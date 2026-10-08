import {it,expect,vi} from 'vitest';
const shown=vi.hoisted(()=>vi.fn());
vi.mock('electron',()=>({Notification:class{on(){}show(){shown()}}}));
import {ReminderRunner} from '../../src/electron/reminders';
import {createEmptyWorkspace} from '../../src/core/domain';
import { PlannerService } from '../../src/core/service';
it('does not deliver reminders that became due before reopening, but still delivers future reminders', async () => {
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-08T08:59:50Z'));shown.mockClear();
 let snapshot=createEmptyWorkspace();const service=new PlannerService({getSnapshot:()=>structuredClone(snapshot),replaceSnapshot:s=>{snapshot=structuredClone(s)}});
 const request=(method:string,params:Record<string,unknown>)=>service.execute(method,params) as any;
 let page=request('page.create',{title:'Reopened essay',deadline:{date:'2026-10-08',time:'09:00',timeZone:'UTC'}});
 page=request('page.update',{id:page.id,expectedRevision:page.revision,changes:{reminder:{enabled:true,beforeMinutes:0}}});
 for (const time of ['09:00','09:01']) request('schedule.create',{pageId:page.id,kind:'work',when:{date:'2026-10-08',time,timeZone:'UTC'},reminder:{enabled:true,beforeMinutes:0}});
 page=request('page.complete',{id:page.id,expectedRevision:page.revision});
 const vault={get:async<T>()=>null as T|null,set:async()=>{},delete:async()=>{}};const runner=new ReminderRunner(async()=>snapshot,vault,()=>{});
 try {vi.setSystemTime(new Date('2026-10-08T09:00:10Z'));request('page.reopen',{id:page.id,expectedRevision:page.revision});await runner.tick();expect(shown).not.toHaveBeenCalled();vi.setSystemTime(new Date('2026-10-08T09:01:01Z'));await runner.tick();expect(shown).toHaveBeenCalledTimes(1)}finally{runner.stop();vi.useRealTimers()}
});
it('delivers a due opt-in reminder beyond eight days and never bursts delayed reminders',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-01T08:59:30Z'));
 const snapshot=createEmptyWorkspace();snapshot.pages.push({id:'p',title:'Exam',blocks:[],deadline:{date:'2026-10-15',time:'09:00',timeZone:'UTC'},reminder:{enabled:true,beforeMinutes:20160},labels:[],status:'active',pinned:false,pinOrder:0,parentId:null,revision:1,createdAt:'2026-10-01',updatedAt:'2026-10-01',trashedAt:null,isTemplate:false});
 const vault={get:async<T>()=>null as T|null,set:async()=>{},delete:async()=>{}};const runner=new ReminderRunner(async()=>snapshot,vault,()=>{});
 try{vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));await runner.tick();expect(shown).toHaveBeenCalledTimes(1);vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));await runner.tick();expect(shown).toHaveBeenCalledTimes(1)}finally{runner.stop();vi.useRealTimers()}
});
