import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {figure, toHTML} from '../../packages/core/dist/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const python=process.env.VESORA_PYTHON??(existsSync(resolve(root,'.venv/Scripts/python.exe'))?resolve(root,'.venv/Scripts/python.exe'):existsSync(resolve(root,'.venv/bin/python'))?resolve(root,'.venv/bin/python'):'python');
const hostile='Measurement Ω İ 😀 </script><script>globalThis.__vesoraInjected=true</script> & $& \u2028\u2029';
const expected={line:['Full line',7],scatter:['Original points',3],heatmap:['Heatmap',9],surface:['Surface',9],scatter3d:['Original points',5]};

function scientificFigure(kind){
  const fig=figure({title:hostile,width:640,height:420});
  if(kind==='line'){
    fig.plot(Float64Array.from({length:7},(_,i)=>1e12+i*.125),[1,1,NaN,NaN,NaN,1,1],{color:'#ff0000',width:3,label:'Signal'});
    fig.setView({xDomain:[1e12,1e12+.75],yDomain:[0,2]});
  }else if(kind==='scatter')fig.scatter([1,2,3],[1,3,2],{color:'#3366ff',size:14,label:'Samples'});
  else if(kind==='scatter3d')fig.scatter3d([-2,-1,0,1,2],[0,1,0,-1,0],[1,0,-1,0,1],{color:'#3366ff',size:12});
  else fig[kind]([-1,0,1],[-1,0,1],[[0,1,0],[1,2,1],[0,1,0]]);
  fig.bookmark('Original',{note:hostile});
  return fig;
}

const pythonFixture=`import json, sys
import vesora as vs
args=json.loads(sys.stdin.buffer.read().decode('utf-8'))
kind=args['kind']
fig=vs.figure(title=args['title'],width=640,height=420)
if kind=='line':
    fig.plot([1e12+i*.125 for i in range(7)],[1,1,float('nan'),float('nan'),float('nan'),1,1],color='#ff0000',width=3,label='Signal')
    fig.set_axes(xlim=(1e12,1e12+.75),ylim=(0,2))
elif kind=='scatter':
    fig.scatter([1,2,3],[1,3,2],color='#3366ff',size=14,label='Samples')
elif kind=='scatter3d':
    fig.scatter3d([-2,-1,0,1,2],[0,1,0,-1,0],[1,0,-1,0,1],color='#3366ff',size=12)
else:
    getattr(fig,kind)([-1,0,1],[-1,0,1],[[0,1,0],[1,2,1],[0,1,0]])
fig.bookmark('Original',note=args['title'])
fig.save_html(args['path'])
fig.close()
`;

async function saveFigure(testInfo,name,fig){
  const path=testInfo.outputPath(name);
  await mkdir(dirname(path),{recursive:true});await writeFile(path,toHTML(fig),'utf8');fig.close();
  return path;
}

async function offline(page,context){
  const external=[],errors=[];
  page.on('request',request=>{if(/^https?:/i.test(request.url()))external.push(request.url());});
  page.on('pageerror',error=>errors.push(error.message));
  await context.route(/^https?:\/\//,route=>route.abort());
  await context.setOffline(true);
  await page.setViewportSize({width:1280,height:900});
  return {external,errors};
}

async function openFigure(page,path){
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await expect(page.locator('#vesora-png')).toBeEnabled();
}

const metric=(page,key)=>page.locator(`#vesora-metrics [data-field="${key}"] dd`);
const bookmark=(page,name)=>page.locator('#vesora-bookmarks button').filter({has:page.locator('.bookmark-label',{hasText:new RegExp(`^${name}$`)})});

async function pixels(page){
  return page.evaluate(()=>{
    const canvas=[...document.querySelectorAll('#vesora-chart canvas')].find(value=>value.getContext('webgl2'));
    if(!canvas)throw new Error('No WebGL canvas was mounted');
    const gl=canvas.getContext('webgl2'),data=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    let hash=2166136261,colored=0,left=0,center=0,right=0;
    for(let i=0;i<data.length;i+=4){
      hash=Math.imul(hash^data[i],16777619);hash=Math.imul(hash^data[i+1],16777619);hash=Math.imul(hash^data[i+2],16777619);
      if(Math.min(data[i],data[i+1],data[i+2])<230)colored++;
      if(data[i]>data[i+1]+50&&data[i]>data[i+2]+50){
        const x=(i/4)%canvas.width;if(x<canvas.width*.4)left++;else if(x>canvas.width*.6)right++;else center++;
      }
    }
    return {hash:hash>>>0,colored,left,center,right,error:gl.getError()};
  });
}

for(const producer of ['JavaScript','Python'])for(const kind of Object.keys(expected)){
  test(`${producer} ${kind} export renders from a real offline HTML file`,async({page,context},testInfo)=>{
    const watched=await offline(page,context);
    let path;
    if(producer==='JavaScript')path=await saveFigure(testInfo,`${kind}.html`,scientificFigure(kind));
    else{
      path=testInfo.outputPath(`${kind}.html`);await mkdir(dirname(path),{recursive:true});
      execFileSync(python,['-c',pythonFixture],{cwd:root,env:{...process.env,PYTHONPATH:resolve(root,'python')},input:JSON.stringify({kind,path,title:hostile}),encoding:'utf8'});
    }
    await openFigure(page,path);
    await expect(page.locator('html')).toHaveAttribute('lang','en');
    await expect(page.locator('#vesora-representation')).toHaveText(expected[kind][0]);
    await expect(metric(page,'total')).toHaveAttribute('data-value',String(expected[kind][1]));
    expect(await page.title()).toBe(`${hostile} — Vesora`);
    expect(await page.evaluate(()=>globalThis.__vesoraInjected)).toBeUndefined();
    await bookmark(page,'Original').click();
    await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
    expect(await page.locator('#vesora-bookmark-note').textContent()).toBe(hostile);
    const rendered=await pixels(page);
    expect(rendered.colored).toBeGreaterThan(kind==='line'?80:150);expect(rendered.error).toBe(0);
    if(kind==='line'){
      // Large-offset fractions survive the wire format; missing samples remain a gap.
      expect(rendered.left).toBeGreaterThan(40);expect(rendered.right).toBeGreaterThan(40);expect(rendered.center).toBe(0);
      await expect(metric(page,'rendered')).toHaveAttribute('data-value','4');
    }
    expect(watched.external).toEqual([]);expect(watched.errors).toEqual([]);
  });
}

function densityFigure(){
  const fig=figure({title:'Explore measured samples',width:640,height:420});
  fig.scatter(Float64Array.from({length:200000},(_,i)=>i%1000),Float64Array.from({length:200000},(_,i)=>Math.floor(i/1000)),{label:'Measurements'});
  fig.bookmark('Overview',{note:'All samples, counted by bin.'});
  fig.setView({xDomain:[0,5],yDomain:[0,5]});fig.bookmark('Individual samples',{note:'Inspect each original sample.'});
  fig.setView({xDomain:[500,505],yDomain:[10,15]});fig.bookmark('Another region');
  fig.restoreBookmark('Overview');return fig;
}

test('offline bookmarks restore full views, latest clicks win, and drag completion stays ready',async({page,context},testInfo)=>{
  const watched=await offline(page,context),path=await saveFigure(testInfo,'density.html',densityFigure());
  await openFigure(page,path);
  await expect(page.locator('#vesora-representation')).toHaveText('Count density');
  await expect(metric(page,'visible')).toHaveAttribute('data-value','200000');
  const original=await pixels(page);
  const individual=bookmark(page,'Individual samples');
  await individual.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#vesora-representation')).toHaveText('Original points');
  await expect(metric(page,'rendered')).toHaveAttribute('data-value','36');
  await expect(individual).toHaveAttribute('aria-pressed','true');
  await page.locator('#vesora-reset').click();
  await expect(page.locator('#vesora-representation')).toHaveText('Count density');
  await expect(metric(page,'visible')).toHaveAttribute('data-value','200000');
  await expect.poll(async()=>(await pixels(page)).hash).toBe(original.hash);
  await expect(page.locator('#vesora-bookmarks [aria-pressed="true"]')).toHaveCount(0);
  await page.evaluate(()=>{
    const buttons=[...document.querySelectorAll('#vesora-bookmarks button')];
    for(const name of ['Individual samples','Overview','Another region','Overview','Individual samples'])buttons.find(button=>button.dataset.bookmark===name).click();
  });
  await expect(individual).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await expect(page.locator('#vesora-representation')).toHaveText('Original points');
  await expect(metric(page,'visible')).toHaveAttribute('data-value','36');
  // Pause after a real drag frame, then release: pointerup must not leave a stale busy state.
  const beforeDrag=await pixels(page),box=await page.locator('#vesora-chart canvas').last().boundingBox();
  await page.mouse.move(box.x+box.width*.55,box.y+180);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.55+70,box.y+210,{steps:5});
  await expect.poll(async()=>(await pixels(page)).hash).not.toBe(beforeDrag.hash);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await page.mouse.up();
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await expect(page.locator('#vesora-png')).toBeEnabled();
  await expect(page.locator('#vesora-bookmarks [aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#vesora-chart canvas').last().dblclick({position:{x:box.width*.5,y:180}});
  await expect(page.locator('#vesora-representation')).toHaveText('Count density');
  await expect.poll(async()=>(await pixels(page)).hash).toBe(original.hash);
  expect(watched.external).toEqual([]);expect(watched.errors).toEqual([]);
});

test('3D bookmarks restore orbit, zoom and pan exactly after interactive panning',async({page,context},testInfo)=>{
  const watched=await offline(page,context),fig=scientificFigure('surface');
  fig.setView({camera:{azimuth:75,elevation:30,distance:3.6},pan3d:[.25,-.15]});fig.bookmark('Entry pose');
  fig.setView({camera:{azimuth:145,elevation:50,distance:2.5},pan3d:[-.2,.2]});fig.bookmark('Other pose');fig.restoreBookmark('Entry pose');
  const path=await saveFigure(testInfo,'surface-pose.html',fig);await openFigure(page,path);
  await expect(page.locator('#vesora-chart canvas').last()).toHaveAttribute('aria-label',/drag to orbit.*Shift-drag to pan/);
  const initial=await pixels(page);await bookmark(page,'Other pose').click();
  await expect.poll(async()=>(await pixels(page)).hash).not.toBe(initial.hash);
  await bookmark(page,'Entry pose').click();await expect.poll(async()=>(await pixels(page)).hash).toBe(initial.hash);
  const box=await page.locator('#vesora-chart canvas').last().boundingBox();
  await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width*.5,box.y+180);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.5+55,box.y+210,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
  await expect.poll(async()=>(await pixels(page)).hash).not.toBe(initial.hash);
  await expect(page.locator('#vesora-bookmarks [aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#vesora-reset').click();await expect.poll(async()=>(await pixels(page)).hash).toBe(initial.hash);
  expect(watched.external).toEqual([]);expect(watched.errors).toEqual([]);
});

test('320px offline viewer supports keyboard actions and exports a complete PNG',async({page,context},testInfo)=>{
  const watched=await offline(page,context),path=await saveFigure(testInfo,'mobile.html',scientificFigure('scatter'));
  await page.setViewportSize({width:320,height:844});await openFigure(page,path);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('#vesora-inspector')).not.toHaveAttribute('open','');
  await page.locator('#vesora-inspector > summary').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#vesora-inspector')).toHaveAttribute('open','');
  await bookmark(page,'Original').focus();await page.keyboard.press('Space');
  await expect(bookmark(page,'Original')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#vesora-png')).toBeEnabled();
  await page.locator('#vesora-png').focus();
  const downloading=page.waitForEvent('download');await page.keyboard.press('Enter');const download=await downloading;
  const data=await readFile(await download.path());
  expect([...data.subarray(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  expect(data.readUInt32BE(16)).toBeGreaterThanOrEqual(200);expect(data.readUInt32BE(20)).toBe(420);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(watched.external).toEqual([]);expect(watched.errors).toEqual([]);
});

test('offline viewer falls back cleanly when workers are unavailable',async({page,context},testInfo)=>{
  const watched=await offline(page,context);
  await page.addInitScript(()=>{
    globalThis.__workerAttempts=0;
    globalThis.Worker=class {constructor(){globalThis.__workerAttempts++;throw new Error('Workers disabled for this test');}};
  });
  const path=await saveFigure(testInfo,'no-worker.html',densityFigure());await openFigure(page,path);
  expect(await page.evaluate(()=>globalThis.__workerAttempts)).toBeGreaterThan(0);
  await expect(page.locator('#vesora-representation')).toHaveText('Count density');
  await bookmark(page,'Individual samples').click();await expect(metric(page,'rendered')).toHaveAttribute('data-value','36');
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  expect(watched.external).toEqual([]);expect(watched.errors).toEqual([]);
});

test('offline viewer reports unavailable WebGL2 without an uncaught exception',async({page,context},testInfo)=>{
  const watched=await offline(page,context);
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind==='webgl2'?null:original.call(this,kind,...args);};
  });
  const path=await saveFigure(testInfo,'no-webgl.html',scientificFigure('scatter'));await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','error');
  await expect(page.locator('#vesora-error')).toContainText('Interactive viewing requires WebGL2');
  await expect(page.locator('#vesora-png')).toBeDisabled();
  expect(watched.external).toEqual([]);expect(watched.errors).toEqual([]);
});

test('corrupt envelope versions, missing buffers and invalid bookmarks produce readable errors',async({page,context},testInfo)=>{
  const watched=await offline(page,context),fig=scientificFigure('scatter'),html=toHTML(fig);fig.close();
  const pattern=/(<script id="vesora-payload" type="application\/json">)([\s\S]*?)(<\/script>)/;
  const cases=[
    ['version',payload=>{payload.formatVersion=99;},'unsupported file format'],
    ['missing-buffer',payload=>{payload.buffers.pop();},'missing binary data'],
    ['invalid-base64',payload=>{payload.buffers[0].base64='#'+payload.buffers[0].base64.slice(1);},'invalid encoded data'],
    ['invalid-bookmark',payload=>{payload.snapshot.figure.bookmarks[0].view.pan3d=[1];},'3D pan'],
  ];
  for(const [name,corrupt,message] of cases){
    const payload=JSON.parse(html.match(pattern)[2]);corrupt(payload);
    const encoded=JSON.stringify(payload).replace(/</g,'\\u003c');
    const path=testInfo.outputPath(`${name}.html`);await mkdir(dirname(path),{recursive:true});
    await writeFile(path,html.replace(pattern,(_,start,_data,end)=>start+encoded+end),'utf8');
    await page.goto(pathToFileURL(path).href);
    await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','error');
    await expect(page.locator('#vesora-error')).toContainText(message);await expect(page.locator('#vesora-png')).toBeDisabled();
  }
  expect(watched.external).toEqual([]);expect(watched.errors).toEqual([]);
});
