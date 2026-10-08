import {spawn} from 'node:child_process';
import {mkdtemp,readFile,mkdir,cp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {createDecipheriv} from 'node:crypto';
const dir=process.env.PLANNER_SMOKE_DIR??await mkdtemp(join(tmpdir(),'planner-smoke-'));
console.log('Smoke profile:',dir);const binary=process.env.PLANNER_EXECUTABLE??'node_modules/.bin/electron';const args=process.env.PLANNER_EXECUTABLE?['--smoke']:['.','--smoke'];const child=spawn(binary,args,{env:{...process.env,PLANNER_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
let diagnostics='';for(const [stream,output] of [[child.stdout,process.stdout],[child.stderr,process.stderr]])stream.on('data',chunk=>{diagnostics+=chunk.toString();output.write(chunk)});
const timer=setTimeout(()=>{child.kill('SIGKILL');process.exitCode=1},90_000);
await new Promise((resolve,reject)=>{child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('exit',(code,signal)=>{clearTimeout(timer);code!==0?reject(new Error(signal?`Desktop smoke terminated by ${signal}`:`Desktop smoke exit ${code}`)):resolve()})});
if(/Planner startup failed/.test(diagnostics))throw new Error('Native app reported a startup error');
const result=JSON.parse(await readFile(join(dir,'smoke-result.json'),'utf8'));
if(!/^PLANNER_SHUTDOWN_QUIESCED\r?$/m.test(diagnostics))throw new Error('Native app did not acknowledge shutdown quiescence');result.quitRequestDrain=true;
const ipcErrors=diagnostics.split('\n').filter(line=>line.includes('Error occurred in handler'));
// The save-guard probe deliberately causes exactly one acknowledged revision conflict.
if(ipcErrors.length&&!(result.nativeFailedSaveRetainsBuffer===true&&ipcErrors.length===1&&/^Error occurred in handler for 'planner:request': Error: Revision conflict: expected \d+, current \d+$/.test(ipcErrors[0])))throw new Error('Native app reported an unexpected IPC error');
// Read the persisted test profile only after the process has quit.
const key=await readFile(join(dir,'test-only-key'));const db=new Database(join(dir,'workspace.db'),{readonly:true});
const row=db.prepare('SELECT payload FROM workspace WHERE id = 1').get();db.close();
const payload=row.payload;const decipher=createDecipheriv('aes-256-gcm',key,payload.subarray(1,13));decipher.setAAD(Buffer.from('planner:encrypted-payload:v1'));decipher.setAuthTag(payload.subarray(13,29));const stored=JSON.parse(Buffer.concat([decipher.update(payload.subarray(29)),decipher.final()]).toString('utf8'));
if(stored.snapshot.pages.find(p=>p.id===result.quitPageId)?.title!==result.quitTitle)throw new Error('Quit lost pending title edits');result.quitFlush=true;
if(stored.snapshot.widgets.find(w=>w.id===result.quitWidgetId)?.state.sequence!==100)throw new Error('Quit lost the last tool state');result.widgetQuitFlush=true;
const windowPayload=await readFile(join(dir,'credentials.enc'));const windowDecipher=createDecipheriv('aes-256-gcm',key,windowPayload.subarray(1,13));windowDecipher.setAAD(Buffer.from('planner:encrypted-payload:v1'));windowDecipher.setAuthTag(windowPayload.subarray(13,29));const vault=JSON.parse(Buffer.concat([windowDecipher.update(windowPayload.subarray(29)),windowDecipher.final()]).toString('utf8'));
if(JSON.stringify(vault['native:window-state']?.bounds)!==JSON.stringify(result.quitWindowBounds))throw new Error('Quit lost native window bounds');result.windowBoundsEncrypted=true;
await mkdir('test-results/native',{recursive:true});await cp(join(dir,'screenshots'),'test-results/native',{recursive:true});await import('node:fs/promises').then(fs=>fs.writeFile('test-results/native/results.json',JSON.stringify(result,null,2)));console.log('Native smoke:',result);
