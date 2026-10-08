import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {app} from 'electron';

/** Test-only, app-owned protocol check. Never uses the person's real profile. */
export async function checkCompanion(directory:string,pageId:string){
  const runtime=app.isPackaged?join(process.resourcesPath,'runtime'):join(__dirname,'../runtime');
  const child=spawn(join(runtime,'node'),[join(runtime,'companion.cjs')],{env:{...process.env,PLANNER_DATA_DIR:directory},stdio:['pipe','pipe','pipe']});
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();let sequence=0,buffer='',stderr='';
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk});
  child.stdout.on('data',chunk=>{buffer+=chunk;while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.trim())continue;try{const message=JSON.parse(line);const wait=pending.get(message.id);if(wait){pending.delete(message.id);message.error?wait.reject(new Error(message.error.message)):wait.resolve(message.result)}}catch(error){for(const wait of pending.values())wait.reject(new Error(`Invalid companion protocol: ${String(error)}`))}}});
  child.on('error',error=>{for(const wait of pending.values())wait.reject(error)});
  child.on('exit',code=>{for(const wait of pending.values())wait.reject(new Error(`Companion exited ${code}: ${stderr}`))});
  const call=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Companion timed out: ${method}`))},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n')});
  try{
    await call('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Planner acceptance',version:'0.1.0'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
    const listed=await call('tools/list',{});
    for(const name of ['search_pages','read_page','edit_page','schedule_work','open_page'])if(!listed.tools?.some((tool:any)=>tool.name===name))throw new Error(`Companion missing ${name}`);
    const search=await call('tools/call',{name:'search_pages',arguments:{query:'Physics HL'}});
    if(search.isError||!JSON.parse(search.content[0].text).some((page:any)=>page.id===pageId))throw new Error('Companion search did not return the canonical page');
    const read=await call('tools/call',{name:'read_page',arguments:{id:pageId}});
    if(read.isError||JSON.parse(read.content[0].text).page.id!==pageId)throw new Error('Companion read returned a different page');
    return true;
  }finally{child.stdin.end();child.kill();for(const wait of pending.values())wait.reject(new Error('Companion check closed'));pending.clear()}
}
