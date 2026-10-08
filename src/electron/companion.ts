import {createServer,connect,type Server} from 'node:net';
import {promises as fs} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
const methods=new Set(['workspace.get','page.create','page.update','page.patch','page.complete','page.undo','schedule.create','schedule.update','schedule.move','schedule.status','app.openPage']);
export async function startCompanion(directory:string,request:(method:string,params?:Record<string,unknown>)=>Promise<unknown>):Promise<Server>{
  await fs.mkdir(directory,{recursive:true,mode:0o700});const socketPath=join(directory,'planner.sock');
  try{await fs.unlink(socketPath)}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
  const token=randomBytes(32).toString('hex');await fs.writeFile(join(directory,'socket-token'),token,{mode:0o600});
  const server=createServer(socket=>{socket.setEncoding('utf8');let buffer='';socket.on('error',()=>{});socket.on('data',chunk=>{buffer+=chunk.toString();if(Buffer.byteLength(buffer)>2_000_000){socket.destroy();return}let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);void(async()=>{let id;try{const m=JSON.parse(line);id=m.id;const supplied=Buffer.from(String(m.token));const expected=Buffer.from(token);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new Error('Companion authentication failed');if(!methods.has(m.method))throw new Error('Unsupported companion command');const result=await request(m.method,m.params);socket.write(JSON.stringify({id,result})+'\n')}catch(error){socket.write(JSON.stringify({id,error:String(error)})+'\n')}})()}})});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>resolve())});await fs.chmod(socketPath,0o600);return server;
}
export async function companionRequest(directory:string,method:string,params:Record<string,unknown>={}):Promise<unknown>{
  const token=await fs.readFile(join(directory,'socket-token'),'utf8');return new Promise((resolve,reject)=>{const socket=connect(join(directory,'planner.sock'));socket.setEncoding('utf8');let buffer='';const timer=setTimeout(()=>{socket.destroy();reject(new Error('Planner did not respond'))},15_000);socket.on('connect',()=>socket.write(JSON.stringify({id:1,token,method,params})+'\n'));socket.on('error',error=>{clearTimeout(timer);reject(new Error(`Open Planner before using its companion: ${error.message}`))});socket.on('data',chunk=>{buffer+=chunk.toString();if(Buffer.byteLength(buffer)>12_000_000){socket.destroy();clearTimeout(timer);reject(new Error('Companion response is too large'));return}if(buffer.includes('\n')){clearTimeout(timer);socket.end();try{const m=JSON.parse(buffer.split('\n')[0]);m.error?reject(new Error(m.error)):resolve(m.result)}catch(e){reject(e)}}})});
}
