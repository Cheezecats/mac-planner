import {app,BrowserWindow,ipcMain,Menu,Tray,nativeImage,dialog,Notification,shell,powerMonitor,screen} from 'electron';
import {join} from 'node:path';
import {promises as fs} from 'node:fs';
import {randomBytes} from 'node:crypto';
import type {AppEvent,WorkspaceSnapshot} from '../shared/types';
import {loadMasterKey,EncryptedVault} from './vault';
import {DataClient} from './data-client';
import {NativeFiles} from './files';
import {NativeBackups} from './backups';
import {WidgetHost} from './widgets';
import {IntegrationHost} from './integration-host';
import {ReminderRunner} from './reminders';
import {startCompanion} from './companion';
import {loadExample} from './example';
import {loadPublicConfiguration} from './public-config';
import {createPlannerMenus,NativeCommandQueue} from './native-ui';
import {clampWindowBounds,WindowStateStore} from './window-state';
import {RequestDrain} from './request-drain';
import {requirePlannerSurface,ShutdownHandshake} from './shutdown';
const smoke=process.argv.includes('--smoke');
if(process.env.PLANNER_DATA_DIR)app.setPath('userData',process.env.PLANNER_DATA_DIR);
else app.setPath('userData',join(app.getPath('appData'),'Planner'));
let window:BrowserWindow|null=null,quitting=false,cleanedUp=false,tray:Tray|null=null,data:DataClient,files:NativeFiles,backups:NativeBackups,widgets:WidgetHost,integrations:IntegrationHost,reminders:ReminderRunner;
let rendererReady=false,pendingOpen:{id:string;blockId?:string}|null=null;
let windowState:WindowStateStore,boundsTimer:NodeJS.Timeout|undefined;
let windowCreation:Promise<void>|null=null;
const requests=new RequestDrain(),shutdownHandshake=new ShutdownHandshake();
let shutdownPhase='running';
const uiCommands=new NativeCommandQueue(showWindow,emit);
function workAreas(){const primary=screen.getPrimaryDisplay();return [primary,...screen.getAllDisplays().filter(display=>display.id!==primary.id)].map(display=>display.workArea)}
async function persistWindow(){if(boundsTimer){clearTimeout(boundsTimer);boundsTimer=undefined}if(window&&!window.isDestroyed())await windowState.save({bounds:window.getNormalBounds(),maximized:window.isMaximized()})}
function queueWindowSave(){if(boundsTimer)clearTimeout(boundsTimer);boundsTimer=setTimeout(()=>{void persistWindow().catch(error=>console.error('Window layout could not be saved',String(error)))},250)}
async function showWindow(){await createWindow();if(window?.isMinimized())window.restore();window?.show();window?.focus()}
let flushPending:{id:string;resolve:()=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}|null=null;
function flushRenderer(){if(!window||window.isDestroyed()||!rendererReady)return Promise.resolve();return new Promise<void>((resolve,reject)=>{const id=randomBytes(8).toString('hex');const timer=setTimeout(()=>{flushPending=null;reject(new Error('The editor did not acknowledge saving. Try quitting again after saving.'))},10000);flushPending={id,resolve,reject,timer};emit({type:'flush-request',data:{id}})})}
async function quiesceRenderer(){if(!window||window.isDestroyed()||!rendererReady)return;const nonce=randomBytes(16).toString('hex');await shutdownHandshake.wait(nonce,()=>window!.webContents.send('planner:quiesce',{nonce}))}
const coreMethods=new Set(['workspace.get','workspace.export','page.create','page.update','page.patch','page.resource','page.complete','page.reopen','page.undo','page.duplicate','page.instantiate','page.archive','page.delete','page.restore','page.purge','schedule.create','schedule.update','schedule.move','schedule.status','schedule.remove','label.create','label.update','label.delete','study.save','widget.save','asset.remove','suggestion.accept','suggestion.dismiss','settings.update']);
function emit(event:AppEvent){if(window&&!window.isDestroyed())window.webContents.send('planner:event',event)}
async function openPage(id:string,blockId?:string){const snapshot=await data.request<WorkspaceSnapshot>('workspace.get');if(!snapshot.pages.some(p=>p.id===id))throw new Error('Page not found');await showWindow();if(rendererReady)emit({type:'open-page',pageId:id,data:{blockId}});else pendingOpen={id,blockId}}
function request(method:string,params:Record<string,unknown>={}){return requests.run(()=>performRequest(method,params))}
async function performRequest(method:string,params:Record<string,unknown>={}){
  if(typeof method!=='string'||!params||typeof params!=='object'||Buffer.byteLength(JSON.stringify(params))>8_000_000)throw new Error('Invalid Planner request');
  let result:unknown;
  if(method==='app.rendererReady'){rendererReady=true;if(pendingOpen){emit({type:'open-page',pageId:pendingOpen.id,data:{blockId:pendingOpen.blockId}});pendingOpen=null}uiCommands.setReady(true);return {received:true}}
  if(method==='app.flushReady'){if(flushPending&&flushPending.id===params.id){const p=flushPending;flushPending=null;clearTimeout(p.timer);params.error?p.reject(new Error(String(params.error))):p.resolve()}return {received:true}}
  if(method==='page.purge'||method==='asset.remove'){const before=await data.request<WorkspaceSnapshot>('workspace.get');result=await data.request(method,params);const after=await data.request<WorkspaceSnapshot>('workspace.get');if(method==='page.purge')for(const page of before.pages)if(!after.pages.some(current=>current.id===page.id))await integrations.purgePage(page.id);await files.purgeAssets(before.assets.filter(a=>!after.assets.some(b=>b.id===a.id)),after.assets)}
  else if(coreMethods.has(method))result=await data.request(method,params);
  else if(['file.attach','file.link','file.locate','file.open','file.read','file.preview','export.markdown'].includes(method))result=await files.handle(method,params);
  else if(['backup.configure','backup.create','backup.restore','export.workspace'].includes(method)){if(method==='backup.restore')await widgets.flushAndStop();result=await backups.handle(method,params);}
  else if(['widget.mount','widget.bounds','widget.visibility','widget.stop','widget.reload','widget.revert','widget.unmount'].includes(method))return widgets.handle(method,params);
  else if(['connection.connect','connection.scan','connection.folders','connection.calendars','connection.refresh','connection.disconnect','assistant.signIn','assistant.models','assistant.send','assistant.cancel','assistant.history'].includes(method))return integrations.handle(method,params);
  else if(method==='app.openPage'){await openPage(String(params.id),params.blockId as string|undefined);return {opened:true}}
  else if(method==='app.notificationsStatus')return {supported:Notification.isSupported(),verifiedDelivery:false,message:app.isPackaged?'Delivery needs macOS notification permission and a signed build.':'Development build: signed notification delivery has not been verified.'};
  else if(method==='app.companionInfo')return {name:'Planner Codex companion',socket:join(app.getPath('userData'),'planner.sock'),plugin:join(process.resourcesPath,'runtime','plugin'),instructions:'Add the repository marketplace at .agents/plugins/marketplace.json to Codex, then install planner. Keep Planner running.'};
  else if(method==='app.loadExample')result=await loadExample(data.request.bind(data));
  else if(method==='app.quit'){app.quit();return}
  else throw new Error('Unsupported Planner action');
  if(method!=='workspace.get'&&method!=='workspace.export'&&!['file.read','file.preview','file.open'].includes(method))emit({type:'changed'});return result;
}
async function createWindow(){if(windowCreation)return windowCreation;if(window&&!window.isDestroyed())return;windowCreation=loadWindow();try{await windowCreation}finally{windowCreation=null}}
async function loadWindow(){rendererReady=false;uiCommands.setReady(false);const state=await windowState.load(workAreas());window=new BrowserWindow({...state.bounds,minWidth:Math.min(680,state.bounds.width),minHeight:Math.min(480,state.bounds.height),title:'Planner',titleBarStyle:'hiddenInset',backgroundColor:'#ffffff',show:false,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:true}});
  if(state.maximized)window.maximize();
  window.on('move',queueWindowSave);window.on('resize',queueWindowSave);window.on('maximize',queueWindowSave);window.on('unmaximize',queueWindowSave);
  window.on('close',event=>{if(!quitting){event.preventDefault();void persistWindow().then(()=>widgets.flushAndStop(false)).then(()=>window?.hide()).catch(error=>dialog.showErrorBox('Changes could not be saved',String(error)))}});
  window.on('closed',()=>{window=null;rendererReady=false;uiCommands.setReady(false)});window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))void shell.openExternal(url);return{action:'deny'}});
  window.webContents.on('will-navigate',(event,url)=>{if(url!==window?.webContents.getURL()){event.preventDefault();if(/^https:\/\//.test(url))void shell.openExternal(url)}});
  const url=process.env.PLANNER_RENDERER_URL;if(url){if(!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(url))throw new Error('Invalid local development URL');await window.loadURL(url)}else await window.loadFile(join(__dirname,'../renderer/index.html'));
  window.show();
}
if(!app.requestSingleInstanceLock())app.quit();
else {
app.on('before-quit',event=>{if(cleanedUp)return;event.preventDefault();if(quitting)return;quitting=true;shutdownPhase='flushing';window?.setEnabled(false);void flushRenderer().then(async()=>{
  await persistWindow();shutdownPhase='tools';await widgets?.flushAndStop();
  shutdownPhase='quiescing';await quiesceRenderer();shutdownPhase='draining';await requests.pauseAndDrain();
  await data?.request('workspace.get');await files?.dispose();reminders?.stop();
  shutdownPhase='closing-data';await data?.close();shutdownPhase='destroying-window';window?.destroy();window=null;cleanedUp=true;app.quit();
}).catch(error=>{requests.resume();quitting=false;shutdownPhase='running';if(window&&!window.isDestroyed()){window.webContents.send('planner:resume');window.setEnabled(true);window.show();window.focus()}dialog.showErrorBox('Your writing is not saved yet',String(error))})});
app.on('window-all-closed',()=>{});
void app.whenReady().then(async()=>{
  const directory=app.getPath('userData');await fs.mkdir(directory,{recursive:true,mode:0o700});let key:Buffer;
  if(smoke){const path=join(directory,'test-only-key');try{key=await fs.readFile(path)}catch{key=randomBytes(32);await fs.writeFile(path,key,{mode:0o600})}}else key=await loadMasterKey(directory);
  data=await DataClient.start(directory,key);const vault=await EncryptedVault.open(directory,key),gateway=data.request.bind(data);
  windowState=new WindowStateStore(vault);
  files=new NativeFiles({dataDir:directory,key,request:gateway,getWindow:()=>window});await files.initialize();backups=new NativeBackups({dataDir:directory,key,request:gateway,getWindow:()=>window,credentials:vault});
  widgets=new WidgetHost(gateway,()=>window,emit);integrations=new IntegrationHost(gateway,vault,async(id,pageId)=>{const s=await gateway<WorkspaceSnapshot>('workspace.get');if(!s.assets.some(a=>a.id===id&&a.pageId===pageId))throw new Error('Select a source attached to this page');return await files.handle('file.read',{id}) as string},emit,await loadPublicConfiguration(app.isPackaged?join(process.resourcesPath,'runtime','public-config.json'):join(__dirname,'../runtime/public-config.json')));await integrations.initialize();
  reminders=new ReminderRunner(()=>gateway<WorkspaceSnapshot>('workspace.get'),vault,(id,block)=>void openPage(id,block));reminders.start();powerMonitor.on('resume',()=>void reminders.tick());
  ipcMain.handle('planner:request',(event,method,params)=>{if(smoke&&quitting)console.log('PLANNER_SHUTDOWN_REQUEST',JSON.stringify({method:typeof method==='string'?method:'invalid',phase:shutdownPhase,senderId:event.sender.id,windowPresent:Boolean(window),framePresent:Boolean(event.senderFrame),ownerMatches:event.sender===window?.webContents}));requirePlannerSurface(event,window);return request(method,params)});
  ipcMain.handle('planner:quiesced',(event,message)=>{requirePlannerSurface(event,window);shutdownHandshake.acknowledge(message??{});if(smoke)console.log('PLANNER_SHUTDOWN_QUIESCED');return {received:true}});
  app.on('second-instance',()=>{void showWindow()});app.on('activate',()=>{void showWindow()});
  const recoverWindow=()=>{if(window&&!window.isDestroyed()&&!window.isFullScreen()){const bounds=clampWindowBounds(window.getNormalBounds(),workAreas());if(!window.isMaximized())window.setBounds(bounds);queueWindowSave()}};
  screen.on('display-removed',recoverWindow);screen.on('display-metrics-changed',recoverWindow);
  const socket=await startCompanion(directory,request);app.on('will-quit',()=>socket.close());
  const menus=createPlannerMenus(command=>uiCommands.dispatch(command).catch(error=>dialog.showErrorBox('Planner could not open',String(error))),()=>void showWindow(),()=>app.quit());
  Menu.setApplicationMenu(Menu.buildFromTemplate(menus.application));
  const icon=nativeImage.createFromNamedImage('NSActionTemplate');tray=new Tray(icon);tray.setToolTip('Planner');tray.setContextMenu(Menu.buildFromTemplate(menus.tray));
  await createWindow();const timer=setInterval(()=>void backups.daily().catch(error=>console.error('Backup failed',String(error))),60*60_000);app.on('will-quit',()=>clearInterval(timer));void backups.daily().catch(error=>console.error(String(error)));
  if(smoke){const {runSmoke}=await import('./smoke');await runSmoke(window!,request,directory,widgets);app.quit()}
}).catch(error=>{console.error('Planner startup failed',error);if(smoke)app.exit(1);else{dialog.showErrorBox('Planner could not open',String(error));app.quit()}});
}
