import {test,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {figure,subplots,toHTML} from '../../packages/core/dist/index.js';

async function load(page,{fallback=false}={}){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async fallback=>{
    window.drawnText=[];window.workerMessages=[];
    const fillText=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawnText.push(text);return fillText.call(this,text,...args);};
    if(fallback)window.Worker=class{constructor(){throw new Error('Worker blocked for fallback test');}};
    else{
      const post=Worker.prototype.postMessage;
      Worker.prototype.postMessage=function(message,...args){workerMessages.push(message.type);return post.call(this,message,...args);};
    }
    window.vs=await import('/packages/core/dist/index.js');
    window.hovered=[];window.selected=[];
    window.observe=fig=>{fig.on('hover',event=>hovered.push(event));fig.on('selection',event=>selected.push(event));};
  },fallback);
  return errors;
}
async function pixels(page,selector='#chart'){
  return page.evaluate(selector=>{
    const canvas=document.querySelector(`${selector} canvas`),gl=canvas.getContext('webgl2'),data=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,data);
    const ink=[0,0,0,0];let hash=2166136261;
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4;
      for(let j=0;j<3;j++)hash=Math.imul(hash^data[i+j],16777619);
      if(Math.min(data[i],data[i+1],data[i+2])<200)ink[(y<canvas.height/2?2:0)+(x<canvas.width/2?0:1)]++;
    }
    return {ink,hash:hash>>>0,error:gl.getError()};
  },selector);
}
// Single-panel test scenes use 640x420, no title, and explicit domains.
const point=(x,y,xd,yd)=>({x:85+(x-xd[0])/(xd[1]-xd[0])*470,y:28+(1-(y-yd[0])/(yd[1]-yd[0]))*310});
async function hover(page,x,y,xd,yd){const p=point(x,y,xd,yd);await page.mouse.move(p.x,p.y);}
async function selectAll(page){
  await page.keyboard.down('Shift');await page.mouse.move(86,29);await page.mouse.down();await page.mouse.move(554,337,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
}

test('statistics and categorical charts draw real pixels in four panels and PNG',async({page})=>{
  const errors=await load(page);
  const data=await page.evaluate(async()=>{
    document.querySelector('#chart').style.width='1000px';
    window.fig=vs.subplots({rows:2,cols:2,height:760,title:'Statistics Ω'});
    fig.panel(0,0).hist([0,1,1,2,2,2,3],{bins:4,color:'#ef4444',label:'Counts'});
    fig.panel(0,1).bar(['A','B'],[2,4],{color:'#ef4444',label:'First'});
    fig.panel(0,1).bar(['B','A'],[3,1],{color:'#2563eb',label:'Second'});
    fig.panel(1,0).boxplot([[1,2,3,4,100],[2,2,3,4]],{labels:['Trial Ω','Control'],color:'#16a34a'});
    fig.panel(1,1).plot(['Jan','Feb','Mar'],[1,3,2],{color:'#dc2626',width:4});
    fig.panel(1,1).scatter(['Jan','Feb','Mar'],[1,3,2],{color:'#2563eb',size:10});
    fig.mount(document.querySelector('#chart'));await fig.ready();
    return {info:fig.inspect(),texts:[...new Set(drawnText)]};
  });
  expect(data.info.map(i=>i.kind)).toEqual(['hist','bar','bar','boxplot','line','points']);
  for(const label of ['Statistics Ω','Trial Ω','Control','Jan','Feb','Mar'])expect(data.texts).toContain(label);
  const gpu=await pixels(page);expect(gpu.error).toBe(0);for(const count of gpu.ink)expect(count).toBeGreaterThan(100);
  const png=await page.evaluate(async()=>{
    const bitmap=await createImageBitmap(await fig.savefig()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data,ink=[0,0,0,0];
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4;if(Math.max(bytes[i],bytes[i+1],bytes[i+2])-Math.min(bytes[i],bytes[i+1],bytes[i+2])>80)ink[(y<canvas.height/2?0:2)+(x<canvas.width/2?0:1)]++;
    }
    return ink;
  });
  for(const count of png)expect(count).toBeGreaterThan(100);
  await mkdir('artifacts',{recursive:true});await page.locator('#chart').screenshot({path:'artifacts/statistics-preview.png'});expect(errors).toEqual([]);
});

for(const fallback of [false,true])test(`histogram identities, exact counts, cache and updates (${fallback?'fallback':'worker'})`,async({page})=>{
  const errors=await load(page,{fallback});
  await page.evaluate(async()=>{
    window.fig=vs.figure({height:420});window.layer=fig.hist([-1,0,1,1,2,3,4,NaN,Infinity],{bins:[0,1,2,4],color:'#ff0000'});
    fig.setView({xDomain:[0,4],yDomain:[0,4]});observe(fig);fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  const info=await page.evaluate(()=>fig.inspect()[0]);expect(info.total).toBe(9);expect(info.visible).toBe(6);expect(info.omitted).toBe(2);expect(info.rangeExcluded).toBe(1);
  await hover(page,1.5,1,[0,4],[0,4]);
  expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'bin',binIndex:1,index:1,left:1,right:2,count:2,height:2});
  await selectAll(page);expect(await page.evaluate(()=>selected.at(-1))).toMatchObject({kind:'bins',indices:[0,1,2],count:3,truncated:false});
  const messages=await page.evaluate(()=>workerMessages.length);
  await page.evaluate(async()=>{fig.setView({xDomain:[.5,3.5]});await fig.ready();});
  expect(await page.evaluate(()=>workerMessages.length)).toBe(messages);
  await page.evaluate(async()=>{layer.setOptions({density:true,cumulative:true});fig.setView({xDomain:[0,4],yDomain:[0,1.2]});await fig.ready();});
  await hover(page,3,.5,[0,4],[0,1.2]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'bin',binIndex:2,count:3,height:1});
  await page.evaluate(async()=>{layer.setData({samples:[0,0,1]});await fig.ready();});
  expect(await page.evaluate(()=>fig.inspect()[0].total)).toBe(3);expect((await pixels(page)).ink.reduce((a,b)=>a+b)).toBeGreaterThan(1000);expect(errors).toEqual([]);
});

test('group slots survive hide and collapse on removal, stacks omit hidden series',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    window.fig=vs.figure({height:420});window.first=fig.bar(['A','B'],[2,3],{color:'#ff0000'});window.second=fig.bar(['A','B'],[4,1],{color:'#0000ff'});
    fig.setView({xDomain:[-.5,1.5],yDomain:[0,6]});observe(fig);fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  await hover(page,-.2,1,[-.5,1.5],[0,6]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'bar',category:'A',value:2});
  await page.evaluate(async()=>{first.setVisible(false);await fig.ready();});
  await hover(page,.2,1,[-.5,1.5],[0,6]);expect(await page.evaluate(()=>hovered.at(-1).layerId)).toBe(await page.evaluate(()=>second.id));
  await page.evaluate(async()=>{first.remove();await fig.ready();});
  await hover(page,0,1,[-.5,1.5],[0,6]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'bar',position:0,value:4});
  await page.evaluate(async()=>{window.third=fig.bar(['A','B'],[1,2],{color:'#00aa00'});fig.setBarMode('stack');await fig.ready();});
  await hover(page,0,4.5,[-.5,1.5],[0,6]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'bar',value:1,start:4,end:5});
  await page.evaluate(async()=>{second.setVisible(false);await fig.ready();});
  await hover(page,0,.5,[-.5,1.5],[0,6]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'bar',value:1,start:0,end:1});
  await selectAll(page);expect(await page.evaluate(()=>selected.at(-1))).toMatchObject({kind:'bars',indices:[0,1],count:2});expect(errors).toEqual([]);
});

test('horizontal positive and negative stacks prepare extents before layout',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    window.fig=vs.figure({height:420});fig.setBarMode('stack');
    fig.barh(['A'],[4],{color:'#ff0000'});fig.barh(['A'],[1],{color:'#00aa00'});fig.barh(['A'],[-2],{color:'#0000ff'});fig.barh(['A'],[-3],{color:'#aa00aa'});
    observe(fig);fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  await page.mouse.move(300,150);await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const domain=await page.evaluate(()=>fig.spec.view.xDomain);expect(domain[1]-domain[0]).toBeCloseTo(10.7*Math.exp(-.1),5);
  await page.evaluate(async()=>{fig.setView({xDomain:[-6,6],yDomain:[-.5,.5]});await fig.ready();});
  await hover(page,-3,0,[-6,6],[-.5,.5]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'bar',orientation:'horizontal',value:-3,start:-2,end:-5,category:'A'});
  expect((await pixels(page)).error).toBe(0);expect(errors).toEqual([]);
});

test('boxplot hover and selection preserve source group identity across empty groups',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    window.fig=vs.figure({height:420});window.layer=fig.boxplot([[],[1,2,3,4,100]],{labels:['Empty','Ω'],color:'#00aa00',size:12});
    fig.setView({xDomain:[-.5,1.5],yDomain:[0,110]});observe(fig);fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  await hover(page,1,100,[-.5,1.5],[0,110]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'outlier',group:'Ω',groupIndex:1,index:1,sourceIndex:4,value:100});
  await hover(page,1,3,[-.5,1.5],[0,110]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'box',groupIndex:1,count:5,q1:2,median:3,q3:4,outlierCount:1});
  await selectAll(page);expect(await page.evaluate(()=>selected.at(-1))).toMatchObject({kind:'boxes',indices:[1],count:1});
  await page.evaluate(async()=>{layer.setOptions({showfliers:false});hovered.length=0;await fig.ready();});
  await hover(page,1,100,[-.5,1.5],[0,110]);expect(await page.evaluate(()=>hovered)).toEqual([]);
  expect(errors).toEqual([]);
});

test('shared categorical coordinates survive partial updates, removal and bookmarks',async({page})=>{
  const errors=await load(page);
  const state=await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:2,cols:1,shareX:true,height:700});
    window.first=fig.panel(0,0).plot(['β','A'],[2,1],{width:3});
    window.second=fig.panel(1,0).scatter(['A','β','新'],[1,2,3],{size:12});
    fig.bookmark('Automatic');fig.mount(document.querySelector('#chart'));await fig.ready();
    second.setData({y:[3,2,1]});second.setData({x:['新','A','Next']});first.remove();fig.restoreBookmark('Automatic');await fig.ready();
    return {categories:fig.spec.categories['x:shared'],texts:[...new Set(drawnText)]};
  });
  expect(state.categories).toEqual(['β','A','新','Next']);for(const label of ['β','A','新','Next'])expect(state.texts).toContain(label);
  expect((await pixels(page)).error).toBe(0);expect(errors).toEqual([]);
});

test('both categorical channels use labels in point tooltips, never HTML',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    window.fig=vs.figure({height:420});fig.scatter(['Ω </script>','A'],['Low','High'],{size:18});
    fig.setView({xDomain:[-.5,1.5],yDomain:[-.5,1.5]});observe(fig);fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  await hover(page,0,0,[-.5,1.5],[-.5,1.5]);expect(await page.evaluate(()=>hovered.at(-1))).toMatchObject({kind:'point',x:'Ω </script>',y:'Low',xCoordinate:0,yCoordinate:0});
  expect(await page.locator('#chart script').count()).toBe(0);expect(errors).toEqual([]);
});

for(const producer of ['JavaScript','Python'])test(`${producer} offline statistics HTML retains raw groups, category labels, bookmarks and PNG`,async({page,context},info)=>{
  const path=info.outputPath('statistics.html');await mkdir(dirname(path),{recursive:true});
  if(producer==='JavaScript'){
  const fig=subplots({rows:2,cols:2,width:1000,height:800,title:'Offline statistics Ω'});
  fig.panel(0,0).hist([0,1,1,2,NaN],{bins:[0,1,2],label:'Histogram'});
  fig.panel(0,1).bar(['A','B'],[2,4],{label:'Bars'});
  fig.panel(1,0).boxplot([[1,2,3,100],[]],{labels:['Ω </script>','Empty'],label:'Boxes'});
  fig.panel(1,1).plot(['a','b'],[2,1],{width:4,label:'Categories'});
  fig.bookmark('Overview');fig.panel(0,0).setView({xDomain:[0,1]});fig.bookmark('Detail');fig.restoreBookmark('Overview');
  await writeFile(path,toHTML(fig));fig.close();
  }else{
    const python=process.env.VESORA_PYTHON??(existsSync('.venv/Scripts/python.exe')?resolve('.venv/Scripts/python.exe'):'python');
    execFileSync(python,['-X','utf8','-c',`import sys
import vesora as vs
fig=vs.subplots(2,2,width=1000,height=800,title='Offline statistics Ω')
fig.panel(0,0).hist([0,1,1,2,float('nan')],bins=[0,1,2],label='Histogram')
fig.panel(0,1).bar(['A','B'],[2,4],label='Bars')
fig.panel(1,0).boxplot([[1,2,3,100],[]],labels=['Ω </script>','Empty'],label='Boxes')
fig.panel(1,1).plot(['a','b'],[2,1],width=4,label='Categories')
fig.bookmark('Overview')
fig.panel(0,0).set_axes(xlim=(0,1))
fig.bookmark('Detail')
fig.restore_bookmark('Overview')
fig.save_html(sys.argv[1])
fig.close()`,path],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8',windowsHide:true});
  }
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await context.setOffline(true);await page.setViewportSize({width:1280,height:1000});await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  const initial=await pixels(page,'#vesora-chart');for(const count of initial.ink)expect(count).toBeGreaterThan(100);
  await page.getByRole('button',{name:'Detail',exact:true}).click();await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');expect((await pixels(page,'#vesora-chart')).hash).not.toBe(initial.hash);
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');expect((await pixels(page,'#vesora-chart')).hash).toBe(initial.hash);
  const waiting=page.waitForEvent('download');await page.locator('#vesora-png').click();const png=info.outputPath('statistics.png');await (await waiting).saveAs(png);
  expect((await readFile(png)).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  await page.screenshot({path:info.outputPath('statistics-offline.png'),fullPage:true});expect(requests).toEqual([]);expect(errors).toEqual([]);
});



test('statistical selection truncates identities at 10000 without dropping the count',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    window.fig=vs.figure({height:420});fig.bar(Float64Array.from({length:10001},(_,i)=>i),new Float64Array(10001).fill(1));
    fig.setView({xDomain:[-100,10100],yDomain:[-1,2]});observe(fig);fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  await selectAll(page);
  const selection=await page.evaluate(()=>selected.at(-1));expect(selection.kind).toBe('bars');expect(selection.count).toBe(10001);expect(selection.truncated).toBe(true);
  expect(selection.indices).toHaveLength(10000);expect(selection.indices[0]).toBe(0);expect(selection.indices.at(-1)).toBe(9999);expect(errors).toEqual([]);
});

test('superseded statistics never overwrite new data and removed sources are released',async({page})=>{
  const errors=await load(page);
  const result=await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:1,cols:2,height:420});
    const samples=Float64Array.from({length:1000000},(_,i)=>Math.sin(i));
    window.hist=fig.panel(0,0).hist(samples,{bins:20});window.box=fig.panel(0,1).boxplot([samples]);
    fig.mount(document.querySelector('#chart'));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    hist.setData({samples:[0,1,2]});box.setData({groups:[[1,2,3]]});await fig.ready();
    const summary=fig.inspect().map(info=>({kind:info.kind,total:info.total}));
    const before=workerMessages.filter(type=>type==='release').length;
    hist.remove();box.remove();await fig.ready();
    const released=workerMessages.filter(type=>type==='release').length-before;
    fig.close();return {summary,released,disposed:workerMessages.includes('dispose'),canvases:document.querySelectorAll('#chart canvas').length};
  });
  expect(result.summary).toEqual([{kind:'hist',total:3},{kind:'boxplot',total:3}]);expect(result.released).toBeGreaterThanOrEqual(3);
  expect(result.disposed).toBe(true);expect(result.canvases).toBe(0);expect(errors).toEqual([]);
});


test('statistics gallery renders all six examples and exports their current figures',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1280,height:1000});await page.goto('/examples/web/statistics.html');
  const cards=page.locator('[data-example]');await expect(cards).toHaveCount(6);
  for(let index=0;index<6;index++){
    const card=cards.nth(index);await card.scrollIntoViewIfNeeded();await expect(card).toHaveAttribute('data-ready','true');
    await expect(card.locator('.error')).toBeHidden();await expect(card.locator('.representation')).not.toHaveText(/loading|preparing/i);
    const drawing=await card.evaluate(card=>{
      const canvas=card.querySelector('canvas'),gl=canvas.getContext('webgl2'),bytes=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);let ink=0;
      for(let i=0;i<bytes.length;i+=4)if(Math.min(bytes[i],bytes[i+1],bytes[i+2])<200)ink++;
      return {ink,error:gl.getError()};
    });
    expect(drawing.ink).toBeGreaterThan(100);expect(drawing.error).toBe(0);
    const waiting=page.waitForEvent('download');await card.locator('[data-action="export-html"]').click();
    const download=await waiting;await download.saveAs(info.outputPath(`gallery-${index}.html`));
    expect(await readFile(info.outputPath(`gallery-${index}.html`),'utf8')).toContain('vesora-payload');
  }
  await cards.first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('statistics-gallery.png'),fullPage:true});
  await page.setViewportSize({width:320,height:800});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
});


test('replacing snapshots invalidates geometry, extents and statistics even for matching source versions',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    document.querySelector('#chart').style.width='1080px';
    window.fig=vs.subplots({rows:1,cols:3,height:420});
    fig.panel(0,0).scatter([1,2,3],[1,2,3],{color:'#ff0000',size:16});
    fig.panel(0,1).hist([0,0,0,3],{bins:[0,1,2,3],color:'#0000ff'});
    fig.panel(0,2).boxplot([[1,2,3,100]],{color:'#00aa00'});
    observe(fig);fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  const initial=await pixels(page);
  await page.evaluate(async()=>{
    const snapshot=fig.snapshot(),buffers=new Map([...fig.registry.entries()].map(([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength)]));
    buffers.set(snapshot.figure.layers[0].data.x,new Float64Array([7,8,9]).buffer);
    buffers.set(snapshot.figure.layers[1].data.samples,new Float64Array([2,2,2,2]).buffer);
    buffers.set(snapshot.figure.layers[2].data.g0,new Float64Array([5,6,7,8]).buffer);
    fig.applySnapshot(snapshot,buffers);await fig.ready();
  });
  expect((await pixels(page)).hash).not.toBe(initial.hash);
  expect(await page.evaluate(()=>fig.inspect().find(info=>info.kind==='hist'))).toMatchObject({total:4,visible:4,rendered:1});
  await page.mouse.move(150,150);await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const domain=await page.evaluate(()=>fig.spec.view.xDomain);expect(domain[0]).toBeGreaterThan(6);expect(domain[1]).toBeGreaterThan(8);
  expect(errors).toEqual([]);
});


for(const kind of ['bar','boxplot'])for(const orientation of ['vertical','horizontal'])test(`wide categorical ${kind} ${orientation} shares full geometry extents without moving category slots`,async({page})=>{
  const errors=await load(page);
  await page.evaluate(async({kind,orientation})=>{
    document.querySelector('#chart').style.width='900px';
    const horizontal=orientation==='horizontal';
    window.fig=vs.subplots({rows:1,cols:2,height:420,...(horizontal?{shareY:true}:{shareX:true})});
    window.layers=[];
    for(let col=0;col<2;col++){
      const panel=fig.panel(0,col),label=col?'B':'A';
      layers.push(kind==='bar'?panel[horizontal?'barh':'bar']([label],[3],{barWidth:2.4,color:'#ff0000'})
        :panel.boxplot([[1,2,3,4]],{labels:[label],orientation,boxWidth:2.4,color:'#ff0000'}));
    }
    fig.bookmark('Automatic');fig.mount(document.querySelector('#chart'));await fig.ready();
  },{kind,orientation});
  const image=await pixels(page);expect(image.error).toBe(0);expect(image.ink.reduce((a,b)=>a+b)).toBeGreaterThan(1000);
  await page.mouse.move(180,150);await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const axis=orientation==='horizontal'?'y':'x';
  const domains=await page.evaluate(axis=>fig.panelEntries().map(panel=>panel.view[`${axis}Domain`]),axis);
  expect(domains[0]).toEqual(domains[1]);expect(domains[0][1]-domains[0][0]).toBeCloseTo(3.4*Math.exp(-.1),6);
  // Hiding one panel's series removes only its wide geometry, not its category.
  await page.evaluate(async()=>{fig.restoreBookmark('Automatic');layers[1].setVisible(false);await fig.ready();});
  await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const hidden=await page.evaluate(axis=>fig.spec.view[`${axis}Domain`],axis);
  expect(hidden[1]-hidden[0]).toBeCloseTo(2.7*Math.exp(-.1),6);
  // Default-sized marks retain the previous [-.5, N-.5] categorical view.
  await page.evaluate(async kind=>{fig.restoreBookmark('Automatic');layers[0].setOptions(kind==='bar'?{barWidth:.8}:{boxWidth:.6});await fig.ready();},kind);
  await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const standard=await page.evaluate(axis=>({domain:fig.spec.view[`${axis}Domain`],labels:fig.spec.categories[`${axis}:shared`]}),axis);
  expect(standard.domain[1]-standard.domain[0]).toBeCloseTo(2*Math.exp(-.1),6);expect(standard.labels).toEqual(['A','B']);expect(errors).toEqual([]);
});
