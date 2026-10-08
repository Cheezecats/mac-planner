import {utilityProcess, type UtilityProcess} from 'electron';
import {join} from 'node:path';
export class DataClient {
  private process:UtilityProcess;private sequence=0;private closing=false;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  private constructor(private ready:Promise<void>,worker:UtilityProcess){this.process=worker}
  static async start(dataDir:string,key:Buffer){
    const worker=utilityProcess.fork(join(__dirname,'data-service.cjs'),[],{serviceName:'Planner encrypted data',stdio:'pipe'});
    let client:DataClient;
    const ready=new Promise<void>((resolve,reject)=>{
      worker.on('message',(m)=>{if(m.type==='ready')resolve();else if(m.type==='fatal')reject(new Error(m.error));else if(m.type==='result'){const p=client.pending.get(m.id);if(p){client.pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}}});
      worker.once('exit',code=>{reject(new Error(`Planner data service exited (${code})`));if(client)for(const p of client.pending.values())p.reject(new Error('Data service stopped'))});
      worker.once('spawn',()=>worker.postMessage({type:'init',dataDir,key:key.toString('base64')}));
    });client=new DataClient(ready,worker);await ready;return client;
  }
  async request<T=unknown>(method:string,params:Record<string,unknown>={}):Promise<T>{await this.ready;if(this.closing)throw new Error('Planner data service is closing');const id=++this.sequence;return new Promise<T>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.process.postMessage({type:'request',id,method,params})})}
  async close(){await this.ready;if(this.closing)return;this.closing=true;const id=++this.sequence;await new Promise<void>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.process.postMessage({type:'request',id,method:'database.close',params:{}})});this.process.kill()}
}
