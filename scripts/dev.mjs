import {spawn} from 'node:child_process';
const vite=spawn('npm',['run','dev'],{stdio:'inherit'});
await new Promise((resolve,reject)=>{const build=spawn('node',['scripts/build-electron.mjs'],{stdio:'inherit'});build.on('exit',c=>c?reject(new Error('Build failed')):resolve())});
const electron=spawn('node_modules/.bin/electron',['.'],{stdio:'inherit',env:{...process.env,PLANNER_RENDERER_URL:'http://127.0.0.1:4173'}});electron.on('exit',code=>{vite.kill();process.exitCode=code??0});process.on('SIGINT',()=>{electron.kill();vite.kill()});
