/** Reproducible real-engine figure exports and a contact-sheet screenshot. No external app or existing dev server is changed. */
import {createServer} from 'node:http';
import {createReadStream,existsSync} from 'node:fs';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,extname,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {chartStories} from '../examples/web/v1-tour-scenarios.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(root,'docs/assets/v1');
const width=1200,height=700;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.png':'image/png','.css':'text/css'};
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const harness=`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;background:#fff}#capture-host{width:${width}px;height:${height}px}</style></head><body><div id="capture-host"></div><script type="module">
import * as core from '/packages/core/dist/runtime.js';
import {createChartStory} from '/examples/web/v1-tour-scenarios.js';
window.renderStory=async slug=>{
  window.currentStory?.dispose();document.getElementById('capture-host').replaceChildren();
  const story=createChartStory(core,slug,{theme:'light',width:${width},height:${height}});window.currentStory=story;
  // A wide export canvas has room for an equilateral simplex with side padding.
  // This public viewport change preserves every barycentric source value.
  if(slug==='ternary')story.figure.setView({xDomain:[-.55,1.55],yDomain:[-.067,.933]});
  story.figure.mount(document.getElementById('capture-host'));await story.figure.ready({timeoutMs:30000});
  return {keyStats:story.keyStats,caption:story.caption,representation:story.figure.inspect(),diagnostics:story.figure.diagnostics()};
};
window.exportStory=async()=>{
  const figure=window.currentStory.figure,blob=await figure.savefig({width:${width},height:${height},scale:1,source:'displayed'});
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
  const capture=figure.captureExport('displayed');let sources;
  try{sources=await Promise.all(capture.snapshot.sources.map(async descriptor=>{const source=capture.registry.get(descriptor.id).values,bytes=new Uint8Array(source.buffer,source.byteOffset,source.byteLength),digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return {...descriptor,sha256:[...digest].map(b=>b.toString(16).padStart(2,'0')).join('')};}));}finally{capture.release();}
  return {image,sources};
};
window.fixtureReady=true;
</script></body></html>`;

function hero(){
  const selected=['ecdf','spectrogram','contour','parallel','pareto','ternary'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;width:1600px;height:1120px;background:#0b1922;color:#eaf2f5;font-family:'Segoe UI',Arial,sans-serif}main{padding:45px 48px 30px;height:100%;background:radial-gradient(ellipse at 88% 0%,#183a47 0%,transparent 55%)}header{display:flex;align-items:end;justify-content:space-between;margin-bottom:26px}.mark{font-size:19px;font-weight:650;letter-spacing:5px;color:#7edcc7;margin-bottom:15px}h1{font-weight:550;font-size:49px;line-height:1.1;letter-spacing:-1.9px;margin:0 0 12px}.intro{margin:0;color:#adc1cb;font-size:17px;line-height:1.5}.stamp{border:1px solid #3c5968;border-radius:30px;padding:10px 17px;font-size:13px;letter-spacing:1.4px;color:#a7c6d4;margin-bottom:7px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.card{background:#fff;border:1px solid #365260;border-radius:13px;overflow:hidden;color:#193847;box-shadow:0 9px 26px #0002}.text{padding:16px 19px 0;min-height:80px}h2{font-size:19px;letter-spacing:-.3px;margin:0 0 7px}.problem{font-size:13px;line-height:1.4;color:#5b7482;margin:0}.chart{display:block;width:100%;height:auto}.foot{display:flex;justify-content:space-between;align-items:center;margin-top:23px;color:#94b1c0;font-size:13px}.foot strong{color:#d3e4eb;font-weight:500}.dot{color:#67cdb7;padding:0 12px}
  </style></head><body><main><header><div><div class="mark">VESORA <span style="color:#739aaa;font-weight:400">/ 1.0</span></div><h1>See the question.<br>Keep the observations.</h1><p class="intro">Ten analysis families. Python, JavaScript and React. One shared scientific engine.</p></div><div class="stamp">REAL ENGINE EXPORTS · SYNTHETIC DATA</div></header><div class="grid">${selected.map(slug=>{const item=chartStories.find(s=>s.slug===slug);return `<article class="card"><div class="text"><h2>${escape(item.title)}</h2><p class="problem">${escape(item.problemEn)}</p></div><img class="chart" alt="${escape(item.title)} actual Vesora export" src="/docs/assets/v1/${slug}.png"></article>`;}).join('')}</div><footer class="foot"><span><strong>Original source values</strong><span class="dot">·</span>Bounded live inspection<span class="dot">·</span>Standalone HTML</span><span>Supplied bounds and fields. Explicit units. No benchmark or real-experiment claim.</span></footer></main></body></html>`;
}

await mkdir(output,{recursive:true});
if(!existsSync(resolve(root,'packages/core/dist/runtime.js')))throw new Error('Build first: npm run build');
const server=createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/__v1-capture'){response.writeHead(200,{'content-type':mime['.html']}).end(harness);return;}
    if(pathname==='/__v1-hero'){response.writeHead(200,{'content-type':mime['.html']}).end(hero());return;}
    const path=resolve(root,`.${pathname}`);if(path!==root&&!path.startsWith(root+sep)){response.writeHead(403).end();return;}
    const metadata=await stat(path);if(!metadata.isFile()){response.writeHead(404).end();return;}
    response.writeHead(200,{'content-type':mime[extname(path)]??'application/octet-stream','content-length':metadata.size,'cache-control':'no-store'});createReadStream(path).pipe(response);
  }catch{response.writeHead(404).end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
let browser;
const errors=[],images=[];
try{
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin}/__v1-capture`);await page.waitForFunction(()=>window.fixtureReady);
  for(const story of chartStories){
    const rendered=await page.evaluate(slug=>window.renderStory(slug),story.slug),result=await page.evaluate(()=>window.exportStory());
    const bytes=Buffer.from(result.image.split(',')[1],'base64'),name=`${story.slug}.png`;
    if(bytes.readUInt32BE(16)!==width||bytes.readUInt32BE(20)!==height)throw new Error(`Unexpected PNG size: ${name}`);
    if(!rendered.representation.length||rendered.representation.some(info=>info.total===0||info.rendered===0))throw new Error(`Missing rendered source content: ${story.slug}`);
    await writeFile(resolve(output,name),bytes);images.push({slug:story.slug,file:`docs/assets/v1/${name}`,width,height,sha256:hash(bytes),bytes:bytes.length,method:'Figure.savefig({width:1200,height:700,scale:1,source:displayed})',...(story.slug==='ternary'?{viewport:{xDomain:[-.55,1.55],yDomain:[-.067,.933],reason:'Side padding for a near-equilateral simplex on the wide export canvas; raw fractions unchanged'}}:{}),keyStats:rendered.keyStats,caption:rendered.caption,representation:rendered.representation,sources:result.sources});
    console.log(`Captured ${story.slug}: ${width}×${height}, ${bytes.length} bytes`);
  }
  await page.evaluate(()=>{window.currentStory?.dispose();window.currentStory=undefined;});
  await page.setViewportSize({width:1600,height:1120});await page.goto(`${origin}/__v1-hero`);await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));await page.screenshot({path:resolve(output,'hero.png'),animations:'disabled'});
  const heroBytes=await readFile(resolve(output,'hero.png'));images.push({slug:'hero',file:'docs/assets/v1/hero.png',width:1600,height:1120,sha256:hash(heroBytes),bytes:heroBytes.length,method:'Playwright screenshot of a DOM contact sheet containing the real figure PNGs',figures:['ecdf','spectrogram','contour','parallel','pareto','ternary']});
  if(errors.length)throw new Error(`Page errors: ${errors.join('; ')}`);
  const inputs={};for(const file of ['examples/web/v1-tour-scenarios.js','scripts/capture-v1-readme.mjs','packages/core/package.json','packages/core/dist/runtime.js','packages/core/dist/worker.js','packages/core/dist/advanced.js','packages/core/dist/renderer.js','packages/core/dist/spectrogram-renderer.js'])if(existsSync(resolve(root,file)))inputs[file]=hash(await readFile(resolve(root,file)));
  await writeFile(resolve(output,'manifest.json'),JSON.stringify({kind:'vesora-real-engine-readme-figures',capturedAt:new Date().toISOString(),packageVersion:JSON.parse(await readFile(resolve(root,'packages/core/package.json'),'utf8')).version,synthetic:true,publicationClaim:false,performanceClaim:false,rendering:{engine:'Vesora WebGL2',browserVersion:browser.version(),backend:'Chrome ANGLE SwiftShader',deviceScaleFactor:1},reproduce:'npm run build && node scripts/capture-v1-readme.mjs',pageErrors:errors,inputs,images},null,2)+'\n');
  console.log(`Saved ${images.length} images and docs/assets/v1/manifest.json`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
