import type { Page, PageBlock, Label, WorkspaceSnapshot, StudyRecord } from '../shared/types';
import { addDays, dateValueMillis, flattenBlocks, getCalendarOccurrences } from '../core/domain';
export const localDate = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const parseDate = (date:string) => new Date(`${date}T12:00:00`);
export const shiftDate = (date:string,days:number) => {const d=parseDate(date);d.setDate(d.getDate()+days);return localDate(d)};
export function weekDays(date:string) {const d=parseDate(date);const monday=shiftDate(date,-((d.getDay()+6)%7));return Array.from({length:7},(_,i)=>shiftDate(monday,i))}
export function monthDays(date:string) {const d=parseDate(date);d.setDate(1);const first=localDate(d),start=weekDays(first)[0];d.setMonth(d.getMonth()+1);d.setDate(0);const count=Math.ceil((((parseDate(first).getDay()+6)%7)+d.getDate())/7)*7;return Array.from({length:count},(_,i)=>shiftDate(start,i))}
export function blockText(blocks:PageBlock[]):string {return blocks.map(b=>{const text=typeof b.content==='string'?b.content:Array.isArray(b.content)?b.content.map((c:any)=>c.text??'').join(' '):b.type==='table'?JSON.stringify(b.content):'';return `${text} ${b.children?blockText(b.children):''}`}).join(' ')}
export function filterPages(pages:Page[],search='',label='',status='active',labels:Label[]=[]) {const q=search.toLocaleLowerCase().trim();return pages.filter(p=>(status==='all'?p.status!=='trashed':p.status===status)&&(!label||p.labels.includes(label))&&(!q||`${p.title} ${p.labels.map(id=>labels.find(l=>l.id===id)?.name??id).join(' ')} ${blockText(p.blocks)}`.toLocaleLowerCase().includes(q)))}
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
