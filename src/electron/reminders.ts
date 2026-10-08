import {Notification} from 'electron';
import {getCalendarOccurrences,dateValueMillis,addDays} from '../core/domain';
import type {WorkspaceSnapshot} from '../shared/types';
import type {IntegrationVault} from '../integrations/types';
export class ReminderRunner {
  private last=Date.now();private timer:NodeJS.Timeout|null=null;private busy=false;
  constructor(private getSnapshot:()=>Promise<WorkspaceSnapshot>,private vault:IntegrationVault,private openPage:(id:string,blockId?:string)=>void){}
  start(){this.last=Date.now();this.timer=setInterval(()=>void this.tick(),30_000)}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
  async tick(){if(this.busy)return;this.busy=true;const now=Date.now(),since=now-this.last>90_000?now:this.last;this.last=now;
    try{const snapshot=await this.getSnapshot(),today=new Date(now).toLocaleDateString('en-CA');const fired=await this.vault.get<Record<string,number>>('reminders:fired')??{};const lead=Math.max(8,...snapshot.pages.map(p=>Math.ceil((p.reminder?.beforeMinutes??0)/1440)+1),...snapshot.entries.map(e=>Math.ceil((e.reminder?.beforeMinutes??0)/1440)+1));for(const occurrence of getCalendarOccurrences(snapshot,addDays(today,-1),addDays(today,lead))){const page=snapshot.pages.find(p=>p.id===occurrence.pageId);if(!page||page.status!=='active'||!occurrence.active||occurrence.status!=='planned')continue;const spec=occurrence.kind==='deadline'?page.reminder:snapshot.entries.find(e=>e.id===occurrence.entryId)?.reminder;if(!spec?.enabled)continue;const due=dateValueMillis({...occurrence.when,time:occurrence.when.time??spec.time??'09:00'})-spec.beforeMinutes*60_000;const key=`${occurrence.id}:${due}`;if(due<=since||due>now||fired[key]||(page.remindersResumedAt!==undefined&&due<=Date.parse(page.remindersResumedAt)))continue;const notification=new Notification({title:page.title||'Planner reminder',body:occurrence.kind==='deadline'?'Deadline approaching':occurrence.title||'Planned work'});notification.on('click',()=>this.openPage(page.id,occurrence.blockId));notification.show();fired[key]=now}for(const [id,time]of Object.entries(fired))if(now-time>60*86400000)delete fired[id];await this.vault.set('reminders:fired',fired)}catch(error){console.error('Reminder check failed',String(error))}finally{this.busy=false}}
}
