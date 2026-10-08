import { PlannerService } from '../core/service';
import { createEmptyWorkspace } from '../core/domain';
import type { AppEvent, PlannerAPI, WorkspaceSnapshot } from '../shared/types';
import type { HistoryEntry } from '../core/repository';

/** The browser preview uses the same domain rules. Native capabilities remain desktop-only. */
async function previewAPI():Promise<PlannerAPI> {
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('planner-browser-preview',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspace');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});
  const stored=await new Promise<{snapshot:WorkspaceSnapshot;history:HistoryEntry[]}|undefined>((resolve,reject)=>{const r=db.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  let snapshot=stored?.snapshot??createEmptyWorkspace(), history=stored?.history??[];
  const listeners=new Set<(event:AppEvent)=>void>();
  const service=new PlannerService({getSnapshot:()=>structuredClone(snapshot),getHistory:()=>structuredClone(history),replaceSnapshot:s=>{snapshot=s;history=[]},commitSnapshot:(s,h)=>{snapshot=s;history=h}});
  let queue=Promise.resolve();
  const persist=()=>new Promise<void>((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({snapshot,history},'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
  return {isDesktop:false,subscribe:callback=>{listeners.add(callback);return ()=>{listeners.delete(callback)}},request:<T>(method:string,params:Record<string,unknown>={})=>{
    const action=async()=>{if(method==='app.openPage'){listeners.forEach(fn=>fn({type:'open-page',pageId:String(params.id)}));return undefined as T}
      if(/^(file\.|backup\.|export\.|connection\.(connect|scan|folders|calendars|refresh|disconnect)|assistant\.|widget\.(mount|bounds|stop|reload|revert|unmount)|app\.)/.test(method))throw new Error('This action requires the desktop app. Browser preview provides local editing only; it has no Keychain, provider authentication, native files, reminders, or isolated native tools.');
      const before=structuredClone({snapshot,history});try{const result=service.execute(method,params);if(method!=='workspace.get'&&method!=='workspace.export'){await persist();listeners.forEach(fn=>fn({type:'changed'}))}return result as T}catch(error){snapshot=before.snapshot;history=before.history;throw error}};
    const result=queue.then(action);queue=result.then(()=>{},()=>{});return result;
  }};
}
let bridge:Promise<PlannerAPI>|undefined;
export const getAPI=()=>bridge??(bridge=window.planner?Promise.resolve(window.planner):previewAPI());
