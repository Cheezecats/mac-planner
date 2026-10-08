import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

it('prepares mandatory notices and versioned companion from a clean lazy Electron install',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'planner-runtime-clean-'));
  try{
    for(const path of ['scripts','dist/electron','docs','node_modules/electron','companion'])await mkdir(join(directory,path),{recursive:true});
    await copyFile(resolve('scripts/prepare-runtime.mjs'),join(directory,'scripts/prepare-runtime.mjs'));
    await writeFile(join(directory,'package.json'),JSON.stringify({version:'0.2.0',devDependencies:{electron:'44.6.0'}}));
    await writeFile(join(directory,'package-lock.json'),JSON.stringify({packages:{}}));
    await writeFile(join(directory,'LICENSE'),'Planner license');await writeFile(join(directory,'docs/notices.md'),'Bundled notices');
    await writeFile(join(directory,'node-license.txt'),'Node license');await writeFile(join(directory,'dist/electron/mcp.cjs'),'companion');
    await writeFile(join(directory,'node_modules/electron/package.json'),JSON.stringify({name:'electron',version:'44.6.0',main:'index.cjs'}));
    // Electron 44 defers extraction to require('electron'); no dist exists at install completion.
    await writeFile(join(directory,'node_modules/electron/index.cjs'),`const fs=require('node:fs');const path=require('node:path');fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});fs.writeFileSync(path.join(__dirname,'dist/LICENSE'),'Electron license');fs.writeFileSync(path.join(__dirname,'dist/LICENSES.chromium.html'),'Chromium notices');module.exports=path.join(__dirname,'dist/Electron');`);
    const run=spawnSync(process.execPath,['scripts/prepare-runtime.mjs'],{cwd:directory,encoding:'utf8',env:{...process.env,PLANNER_TARGET_ARCH:process.arch,PLANNER_NODE_LICENSE:join(directory,'node-license.txt')}});
    expect(run.status,run.stderr).toBe(0);
    expect(await readFile(join(directory,'dist/runtime/notices/Electron-LICENSE.txt'),'utf8')).toBe('Electron license');
    expect(await readFile(join(directory,'dist/runtime/notices/Electron-LICENSES.chromium.html'),'utf8')).toBe('Chromium notices');
    expect(JSON.parse(await readFile(join(directory,'dist/runtime/plugin/plugin.json'),'utf8')).version).toBe('0.2.0');
    expect(JSON.parse(await readFile(join(directory,'dist/runtime/plugin/.codex-plugin/plugin.json'),'utf8')).version).toBe('0.2.0');
  }finally{await rm(directory,{recursive:true,force:true})}
});
