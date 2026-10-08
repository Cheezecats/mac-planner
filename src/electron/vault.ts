import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeStorage } from 'electron';
import { encryptPayload,decryptPayload } from '../core/repository';
import type { IntegrationVault } from '../integrations/types';
export async function loadMasterKey(directory:string,ephemeral=false):Promise<Buffer>{
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  if(ephemeral)return randomBytes(32);
  if(!await safeStorage.isAsyncEncryptionAvailable())throw new Error('macOS Keychain is unavailable. Planner cannot open encrypted storage.');
  const path=join(directory,'protected-key');
  try{return Buffer.from((await safeStorage.decryptStringAsync(await fs.readFile(path))).result,'base64')}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const key=randomBytes(32);
  await fs.writeFile(path,await safeStorage.encryptStringAsync(key.toString('base64')),{mode:0o600,flag:'wx'});
  return key;
}
export class EncryptedVault implements IntegrationVault {
  private values:Record<string,unknown>={};private writes:Promise<void>=Promise.resolve();
  private constructor(private path:string,private key:Buffer){}
  static async open(directory:string,key:Buffer){const v=new EncryptedVault(join(directory,'credentials.enc'),key);try{v.values=JSON.parse(decryptPayload(await fs.readFile(v.path),key).toString())}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}return v}
  async get<T=unknown>(key:string):Promise<T|null>{await this.writes;return structuredClone(this.values[key] as T??null)}
  async keys():Promise<string[]>{await this.writes;return Object.keys(this.values)}
  async set(key:string,value:unknown){await this.persist(()=>{this.values[key]=structuredClone(value)})}
  async delete(key:string){await this.persist(()=>{delete this.values[key]})}
  private async persist(change:()=>void){const job=this.writes.then(async()=>{change();const temp=this.path+'.tmp';await fs.writeFile(temp,encryptPayload(JSON.stringify(this.values),this.key),{mode:0o600});await fs.rename(temp,this.path)});this.writes=job.catch(()=>{});await job}
}
