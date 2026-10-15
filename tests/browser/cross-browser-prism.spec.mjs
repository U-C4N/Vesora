import {test,expect} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {prismReleaseScenes} from '../../scripts/prism-release-scenes.mjs';

test.beforeEach(async({page,browser,browserName},testInfo)=>{
  await page.goto('/tests/browser/harness.html');
  const support=await page.evaluate(()=>{const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');if(!gl)return {webgl2:false,userAgent:navigator.userAgent};const extension=gl.getExtension('WEBGL_debug_renderer_info'),info={webgl2:true,userAgent:navigator.userAgent,version:gl.getParameter(gl.VERSION),renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};gl.getExtension('WEBGL_lose_context')?.loseContext();return info;});
  const runtimeHashes=Object.fromEntries(await Promise.all(['index','worker','viewer','labs'].map(async name=>[name,createHash('sha256').update(await readFile(new URL(`../../packages/core/dist/${name}.js`,import.meta.url))).digest('hex')])));
  await testInfo.attach('engine-provenance',{body:JSON.stringify({engine:browserName,browserVersion:browser.version(),runtimeHashes,...support},null,2),contentType:'application/json'});
  expect(support.webgl2,`${browserName} desktop automation engine must provide real WebGL2`).toBe(true);
  await page.evaluate(async()=>{document.querySelector('#chart').style.width='1100px';window.vs=await import('/packages/core/dist/index.js');window.viewer=await import('/packages/core/dist/viewer.js');});
});

test('shared viewer renders scientific 3D, exact slices, picking and PNG',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(async()=>{const f=vs.subplots({rows:1,cols:2,kinds:[['3d','2d']],width:1100,height:480}),axis=Float64Array.from({length:25},(_,i)=>i/24),z=Float64Array.from({length:625},(_,i)=>Math.sin(axis[i%25]*4)*Math.cos(axis[Math.floor(i/25)]*4));const surface=f.panel(0,0).surface(axis,axis,z,{shading:'smooth',wireframe:true});f.panel(0,1).slice(surface,{axis:'x',index:12});window.figure=f;window.handle=viewer.mountViewer(f,document.querySelector('#chart'),{theme:'dark'});await f.ready();});
  await expect(page.locator('[data-vesora-viewer]')).toHaveCount(1);await page.locator('summary').filter({hasText:/^Inspector$/}).click();await page.getByRole('button',{name:'XY',exact:true}).click();await page.getByRole('slider').fill('8');
  const result=await page.evaluate(async()=>{await figure.ready();const hits=[];figure.on('hover',hit=>{if(hit)hits.push(hit);});const p=figure.view.panels[0];figure.view.hover(p.rect.left+p.rect.width*.5,p.rect.top+p.rect.height*.5,true);const gl=document.querySelector('canvas').getContext('webgl2'),pixels=new Uint8Array(gl.canvas.width*gl.canvas.height*4);gl.readPixels(0,0,gl.canvas.width,gl.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let colored=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>35)colored++;const blob=await figure.savefig({width:900,height:500}),bitmap=await createImageBitmap(blob),error=gl.getError();return {hit:hits.at(-1),slice:figure.snapshot().figure.slices[0].index,png:[bitmap.width,bitmap.height],colored,error};});
  expect(result.hit?.kind).toBe('surface');expect(result.slice).toBe(8);expect(result.png).toEqual([900,500]);expect(result.colored).toBeGreaterThan(500);expect(result.error).toBe(0);await page.getByRole('button',{name:'Light theme',exact:true}).click();await expect(page.getByRole('button',{name:'Dark theme',exact:true})).toBeVisible();await page.evaluate(()=>{handle.dispose();figure.close();});expect(errors).toEqual([]);
});

test('frozen telemetry remains displayed while atomic accepted batches advance',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({width:1000,height:500}),layers=[0,1,2].map(j=>f.plot([0,1],[j,j+1]).enableStreaming({maxPoints:4}));const handle=viewer.mountViewer(f,document.querySelector('#chart'),{theme:'dark'});await f.ready();const frozen=f.freezeInspection(),snapshot=f.getInspectionSnapshot();
    await f.appendDataBatch(layers.map((layer,j)=>({layer,data:{x:[2,3,4,5],y:[2+j,3+j,4+j,5+j]}})),{waitFor:'accepted'});const before=f.getInspectionState(),same=JSON.stringify(snapshot)===JSON.stringify(f.getInspectionSnapshot());
    const blob=await f.savefig({source:'displayed',width:900,height:500}),bitmap=await createImageBitmap(blob);await f.resumeLive();const after=f.getInspectionState(),counts=layers.map(layer=>f.getStreamingState(layer.id).retained),error=document.querySelector('canvas').getContext('webgl2').getError();handle.dispose();f.close();return {frozen,before,after,same,counts,png:[bitmap.width,bitmap.height],error};
  });
  expect(result.same).toBe(true);expect(result.before.displayedRevision).toBe(result.frozen.displayedRevision);expect(result.before.acceptedRevision).toBeGreaterThan(result.before.displayedRevision);expect(result.after.displayedRevision).toBe(result.after.acceptedRevision);expect(result.counts).toEqual([4,4,4]);expect(result.png).toEqual([900,500]);expect(result.error).toBe(0);
});

test('three protocol7 captures open offline in the shared viewer and download PNG',async({page,browserName},testInfo)=>{
  test.setTimeout(90_000);const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/i.test(request.url()))requests.push(request.url());});
  // This Windows WebKit build rejects even a tiny local file when Playwright's
  // offline flag is set. Block every HTTP(S) request instead, preserving actual
  // file:// loading and verifying the export needs no network resource.
  if(browserName==='webkit')await page.context().route(/^https?:\/\//i,route=>route.abort('internetdisconnected'));else await page.context().setOffline(true);
  await testInfo.attach('network-isolation',{body:JSON.stringify({mode:browserName==='webkit'?'all HTTP(S) requests aborted; file loading enabled':'browser context offline',externalRequestsAllowed:false}),contentType:'application/json'});
  for(const [name,html]of await prismReleaseScenes()){
    const path=testInfo.outputPath(name);await mkdir(testInfo.outputDir,{recursive:true});await writeFile(path,html);await page.goto(pathToFileURL(path).href);await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');await expect(page.locator('[data-vesora-viewer]')).toHaveCount(1);await expect(page.locator('#vesora-error')).toBeHidden();
    const downloadPromise=page.waitForEvent('download');await page.locator('[data-vesora-viewer]').getByRole('button',{name:/^(Download|Export) PNG$/}).click();const download=await downloadPromise,pngPath=testInfo.outputPath(name.replace('.html','.png'));await download.saveAs(pngPath);expect(await download.failure()).toBeNull();const bytes=await readFile(pngPath);expect(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))).toBe(true);expect(bytes.readUInt32BE(16)).toBeGreaterThanOrEqual(200);expect(bytes.readUInt32BE(20)).toBeGreaterThanOrEqual(180);
  }
  expect(requests).toEqual([]);expect(errors).toEqual([]);
});
