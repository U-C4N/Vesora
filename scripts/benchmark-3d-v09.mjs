// Measured scientific 3D matrix. Run alone: concurrent graphics jobs distort timing.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {cpus,platform,totalmem} from 'node:os';
import {createHash} from 'node:crypto';

const software=process.env.VESORA_SOFTWARE_GPU!=='0',port=4191,repeats=Number(process.env.VESORA_3D_REPEATS??3);
assert.ok(Number.isInteger(repeats)&&repeats>=1&&repeats<=10,'VESORA_3D_REPEATS must be 1–10');
const runtime='/packages/core/dist/index.js',hashFile=async path=>createHash('sha256').update(await readFile(path)).digest('hex'),initialHash=await hashFile(`.${runtime}`),workerHash=await hashFile('./packages/core/dist/worker.js');
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'ignore'});
const results=[];let browser;
try{
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/tests/browser/harness.html`)).ok)break;}catch{}if(i===99)throw new Error('3D benchmark server did not start');await new Promise(resolve=>setTimeout(resolve,100));}
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--enable-precise-memory-info',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
  const context=await browser.newContext({viewport:{width:1200,height:800},deviceScaleFactor:1});
  const open=async()=>{const page=await context.newPage();await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);await page.evaluate(()=>document.querySelector('#chart').style.width='1000px');return page;};
  const warmup=await open();await warmup.evaluate(async runtime=>{const {figure}=await import(runtime);for(const kind of ['surface','scatter']){const f=figure({width:1000,height:600});if(kind==='surface')f.surface([0,1],[0,1],[[0,1],[1,0]],{shading:'smooth'});else f.scatter3d([0,1],[0,1],[0,1]);f.mount(document.querySelector('#chart'));await f.ready();document.querySelector('canvas').getContext('webgl2').finish();f.close();}},runtime);await warmup.close();
  const cases=[...[128,256,512].map(size=>({kind:'surface',size,count:size*size})),...[10_000,100_000,500_000].map(count=>({kind:'scatter3d',count}))];
  for(let repeat=0;repeat<repeats;repeat++)for(const spec of repeat%2?[...cases].reverse():cases){
    const page=await open();
    const result=await page.evaluate(async({runtime,spec})=>{
      const {figure}=await import(runtime),memory=()=>performance.memory?.usedJSHeapSize??null,heapBefore=memory(),sourceStart=performance.now();
      let x,y,z;if(spec.kind==='surface'){
        x=Float64Array.from({length:spec.size},(_,i)=>-3+6*i/(spec.size-1));y=x.slice();z=new Float64Array(spec.count);
        for(let row=0;row<y.length;row++)for(let column=0;column<x.length;column++){const radius=Math.hypot(x[column],y[row]);z[row*x.length+column]=Math.cos(2*radius)*Math.exp(-radius*.3);}
      }else{
        x=new Float64Array(spec.count);y=new Float64Array(spec.count);z=new Float64Array(spec.count);let seed=42;
        const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)+1)/4294967297;
        for(let i=0;i<spec.count;i++){x[i]=random()*2-1;y[i]=random()*2-1;z[i]=random()*2-1;}
      }
      const generatedMs=performance.now()-sourceStart,started=performance.now(),f=figure({kind:'3d',width:1000,height:600,title:`3D matrix: ${spec.kind}`});
      if(spec.kind==='surface')f.surface(x,y,z,{shading:'smooth'});else f.scatter3d(x,y,z,{size:3});
      f.mount(document.querySelector('#chart'));await f.ready();const readyResolvedMs=performance.now()-started,gl=document.querySelector('canvas').getContext('webgl2');gl.finish();
      const firstReadyGpuCompleteMs=performance.now()-started,beforeOrbit=f.diagnostics(),heapFirst=memory(),debug=gl.getExtension('WEBGL_debug_renderer_info'),gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,canvas={width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};
      const orbitSamples=[];
      for(let i=0;i<30;i++){const t=performance.now();f.setView({camera:{azimuth:35+i*3,elevation:25+12*Math.sin(i/5),distance:3}});await f.ready();gl.finish();orbitSamples.push(performance.now()-t);}
      const afterOrbit=f.diagnostics(),panel=f.view.panels[0],pick=(x,y)=>{const t=performance.now();f.view.hover(x,y,true);return performance.now()-t;};
      const coldPickMs=pick(panel.rect.left+panel.rect.width*.5,panel.rect.top+panel.rect.height*.5),coldPicking=f.diagnostics().picking,heapWithIndex=memory(),pickSamples=[],candidateSamples=[];
      for(let i=0;i<100;i++){pickSamples.push(pick(panel.rect.left+panel.rect.width*(.15+.7*((i*37)%100)/99),panel.rect.top+panel.rect.height*(.15+.7*((i*61)%100)/99)));candidateSamples.push(f.diagnostics().picking.lastCandidates);}
      const afterPicking=f.diagnostics(),error=gl.getError(),glVersion=gl.getParameter(gl.VERSION),sourceIdentityBytes=[...f.view.geometries.values()].reduce((sum,item)=>sum+(item.geometry.sourceIndices?.byteLength??0),0),summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {min:sorted[0],median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
      f.close();return {...spec,generatedMs,readyResolvedMs,firstReadyGpuCompleteMs,orbit:summarize(orbitSamples),orbitSamples,coldPickMs,warmPick:summarize(pickSamples),pickSamples,candidates:summarize(candidateSamples),candidateSamples,canvas,gpu,glVersion,error,beforeOrbit,afterOrbit,coldPicking,afterPicking,afterClose:f.diagnostics(),heap:{before:heapBefore,first:heapFirst,withPickingIndex:heapWithIndex},sourceIdentityBytes};
    },{runtime,spec});
    results.push({repeat,...result});console.log(JSON.stringify({repeat,kind:spec.kind,count:spec.count,firstReadyGpuCompleteMs:result.firstReadyGpuCompleteMs,orbitP95Ms:result.orbit.p95,coldPickMs:result.coldPickMs,warmPickP95Ms:result.warmPick.p95,pickingIndexBytes:result.afterPicking.picking.lastIndexBytes}));await page.close();
  }
  assert.equal(await hashFile(`.${runtime}`),initialHash,'Runtime changed during measurement; rerun on one fixed build');assert.equal(await hashFile('./packages/core/dist/worker.js'),workerHash,'Worker changed during measurement');
  const report={recordedAt:new Date().toISOString(),runtime,sha256:initialHash,workerSha256:workerHash,browser:browser.version(),softwareGpuRequested:software,platform:platform(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,physicalMemoryBytes:totalmem(),repeats,seed:42,viewport:{width:1000,height:600,dpr:1},warmup:'one unmeasured small surface and scatter3d, then new page per measured case',timing:'first ready includes Figure creation, source registration, mount and ready; GPU completion also calls gl.finish. Orbit includes ready + gl.finish. Picking is synchronous committed hover; cold includes index build, warm reuses the camera index.',memory:'Heap is Chrome precise-memory sample, not a forced-GC retained heap. geometryBytes/estimatedGPUBytes count geometry GPU attributes. sourceIdentityBytes and picking.lastIndexBytes add CPU identity/index storage. Driver and framebuffer allocation are not estimatedGPUBytes.',p95:'nearest rank; raw samples retained',results};
  await mkdir('artifacts/v09',{recursive:true});const path=`artifacts/v09/3d-${software?'software':'default-gpu'}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(`Wrote ${path}`);
  for(const result of results){assert.deepEqual(result.canvas,{width:1000,height:600});assert.equal(result.error,0);assert.equal(result.afterOrbit.geometryBuilds,result.beforeOrbit.geometryBuilds,'Orbit must reuse source geometry');assert.equal(result.afterOrbit.uploadedBytes,result.beforeOrbit.uploadedBytes,'Orbit must not upload geometry');assert.equal(result.afterPicking.picking.indexBuilds,result.coldPicking.indexBuilds,'Warm pointer moves must reuse the projected index');assert.equal(result.afterClose.sourceBytes,0);}
}finally{await browser?.close();server.kill();}
