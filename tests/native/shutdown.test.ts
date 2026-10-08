import {beforeEach,afterEach,it,expect,vi} from 'vitest';

const ipc=vi.hoisted(()=>({bridge:null as any,listeners:new Map<string,((event:unknown,value:any)=>void)[]>(),calls:[] as {channel:string;args:any[]}[],transport:async(_channel:string,..._args:any[])=>({received:true}) as any}));
vi.mock('electron',()=>({contextBridge:{exposeInMainWorld:(_name:string,value:any)=>ipc.bridge=value},ipcRenderer:{
  on:(channel:string,listener:(event:unknown,value:any)=>void)=>ipc.listeners.set(channel,[...(ipc.listeners.get(channel)??[]),listener]),
  removeListener:()=>{},
  invoke:(channel:string,...args:any[])=>{ipc.calls.push({channel,args});return ipc.transport(channel,...args)}
}}));
beforeEach(()=>{vi.resetModules();ipc.bridge=null;ipc.listeners.clear();ipc.calls=[];ipc.transport=async()=>({received:true});vi.stubGlobal('window',{addEventListener:()=>{}})});
afterEach(()=>vi.unstubAllGlobals());
const signal=(channel:string,value?:any)=>{for(const listener of ipc.listeners.get(channel)??[])listener({},value)};
const deferred=()=>{let resolve!:(value:any)=>void,reject!:(reason:Error)=>void;const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};

it('preload quiescence acknowledges only after admitted writing and a post-flush refresh settle',async()=>{
  const write=deferred(),refresh=deferred();
  ipc.transport=async(channel,method)=>channel==='planner:request'?(method==='page.update'?write.promise:refresh.promise):{received:true};
  await import('../../src/electron/preload');
  const writing=ipc.bridge.request('page.update',{title:'pending title'}),reading=ipc.bridge.request('workspace.get');
  signal('planner:quiesce',{nonce:'shutdown-1'});
  const late=ipc.bridge.request('workspace.get');void late.catch(()=>{});
  expect(ipc.calls.filter(call=>call.channel==='planner:request')).toHaveLength(2);
  await expect(late).rejects.toThrow(/Quit/);
  expect(ipc.calls.filter(call=>call.channel==='planner:quiesced')).toHaveLength(0);
  write.resolve({saved:true});await writing;await Promise.resolve();
  expect(ipc.calls.filter(call=>call.channel==='planner:quiesced')).toHaveLength(0);
  refresh.resolve({pages:[]});await reading;
  await vi.waitFor(()=>expect(ipc.calls.filter(call=>call.channel==='planner:quiesced')).toEqual([{channel:'planner:quiesced',args:[{nonce:'shutdown-1'}]}]));
  expect(ipc.calls.filter(call=>call.channel==='planner:request')).toHaveLength(2);
});

it('failed admitted writing fails quiescence and resume restores requests without hiding the error',async()=>{
  const write=deferred();ipc.transport=async(channel)=>channel==='planner:request'?write.promise:{received:true};
  await import('../../src/electron/preload');
  const writing=ipc.bridge.request('page.update');const observed=expect(writing).rejects.toThrow('Retained write failed');
  signal('planner:quiesce',{nonce:'failed-quit'});write.reject(new Error('Retained write failed'));await observed;
  await vi.waitFor(()=>expect(ipc.calls.filter(call=>call.channel==='planner:quiesced')[0]?.args[0]).toEqual({nonce:'failed-quit',error:'Retained write failed'}));
  signal('planner:resume');ipc.transport=async()=>({saved:true});
  expect(await ipc.bridge.request('page.update')).toEqual({saved:true});
});

it('resume cancels an old quiescence acknowledgement while its pending request finishes',async()=>{
  const refresh=deferred();ipc.transport=async()=>refresh.promise;
  await import('../../src/electron/preload');const reading=ipc.bridge.request('workspace.get');
  signal('planner:quiesce',{nonce:'timed-out'});signal('planner:resume');refresh.resolve({pages:[]});await reading;await Promise.resolve();await Promise.resolve();
  expect(ipc.calls.filter(call=>call.channel==='planner:quiesced')).toHaveLength(0);
});
