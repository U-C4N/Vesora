// Small deterministic CPU planner benchmark. No browser, GPU, build output or RC archive writes.
import {build,version as esbuildVersion} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import os from 'node:os';
const bundled=await build({stdin:{contents:"export {DataRegistry} from './packages/core/src/data'; export {scatterSteps} from './packages/core/src/planning'; export {ScatterIndexCache} from './packages/core/src/scatter-index';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',target:'es2022'});
const {DataRegistry,scatterSteps,ScatterIndexCache}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`);
const count=Number(process.argv[2]??1000000);assert.ok(Number.isSafeInteger(count)&&count>=4096&&count<=2000000,'Rows must be between 4096 and 2000000');
const registry=new DataRegistry();let state=123456;
const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32);
registry.set('x',Float64Array.from({length:count},()=>random()*100));registry.set('y',Float64Array.from({length:count},()=>random()*100));
const query={bounds:{x:[35,45],y:[55,65]},width:1000,height:600,xScale:'linear',yScale:'linear',pointBudget:250000,mode:'density'};
const run=index=>{const steps=scatterSteps(registry.get('x'),registry.get('y'),query,index,true);while(true){const step=steps.next();if(step.done)return step.value;}};
const timed=fn=>{const start=performance.now();const result=fn();return {ms:performance.now()-start,result};};
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
run();run(); // Warm JS compilation independently from the spatial-index lifecycle.
const baseline=[];for(let i=0;i<7;i++)baseline.push(timed(()=>run()).ms);
const index=new ScatterIndexCache(),first=timed(()=>run(index)),cold=timed(()=>run(index));
assert.deepEqual(first.result,run());assert.deepEqual(cold.result,run());
const warm=[];for(let i=0;i<7;i++){const sample=timed(()=>run(index));assert.deepEqual(sample.result,cold.result);warm.push(sample.ms);}
const sources=['packages/core/src/scatter-index.ts','packages/core/src/planning.ts','packages/core/src/scheduler.ts','packages/core/src/worker.ts','packages/core/src/data.ts','packages/core/src/scales.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(sources.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={createdAt:new Date().toISOString(),environment:{node:process.version,esbuild:esbuildVersion,os:os.type(),release:os.release(),architecture:os.arch(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length},sourceHashes,
  scope:'Node synchronous CPU planner only; same deterministic random 2D data, 1% viewport, exact density parity. No GPU, transport, event-loop latency or production p95 claim.',rows:count,
  baselineMedianMs:median(baseline),firstQueryScanMs:first.ms,secondQueryColdBuildMs:cold.ms,warmMedianMs:median(warm),warmSpeedup:median(baseline)/median(warm),baselineSamplesMs:baseline,warmSamplesMs:warm,diagnostics:index.diagnostics()};
const path=resolve(process.argv[3]??'artifacts/product-update/scatter-index.json');await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,reportPath:path},null,2));
