// Compare single-panel and 2x2 figures with identical total source row counts.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {cpus, totalmem, platform, arch} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url)),port=4184;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,PORT:String(port)},windowsHide:true,stdio:'ignore'});
let browser;
try{
  for(let attempt=0;attempt<100;attempt++){
    try{if((await fetch(`http://127.0.0.1:${port}/tests/browser/harness.html`)).ok)break;}catch{}
    if(attempt===99)throw new Error('Benchmark server did not start');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
  const software=process.env.VESORA_SOFTWARE_GPU==='1';
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--enable-precise-memory-info',...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]});
  const cases=[];
  for(const count of [100_000,1_000_000])for(const kind of ['line','scatter'])for(const panels of [1,4]){
    const page=await browser.newPage({viewport:{width:1200,height:1000},deviceScaleFactor:1});
    try{
      await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);
      cases.push(await page.evaluate(async({count,kind,panels})=>{
        const vs=await import('/packages/core/dist/index.js');
        const chart=document.querySelector('#chart');chart.style.width='1000px';
        const dataStart=performance.now(),sources=[];let seed=42;
        const random=()=>((seed=(1664525*seed+1013904223)>>>0)+1)/4294967297;
        for(let panel=0;panel<panels;panel++){
          const n=count/panels,x=new Float64Array(n),y=new Float64Array(n);
          for(let i=0;i<n;i++){
            if(kind==='line'){x[i]=100*i/(n-1);y[i]=Math.sin(x[i])+.1*Math.sin(37*x[i]);}
            else{const r=Math.sqrt(-2*Math.log(random())),a=2*Math.PI*random();x[i]=r*Math.cos(a);y[i]=r*Math.sin(a);}
          }
          sources.push({x,y});
        }
        const generationMs=performance.now()-dataStart,started=performance.now();
        const fig=panels===1?vs.figure({width:1000,height:800}):vs.subplots({rows:2,cols:2,shareX:true,shareY:true,width:1000,height:800});
        sources.forEach(({x,y},i)=>{const target=panels===1?fig:fig.panel(Math.floor(i/2),i%2);target[kind==='line'?'plot':'scatter'](x,y);});
        fig.mount(chart);await fig.ready();
        const firstRenderMs=performance.now()-started,initial=fig.inspect(),samples=[];
        for(let i=0;i<20;i++){
          const fraction=1-i/25,start=performance.now();
          const view=kind==='line'?{xDomain:[0,100*fraction]}:{xDomain:[-4*fraction,4*fraction],yDomain:[-4*fraction,4*fraction]};
          if(panels===1)fig.setView(view);else fig.panel(1,1).setView(view);
          await fig.ready();samples.push(performance.now()-start);
        }
        const canvas=[...chart.querySelectorAll('canvas')].find(c=>c.getContext('webgl2'));
        const gl=canvas.getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
        const sorted=[...samples].sort((a,b)=>a-b);
        const result={kind,panels,totalSourceRows:count,rowsPerPanel:count/panels,sourceBytes:count*16,generationMs,viewport:{width:1000,height:800,devicePixelRatio},firstRenderMs,
          zoomToReadyMs:{samples,median:sorted[10],p95:sorted[19]},representations:{initial,final:fig.inspect()},
          memory:{jsUsedHeapBytes:performance.memory?.usedJSHeapSize??null,pythonBytes:null,gpuBytes:null},
          gpu:debug?{vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)}:null,webglError:gl.getError()};
        fig.close();return result;
      },{count,kind,panels}));
      const result=cases.at(-1);
      console.log(`${kind}: ${count} rows / ${panels} panels; first ${result.firstRenderMs.toFixed(1)} ms; zoom p95 ${result.zoomToReadyMs.p95.toFixed(1)} ms`);
    }finally{await page.close();}
  }
  const report={recordedAt:new Date().toISOString(),hardware:{platform:platform(),architecture:arch(),cpu:cpus()[0]?.model,logicalCpuCount:cpus().length,systemMemoryBytes:totalmem()},browser:{version:browser.version(),headless:true,softwareGpuRequested:software},cases,
    notes:['Fixed total rows per figure; four-panel cases split the row budget equally across panels.','Lines are monotonic-x signals; scatter uses Box–Muller Gaussian samples with LCG seed 42.','Each case uses a fresh browser page; data generation is excluded from first-render time.','Latency measures programmatic view changes through ready(), not rendering FPS.','Python transfer and GPU allocation sizes are not measured.']};
  await mkdir(resolve(root,'artifacts'),{recursive:true});
  const output=resolve(root,'artifacts','benchmark-panels.json');
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(output);
}finally{await browser?.close();server.kill();}
