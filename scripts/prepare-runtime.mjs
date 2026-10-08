import {mkdir,copyFile,chmod,writeFile,readFile,cp} from 'node:fs/promises';
import {join} from 'node:path';
const target=process.env.PLANNER_TARGET_ARCH??process.env.npm_config_arch??process.arch;
if(process.platform!=='darwin'||target!==process.arch)throw new Error(`Build on the target Mac architecture (${target}); host ${process.platform}/${process.arch} cannot silently supply the companion runtime.`);
await mkdir('dist/runtime',{recursive:true});await copyFile(process.execPath,'dist/runtime/node');await chmod('dist/runtime/node',0o755);await copyFile('dist/electron/mcp.cjs','dist/runtime/companion.cjs');
await writeFile('dist/runtime/architecture.json',JSON.stringify({platform:process.platform,arch:process.arch,node:process.version},null,2));
// Client IDs are public registration identifiers, never credentials. Persist them for Finder launches.
await writeFile('dist/runtime/public-config.json',JSON.stringify({googleClientId:process.env.PLANNER_GOOGLE_CLIENT_ID??null,microsoftClientId:process.env.PLANNER_MICROSOFT_CLIENT_ID??null},null,2));
await mkdir('dist/runtime/notices',{recursive:true});
const nodeLicense=process.env.PLANNER_NODE_LICENSE??'/private/tmp/planner-node-license.txt';
let nodeText;try{nodeText=await readFile(nodeLicense,'utf8')}catch{const response=await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);if(!response.ok)throw new Error('Unable to obtain the bundled Node license');nodeText=await response.text()}
await writeFile('dist/runtime/notices/Node-LICENSE.txt',nodeText);
await copyFile('LICENSE','dist/runtime/notices/Planner-LICENSE.txt');
await copyFile('node_modules/electron/dist/LICENSE','dist/runtime/notices/Electron-LICENSE.txt');
await copyFile('node_modules/electron/dist/LICENSES.chromium.html','dist/runtime/notices/Electron-LICENSES.chromium.html');
await copyFile('docs/notices.md','dist/runtime/notices/README.md');
const lock=JSON.parse(await readFile('package-lock.json','utf8'));const inventory=[];
for(const [location,record] of Object.entries(lock.packages)){if(!location||record.dev)continue;const item={name:record.name??location.split('node_modules/').at(-1),version:record.version,license:record.license??'See package notices',location};inventory.push(item);let packageData;try{packageData=JSON.parse(await readFile(join(location,'package.json'),'utf8'));if(packageData.license)item.license=packageData.license}catch{}for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','LICENCE','COPYING','NOTICE','NOTICE.txt']){try{const content=await readFile(join(location,file));const destination=join('dist/runtime/notices',item.name.replaceAll('/','__'));await mkdir(destination,{recursive:true});await writeFile(join(destination,file),content)}catch{}}}
await writeFile('dist/runtime/notices/inventory.json',JSON.stringify(inventory,null,2));
await writeFile('dist/runtime/README.txt',`Planner companion runtime: Node ${process.version}, ${process.platform}/${process.arch}. Bundled to avoid a separate Node installation. See app dependency notices.\n`);
await mkdir('companion/.codex-plugin',{recursive:true});await mkdir('companion/scripts',{recursive:true});
await writeFile('companion/.codex-plugin/plugin.json',JSON.stringify({name:'planner',version:'0.1.0',description:'Read, edit and schedule local Planner pages through a private socket.'},null,2));
await writeFile('companion/plugin.json',JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'planner',version:'0.1.0',license:'MIT',description:'Read, edit and schedule local Planner pages through a private socket.'},null,2));
await writeFile('companion/.mcp.json',JSON.stringify({mcpServers:{planner:{command:'${PLUGIN_ROOT}/scripts/launch.sh',args:[]}}},null,2));
await copyFile('companion/.mcp.json','companion/mcp.json');
await writeFile('companion/scripts/launch.sh','#!/bin/sh\nset -eu\napp_path="${PLANNER_APP_PATH:-/Applications/Planner.app}"\nruntime="$app_path/Contents/Resources/runtime"\nif [ ! -x "$runtime/node" ]; then echo "Install Planner.app in /Applications or set PLANNER_APP_PATH." >&2; exit 1; fi\nexec "$runtime/node" "$runtime/companion.cjs"\n');await chmod('companion/scripts/launch.sh',0o755);
await mkdir('.agents/plugins',{recursive:true});await writeFile('.agents/plugins/marketplace.json',JSON.stringify({name:'planner-local',interface:{displayName:'Planner'},plugins:[{name:'planner',source:{source:'local',path:'./companion'},policy:{installation:'AVAILABLE',authentication:'ON_USE'},category:'Productivity'}]},null,2));
await mkdir('dist/runtime/plugin',{recursive:true});
await cp('companion','dist/runtime/plugin',{recursive:true});
