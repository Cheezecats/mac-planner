import {it,expect} from 'vitest';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import Database from 'better-sqlite3';
import {encryptPayload} from '../../src/core/repository';

it('desktop acceptance requires native quiescence even when Quit data is already persisted',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'planner-quit-acceptance-')),profile=join(directory,'profile'),key=randomBytes(32);
  try{
    await mkdir(join(directory,'scripts'));await mkdir(join(profile,'screenshots'),{recursive:true});
    await copyFile(resolve('scripts/desktop-smoke.mjs'),join(directory,'scripts/desktop-smoke.mjs'));
    await symlink(resolve('node_modules'),join(directory,'node_modules'),'dir');
    const executable=join(directory,'fixture.cjs');await writeFile(executable,`#!${process.execPath}\nif(process.env.PLANNER_TEST_QUIESCED==='1')console.log('PLANNER_SHUTDOWN_QUIESCED');\n`,{mode:0o755});
    const bounds={x:80,y:30,width:1260,height:860};
    await writeFile(join(profile,'test-only-key'),key);
    await writeFile(join(profile,'smoke-result.json'),JSON.stringify({quitPageId:'page',quitTitle:'Saved writing',quitWidgetId:'widget',quitWindowBounds:bounds}));
    const database=new Database(join(profile,'workspace.db'));
    database.exec('CREATE TABLE workspace (id INTEGER PRIMARY KEY, payload BLOB)');
    database.prepare('INSERT INTO workspace (id,payload) VALUES (1,?)').run(encryptPayload(JSON.stringify({snapshot:{pages:[{id:'page',title:'Saved writing'}],widgets:[{id:'widget',state:{sequence:100}}]}}),key));database.close();
    await writeFile(join(profile,'credentials.enc'),encryptPayload(JSON.stringify({'native:window-state':{bounds,maximized:false}}),key));
    const run=(quiesced:string)=>spawnSync(process.execPath,['scripts/desktop-smoke.mjs'],{cwd:directory,encoding:'utf8',env:{...process.env,PLANNER_EXECUTABLE:executable,PLANNER_SMOKE_DIR:profile,PLANNER_TEST_QUIESCED:quiesced}});
    const missing=run('0');expect(missing.status,'Missing quiescence must fail acceptance').not.toBe(0);expect(missing.stderr).toContain('quiescence');
    const complete=run('1');expect(complete.status,complete.stderr).toBe(0);
    expect(JSON.parse(await readFile(join(directory,'test-results/native/results.json'),'utf8')).quitRequestDrain).toBe(true);
    await writeFile(executable,`#!${process.execPath}\nconsole.log('PLANNER_SHUTDOWN_QUIESCED');process.kill(process.pid,'SIGKILL');\n`,{mode:0o755});
    const killed=run('1');expect(killed.status,'A signal-killed app must fail even if it saved data').not.toBe(0);expect(killed.stderr).toContain('SIGKILL');
  }finally{await rm(directory,{recursive:true,force:true})}
});
