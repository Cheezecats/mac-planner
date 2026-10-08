import {contextBridge,ipcRenderer} from 'electron';
window.addEventListener('DOMContentLoaded',()=>{document.documentElement.dataset.desktop='true'});
contextBridge.exposeInMainWorld('planner',{
  isDesktop:true,
  request:(method:string,params:Record<string,unknown>={})=>ipcRenderer.invoke('planner:request',method,params),
  subscribe:(callback:(event:unknown)=>void)=>{const listener=(_event:unknown,event:unknown)=>callback(event);ipcRenderer.on('planner:event',listener);return()=>ipcRenderer.removeListener('planner:event',listener)}
});
