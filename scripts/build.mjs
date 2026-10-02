import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const out='packages/core/dist', assets='python/vesora/_assets';
await mkdir(out,{recursive:true});await mkdir(assets,{recursive:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--emitDeclarationOnly'],{stdio:'inherit'});
await build({entryPoints:['packages/core/src/index.ts','packages/core/src/worker.ts'],outdir:out,bundle:true,format:'esm',target:'es2022',sourcemap:true});
const workerSource=await readFile(`${out}/worker.js`,'utf8');
await build({entryPoints:['packages/core/src/notebook.ts'],outfile:`${assets}/notebook.js`,bundle:true,format:'esm',target:'es2022',define:{__VESORA_WORKER_SOURCE__:JSON.stringify(workerSource)}});
for(const file of ['index.js','index.js.map','worker.js','worker.js.map'])await copyFile(`${out}/${file}`,`${assets}/${file}`);
console.log('Built @vesora/core and matching Python engine assets.');
