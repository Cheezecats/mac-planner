import {contextBridge,ipcRenderer} from 'electron';
let paused=false;let ownId='';let ownState:Record<string,unknown>={},inputs:Record<string,unknown>={};
ipcRenderer.on('widget:init',(_event,data)=>{ownId=data.id;ownState=data.state;inputs=data.inputs;window.dispatchEvent(new Event('planner-ready'))});
function saveState(state:Record<string,unknown>,flushNonce?:string){
  if(paused&&!flushNonce)return Promise.resolve();
  if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('Tool state must be a JSON object');
  const serialized=JSON.stringify(state,(_key,value)=>{if(value===undefined||['function','symbol','bigint'].includes(typeof value)||(typeof value==='number'&&!Number.isFinite(value)))throw new Error('Tool state must contain JSON values');return value});
  if(new TextEncoder().encode(serialized).length>1_000_000)throw new Error('Tool state is too large');
  ownState=JSON.parse(serialized);
  return ipcRenderer.invoke('widget:save-state',{type:'save-state',id:ownId,state:ownState,...(flushNonce?{flushNonce}:{})});
}
ipcRenderer.on('widget:flush-request',(_event,{nonce})=>{paused=true;void saveState(ownState,nonce).catch(()=>{paused=false})});
ipcRenderer.on('widget:resume',()=>{paused=false});
contextBridge.exposeInMainWorld('PlannerWidget',{
  getState:()=>structuredClone(ownState),getInputs:()=>structuredClone(inputs),saveState:(state:Record<string,unknown>)=>saveState(state),setState:(state:Record<string,unknown>)=>saveState(state)
});
