// Reproducible v0.9 regression/stream measurements; run without other GPU jobs.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {cpus,platform,totalmem} from 'node:os';
import {createHash} from 'node:crypto';

const mode=process.argv[2]??'stream';
assert.ok(['regression','stream','soak'].includes(mode),'Use regression, stream or soak');
const software=process.env.VESORA_SOFTWARE_GPU!=='0',port=4189;
const seconds=Number(process.env.VESORA_SOAK_SECONDS??(mode==='soak'?1800:60));
assert.ok(Number.isFinite(seconds)&&seconds>=1);
const runtimes={v08:'/artifacts/v09/baseline/package/dist/index.js',v09:'/packages/core/dist/index.js'};
const measuredRuntimes=mode==='regression'?Object.entries(runtimes):[['v09',runtimes.v09]];
const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex'),hash=async path=>hashBytes(await readFile(`.${path}`));
const fingerprints=async()=>({runtimeHashes:Object.fromEntries(await Promise.all(measuredRuntimes.map(async([label,path])=>[label,await hash(path)]))),workerHashes:Object.fromEntries(await Promise.all(measuredRuntimes.map(async([label,path])=>[label,await hash(path.replace(/index\.js$/,'worker.js'))])))});
const initialFingerprints=await fingerprints();let baselineArchiveSha256,baselineArchivePath;
if(mode==='regression'){
  const archive=baselineArchivePath=process.env.VESORA_V08_ARCHIVE??'dist/release-v0.8.0/vesora-core-0.8.0.tgz';baselineArchiveSha256=hashBytes(await readFile(archive));
  assert.equal(baselineArchiveSha256,'ab36142c084f0b33236e47d248c5ff9ab81bf4b4ef0e0c2bd4f7216aa2af9bb8','Baseline archive differs from the recorded v0.8 release');
  for(const [name,expected]of [['index',initialFingerprints.runtimeHashes.v08],['worker',initialFingerprints.workerHashes.v08]])assert.equal(hashBytes(execFileSync('tar',['-xOf',archive,`package/dist/${name}.js`],{windowsHide:true,maxBuffer:32*1024*1024})),expected,`Served v0.8 ${name} differs from the archived baseline`);
}
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'ignore'});
let browser;
const results=[];
try{
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/tests/browser/harness.html`)).ok)break;}catch{}if(i===99)throw new Error('Benchmark server failed');await new Promise(r=>setTimeout(r,100));}
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--enable-precise-memory-info',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
  const open=async()=>{const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);await page.evaluate(()=>{document.querySelector('#chart').style.width='1000px';});return page;};
  for(const runtime of mode==='regression'?Object.values(runtimes):[runtimes.v09]){
    const page=await open();await page.evaluate(async runtime=>{const {figure}=await import(runtime),fig=figure({width:1000,height:600});fig.scatter([0,1,2],[0,1,0]);fig.scatter([0,1,2],[0,1,0],{representation:'density'});fig.mount(document.querySelector('#chart'));await fig.ready();fig.close();},runtime);await page.close();
  }
  if(mode==='regression')for(let repeat=0;repeat<5;repeat++)for(const kind of ['density','line'])for(const label of repeat%2?['v09','v08']:['v08','v09']){
    const page=await open();
    const result=await page.evaluate(async({runtime,kind})=>{
      const {figure}=await import(runtime),n=1_000_000,x=new Float64Array(n),y=new Float64Array(n);
      let seed=42;const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)+1)/4294967297;
      for(let i=0;i<n;i++)if(kind==='density'){const r=Math.sqrt(-2*Math.log(random())),a=random()*Math.PI*2;x[i]=r*Math.cos(a);y[i]=r*Math.sin(a);}else{x[i]=i/1000;y[i]=Math.sin(x[i])+.1*Math.sin(x[i]*17);}
      const started=performance.now(),fig=figure({width:1000,height:600,title:`v0.9 regression ${kind}`});
      if(kind==='density')fig.scatter(x,y);else fig.plot(x,y);
      fig.mount(document.querySelector('#chart'));await fig.ready();const firstRenderMs=performance.now()-started,samples=[];
      for(let i=0;i<100;i++){const phase=((i*7)%100)/5,radius=4*(1-phase/30),t=performance.now();fig.setView(kind==='density'?{xDomain:[-radius,radius],yDomain:[-radius,radius]}:{xDomain:[phase*7,1000-phase*9],yDomain:[-1.2,1.2]});await fig.ready();samples.push(performance.now()-t);}
      const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean),debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
      const canvas={width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};
      if(canvas.width!==1000||canvas.height!==600)throw new Error(`Unexpected measured canvas ${JSON.stringify(canvas)}`);
      const sorted=[...samples].sort((a,b)=>a-b),info=fig.inspect();fig.close();
      return {kind,count:n,canvas,firstRenderMs,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],samples,gpu,info};
    },{runtime:runtimes[label],kind});
    results.push({repeat,label,...result});console.log(JSON.stringify({repeat,label,kind,firstRenderMs:result.firstRenderMs,p95Ms:result.p95Ms}));await page.close();
  }
  else{
    const page=await open();await page.exposeFunction('reportSample',sample=>console.log(JSON.stringify(sample)));
    const result=await page.evaluate(async({runtime,seconds})=>{
      const {figure}=await import(runtime),maxPoints=100_000,batchSize=100,series=3;
      const x=Float64Array.from({length:maxPoints},(_,i)=>i),curve=(t,j)=>(j+1)*.15+3*Math.exp(-t/2000)+.08*Math.sin(t*.07+j);
      const fig=figure({width:1000,height:600,title:'Bounded synthetic telemetry'});
      const layers=Array.from({length:series},(_,j)=>fig.plot(x,Float64Array.from(x,t=>curve(t,j)),{label:`Model ${j+1}`}).enableStreaming({maxPoints}));
      fig.setHoverMode('x');fig.mount(document.querySelector('#chart'));await fig.ready();
      const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean),debug=gl?.getExtension('WEBGL_debug_renderer_info'),gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
      const canvas={width:gl.drawingBufferWidth,height:gl.drawingBufferHeight};
      if(canvas.width!==1000||canvas.height!==600)throw new Error(`Unexpected measured canvas ${JSON.stringify(canvas)}`);
      const samples=[],memory=[],errors=[],pending=new Set();let sequence=maxPoints,batches=0,maxPending=0,deferredTicks=0;
      const begin=performance.now(),record=()=>{const row={elapsedSeconds:(performance.now()-begin)/1000,heapBytes:performance.memory?.usedJSHeapSize??null,diagnostics:fig.diagnostics()};memory.push(row);window.reportSample({mode:'stream',seconds:row.elapsedSeconds,batches,pending:pending.size,heapBytes:row.heapBytes,sourceBytes:row.diagnostics.sourceBytes,completedFrames:row.diagnostics.completedFrames});};
      record();
      const interval=setInterval(()=>{
        if(pending.size>=63){deferredTicks++;return;}
        const values=Float64Array.from({length:batchSize},(_,i)=>sequence+i);sequence+=batchSize;batches++;
        const start=performance.now();let promise;
        try{promise=fig.appendDataBatch(layers.map((layer,j)=>({layer,data:{x:values,y:Float64Array.from(values,t=>curve(t,j))}})),{waitFor:'rendered'});}
        catch(error){errors.push({code:error.code,message:error.message});return;}
        pending.add(promise);maxPending=Math.max(maxPending,pending.size);
        promise.then(()=>samples.push(performance.now()-start),error=>errors.push({code:error.code,message:error.message})).finally(()=>pending.delete(promise));
      },50);
      const sampler=setInterval(record,30_000);
      await new Promise(resolve=>setTimeout(resolve,seconds*1000));clearInterval(interval);clearInterval(sampler);
      let drainTimer;
      try{await Promise.race([Promise.allSettled([...pending]),new Promise((_,reject)=>{drainTimer=setTimeout(()=>reject(new Error('Append drain exceeded 30 seconds')),30_000);})]);await fig.ready({timeoutMs:30_000});}
      catch(error){errors.push({phase:'drain',code:error.code,message:error.message});}
      finally{clearTimeout(drainTimer);}
      record();
      const end=performance.now(),states=layers.map(layer=>fig.getStreamingState(layer.id)),diagnostics=fig.diagnostics();
      const sorted=[...samples].sort((a,b)=>a-b),p95Ms=sorted[Math.ceil(sorted.length*.95)-1]??null,p99Ms=sorted[Math.ceil(sorted.length*.99)-1]??null;
      fig.close();
      return {seconds:(end-begin)/1000,canvas,requestedBatchHz:20,actualBatchHz:batches/((end-begin)/1000),maxPoints,batchSize,series,batches,completedBatches:samples.length,maxPending,deferredTicks,p95Ms,p99Ms,samples,memory,errors,states,diagnostics,afterClose:fig.diagnostics(),gpu};
    },{runtime:runtimes.v09,seconds});
    results.push(result);await page.close();
  }
  await mkdir('artifacts/v09',{recursive:true});
  const finalFingerprints=await fingerprints();assert.deepEqual(finalFingerprints,initialFingerprints,'Runtime or worker changed during measurement; rerun on one fixed build');
  if(baselineArchivePath)assert.equal(hashBytes(await readFile(baselineArchivePath)),baselineArchiveSha256,'Baseline archive changed during measurement');
  const {runtimeHashes,workerHashes}=initialFingerprints;
  const report={mode,recordedAt:new Date().toISOString(),browser:browser.version(),softwareGpuRequested:software,cpu:cpus()[0]?.model,platform:platform(),physicalMemoryBytes:totalmem(),seed:42,baselineArchiveSha256,viewport:{width:1000,height:600,dpr:1},runtimeHashes,workerHashes,warmup:'one unmeasured points+density figure per runtime',timing:'Regression measures Figure.ready() completion, not GPU synchronization or physical display presentation. Stream latency measures explicit rendered append completion. Neither timing calls gl.finish().',p95:'nearest rank; all completion samples retained; stream p99 uses the same method',results};
  if(mode==='regression'){
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    report.comparisons=['density','line'].flatMap(kind=>['firstRenderMs','p95Ms'].map(metric=>{
      const baseline=median(results.filter(row=>row.kind===kind&&row.label==='v08').map(row=>row[metric])),current=median(results.filter(row=>row.kind===kind&&row.label==='v09').map(row=>row[metric]));
      return {kind,metric,baseline,current,changePercent:(current/baseline-1)*100,passed:current<=baseline*1.1};
    }));
  }
  const path=`artifacts/v09/${mode}-${software?'software':'default-gpu'}.json`;await writeFile(path,JSON.stringify(report,null,2)+'\n');console.log(`Wrote ${path}`);
  if(mode==='regression')assert.ok(report.comparisons.every(comparison=>comparison.passed),'A median regression exceeds the 10% release limit; inspect the saved raw samples');
  if(mode!=='regression'){
    const result=results[0];assert.deepEqual(result.errors,[]);assert.ok(result.batches>0);assert.equal(result.completedBatches,result.batches);assert.ok(result.diagnostics.pendingAppends===0);
    for(const state of result.states){assert.equal(state.retained,100_000);assert.equal(state.nextSequence,100_000+result.batches*100);}
    assert.equal(result.diagnostics.sourceBytes,3*100_000*2*8);assert.equal(result.afterClose.pendingAppends,0);assert.equal(result.afterClose.sourceBytes,0);
    // Latency/heap trends are measured evidence, never silently asserted as universal guarantees.
  }
}finally{await browser?.close();server.kill();}
