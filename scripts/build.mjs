import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Blob-backed notebook modules cannot resolve relative imports. Keep their HTML
// exporter self-contained; standalone documents have no HTML-export action.
const embeddedExporter=mode=>({name:`${mode}-html-export`,setup(build){
  build.onResolve({filter:/^\.\/html-export-async$/},()=>({path:mode,namespace:'embedded-html-export'}));
  build.onLoad({filter:/.*/,namespace:'embedded-html-export'},()=>({loader:'js',resolveDir:resolve('packages/core/src'),contents:mode==='notebook'
    ? `import {toHTML} from './html-export'; export async function toHTMLAsync(figure,options){return toHTML(figure,options);}`
    : `export async function toHTMLAsync(){throw new Error('HTML export is unavailable in a standalone document.');}`}));
}});
const sharedRuntime={name:'shared-runtime-identity',setup(build){
  build.onResolve({filter:/^\.\/(?:figure|runtime|html-export-async)$/},()=>({path:'./runtime.js',external:true}));
}};
const externalTemplate={name:'on-demand-html-template',setup(build){
  build.onResolve({filter:/^\.\/html-template$/},()=>({path:'./html-template.js',external:true}));
}};

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
const standalone=await build({entryPoints:['packages/core/src/standalone.ts'],bundle:true,format:'esm',target:'es2022',write:false,define:{__VESORA_WORKER_SOURCE__:JSON.stringify(workerSource)},plugins:[embeddedExporter('standalone')]});
const shell=await readFile('packages/core/src/standalone-template.html','utf8');
const runtimeMarker='__VESORA_RUNTIME_SOURCE__',payloadMarker='__VESORA_PAYLOAD_JSON__';
if(shell.split(runtimeMarker).length!==2||shell.split(payloadMarker).length!==2)throw new Error('The standalone shell must contain exactly one runtime and payload placeholder.');
// Keep inline script parsing safe even when a bundled string contains a closing tag.
const runtime=standalone.outputFiles[0].text.replace(/<\/script/gi,'<\\/script').replaceAll(payloadMarker,'\\u005f_VESORA_PAYLOAD_JSON__');
const htmlTemplate=shell.replace(runtimeMarker,()=>runtime);
await writeFile(`${assets}/standalone.html`,htmlTemplate,'utf8');
await build({entryPoints:['packages/core/src/html-template.ts'],outdir:out,bundle:true,format:'esm',target:'es2022',sourcemap:true,define:{__VESORA_HTML_TEMPLATE__:JSON.stringify(htmlTemplate)}});
await build({entryPoints:['packages/core/src/runtime.ts','packages/core/src/balance.ts'],outdir:out,bundle:true,format:'esm',target:'es2022',sourcemap:true,plugins:[externalTemplate]});
await build({entryPoints:['packages/core/src/index.ts','packages/core/src/viewer.ts','packages/core/src/labs.ts'],outdir:out,bundle:true,format:'esm',target:'es2022',sourcemap:true,plugins:[sharedRuntime,externalTemplate]});
await build({entryPoints:['packages/core/src/notebook.ts'],outfile:`${assets}/notebook.js`,bundle:true,format:'esm',target:'es2022',define:{__VESORA_WORKER_SOURCE__:JSON.stringify(workerSource),__VESORA_HTML_TEMPLATE__:JSON.stringify(htmlTemplate)},plugins:[embeddedExporter('notebook')]});
for(const file of ['index.js','index.js.map','runtime.js','runtime.js.map','html-template.js','html-template.js.map','worker.js','worker.js.map','viewer.js','viewer.js.map'])await copyFile(`${out}/${file}`,`${assets}/${file}`);
console.log('Built @vesora/core and matching Python engine assets.');
await copyFile('LICENSE', `${out}/../LICENSE`);
await import('../packages/react/build.mjs');
