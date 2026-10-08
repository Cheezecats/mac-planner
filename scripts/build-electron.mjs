import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('dist/electron',{recursive:true});
await build({entryPoints:{main:'src/electron/main.ts',preload:'src/electron/preload.ts','widget-preload':'src/electron/widget-preload.ts','data-service':'src/electron/data-service.ts',mcp:'src/electron/mcp.ts'},outdir:'dist/electron',outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node24',format:'cjs',sourcemap:true,external:['electron','better-sqlite3','mammoth','pdfjs-dist/legacy/build/pdf.mjs']});
