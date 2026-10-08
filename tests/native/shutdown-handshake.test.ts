import {it,expect,vi} from 'vitest';
import {requirePlannerSurface,ShutdownHandshake} from '../../src/electron/shutdown';
import {RequestDrain} from '../../src/electron/request-drain';
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise<any>(yes=>resolve=yes);return {promise,resolve}};
it('rejects foreign senders, foreign frames and retired windows for every shutdown acknowledgement',()=>{
  const frame={},sender={mainFrame:frame},window={webContents:sender};
  expect(()=>requirePlannerSurface({sender,senderFrame:frame},window)).not.toThrow();
  expect(()=>requirePlannerSurface({sender:{mainFrame:frame},senderFrame:frame},window)).toThrow('Untrusted Planner surface');
  expect(()=>requirePlannerSurface({sender,senderFrame:{}},window)).toThrow('Untrusted Planner surface');
  expect(()=>requirePlannerSurface({sender,senderFrame:null},window)).toThrow('Untrusted Planner surface');
  expect(()=>requirePlannerSurface({sender,senderFrame:frame},null)).toThrow('Untrusted Planner surface');
});
it('stale nonce does not release database shutdown and a matching failed drain aborts it',async()=>{
  const handshake=new ShutdownHandshake();const waiting=handshake.wait('current',()=>{});
  const observed=expect(waiting).rejects.toThrow('Pending writing failed');
  expect(()=>handshake.acknowledge({nonce:'previous'})).toThrow('Invalid shutdown acknowledgement');
  handshake.acknowledge({nonce:'current',error:'Pending writing failed'});await observed;
  const retry=handshake.wait('retry',()=>{});handshake.acknowledge({nonce:'retry'});await retry;
});
it('missing renderer acknowledgement times out rather than closing storage unsafely',async()=>{
  vi.useFakeTimers();try{
    const handshake=new ShutdownHandshake();const waiting=handshake.wait('missing',()=>{});
    const observed=expect(waiting).rejects.toThrow(/did not finish/);
    await vi.advanceTimersByTimeAsync(10_000);await observed;
    const retry=handshake.wait('retry',()=>{});handshake.acknowledge({nonce:'retry'});await retry;
  }finally{vi.useRealTimers()}
});
it('main request drain finishes every admitted request before closure and can resume',async()=>{
  const gate=new RequestDrain(),first=deferred(),second=deferred();
  const admittedFirst=gate.run(()=>first.promise),admittedSecond=gate.run(()=>second.promise);
  let drained=false;const drain=gate.pauseAndDrain().then(()=>{drained=true});
  await expect(gate.run(async()=>({saved:true}))).rejects.toThrow(/Quit/);
  first.resolve({saved:true});await admittedFirst;await Promise.resolve();expect(drained).toBe(false);
  second.resolve({pages:[]});await admittedSecond;await drain;expect(drained).toBe(true);
  gate.resume();expect(await gate.run(async()=>({saved:true}))).toEqual({saved:true});
});
