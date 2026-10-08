import {WebContentsView,ipcMain,session,type BrowserWindow} from 'electron';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AppEvent,WidgetRecord,WorkspaceSnapshot} from '../shared/types';
import {sanitizeWidgetSource,isAllowedWidgetURL,widgetBridgeMessage} from './widget-policy';
type Request=<T=unknown>(method:string,params?:Record<string,unknown>)=>Promise<T>;
export class WidgetHost {
  private views=new Map<string,WebContentsView>();private owners=new Map<number,string>();
  private saves=new Map<string,Promise<void>>();private failures=new Map<string,{message:unknown;error:Error}>();private flushes=new Map<string,{senderId:number;resolve:()=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();private obscured=false;private closing=new Map<string,Promise<void>>();
  constructor(private request:Request,private getWindow:()=>BrowserWindow|null,private emit:(event:AppEvent)=>void){
    ipcMain.handle('widget:save-state',(event,message)=>{const id=this.owners.get(event.sender.id);if(!id)throw new Error('Untrusted tool surface');const pending=this.flushes.get(message?.flushNonce);if(pending&&pending.senderId!==event.sender.id)throw new Error('Invalid tool flush');if(pending){clearTimeout(pending.timer);this.flushes.delete(message.flushNonce)}const job=this.enqueue(id,message);if(pending)void job.then(pending.resolve,pending.reject);return job});
  }
  private enqueue(id:string,message:unknown){const next=(this.saves.get(id)??Promise.resolve()).then(()=>this.save(id,message)).then(()=>{this.failures.delete(id)});const settled=next.catch(error=>{this.failures.set(id,{message,error:error instanceof Error?error:new Error(String(error))});this.emit({type:'widget-error',text:String(error),data:{id}})});this.saves.set(id,settled);void settled.then(()=>{if(this.saves.get(id)===settled)this.saves.delete(id)});return next}

  private async save(id:string,message:unknown){const state=widgetBridgeMessage(message,id);const snapshot=await this.request<WorkspaceSnapshot>('workspace.get');const record=snapshot.widgets.find(w=>w.id===id);if(!record)throw new Error('Tool no longer exists');await this.request('widget.save',{record:{...record,state},expectedRevision:record.revision});this.emit({type:'changed'})}
  async handle(method:string,params:Record<string,unknown>){const id=String(params.id??'');if(method==='widget.visibility'){this.obscured=params.visible!==true;for(const view of this.views.values())view.setVisible(!this.obscured);return}if(method==='widget.stop'||method==='widget.unmount'){await this.stopView(id);return}
    if(method==='widget.bounds'){const view=this.views.get(id);if(view)this.bounds(view,params.bounds);return}
    await this.closing.get(id);const snapshot=await this.request<WorkspaceSnapshot>('workspace.get');let record=snapshot.widgets.find(w=>w.id===id);if(!record)throw new Error('Tool not found');
    if(method==='widget.revert'){const version=record.versions.find(v=>v.version===Number(params.version));if(!version)throw new Error('Tool version not found');await this.request('widget.save',{record:{...record,source:version.source,version:record.version+1,versions:[...record.versions,{version:record.version,source:record.source}]},expectedRevision:record.revision});this.emit({type:'changed'});return}
    let bounds=params.bounds;if(method==='widget.reload'){bounds=this.views.get(id)?.getBounds();await this.stopView(id);record=(await this.request<WorkspaceSnapshot>('workspace.get')).widgets.find(w=>w.id===id);if(!record)throw new Error('Tool no longer exists')}
    if(this.views.has(id)){if(bounds)this.bounds(this.views.get(id)!,bounds);return}
    const window=this.getWindow();if(!window)throw new Error('Open Planner to start a tool');
    const partition=`planner-widget-${randomUUID()}`,isolated=session.fromPartition(partition);
    isolated.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));isolated.setPermissionCheckHandler(()=>false);
    isolated.webRequest.onBeforeRequest({urls:['*://*/*','file://*/*']},(_details,callback)=>callback({cancel:true}));
    isolated.on('will-download',event=>event.preventDefault());
    const view=new WebContentsView({webPreferences:{session:isolated,preload:join(__dirname,'widget-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,spellcheck:false}});
    this.views.set(id,view);this.owners.set(view.webContents.id,id);window.contentView.addChildView(view);view.setVisible(!this.obscured);this.bounds(view,bounds??{x:0,y:0,width:1,height:1});
    view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    view.webContents.on('will-navigate',(event,url)=>{if(!isAllowedWidgetURL(url))event.preventDefault()});
    view.webContents.on('will-redirect',event=>event.preventDefault());
    view.webContents.on('unresponsive',()=>{if(!this.remove(id,true,view))return;this.emit({type:'widget-error',text:'The tool stopped responding. Reload it to recover.',data:{id}})});
    view.webContents.on('render-process-gone',(_event,details)=>{if(!this.remove(id,false,view))return;this.emit({type:'widget-error',text:`Tool stopped: ${details.reason}`,data:{id}})});
    await view.webContents.loadURL('about:blank');view.webContents.send('widget:init',{id,state:record.state,inputs:{}});
    const source=sanitizeWidgetSource(record.source);
    let timer:NodeJS.Timeout|undefined;
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{this.remove(id,true,view);this.emit({type:'widget-error',text:'Tool startup timed out. Its saved version is available.',data:{id}});reject(new Error('Tool startup timed out'))},5000)});
    try{await Promise.race([view.webContents.executeJavaScript(`document.open();document.write(${JSON.stringify(source)});document.close();`),timeout])}catch(error){this.remove(id,true,view);throw error}finally{if(timer)clearTimeout(timer)}
  }
  private bounds(view:WebContentsView,value:unknown){const b=value as Record<string,number>;if(!b||['x','y','width','height'].some(k=>!Number.isFinite(b[k])))throw new Error('Invalid tool bounds');view.setBounds({x:Math.max(0,Math.round(b.x)),y:Math.max(0,Math.round(b.y)),width:Math.min(10000,Math.max(0,Math.round(b.width))),height:Math.min(10000,Math.max(0,Math.round(b.height)))})}
  private remove(id:string,force=true,expected?:WebContentsView){const view=this.views.get(id);if(!view||(expected&&view!==expected))return false;this.views.delete(id);this.owners.delete(view.webContents.id);this.getWindow()?.contentView.removeChildView(view);if(!view.webContents.isDestroyed()){if(force)view.webContents.forcefullyCrashRenderer();view.webContents.close({waitForBeforeUnload:false})}return true}
  private flushView(view:WebContentsView){return new Promise<void>((resolve,reject)=>{const nonce=randomUUID();const timer=setTimeout(()=>{this.flushes.delete(nonce);resolve()},1000);this.flushes.set(nonce,{senderId:view.webContents.id,resolve,reject,timer});view.webContents.send('widget:flush-request',{nonce})})}
  private stopView(id:string){const existing=this.closing.get(id);if(existing)return existing;const view=this.views.get(id);if(!view)return Promise.resolve();view.setVisible(false);const stopping=this.flushView(view).then(async()=>{await this.saves.get(id);const failure=this.failures.get(id);if(failure)throw failure.error;this.remove(id,true,view)}).catch(error=>{if(this.views.get(id)===view){view.webContents.send('widget:resume');view.setVisible(!this.obscured)}throw error}).finally(()=>{if(this.closing.get(id)===stopping)this.closing.delete(id)});this.closing.set(id,stopping);return stopping}
  async flushAndStop(stop=true){
    // Retry a retained failed write; intentionally removed resources no longer need persistence.
    if(this.failures.size){const snapshot=await this.request<WorkspaceSnapshot>('workspace.get');for(const[id,failure]of [...this.failures]){if(snapshot.widgets.some(widget=>widget.id===id))await this.enqueue(id,failure.message);else this.failures.delete(id)}}
    try{
      await Promise.all([...this.views.values()].map(view=>this.flushView(view)));
      if(stop)this.stopAll();while(this.saves.size)await Promise.all([...this.saves.values()]);
      if(this.failures.size)throw this.failures.values().next().value!.error;
      if(!stop)for(const view of this.views.values())view.webContents.send('widget:resume');
    }catch(error){for(const view of this.views.values())view.webContents.send('widget:resume');throw error}
  }

  stopAll(){for(const id of this.views.keys())this.remove(id)}
}
