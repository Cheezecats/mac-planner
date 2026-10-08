module.exports = {
  packagerConfig: {
    electronZipDir:process.env.PLANNER_ELECTRON_ZIP_DIR,
    name: 'Planner', executableName: 'Planner', appBundleId: 'local.planner.workspace',
    appCategoryType: 'public.app-category.productivity',
    asar: {unpack: '**/*.node'},
    extraResource: ['dist/runtime'],
    osxSign: process.env.APPLE_SIGN_IDENTITY ? {identity:process.env.APPLE_SIGN_IDENTITY} : undefined,
    osxNotarize: process.env.APPLE_API_KEY ? {appleApiKey:process.env.APPLE_API_KEY,appleApiKeyId:process.env.APPLE_API_KEY_ID,appleApiIssuer:process.env.APPLE_API_ISSUER} : undefined,
    ignore: [/^\/tests/, /^\/src/, /^\/docs/, /^\/dist\/runtime/, /^\/\.planner-dependencies-old/, /^\/\.planner-data/, /^\/\.superpowers/, /^\/\.npm-cache/, /^\/test-results/, /^\/\.git/, /^\/\.agents/, /^\/\.github/, /^\/\.env(?:$|\.)/, /^\/node_modules\/\.cache/]
  },
  // better-sqlite3 13 ships Node-API binaries; packaged smoke validates the target prebuild.
  rebuildConfig: {ignoreModules:['better-sqlite3']},
  hooks: {prePackage:async(_config,_platform,arch)=>{const fs=require('node:fs/promises');const runtime=JSON.parse(await fs.readFile('dist/runtime/architecture.json','utf8'));if(runtime.arch!==arch)throw new Error(`Companion runtime is ${runtime.arch}; package target is ${arch}. Build on the target architecture.`)}},
  makers: [{name:'@electron-forge/maker-dmg',platforms:['darwin']},{name:'@electron-forge/maker-zip',platforms:['darwin']}]
};
