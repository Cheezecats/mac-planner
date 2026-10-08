import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';

it('native utility transport permits revision-guarded page reopen through the real database',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'planner-data-service-'));
  const original=Object.getOwnPropertyDescriptor(process,'parentPort'),exitListeners=process.listeners('exit');
  const responses:any[]=[];let receive:(event:{data:unknown})=>void=()=>{};
  Object.defineProperty(process,'parentPort',{configurable:true,value:{on:(_event:string,listener:typeof receive)=>receive=listener,postMessage:(message:unknown)=>responses.push(message)}});
  let initialized=false;
  const send=async(message:Record<string,unknown>)=>{receive({data:message});await vi.waitFor(()=>expect(responses.some(value=>message.type==='init'?value.type==='ready':value.id===message.id)).toBe(true));return responses.find(value=>value.id===message.id)};
  try{
    await import('../../src/electron/data-service');
    await send({type:'init',dataDir:directory,key:randomBytes(32).toString('base64')});initialized=true;
    const created=await send({type:'request',id:'create',method:'page.create',params:{title:'Reopen over utility transport'}});
    const completed=await send({type:'request',id:'complete',method:'page.complete',params:{id:created.result.id,expectedRevision:created.result.revision}});
    const reopened=await send({type:'request',id:'reopen',method:'page.reopen',params:{id:created.result.id,expectedRevision:completed.result.revision}});
    expect(reopened.error).toBeUndefined();expect(reopened.result.page.status).toBe('active');
    const stale=await send({type:'request',id:'stale',method:'page.reopen',params:{id:created.result.id,expectedRevision:completed.result.revision}});
    expect(stale.error).toMatch(/Revision conflict/);
  }finally{
    if(initialized)await send({type:'request',id:'close',method:'database.close'});
    if(original)Object.defineProperty(process,'parentPort',original);else Reflect.deleteProperty(process,'parentPort');
    for(const listener of process.listeners('exit'))if(!exitListeners.includes(listener))process.removeListener('exit',listener);
    await rm(directory,{recursive:true,force:true});
  }
});
