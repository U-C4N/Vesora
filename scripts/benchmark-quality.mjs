import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {cpus,platform} from 'node:os';
import {createHash} from 'node:crypto';

const label=process.argv[2]??'v07';
const runtime=process.argv[3]??'/packages/core/dist/index.js';
const software=process.env.VESORA_SOFTWARE_GPU!=='0';
const port=4187;
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'ignore'});
let browser;
try {
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/tests/browser/harness.html`)).ok)break;}catch{}if(i===99)throw new Error('Server failed');await new Promise(r=>setTimeout(r,100));}
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--enable-precise-memory-info',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
  // Warm the driver/program once, identically for both versions. The measured
  // first frame still includes figure construction, validation, worker and data.
  const warm=await browser.newPage();await warm.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);
  await warm.evaluate(async runtime=>{const {figure}=await import(runtime),f=figure({width:1000,height:600});f.scatter([0,1,2],[0,1,0]);f.scatter([0,1,2],[0,1,0],{representation:'density'});f.mount(document.querySelector('#chart'));await f.ready();f.close();},runtime);await warm.close();
  const results=[];
  for(let repeat=0;repeat<3;repeat++)for(const kind of ['density','line']){
    const page=await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
    await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);
    const result=await page.evaluate(async({runtime,kind})=>{
      const {figure}=await import(runtime),n=1_000_000,x=new Float64Array(n),y=new Float64Array(n);
      let seed=42;const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)+1)/4294967297;
      for(let i=0;i<n;i++)if(kind==='density'){const r=Math.sqrt(-2*Math.log(random())),a=random()*Math.PI*2;x[i]=r*Math.cos(a);y[i]=r*Math.sin(a);}else{x[i]=i/1000;y[i]=Math.sin(x[i])+.1*Math.sin(x[i]*17);}
      document.querySelector('#chart').style.width='1000px';
      const start=performance.now(),fig=figure({width:1000,height:600,title:`Quality baseline ${kind}`});
      if(kind==='density')fig.scatter(x,y);else fig.plot(x,y);
      fig.mount(document.querySelector('#chart'));await fig.ready();const firstRenderMs=performance.now()-start;
      const samples=[];
      for(let i=0;i<20;i++){const radius=4*(1-i/30),t=performance.now();fig.setView(kind==='density'?{xDomain:[-radius,radius],yDomain:[-radius,radius]}:{xDomain:[i*7,1000-i*9],yDomain:[-1.2,1.2]});await fig.ready();samples.push(performance.now()-t);}
      const gl=[...document.querySelectorAll('canvas')].map(c=>c.getContext('webgl2')).find(Boolean),debug=gl?.getExtension('WEBGL_debug_renderer_info');
      const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
      const sorted=[...samples].sort((a,b)=>a-b),info=fig.inspect();fig.close();
      return {kind,count:n,firstRenderMs,p95Ms:sorted[Math.ceil(sorted.length*.95)-1],samples,gpu,info};
    },{runtime,kind});
    results.push({repeat,...result});await page.close();
    console.log(JSON.stringify({label,repeat,kind,firstRenderMs:result.firstRenderMs,p95Ms:result.p95Ms}));
  }
  await mkdir('artifacts/v07',{recursive:true});
  const runtimeSHA256=createHash('sha256').update(await readFile(`.${runtime}`)).digest('hex');
  await writeFile(`artifacts/v07/${label}.json`,JSON.stringify({label,runtime,runtimeSHA256,recordedAt:new Date().toISOString(),browser:browser.version(),softwareGpuRequested:software,cpu:cpus()[0]?.model,platform:platform(),viewport:{width:1000,height:600,dpr:1},warmup:'one unmeasured points+density figure per browser session',p95:'nearest rank of 20 completed setView/ready interactions',results},null,2));
} finally {await browser?.close();server.kill();}
