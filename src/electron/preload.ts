import {contextBridge,ipcRenderer} from 'electron';
import {RequestDrain} from './request-drain';
const requests=new RequestDrain();let shutdownNonce:string|null=null;
ipcRenderer.on('planner:quiesce',(_event,message:{nonce:string})=>{
  const nonce=message.nonce;shutdownNonce=nonce;
  void requests.pauseAndDrain().then(()=>{if(shutdownNonce===nonce)return ipcRenderer.invoke('planner:quiesced',{nonce})},error=>{if(shutdownNonce===nonce)return ipcRenderer.invoke('planner:quiesced',{nonce,error:error instanceof Error?error.message:String(error)})}).catch(()=>{});
});
ipcRenderer.on('planner:resume',()=>{shutdownNonce=null;requests.resume()});
window.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.desktop='true'});
contextBridge.exposeInMainWorld('planner',{
  isDesktop:true,
  request:(method:string,params:Record<string,unknown>={})=>requests.run(()=>ipcRenderer.invoke('planner:request',method,params)),
  subscribe:(callback:(event:unknown)=>void)=>{const listener=(_event:unknown,event:unknown)=>callback(event);ipcRenderer.on('planner:event',listener);return()=>ipcRenderer.removeListener('planner:event',listener)}
});
