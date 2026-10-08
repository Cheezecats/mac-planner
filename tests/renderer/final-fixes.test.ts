import { describe,it,expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext } from '../../src/renderer/ui';
import { CalendarView, SessionForm } from '../../src/renderer/Calendar';
import { createEmptyWorkspace, getCalendarOccurrences } from '../../src/core/domain';
import { PlannerService } from '../../src/core/service';
import * as logic from '../../src/renderer/logic';

function workspace(){let state=createEmptyWorkspace();const service=new PlannerService({getSnapshot:()=>state,replaceSnapshot:s=>state=s});const page:any=service.execute('page.create',{title:'Revise',deadline:{date:'2026-10-15',timeZone:'Asia/Shanghai'},blocks:[{id:'checked',type:'checkListItem',props:{checked:true},content:'Already done'},{id:'todo',type:'checkListItem',props:{checked:false},content:'Practice mechanics'}]});return {service,page,get state(){return state}}}

describe('occurrence editing',()=>{
 it('offers named keyboard controls for calendar dates',()=>{
  const w=workspace();const context:any={snapshot:w.state,api:{},request:async()=>{},notify:()=>{},openPage:()=>{},refresh:async()=>{},registerNavigationGuard:()=>()=>{},flushPage:async()=>{}};
  const html=renderToStaticMarkup(createElement(AppContext,{value:context},createElement(CalendarView)));
  expect(html).toContain('data-date=');expect(html).toContain('aria-label="Open ');
 });
 it('offers reopening for a completed occurrence whose weekly series remains planned',()=>{
  const w=workspace();let entry:any=w.service.execute('schedule.create',{pageId:w.page.id,when:{date:'2026-10-07',timeZone:'Asia/Shanghai'},repeat:{frequency:'weekly'},kind:'work'});entry=w.service.execute('schedule.status',{id:entry.id,expectedRevision:entry.revision,occurrenceDate:'2026-10-14',status:'done'});
  const occurrence=getCalendarOccurrences(w.state,'2026-10-14','2026-10-14').find(o=>o.kind==='work')!;
  const context:any={snapshot:w.state,api:{},request:async()=>{},notify:()=>{},openPage:()=>{},refresh:async()=>{},registerNavigationGuard:()=>()=>{},flushPage:async()=>{}};
  const html=renderToStaticMarkup(createElement(AppContext,{value:context},createElement(SessionForm,{page:w.page,occurrence,onClose:()=>{}})));
  expect(entry.status).toBe('planned');expect(html).toContain('Reopen session');
 });
});

describe('focus row projection',()=>{
 it('shows the unfinished action and next work date instead of an unrelated deadline',()=>{
  const w=workspace();w.service.execute('schedule.create',{pageId:w.page.id,blockId:'todo',when:{date:'2026-10-12',timeZone:'Asia/Shanghai'},kind:'work'});
  const project=(logic as any).pageNextAction;
  expect(project).toBeTypeOf('function');
  const row=project(w.state,w.page,'2026-10-07','2026-10-07T12:00:00+08:00');
  expect(row.text).toBe('Practice mechanics');expect(row.when.date).toBe('2026-10-12');expect(row.kind).toBe('work');
 });
});

describe('post-submit quiz feedback',()=>{
 it('updates the selected saved attempt using current revision and preserves other attempt answers',async()=>{
  const w=workspace();let study:any=w.service.execute('study.save',{record:{id:'study',pageId:w.page.id,kind:'quiz',title:'Quiz',cards:[],questions:[{id:'question',type:'short-answer',prompt:'Why?',answer:'Because'}],attempts:[{id:'old',at:'2026-10-07T00:00:00Z',answers:{question:'First answer'}},{id:'new',at:'2026-10-07T01:00:00Z',answers:{question:'New answer'}}],revision:1}});
  study=w.service.execute('study.save',{record:{...study,title:'Renamed while practicing'},expectedRevision:study.revision});
  const persist=(logic as any).saveAttemptAssessment;
  expect(persist).toBeTypeOf('function');
  const request=async(method:string,params:any={})=>w.service.execute(method,params);
  await persist(request,'study','old','question','got-it');
  const saved=w.state.studies[0];expect(saved.title).toBe('Renamed while practicing');expect(saved.attempts[0].answers.question).toBe('First answer');expect(saved.attempts[0].selfAssessment).toEqual({question:'got-it'});expect(saved.attempts[1].selfAssessment).toBeUndefined();
 });
});

describe('assistant page context',()=>{
 it('commits pending edits before sending and limits selected assets to the active page',async()=>{
  const w=workspace();w.state.assets=[{id:'current-source',pageId:w.page.id,name:'Current',kind:'file-link',size:0,mime:'text/plain'},{id:'other-source',pageId:'other-page',name:'Other',kind:'file-link',size:0,mime:'text/plain'}];
  let release!:()=>void;const flush=new Promise<void>(resolve=>release=resolve);const calls:any[]=[];
  const send=(logic as any).sendScopedAssistant;expect(send).toBeTypeOf('function');
  const sending=send({flushPage:()=>flush,request:async(method:string,params:any)=>{calls.push({method,params})},snapshot:w.state,page:w.page,text:'Explain this',model:'model',assetIds:['current-source','other-source']});
  expect(calls).toHaveLength(0);release();await sending;
  expect(calls).toEqual([{method:'assistant.send',params:{pageId:w.page.id,text:'Explain this',model:'model',assetIds:['current-source']}}]);
 });
});
