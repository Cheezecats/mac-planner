import type { Page, PageBlock, Label, WorkspaceSnapshot, StudyRecord, PlannerUICommand, PageReopenResult } from '../shared/types';
import { addDays, dateValueMillis, flattenBlocks, getCalendarOccurrences } from '../core/domain';
export const localDate = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const parseDate = (date:string) => new Date(`${date}T12:00:00`);
export const shiftDate = (date:string,days:number) => {const d=parseDate(date);d.setDate(d.getDate()+days);return localDate(d)};
export function weekDays(date:string) {const d=parseDate(date);const monday=shiftDate(date,-((d.getDay()+6)%7));return Array.from({length:7},(_,i)=>shiftDate(monday,i))}
export function monthDays(date:string) {const d=parseDate(date);d.setDate(1);const first=localDate(d),start=weekDays(first)[0];d.setMonth(d.getMonth()+1);d.setDate(0);const count=Math.ceil((((parseDate(first).getDay()+6)%7)+d.getDate())/7)*7;return Array.from({length:count},(_,i)=>shiftDate(start,i))}
function contentText(content:unknown):string {if(typeof content==='string')return content;if(Array.isArray(content))return content.map(contentText).join(' ');if(content&&typeof content==='object'){const value=content as any;if(typeof value.text==='string')return value.text;if(value.type==='link')return contentText(value.content);if(Array.isArray(value.rows))return value.rows.map((row:any)=>contentText(row.cells)).join(' ');if(value.type==='tableCell')return contentText(value.content)}return ''}
export function blockText(blocks:PageBlock[]):string {return blocks.map(b=>`${contentText(b.content)} ${b.children?blockText(b.children):''}`).join(' ')}
const labelText=(page:Page,labels:Label[])=>page.labels.map(id=>labels.find(label=>label.id===id)?.name??id).join(' ');
export function filterPages(pages:Page[],search='',label='',status='active',labels:Label[]=[]) {
  const q=search.toLocaleLowerCase().trim(),rank=(p:Page)=>p.title.toLocaleLowerCase().includes(q)?0:labelText(p,labels).toLocaleLowerCase().includes(q)?1:2;
  const matches=pages.filter(p=>(status==='all'?p.status!=='trashed':p.status===status)&&(!label||p.labels.includes(label))&&(!q||`${p.title} ${labelText(p,labels)} ${blockText(p.blocks)}`.toLocaleLowerCase().includes(q)));
  return q?matches.sort((a,b)=>rank(a)-rank(b)||(b.updatedAt??'').localeCompare(a.updatedAt??'')):matches;
}
export function searchSnippet(page:Page,query:string,labels:Label[]) {const body=blockText(page.blocks).replace(/\s+/g,' ').trim(),q=query.toLocaleLowerCase().trim();const text=body.toLocaleLowerCase().includes(q)?body:labelText(page,labels);const match=text.toLocaleLowerCase().indexOf(q),start=Math.max(0,match-45),end=Math.min(text.length,start+160);return `${start?'…':''}${text.slice(start,end)}${end<text.length?'…':''}`}
export function searchKeyAction(key:string,selected:number,count:number,composing:boolean):{selected?:number;open?:number;close?:boolean} {if(composing)return {};if(key==='Escape')return {close:true};if(key==='Enter'&&count)return {open:Math.min(selected,count-1)};if(key==='ArrowDown'&&count)return {selected:Math.min(selected+1,count-1)};if(key==='ArrowUp'&&count)return {selected:Math.max(0,selected-1)};return {}}

/** A visit becomes history only after the editor guard and route commit succeed. */
export class VisitHistory<T> {
  private visits:T[];private index=0;private queue:Promise<unknown>=Promise.resolve();
  constructor(initial:T,private guard:()=>Promise<void>,private commit:(visit:T,previous?:T)=>Promise<void>,private capture?:(visit:T)=>T){this.visits=[structuredClone(initial)]}
  get current():T{return structuredClone(this.visits[this.index])}
  get previous():T|undefined{return this.index?structuredClone(this.visits[this.index-1]):undefined}
  private enqueue(action:()=>Promise<void>){const result=this.queue.then(action);this.queue=result.catch(()=>{});return result}
  visit(next:T){return this.enqueue(async()=>{await this.guard();const current=this.capture?.(this.current)??this.current;await this.commit(next,structuredClone(current));this.visits[this.index]=current;this.visits=this.visits.slice(0,this.index+1);this.visits.push(structuredClone(next));this.index++})}
  private move(direction:number){return this.enqueue(async()=>{const next=this.index+direction;if(next<0||next>=this.visits.length)return;await this.guard();const current=this.capture?.(this.current)??this.current;const previous=next>0?structuredClone(this.visits[next-1]):undefined;await this.commit(structuredClone(this.visits[next]),previous);this.visits[this.index]=current;this.index=next})}
  back(){return this.move(-1)}forward(){return this.move(1)}
}
export function createCommandDispatcher(guard:()=>Promise<void>,handlers:Partial<Record<PlannerUICommand,()=>unknown|Promise<unknown>>>) {let queue:Promise<unknown>=Promise.resolve();return (command:PlannerUICommand)=>{const result=queue.then(async()=>{await guard();await handlers[command]?.()});queue=result.catch(()=>{});return result}}
export function operationFeedback(method:string,result:any):string {
  const names:Record<string,string>={'backup.configure':'Backup configuration','backup.create':'Backup creation','backup.restore':'Workspace restore','export.workspace':'Workspace export'};
  if(method in names)return result==null||result.cancelled?`${names[method]} cancelled.`:`${names[method]} complete.`;
  if(method==='app.notificationsStatus')return `${result.supported?'Native notifications are supported.':'Native notifications are unavailable.'} ${result.message??'Delivery has not been verified.'}`;
  if(method==='app.companionInfo')return `${result.name??'Planner companion'}. ${result.instructions??'Keep Planner running to use the companion.'}${result.socket?` Local connection: ${result.socket}`:''}`;
  return typeof result==='string'?result:'Done.';
}
export function prepareEditorBlocks(blocks:PageBlock[],supported:Set<string>):any[] {return blocks.map(b=>supported.has(b.type)?{...b,children:b.children?prepareEditorBlocks(b.children,supported):undefined}:{id:b.id,type:'unsupported',props:{originalType:b.type,originalPayload:JSON.stringify(b)},content:undefined})}
export function restoreUnknownBlocks(blocks:PageBlock[],original:PageBlock[]):PageBlock[] {
  const originals=new Map(flattenBlocks(original).map(b=>[b.id,b]));
  const duplicate=(b:PageBlock,id:string=uid()):PageBlock=>({...structuredClone(b),id,children:b.children?.map(child=>duplicate(child))});
  return blocks.map(b=>{
    if(b.type==='unsupported'){
      if(originals.has(b.id))return structuredClone(originals.get(b.id)!);
      try{const source=JSON.parse(String(b.props.originalPayload??'')) as PageBlock;if(source&&typeof source.type==='string'&&source.props&&source.type!=='unsupported')return duplicate(source,b.id)}catch{/* Preserve an unreadable placeholder until a supported version is available. */}
    }
    return {...b,children:b.children?restoreUnknownBlocks(b.children,original):undefined};
  });
}
export function clampPopup(anchor:{left:number;top:number;width:number;height:number},width:number,height:number,viewport:{width:number;height:number}) {return {left:Math.max(12,Math.min(anchor.left+anchor.width/2-width/2,viewport.width-width-12)),top:Math.max(12,anchor.top-height-8)}}
export class SerializedSaver<T> {private pending:T|undefined;private running:Promise<void>|undefined;constructor(private save:(value:T)=>Promise<void>){} push(value:T) {this.pending=value;if(!this.running)this.running=this.drain();return this.running}private async drain(){try{while(this.pending!==undefined){const value=this.pending;this.pending=undefined;await this.save(value)}}finally{this.running=undefined}}}
export function dueLabel(date:Page['deadline']) {if(!date)return '—';const today=localDate();return `${date.date===today?'Today':parseDate(date.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}${date.time?` · ${date.time}`:''}`}
export const uid = () => crypto.randomUUID();
export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function pageNextAction(snapshot:WorkspaceSnapshot,page:Page,today=localDate(),nowISO=new Date().toISOString()) {
  const entries=snapshot.entries.filter(entry=>entry.pageId===page.id);
  const dates=entries.flatMap(entry=>[entry.when.date,...Object.values(entry.exceptions).flatMap(exception=>exception.when?[exception.when.date]:[])]);
  const from=[today,...dates].sort()[0],to=[addDays(today,7),...dates,page.deadline?.date??today].sort().at(-1)!;
  const now=Date.parse(nowISO);
  const occurrences=getCalendarOccurrences(snapshot,from,to).filter(o=>o.pageId===page.id&&o.active&&o.status==='planned'&&(o.kind!=='event'||dateValueMillis(o.when,!o.when.time)>=now));
  const relevant=occurrences[0];
  const blocks=flattenBlocks(page.blocks);
  const next=blocks.find(block=>block.id===relevant?.blockId&&block.props.checked!==true)??blocks.find(block=>block.type==='checkListItem'&&block.props.checked!==true);
  return {text:next?blockText([next]).trim():relevant?.kind==='work'&&relevant.title!==page.title?relevant.title:blockText(page.blocks).trim().slice(0,100),when:relevant?.when??page.deadline,kind:relevant?.kind};
}

type Request=(method:string,params?:Record<string,unknown>)=>Promise<any>;
export async function reopenSavedPage(flush:()=>Promise<void>,request:Request,id:string,revision:()=>number,notify:(message:string)=>void) {await flush();const result=await request('page.reopen',{id,expectedRevision:revision()}) as PageReopenResult;notify(result.message);return result.page}
export async function saveAttemptAssessment(request:Request,studyId:string,attemptId:string,questionId:string,value:'again'|'got-it') {
  const snapshot=await request('workspace.get') as WorkspaceSnapshot;
  const record=snapshot.studies.find(study=>study.id===studyId);
  if(!record||!record.attempts.some(attempt=>attempt.id===attemptId))throw new Error('This saved attempt is unavailable.');
  if(!record.questions.some(question=>question.id===questionId&&question.type==='short-answer'))throw new Error('This short-answer question is unavailable.');
  return await request('study.save',{record:{...record,attempts:record.attempts.map(attempt=>attempt.id===attemptId?{...attempt,selfAssessment:{...attempt.selfAssessment,[questionId]:value}}:attempt)},expectedRevision:record.revision}) as StudyRecord;
}

export async function sendScopedAssistant(options:{flushPage:()=>Promise<void>;request:Request;snapshot:WorkspaceSnapshot;page:Page;text:string;model?:string;assetIds:string[];isCurrent?:()=>boolean}) {
  await options.flushPage();
  if(options.isCurrent&&!options.isCurrent())return;
  const assetIds=options.assetIds.filter(id=>options.snapshot.assets.some(asset=>asset.id===id&&asset.pageId===options.page.id));
  return options.request('assistant.send',{pageId:options.page.id,text:options.text,model:options.model||undefined,assetIds});
}
