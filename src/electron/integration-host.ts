import {shell} from 'electron';
import {OAuthManager,GoogleClient,MicrosoftClient,AssistantClient,extractDeadlineSuggestions} from '../integrations';
import type {AppEvent,Connection,WorkspaceSnapshot} from '../shared/types';
import type {IntegrationVault} from '../integrations/types';
type Request=<T=unknown>(method:string,params?:Record<string,unknown>)=>Promise<T>;
export class IntegrationHost {
  private oauth:OAuthManager;private assistants=new Map<string,AssistantClient>();
  private purgingPages=new Set<string>();
  constructor(private request:Request,private vault:IntegrationVault&{keys():Promise<string[]>},private readAsset:(id:string,pageId:string)=>Promise<string>,private emit:(event:AppEvent)=>void,publicConfig:{googleClientId?:string;microsoftClientId?:string}={googleClientId:process.env.PLANNER_GOOGLE_CLIENT_ID,microsoftClientId:process.env.PLANNER_MICROSOFT_CLIENT_ID}){
    this.oauth=new OAuthManager({vault,openExternal:url=>shell.openExternal(url),providers:{google:publicConfig.googleClientId?{clientId:publicConfig.googleClientId}:undefined,microsoft:publicConfig.microsoftClientId?{clientId:publicConfig.microsoftClientId}:undefined,openai:{appName:'Planner'}}});
  }
  private async client(id:string){const snapshot=await this.request<WorkspaceSnapshot>('workspace.get');const connection=snapshot.connections.find(c=>c.id===id);if(!connection||connection.provider==='openai')throw new Error('Select a connected email account');const session=await this.oauth.session(id);const options={connectionId:id,accountId:session?.accountId,accountName:session?.accountName,accessToken:(refresh?:boolean)=>this.oauth.accessToken(id,refresh)};return connection.provider==='google'?new GoogleClient(options):new MicrosoftClient(options)}
  private async assistant(){const snapshot=await this.request<WorkspaceSnapshot>('workspace.get');const connection=snapshot.connections.find(c=>c.provider==='openai'&&c.status==='connected');if(!connection)throw new Error('Sign in with ChatGPT first');let client=this.assistants.get(connection.id);if(!client){const id=connection.id,session=await this.oauth.session(id);if(!session)throw new Error('Sign in again');const prefix=`account:${session.accountId}:`;const scoped:IntegrationVault={get:key=>this.vault.get(prefix+key),set:(key,value)=>{if(key.startsWith('assistant:history:')&&this.purgingPages.has(key.slice('assistant:history:'.length)))return Promise.reject(new Error('Current page is unavailable.'));return this.vault.set(prefix+key,value)},delete:key=>this.vault.delete(prefix+key)};client=new AssistantClient({accessToken:refresh=>this.oauth.accessToken(id,refresh),session:()=>this.oauth.session(id),historyVault:scoped,gateway:{request:this.request,readAsset:this.readAsset},emit:event=>{this.emit(event);if(event.type==='assistant-done'||event.type==='assistant-error')this.emit({type:'changed'})}});this.assistants.set(id,client)}return client}
  async initialize():Promise<void>{
    const snapshot=await this.request<WorkspaceSnapshot>('workspace.get');
    for(const key of await this.vault.keys()){
      if(!key.startsWith('account:')||!key.includes(':assistant:history:'))continue;
      if(!snapshot.pages.some(page=>key.endsWith(`:assistant:history:${page.id}`)))await this.vault.delete(key);
    }
  }
  async purgePage(pageId:string):Promise<void>{
    this.purgingPages.add(pageId);
    for(const client of this.assistants.values())client.cancel(pageId);
    try{for(const key of await this.vault.keys())if(key.startsWith('account:')&&key.endsWith(`:assistant:history:${pageId}`))await this.vault.delete(key)}
    finally{this.purgingPages.delete(pageId)}
  }
  async handle(method:string,p:Record<string,unknown>){
    if(method==='connection.connect'||method==='assistant.signIn'){const provider=method==='assistant.signIn'?'openai':p.provider;if(provider!=='google'&&provider!=='microsoft'&&provider!=='openai')throw new Error('Unsupported provider');const c=await this.oauth.signIn(provider);await this.request('connection.save',{record:c});this.emit({type:'changed'});return c}
    if(method==='connection.disconnect'){const id=String(p.id);const client=this.assistants.get(id);if(client){const s=await this.request<WorkspaceSnapshot>('workspace.get');for(const page of s.pages)client.cancel(page.id);this.assistants.delete(id)}await this.oauth.disconnect(id);await this.request('connection.remove',{id});this.emit({type:'changed'});return}
    if(method==='connection.folders')return (await this.client(String(p.id))).folders();
    if(method==='connection.calendars')return (await this.client(String(p.id))).calendars();
    if(method==='connection.scan'){const id=String(p.id),snapshot=await this.request<WorkspaceSnapshot>('workspace.get');const result=await(await this.client(id)).messages({folder:p.folder as string|undefined,from:p.from as string|undefined,to:p.to as string|undefined});const suggestions=extractDeadlineSuggestions(result.items,id,Intl.DateTimeFormat().resolvedOptions().timeZone,snapshot.suggestions);await this.request('suggestion.upsert',{suggestions});this.emit({type:'changed'});return {count:suggestions.length,complete:result.complete,errors:result.errors}}
    if(method==='connection.refresh'){const id=String(p.id),client=await this.client(id),calendars=await client.calendars();const ids=Array.isArray(p.calendarIds)?p.calendarIds.map(String):calendars.items.map(c=>c.id);const events=[];const errors=[...calendars.errors];let complete=calendars.complete;for(const calendarId of ids){const result=await client.events({calendarId,from:String(p.from??new Date().toISOString().slice(0,10)),to:String(p.to??new Date(Date.now()+90*86400000).toISOString().slice(0,10)),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});events.push(...result.items);errors.push(...result.errors);complete&&=result.complete}if(complete)await this.request('calendar.import',{connectionId:id,events});this.emit({type:'changed'});return {count:events.length,complete,errors}}
    const assistant=await this.assistant();if(method==='assistant.models')return assistant.models();if(this.purgingPages.has(String(p.pageId)))throw new Error('Current page is unavailable.');if(method==='assistant.history')return assistant.history(String(p.pageId));if(method==='assistant.cancel'){assistant.cancel(String(p.pageId));return}if(method==='assistant.send'){void assistant.send({pageId:String(p.pageId),text:String(p.text),model:p.model as string|undefined,assetIds:p.assetIds as string[]|undefined}).catch(error=>this.emit({type:'assistant-error',pageId:String(p.pageId),text:String(error)}));return {started:true}}
    throw new Error('Unknown integration action');
  }
}
