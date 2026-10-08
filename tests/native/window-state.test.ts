import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
vi.mock('electron',()=>({safeStorage:{}}));
import {EncryptedVault} from '../../src/electron/vault';
import {clampWindowBounds,WindowStateStore} from '../../src/electron/window-state';
const displays=[{x:0,y:25,width:1440,height:875},{x:1440,y:25,width:1920,height:1055}];
it('preserves bounds on a connected secondary monitor and recovers a removed monitor',()=>{
  const saved={x:1600,y:110,width:1200,height:800};
  expect(clampWindowBounds(saved,displays)).toEqual(saved);
  expect(clampWindowBounds(saved,[displays[0]])).toEqual({x:120,y:63,width:1200,height:800});
});
it('clamps oversized and partly offscreen bounds to available screen area',()=>{
  expect(clampWindowBounds({x:-300,y:-50,width:1800,height:1000},[displays[0]])).toEqual({x:0,y:25,width:1440,height:875});
  expect(clampWindowBounds({x:1300,y:800,width:700,height:500},[displays[0]])).toEqual({x:740,y:400,width:700,height:500});
});
it('invalid state falls back to a visible centered window',()=>{
  expect(clampWindowBounds({x:NaN,y:0,width:0,height:-1},[displays[0]])).toEqual({x:90,y:33,width:1260,height:860});
});
it('persists normal bounds and maximized state encrypted across launches',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'planner-window-state-')),key=randomBytes(32);
  try{
    const store=new WindowStateStore(await EncryptedVault.open(directory,key));
    await store.save({bounds:{x:1600,y:110,width:1200,height:800},maximized:true});
    expect((await readFile(join(directory,'credentials.enc'))).toString()).not.toContain('maximized');
    const reopened=new WindowStateStore(await EncryptedVault.open(directory,key));
    expect(await reopened.load(displays)).toEqual({bounds:{x:1600,y:110,width:1200,height:800},maximized:true});
    expect(await reopened.load([displays[0]])).toEqual({bounds:{x:120,y:63,width:1200,height:800},maximized:true});
  }finally{await rm(directory,{recursive:true,force:true})}
});
