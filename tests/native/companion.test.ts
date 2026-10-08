import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect} from 'node:net';
import {startCompanion,companionRequest} from '../../src/electron/companion';
import { PlannerService } from '../../src/core/service';
import { createEmptyWorkspace } from '../../src/core/domain';
it('passes reopening through the authenticated canonical core and rejects stale or noncompleted pages', async () => {
 const dir=await mkdtemp(join(tmpdir(),'planner-reopen-socket-'));let state=createEmptyWorkspace();
 const service=new PlannerService({getSnapshot:()=>structuredClone(state),replaceSnapshot:s=>{state=structuredClone(s)}});
 const server=await startCompanion(dir,async(method,params)=>service.execute(method,params));
 try {
  let p:any=await companionRequest(dir,'page.create',{title:'Essay'});
  await expect(companionRequest(dir,'page.reopen',{id:p.id,expectedRevision:p.revision})).rejects.toThrow(/completed/);
  p=await companionRequest(dir,'page.complete',{id:p.id,expectedRevision:p.revision});
  await expect(companionRequest(dir,'page.reopen',{id:p.id,expectedRevision:p.revision-1})).rejects.toThrow(/Revision conflict/);
  expect(await companionRequest(dir,'page.reopen',{id:p.id,expectedRevision:p.revision})).toMatchObject({page:{status:'active'},restoredEntryCount:0,skippedEntryCount:0});
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true})}
});
it('preserves Chinese text split across socket packet boundaries and authenticates commands',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'planner-socket-test-'));const received:any[]=[];
 const server=await startCompanion(dir,async(method,params)=>{received.push({method,params});return params});
 try{const token=await readFile(join(dir,'socket-token'),'utf8');const message=Buffer.from(JSON.stringify({id:1,token,method:'page.create',params:{title:'中文'}})+'\n');const split=message.indexOf(Buffer.from('中文'))+1;
 await new Promise<void>((resolve,reject)=>{const socket=connect(join(dir,'planner.sock'));socket.on('error',reject);socket.on('connect',()=>{socket.write(message.subarray(0,split));setTimeout(()=>socket.write(message.subarray(split)),10)});socket.on('data',()=>{socket.end();resolve()})});
 expect(received[0].params.title).toBe('中文');expect(await companionRequest(dir,'page.create',{title:'Another'})).toEqual({title:'Another'});
 await expect(companionRequest(dir,'file.read',{id:'x'})).rejects.toThrow('Unsupported');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true})}
});
