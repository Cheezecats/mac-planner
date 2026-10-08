import {it,expect,vi} from 'vitest';
const shown=vi.hoisted(()=>vi.fn());
vi.mock('electron',()=>({Notification:class{on(){}show(){shown()}}}));
import {ReminderRunner} from '../../src/electron/reminders';
import {createEmptyWorkspace} from '../../src/core/domain';
it('delivers a due opt-in reminder beyond eight days and never bursts delayed reminders',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-01T08:59:30Z'));
 const snapshot=createEmptyWorkspace();snapshot.pages.push({id:'p',title:'Exam',blocks:[],deadline:{date:'2026-10-15',time:'09:00',timeZone:'UTC'},reminder:{enabled:true,beforeMinutes:20160},labels:[],status:'active',pinned:false,pinOrder:0,parentId:null,revision:1,createdAt:'2026-10-01',updatedAt:'2026-10-01',trashedAt:null,isTemplate:false});
 const vault={get:async<T>()=>null as T|null,set:async()=>{},delete:async()=>{}};const runner=new ReminderRunner(async()=>snapshot,vault,()=>{});
 try{vi.setSystemTime(new Date('2026-10-01T09:00:00Z'));await runner.tick();expect(shown).toHaveBeenCalledTimes(1);vi.setSystemTime(new Date('2026-10-16T09:00:00Z'));await runner.tick();expect(shown).toHaveBeenCalledTimes(1)}finally{runner.stop();vi.useRealTimers()}
});
