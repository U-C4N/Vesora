import {test,expect} from '@playwright/test';

async function load(page){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    window.workers=0;const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker{constructor(...args){super(...args);workers++;}};
    window.drawnText=[];const fillText=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawnText.push(text);return fillText.call(this,text,...args);};
    window.vs=await import('/packages/core/dist/index.js');
  });
  return errors;
}

async function gpuQuadrants(page){
  return page.evaluate(()=>{
    const canvas=document.querySelector('#chart canvas'),gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const counts=[0,0,0,0];
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const offset=(y*canvas.width+x)*4;
      if(Math.min(pixels[offset],pixels[offset+1],pixels[offset+2])<200){
        const row=y<canvas.height/2?1:0,col=x<canvas.width/2?0:1;counts[row*2+col]++;
      }
    }
    return {counts,error:gl.getError()};
  });
}

test('2x2 panels share one worker and GPU context and export all titles and annotations',async({page})=>{
  const errors=await load(page);
  const initial=await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:2,cols:2,width:800,height:640});
    for(let row=0;row<2;row++)for(let col=0;col<2;col++){
      const panel=fig.panel(row,col);panel.setView({xDomain:[0,2],yDomain:[0,2],xLabel:'Time',yLabel:'Signal'}).setTitle(`Panel ${row},${col}`);
      panel.scatter([.5,1,1.5],[1,.5,1.5],{color:'#ff0000',size:15,label:`Series ${row},${col}`});
      panel.text(.4,1.75,`Note ${row},${col}`,{color:'#0000ff',fontSize:14});
      panel.axhline(1,{color:'#00aa00',width:3});
    }
    fig.mount(document.querySelector('#chart'));await fig.ready();
    return {workers,canvases:document.querySelectorAll('#chart canvas').length,info:fig.inspect(),texts:[...new Set(drawnText)]};
  });
  expect(initial.workers).toBe(1);expect(initial.canvases).toBe(2);
  expect(initial.info).toHaveLength(4);expect(new Set(initial.info.map(i=>i.panelId)).size).toBe(4);
  for(let row=0;row<2;row++)for(let col=0;col<2;col++){
    expect(initial.texts).toContain(`Panel ${row},${col}`);expect(initial.texts).toContain(`Note ${row},${col}`);expect(initial.texts).toContain(`Series ${row},${col}`);
  }
  const gpu=await gpuQuadrants(page);expect(gpu.error).toBe(0);for(const count of gpu.counts)expect(count).toBeGreaterThan(200);
  const png=await page.evaluate(async()=>{
    const bitmap=await createImageBitmap(await fig.savefig()),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const blue=[0,0,0,0],green=[0,0,0,0];
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4,q=(y<canvas.height/2?0:2)+(x<canvas.width/2?0:1);
      if(pixels[i+2]>pixels[i]+70&&pixels[i+2]>pixels[i+1]+70)blue[q]++;
      if(pixels[i+1]>pixels[i]+70&&pixels[i+1]>pixels[i+2]+70)green[q]++;
    }
    return {blue,green,width:bitmap.width,height:bitmap.height,dpr:Math.min(2,devicePixelRatio)};
  });
  expect(png.width).toBe(720*png.dpr);expect(png.height).toBe(640*png.dpr);
  for(const count of png.blue)expect(count).toBeGreaterThan(20);for(const count of png.green)expect(count).toBeGreaterThan(200);
  await page.evaluate(async()=>{fig.panel(1,1).setView({xDomain:[0,3]});await fig.ready();});
  for(const count of (await gpuQuadrants(page)).counts)expect(count).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('shared axes union visible data, synchronize interactions and restore whole-figure bookmarks',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:2,cols:1,shareX:true,height:700});
    fig.panel(0,0).scatter([0,10],[0,1],{size:15,representation:'points'});
    window.second=fig.panel(1,0).scatter([20,30],[2,3],{size:15,representation:'points'});
    window.events=[];fig.on('viewchange',e=>events.push(e));
    fig.bookmark('automatic');fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  await page.mouse.move(300,130);await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const zoomed=await page.evaluate(()=>({main:fig.panel(0,0).view,second:fig.panel(1,0).view,event:events.at(-1)}));
  expect(zoomed.main.xDomain).toEqual(zoomed.second.xDomain);
  expect(zoomed.main.xDomain[1]-zoomed.main.xDomain[0]).toBeCloseTo(32.1*Math.exp(-.1),5);
  expect(zoomed.main.yDomain).toBeDefined();expect(zoomed.second.yDomain).toBeUndefined();
  expect(zoomed.event.panelId).toBe('main');expect(Object.keys(zoomed.event.panelViews)).toHaveLength(1);
  await page.evaluate(async()=>{fig.panel(1,0).setView({yDomain:[10,20]});fig.restoreBookmark('automatic');second.setVisible(false);await fig.ready();});
  expect(await page.evaluate(()=>fig.panel(1,0).view.yDomain)).toBeUndefined();
  await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const hidden=await page.evaluate(()=>fig.panel(0,0).view.xDomain);
  expect(hidden[1]-hidden[0]).toBeCloseTo(10.7*Math.exp(-.1),5);
  await page.mouse.dblclick(300,130);await page.evaluate(()=>fig.ready());
  const reset=await page.evaluate(()=>({first:fig.panel(0,0).view,second:fig.panel(1,0).view,event:events.at(-1)}));
  expect(reset.first.xDomain).toBeUndefined();expect(reset.second.xDomain).toBeUndefined();expect(reset.event.xDomain).toBeNull();
  expect(errors).toEqual([]);
});

test('selection and hover remain panel-local while independent logarithmic panels zoom separately',async({page})=>{
  const errors=await load(page);
  await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:2,cols:1,height:700});
    for(let row=0;row<2;row++){
      fig.panel(row,0).setView({xScale:'log',xDomain:[1,100],yDomain:[0,10]});
      fig.panel(row,0).scatter([10],[5],{size:16,representation:'points'});
    }
    window.selected=[];window.hovered=[];fig.on('selection',e=>selected.push(e));fig.on('hover',e=>hovered.push(e));
    fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  await page.mouse.move(312,498);await expect.poll(()=>page.evaluate(()=>hovered.length)).toBeGreaterThan(0);
  const secondaryId=await page.evaluate(()=>fig.spec.panels[1].id);
  expect(await page.evaluate(()=>hovered.at(-1).panelId)).toBe(secondaryId);
  await page.keyboard.down('Shift');await page.mouse.move(80,390);await page.mouse.down();await page.mouse.move(540,600,{steps:5});await page.mouse.up();await page.keyboard.up('Shift');
  const selected=await page.evaluate(()=>window.selected);expect(selected).toHaveLength(1);expect(selected[0].count).toBe(1);expect(selected[0].panelId).toBe(secondaryId);
  await page.mouse.move(300,490);await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const views=await page.evaluate(()=>[fig.panel(0,0).view,fig.panel(1,0).view]);
  expect(views[0].xDomain).toEqual([1,100]);expect(views[1].xDomain[0]).toBeGreaterThan(1);expect(views[1].xDomain[1]).toBeLessThan(100);
  expect(errors).toEqual([]);
});

test('annotation changes are clipped, support update/removal and do not change automatic domains',async({page})=>{
  const errors=await load(page);
  const result=await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:1,cols:1,height:400});fig.plot([0,1],[0,1]);
    window.note=fig.text(.25,.75,'First',{color:'#ff0000',fontSize:16});
    fig.text(1e12,1e12,'Far outside');fig.axhline(1e12);fig.axvline(-1e12);
    fig.mount(document.querySelector('#chart'));await fig.ready();
    const first=drawnText.includes('First');drawnText.length=0;note.update({text:'Changed',color:'#0000ff'});await fig.ready();
    const changed=drawnText.includes('Changed');drawnText.length=0;note.remove();await fig.ready();
    return {first,changed,removed:!drawnText.includes('Changed')};
  });
  expect(result).toEqual({first:true,changed:true,removed:true});
  await page.mouse.move(300,140);await page.mouse.wheel(0,-100);await page.evaluate(()=>fig.ready());
  const domain=await page.evaluate(()=>fig.spec.view.xDomain);
  expect(domain[1]-domain[0]).toBeCloseTo(1.07*Math.exp(-.1),5);expect(errors).toEqual([]);
});

test('large Float64 gaps and density stay panel-local across superseded queries',async({page})=>{
  const errors=await load(page);
  const result=await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:2,cols:1,height:700});
    fig.panel(0,0).setView({xDomain:[1e12,1e12+6],yDomain:[0,2]});
    fig.panel(0,0).plot(Float64Array.from({length:7},(_,i)=>1e12+i),[1,1,NaN,NaN,NaN,1,1],{color:'#ff0000',width:3});
    const n=200000;fig.panel(1,0).scatter(Float64Array.from({length:n},(_,i)=>i%1000),Float64Array.from({length:n},(_,i)=>Math.floor(i/1000)));
    fig.mount(document.querySelector('#chart'));await fig.ready();const initial=fig.inspect();
    for(let i=0;i<8;i++)fig.panel(1,0).setView({xDomain:[i,i+1],yDomain:[i,i+1]});
    await fig.ready();
    const canvas=document.querySelector('#chart canvas'),gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    const counts=[0,0,0];
    for(let y=canvas.height/2;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
      const i=(y*canvas.width+x)*4;if(pixels[i]>pixels[i+1]+50&&pixels[i]>pixels[i+2]+50)counts[x<canvas.width*.35?0:x>canvas.width*.7?2:1]++;
    }
    return {initial,latest:fig.inspect(),counts,error:gl.getError()};
  });
  expect(result.initial[1].kind).toBe('density');expect(result.latest[1].kind).toBe('points');expect(result.latest[1].visible).toBe(4);
  expect(result.counts[0]).toBeGreaterThan(20);expect(result.counts[1]).toBe(0);expect(result.counts[2]).toBeGreaterThan(20);expect(result.error).toBe(0);expect(errors).toEqual([]);
});

test('a failing panel rejects ready and PNG until the complete figure recovers',async({page})=>{
  const errors=await load(page);
  const result=await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:2,cols:1,height:700});fig.plot([0,1],[0,1]);fig.mount(document.querySelector('#chart'));await fig.ready();
    const huge=fig.panel(1,0).heatmap(Float64Array.from({length:1001},(_,i)=>i),Float64Array.from({length:1000},(_,i)=>i),new Float64Array(1001000));
    const rejected=[];for(const operation of [()=>fig.ready(),()=>fig.savefig()]){try{await operation();rejected.push(false);}catch(error){rejected.push(error.message.includes('1,000,000'));}}
    huge.remove();fig.panel(1,0).scatter([.5],[.5]);await fig.ready();const png=await fig.savefig();return {rejected,info:fig.inspect(),type:png.type};
  });
  expect(result.rejected).toEqual([true,true]);expect(result.info).toHaveLength(2);expect(result.type).toBe('image/png');expect(errors).toEqual([]);
});

test('narrow containers scroll within the figure without overlapping equal cells',async({page})=>{
  const errors=await load(page);
  const result=await page.evaluate(async()=>{
    document.querySelector('#chart').style.width='280px';window.fig=vs.subplots({rows:2,cols:2,height:480});
    for(let row=0;row<2;row++)for(let col=0;col<2;col++)fig.panel(row,col).heatmap([0,1],[0,1],[1,2,3,4]);
    fig.mount(document.querySelector('#chart'));await fig.ready();
    const root=document.querySelector('.vesora-figure'),canvas=root.querySelector('canvas');
    root.scrollLeft=400;root.scrollTop=50;
    return {client:root.clientWidth,width:root.scrollWidth,height:root.scrollHeight,left:root.scrollLeft,top:root.scrollTop,canvasWidth:canvas.width/dpr(),canvasHeight:canvas.height/dpr()};
    function dpr(){return Math.min(2,devicePixelRatio);}
  });
  expect(result.client).toBeLessThanOrEqual(280);expect(result.width).toBe(720);expect(result.height).toBe(520);expect(result.left).toBeGreaterThan(0);expect(result.top).toBeGreaterThan(0);expect(result.canvasWidth).toBe(720);expect(result.canvasHeight).toBe(520);expect(errors).toEqual([]);
});

test('released color sources cannot break overlay events or failed-frame export promises',async({page})=>{
  const errors=await load(page);
  const result=await page.evaluate(async()=>{
    const fig=vs.subplots({rows:2,cols:1,height:700});
    const scalar=fig.heatmap([0,1],[0,1],[0,1,2,3]);
    fig.mount(document.querySelector('#chart'));await fig.ready();
    const overlay=document.querySelectorAll('#chart canvas')[1],rect=overlay.getBoundingClientRect();
    scalar.remove();
    // Dispatch before requestAnimationFrame commits the deletion. The old frame
    // still contains a colorbar, but its registry sources have been released.
    overlay.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.left+200,clientY:rect.top+100}));
    overlay.dispatchEvent(new PointerEvent('pointerleave'));
    const huge=fig.panel(1,0).heatmap(Float64Array.from({length:1001},(_,i)=>i),Float64Array.from({length:1000},(_,i)=>i),new Float64Array(1001000));
    const rejected=await Promise.all([fig.ready(),fig.savefig()].map(operation=>operation.then(()=>false,error=>error.message.includes('1,000,000'))));
    huge.remove();await fig.ready();const png=await fig.savefig();fig.close();return {rejected,type:png.type};
  });
  expect(result.rejected).toEqual([true,true]);expect(result.type).toBe('image/png');expect(errors).toEqual([]);
});
