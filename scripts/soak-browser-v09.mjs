// Exercise the exact candidate archive with bounded acquisition and private inspection.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {cpus,platform,totalmem} from 'node:os';
import {validateRuntimeHashes} from './release-validation.mjs';

const version=JSON.parse(await readFile('package.json','utf8')).version;
const directory=resolve(process.argv[2]??`dist/release-v${version}`),seconds=Number(process.env.VESORA_SOAK_SECONDS??7200);
assert.ok(Number.isFinite(seconds)&&seconds>=5&&seconds<=86400,'Duration must be 5..86400 seconds');
const maxPoints=Number(process.env.VESORA_SOAK_RETENTION??100000),profile=process.env.VESORA_SOAK_PROFILE??'isolated';
assert.ok(Number.isSafeInteger(maxPoints)&&maxPoints>=10&&maxPoints<=1000000);assert.ok(['isolated','concurrent-stress'].includes(profile));
const cycleSeconds=Number(process.env.VESORA_SOAK_FREEZE_EVERY??Math.min(300,seconds/3)),heldSeconds=Number(process.env.VESORA_SOAK_FREEZE_HOLD??Math.min(10,seconds/10));
assert.ok(Number.isFinite(cycleSeconds)&&cycleSeconds>=1&&Number.isFinite(heldSeconds)&&heldSeconds>=.2&&heldSeconds<=120&&cycleSeconds+heldSeconds<seconds);
const manifestBytes=await readFile(join(directory,'release-manifest.json')),manifest=JSON.parse(manifestBytes),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const archive=`vesora-core-${manifest.version}.tgz`,expected=manifest.files.find(file=>file.name===archive);assert.ok(expected);
assert.equal(hash(await readFile(join(directory,archive))),expected.sha256);
const output=resolve(process.env.VESORA_SOAK_OUTPUT??'artifacts/v09/soak');await mkdir(output,{recursive:true});
const installed=await mkdtemp(join(output,'browser-runtime-'));
execFileSync('tar',['-xzf',join(directory,archive),'-C',installed],{windowsHide:true});
const assets=new Map([['/',Buffer.from('<!doctype html><html><body><div id="chart"></div></body></html>')]]);
for(const name of validateRuntimeHashes(manifest.runtime)){const bytes=await readFile(join(installed,`package/dist/${name}.js`));assert.equal(hash(bytes),manifest.runtime[name]);assets.set(`/${name}.js`,bytes);}
const server=createServer((request,response)=>{const path=new URL(request.url,'http://127.0.0.1').pathname,body=assets.get(path);response.writeHead(body?200:404,{'Content-Type':path==='/'?'text/html':'text/javascript',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:"});response.end(body??'Not found');});
await new Promise((ready,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',ready);});
const origin=`http://127.0.0.1:${server.address().port}`,runtime='/index.js';
let browser,watchdog,report={status:'failed',qualifiesTwoHourGate:false,version:manifest.version,archiveSha256:expected.sha256,manifestSha256:hash(manifestBytes),profile};
try{
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe',software=process.env.VESORA_SOFTWARE_GPU!=='0';
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--enable-precise-memory-info',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
  const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});await page.goto(origin);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.exposeFunction('soakProgress',row=>console.log(JSON.stringify(row)));
  const result=await Promise.race([new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(new Error('Soak exceeded production plus 240-second cleanup deadline')),(seconds+240)*1000);}),page.evaluate(async({runtime,seconds,maxPoints,cycleSeconds,heldSeconds})=>{
    const {figure,toHTML}=await import(runtime),base=Float64Array.from({length:maxPoints},(_,i)=>i),curve=(x,j)=>Math.sin(x*.01+j)+j;
    const fig=figure({width:1000,height:600,title:'PRISM exact-archive soak'}),layers=Array.from({length:3},(_,j)=>fig.plot(base,Float64Array.from(base,x=>curve(x,j))).enableStreaming({maxPoints}));
    document.querySelector('#chart').style.width='1000px';fig.mount(document.querySelector('#chart'));await fig.ready({timeoutMs:60000});
    const gl=document.querySelector('canvas').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const scheduler=fig.view.scheduler;
    const pending=new Set(),presentations=[],acceptance=[],liveLatency=[],frozenLatency=[],errors=[],snapshots=[],resources=[];
    let batches=0,totalRows=0,accepted=0,covered=0,exports=0,freezes=0,epoch=0,controlBusy=false,control=Promise.resolve(),stopping=false,nextControl=cycleSeconds*1000;
    const start=performance.now(),cycleMs=cycleSeconds*1000,heldMs=heldSeconds*1000;
    const deadline=(promise,label,ms=60000)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),ms);})]).finally(()=>clearTimeout(timer));};
    const verifySources=(lease,expectedNext)=>{const ranges=[];for(let j=0;j<layers.length;j++){const layer=lease.snapshot.figure.layers.find(item=>item.id===layers[j].id),x=lease.registry.get(layer.data.x).values,y=lease.registry.get(layer.data.y).values;
      if(x.length!==maxPoints||y.length!==maxPoints)throw new Error('Rendered retained length mismatch');
      for(let i=0;i<x.length;i++)if(x[i]!==x[0]+i||Math.abs(y[i]-curve(x[i],j))>1e-12)throw new Error(`Rendered source mismatch in series ${j}, sample ${i}`);
      ranges.push([x[0],x[x.length-1],x.length]);}if(ranges.some(range=>JSON.stringify(range)!==JSON.stringify(ranges[0])))throw new Error('Displayed atomic series are not aligned');
      if(expectedNext!==undefined&&ranges[0][1]+1!==expectedNext)throw new Error('Displayed range does not cover final accepted samples');return ranges;};
    fig.on('error',event=>errors.push({phase:'renderer',message:event.message}));
    fig.on('frame',state=>{const states=Object.values(state.displayedStreams);if(states.length!==3||states.some(s=>s.nextSequence!==states[0].nextSequence||s.retained!==states[0].retained))errors.push({phase:'frame',message:'Atomic displayed stream identities differ'});
      if(state.mode!=='live')return;while(presentations.length&&presentations[0].revision<=state.displayedRevision){const row=presentations.shift();covered++;(row.frozen||row.epoch!==epoch?frozenLatency:liveLatency).push(performance.now()-row.started);}});
    const record=()=>{const diagnostics=fig.diagnostics(),row={seconds:(performance.now()-start)/1000,batches,accepted,covered,pending:pending.size,heapBytes:performance.memory?.usedJSHeapSize??null,diagnostics};resources.push(row);window.soakProgress({seconds:row.seconds,batches,accepted,covered,exports,freezes,snapshotBytes:diagnostics.snapshotBytes,sourceBytes:diagnostics.sourceBytes});};
    const producer=setInterval(()=>{
      if(stopping)return;
      const size=batches%100===99?1000:100,x=Float64Array.from({length:size},(_,i)=>maxPoints+totalRows+i),started=performance.now(),frozen=fig.getInspectionState().mode==='frozen';
      try{
        const operation=fig.appendDataBatch(layers.map((layer,j)=>({layer,data:{x,y:Float64Array.from(x,t=>curve(t,j))}})),{waitFor:'accepted'});
        batches++;totalRows+=size;presentations.push({revision:fig.acceptedRevision,started,frozen,epoch});pending.add(operation);
        if(presentations.length>20000){errors.push({phase:'ledger',message:'Pending presentation ledger exceeded its bound'});stopping=true;}
        operation.then(()=>{accepted++;acceptance.push(performance.now()-started);},error=>errors.push({phase:'append',message:error.message,code:error.code})).finally(()=>pending.delete(operation));
      }catch(error){errors.push({phase:'append-sync',message:error.message});}
    },50);
    const controls=setInterval(()=>{
      if(stopping||controlBusy||performance.now()-start<nextControl||performance.now()-start+heldMs>=seconds*1000-250)return;
      controlBusy=true;nextControl=performance.now()-start+cycleMs;
      control=(async()=>{
        const held=fig.freezeInspection();freezes++;epoch++;const before=JSON.stringify(fig.getInspectionSnapshot());
        await new Promise(resolve=>setTimeout(resolve,heldMs));
        if(JSON.stringify(fig.getInspectionSnapshot())!==before)throw new Error('Frozen source descriptors changed during ingestion');
        if(fig.getInspectionState().acceptedRevision<=held.acceptedRevision)throw new Error('Acquisition stopped during inspection');
        const lease=fig.captureExport('displayed');let ranges;try{ranges=verifySources(lease);}finally{lease.release();}
        const png=fig.savefig({source:'displayed',width:400,height:300,scale:1}),html=toHTML(fig,{source:'displayed'}),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('#vesora-payload').textContent);
        if(payload.capture.snapshotId!==held.snapshotId)throw new Error('HTML belongs to another snapshot');
        const [,blob]=await deadline(Promise.all([fig.resumeLive(),png]),'Resume and displayed PNG');const signature=[...new Uint8Array(await blob.arrayBuffer()).slice(0,8)];
        if(String(signature)!=='137,80,78,71,13,10,26,10')throw new Error('Invalid PNG');
        exports++;snapshots.push({snapshotId:held.snapshotId,frameId:held.frameId,acceptedAtCapture:held.acceptedRevision,displayedAtCapture:held.displayedRevision,ranges});
        if(fig.diagnostics().snapshotBytes!==0)throw new Error('Snapshot reservation leaked after resumed export');
      })().catch(error=>errors.push({phase:'inspection',message:error.message})).finally(()=>{controlBusy=false;});
    },100);
    record();const sampler=setInterval(record,30_000);
    await new Promise(resolve=>setTimeout(resolve,seconds*1000));const producerDurationSeconds=(performance.now()-start)/1000;stopping=true;clearInterval(producer);clearInterval(controls);clearInterval(sampler);
    await deadline(control,'Inspection cleanup',150000);await deadline(Promise.allSettled([...pending]),'Accepted append drain');if(fig.getInspectionState().mode==='frozen')await deadline(fig.resumeLive(),'Final resume');await fig.ready({timeoutMs:60000});record();
    const finalLease=fig.captureExport('displayed');let finalRanges;try{finalRanges=verifySources(finalLease,maxPoints+totalRows);}finally{finalLease.release();}
    const states=layers.map(layer=>fig.getStreamingState(layer.id)),diagnostics=fig.diagnostics();fig.close();
    return {producerDurationSeconds,durationSeconds:(performance.now()-start)/1000,batches,totalRows,accepted,covered,exports,freezes,pendingPresentations:presentations.length,states,diagnostics,afterClose:fig.diagnostics(),schedulerAfterClose:scheduler.stats,remainingCanvases:document.querySelectorAll('canvas').length,resources,snapshots,finalRanges,acceptanceMs:acceptance,liveFrameLatencyMs:liveLatency,frozenFrameLatencyMs:frozenLatency,errors,renderer};
  },{runtime,seconds,maxPoints,cycleSeconds,heldSeconds})]);
  report={...report,runtimeHashes:manifest.runtime,recordedAt:new Date().toISOString(),browser:browser.version(),cpu:cpus()[0]?.model,platform:platform(),physicalMemoryBytes:totalmem(),softwareGpuRequested:software,requestedSeconds:seconds,latencyReference:profile==='isolated',scope:'Exact core tarball; three bounded series, atomic batches, bursts, frozen snapshots and exports across resume. Latency crossing any freeze is separate. JS heap includes test serialization; no OS RSS or GPU-driver memory claim.',browserErrors:errors,result};
  assert.deepEqual(errors,[]);assert.deepEqual(result.errors,[]);assert.equal(result.accepted,result.batches);assert.equal(result.covered,result.accepted);assert.equal(result.pendingPresentations,0);assert.ok(result.exports>0);
  for(const state of result.states){assert.equal(state.retained,maxPoints);assert.equal(state.nextSequence,maxPoints+result.totalRows);}
  assert.equal(result.liveFrameLatencyMs.length+result.frozenFrameLatencyMs.length,result.covered);
  assert.equal(result.diagnostics.pendingAppends,0);assert.equal(result.diagnostics.pendingExports,0);assert.equal(result.diagnostics.snapshotBytes,0);assert.equal(result.diagnostics.sourceBytes,3*2*maxPoints*8);assert.equal(result.afterClose.sourceBytes,0);assert.equal(result.afterClose.pendingAppends,0);assert.equal(result.remainingCanvases,0);
  for(const sample of result.resources)for(const cache of Object.values(sample.diagnostics.lineIndex))assert.ok(cache.indexBytes+cache.retainedBytes<=8*1024*1024,'Line index exceeded its accounted resource budget');
  for(const cache of Object.values(result.schedulerAfterClose.lineIndex)){assert.equal(cache.indexBytes,0);assert.equal(cache.retainedBytes,0);}
  assert.equal(result.schedulerAfterClose.worker,false);assert.equal(result.schedulerAfterClose.workerSourceBytes,0);assert.equal(result.schedulerAfterClose.pending,0);
  assert.equal(result.diagnostics.contextLost,false);report.status='passed';report.qualifiesTwoHourGate=seconds>=7200&&result.producerDurationSeconds>=7200;
  console.log(`Browser soak passed (${result.durationSeconds.toFixed(1)}s; two-hour gate: ${report.qualifiesTwoHourGate}).`);
}catch(error){report.error=String(error);throw error;}
finally{clearTimeout(watchdog);await writeFile(join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');await browser?.close();await new Promise(done=>server.close(done));}
