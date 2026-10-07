import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const out='packages/core/dist', assets='python/vesora/_assets';
await mkdir(out,{recursive:true});await mkdir(assets,{recursive:true});
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--emitDeclarationOnly'],{stdio:'inherit'});
// Published ESM declarations must resolve in NodeNext as well as bundler mode.
for(const file of await readdir(out,{recursive:true})){
  if(!file.endsWith('.d.ts'))continue;
  const path=`${out}/${file}`,source=await readFile(path,'utf8');
  const declarations=source.replace(/(from\s*['"]|import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"])/g,(_match,prefix,specifier,suffix)=>`${prefix}${/\.[^/]+$/.test(specifier)?specifier:`${specifier}.js`}${suffix}`);
  await writeFile(path,declarations,'utf8');
}
await build({entryPoints:['packages/core/src/worker.ts'],outdir:out,bundle:true,format:'esm',target:'es2022',sourcemap:true});
const workerSource=(await readFile(`${out}/worker.js`,'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm,'');
const standalone=await build({entryPoints:['packages/core/src/standalone.ts'],bundle:true,format:'esm',target:'es2022',write:false,define:{__VESORA_WORKER_SOURCE__:JSON.stringify(workerSource)}});
const shell=await readFile('packages/core/src/standalone-template.html','utf8');
const runtimeMarker='__VESORA_RUNTIME_SOURCE__',payloadMarker='__VESORA_PAYLOAD_JSON__';
if(shell.split(runtimeMarker).length!==2||shell.split(payloadMarker).length!==2)throw new Error('The standalone shell must contain exactly one runtime and payload placeholder.');
// Keep inline script parsing safe even when a bundled string contains a closing tag.
const runtime=standalone.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const htmlTemplate=shell.replace(runtimeMarker,()=>runtime);
await writeFile(`${assets}/standalone.html`,htmlTemplate,'utf8');
await build({entryPoints:['packages/core/src/index.ts'],outdir:out,bundle:true,format:'esm',target:'es2022',sourcemap:true,define:{__VESORA_HTML_TEMPLATE__:JSON.stringify(htmlTemplate)}});
await build({entryPoints:['packages/core/src/notebook.ts'],outfile:`${assets}/notebook.js`,bundle:true,format:'esm',target:'es2022',define:{__VESORA_WORKER_SOURCE__:JSON.stringify(workerSource)}});
for(const file of ['index.js','index.js.map','worker.js','worker.js.map'])await copyFile(`${out}/${file}`,`${assets}/${file}`);
console.log('Built @vesora/core and matching Python engine assets.');
