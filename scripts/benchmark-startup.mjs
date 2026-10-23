// Immutable before/after captures and short paired cold-start measurements.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {cp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {cpus,platform,release} from 'node:os';
import {chromium} from '@playwright/test';

const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(root,'artifacts/startup-2026-10-23');
const command=process.argv[2]??'measure',phase=process.argv[3];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inventory(folder,prefix=''){
  const files=[];
  for(const item of await readdir(folder,{withFileTypes:true})){
    const name=prefix+item.name,path=resolve(folder,item.name);
    if(item.isDirectory())files.push(...await inventory(path,name+'/'));
    else if(/\.(?:js|css|html)$/.test(name)){const bytes=await readFile(path);files.push({name,bytes:bytes.length,gzipBytes:gzipSync(bytes,{level:9}).length,sha256:hash(bytes)});}
  }
  return files;
}
if(command==='capture'){
  assert.ok(['before','after'].includes(phase),'capture requires before or after');
  const destination=resolve(output,phase);assert.ok(!existsSync(destination),`Refusing to replace ${destination}`);
  await mkdir(destination,{recursive:true});await cp(resolve(root,'examples/react-saas/dist'),resolve(destination,'app'),{recursive:true});
  await mkdir(resolve(destination,'core'),{recursive:true});
  for(const file of await readdir(resolve(root,'packages/core/dist')))if(file.endsWith('.js'))await cp(resolve(root,'packages/core/dist',file),resolve(destination,'core',file));
  const files=await inventory(destination);await writeFile(resolve(destination,'manifest.json'),JSON.stringify({capturedAt:new Date().toISOString(),phase,files},null,2)+'\n');
  console.log(JSON.stringify({phase,destination,files:files.map(({name,bytes,gzipBytes})=>({name,bytes,gzipBytes}))},null,2));
  process.exit(0);
}
assert.ok(['measure','probe'].includes(command),'Use capture before, capture after, measure, or probe <before|after> <mode>');
const manifests={};
const capturedFiles=new Map();
for(const phase of ['before','after']){
  manifests[phase]=JSON.parse(await readFile(resolve(output,phase,'manifest.json'),'utf8'));
  for(const file of manifests[phase].files){
    assert.equal(hash(await readFile(resolve(output,phase,file.name))),file.sha256,`Changed captured file: ${phase}/${file.name}`);
    capturedFiles.set(`/${phase}/${file.name}`,file);
  }
}
const fixture=(phase,mode)=>`<!doctype html><html lang="en"><meta charset="utf-8"><title>Vesora ${mode} cold start</title><style>body{margin:0;background:#101215;color:#edf0f4;font-family:system-ui}#chart{width:${mode==='embed'?320:1000}px;margin:24px}</style><main id="chart"></main><script type="module">
import {figure} from '/${phase}/core/${phase==='before'?'index':'runtime'}.js';
import {mountViewer} from '/${phase}/core/viewer.js';
try{
  const x=Float64Array.from({length:10000},(_,i)=>i/1000),y=Float64Array.from(x,value=>298+Math.sin(value));
  const fig=figure({title:'Temperature',height:360}),line=fig.plot(x,y,{label:'Sensor A'});
  line.setSemantics({x:{unit:'s'},y:{quantity:'temperature',unit:'K'}});
  const viewer=mountViewer(fig,document.querySelector('#chart'),{mode:'${mode}',observation:true});window.__fixture={fig,viewer};
  await fig.ready();const readyMs=performance.now();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  window.__startup={readyMs,afterPaintMs:performance.now(),worker:fig.diagnostics().worker,frameId:fig.getInspectionState().frameId};
}catch(error){window.__startup={error:String(error?.stack??error)};}
</script></html>`;
const contentTypes={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'};
// Local security software can inject remote scripts into HTTP pages. Use the
// same policy for both builds so those scripts cannot become benchmark work.
const securityHeaders={'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; font-src 'self' data:; object-src 'none'"};
let activeScriptRequests=[];
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),parts=url.pathname.split('/').filter(Boolean);
    if(parts.length===2&&['before','after'].includes(parts[0])&&['studio.html','embed.html'].includes(parts[1])){
      res.writeHead(200,{'Content-Type':'text/html',...securityHeaders});res.end(fixture(parts[0],parts[1].split('.')[0]));return;
    }
    const path=resolve(output,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(output+sep)){res.writeHead(403).end();return;}
    const bytes=await readFile(path),type=contentTypes[extname(path)]??'application/octet-stream';
    // Count at the server so dedicated-worker fetches are included too. Samples
    // run sequentially; every request (including repeated worker URLs) counts.
    if(extname(path)==='.js')activeScriptRequests.push({url:url.pathname,bytes:bytes.length,gzipBytes:capturedFiles.get(url.pathname).gzipBytes});
    res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,...securityHeaders});res.end(bytes);
  }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const port=server.address().port;
let browser;
const samples=[];
try{
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  // Every sample uses a fresh browser context and disabled cache. Alternate order
  // to reduce phase bias. This is local uncompressed HTTP, not a network simulation.
  for(let round=0;round<(command==='probe'?1:5);round++)for(const mode of command==='probe'?[process.argv[4]??'workbench']:['studio','embed','workbench'])for(const phase of command==='probe'?[process.argv[3]??'after']:round%2?['after','before']:['before','after']){
    const context=await browser.newContext({viewport:{width:1280,height:1000},deviceScaleFactor:1}),page=await context.newPage(),errors=[],consoleErrors=[];
    activeScriptRequests=[];
    await context.route(/^https?:\/\//,route=>new URL(route.request().url()).origin===`http://127.0.0.1:${port}`?route.continue():route.abort());
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text().slice(0,500));});
    if(mode==='workbench')await page.addInitScript(()=>{
      const observer=new MutationObserver(()=>{
        const selectors=['[aria-label="Studio workspace"]','[aria-label="Embedded sensor card"]'];
        if(!selectors.every(selector=>{
          const host=document.querySelector(selector),status=host?.querySelector('.vv-status');
          const freeze=Array.from(host?.querySelectorAll('button')??[]).find(button=>button.textContent?.trim()==='Freeze view');
          // Live is already displayed during mount. The freeze control is
          // enabled only once frameId > 0, so both actual frames must exist.
          return /^(Live|Ready)$/.test(status?.textContent?.trim()??'')&&freeze&&!freeze.disabled;
        }))return;
        observer.disconnect();const readyMs=performance.now();
        const workers=selectors.map(selector=>Array.from(document.querySelectorAll(`${selector} .vv-inspection`)).some(node=>node.textContent?.includes('Worker: active')));
        requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__startup={readyMs,afterPaintMs:performance.now(),workers};}));
      });
      observer.observe(document,{childList:true,subtree:true,characterData:true,attributes:true});
    });
    const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    await page.goto(`http://127.0.0.1:${port}/${phase}/${mode==='workbench'?'app/index.html?demo=workbench':mode+'.html'}`,{waitUntil:'domcontentloaded'});
    let measurement;
    try{
    if(mode==='workbench'){
      await page.waitForFunction(()=>window.__startup);measurement=await page.evaluate(()=>window.__startup);
      assert.deepEqual(measurement.workers,[true,true],'Workbench must use real workers in both phases');
    }else{
      await page.waitForFunction(()=>window.__startup);measurement=await page.evaluate(()=>window.__startup);assert.ok(!measurement.error,measurement.error);assert.equal(measurement.worker,true);assert.ok(measurement.frameId>0);
    }
    }catch(error){console.error(JSON.stringify({phase,mode,errors,consoleErrors,scripts:activeScriptRequests.map(file=>file.url),body:(await page.locator('body').innerText()).slice(0,6000)},null,2));throw error;}
    assert.deepEqual(errors,[]);
    const scripts=[...activeScriptRequests];
    if(phase==='after')assert.ok(scripts.every(file=>!file.url.includes('html-template')),'HTML export template must remain outside startup');
    if(phase==='after'&&mode==='workbench')assert.ok(scripts.every(file=>!file.url.includes('BalanceDemo')&&!file.url.includes('StreamingDemo')&&!file.url.includes('/App-')),'Unselected screens must remain outside Workbench startup');
    const resource=await page.evaluate(()=>({paint:performance.getEntriesByType('paint').map(({name,startTime})=>({name,startTime})),resources:performance.getEntriesByType('resource').filter(item=>item.name.includes('.js')).map(({name,transferSize,encodedBodySize,decodedBodySize,duration})=>({name:new URL(name).pathname,transferSize,encodedBodySize,decodedBodySize,duration}))}));
    samples.push({round,phase,mode,...measurement,scriptBytes:scripts.reduce((sum,file)=>sum+file.bytes,0),scriptGzipBytes:scripts.reduce((sum,file)=>sum+file.gzipBytes,0),scripts,consoleErrors,...resource});
    await context.close();console.log(JSON.stringify({round,phase,mode,readyMs:measurement.readyMs,scriptBytes:samples.at(-1).scriptBytes}));
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary=[];
  for(const mode of ['studio','embed','workbench'])for(const phase of ['before','after']){
    const group=samples.filter(item=>item.mode===mode&&item.phase===phase);
    if(!group.length)continue;
    summary.push({mode,phase,readyMedianMs:median(group.map(item=>item.readyMs)),afterPaintMedianMs:median(group.map(item=>item.afterPaintMs)),initialScriptBytes:median(group.map(item=>item.scriptBytes)),initialScriptGzipBytes:median(group.map(item=>item.scriptGzipBytes))});
  }
  const report={createdAt:new Date().toISOString(),environment:{node:process.version,browser:browser.version(),os:platform(),release:release(),cpu:cpus()[0]?.model,viewport:{width:1280,height:1000},deviceScaleFactor:1,gpu:'ANGLE SwiftShader'},method:'5 paired rounds per mode; fresh contexts, network cache disabled, shared browser process (not cold-process/GPU); local uncompressed HTTP; identical self-only CSP and external-request blocking exclude remote fonts and security-software script injection in both phases; first completed frame via figure.ready() or both Workbench freeze controls enabled with Live status, plus 2 rAFs (a proxy, not physical presentation). JS bytes include every dedicated-worker request. Gzip level 9 is computed offline, not sent over HTTP. No hardware GPU/FPS or Internet speed claim.',contentSecurityPolicy:securityHeaders['Content-Security-Policy'],manifests,summary,samples};
  const reportName=command==='probe'?'probe.json':'comparison.json';
  if(command==='probe')report.method='Diagnostic single sample only; not a comparative benchmark. '+report.method;
  await writeFile(resolve(output,reportName),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output:resolve(output,reportName),summary},null,2));
}finally{await browser?.close();await new Promise(done=>server.close(done));}
