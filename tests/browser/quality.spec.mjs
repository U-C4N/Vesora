import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{window.vs=await import('/packages/core/dist/index.js');});
});

test('paired band renders gaps and survives offline HTML without network',async({page,context})=>{
  const result=await page.evaluate(async()=>{
    const f=window.f=vs.figure({width:640,height:420,title:'Measured envelope'});
    f.fillBetween([0,1,2,3,4],[1,2,NaN,2,1],[3,4,NaN,4,3],{color:'#3569c8',label:'Interval'});
    f.plot([0,1,2,3,4],[2,3,NaN,3,2],{label:'Estimate'});f.setHoverMode('x');
    f.mount(document.querySelector('#chart'));await f.ready();
    return {info:f.inspect(),html:vs.toHTML(f),bounds:f.view.panels[0].bounds};
  });
  expect(result.info.find(i=>i.kind==='band').exact).toBe(true);
  expect(result.bounds.y[0]).toBeLessThan(1);expect(result.bounds.y[1]).toBeGreaterThan(4);
  const offline=await context.newPage();await context.setOffline(true);
  await offline.setContent(result.html);await expect(offline.locator('[data-ready="ready"]')).toBeVisible();
  expect(await offline.locator('canvas').count()).toBeGreaterThan(0);await offline.close();
});

test('x inspection uses source samples, supports gaps, keyboard and legacy click',async({page})=>{
  await page.evaluate(async()=>{
    const x=Array.from({length:10001},(_,i)=>i/1000),y=x.map(t=>Math.sin(t));
    const f=window.f=vs.figure({height:400});f.plot(x,y,{label:'Dense'});f.plot([0,3,7,10],[0,.2,NaN,1],{label:'Sparse'});f.setHoverMode('x');
    window.events=[];f.on('xhover',e=>window.events.push(e));f.mount(document.querySelector('#chart'));await f.ready();
  });
  const point=await page.evaluate(()=>{const p=f.view.panels[0],r=p.rect;return {x:r.left+(2.537-p.bounds.x[0])/(p.bounds.x[1]-p.bounds.x[0])*r.width,y:r.top+r.height/2};});
  await page.mouse.move(point.x,point.y);
  const hit=await page.evaluate(()=>events.filter(Boolean).at(-1));
  expect(hit.items[0].index).toBe(2537);expect(hit.items[0].x).toBe(2.537);expect(hit.items[1].x).toBe(3);
  await page.locator('canvas').last().focus();await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>events.filter(Boolean).at(-1).items[0].index)).toBe(2538);
  await page.keyboard.press('Escape');expect(await page.evaluate(()=>events.at(-1))).toBeNull();
  await page.evaluate(async()=>{f.spec.layers[0].visible=false;f.changed();await f.ready();});
  const gap=await page.evaluate(()=>{const p=f.view.panels[0];return {x:p.rect.left+(5-p.bounds.x[0])/(p.bounds.x[1]-p.bounds.x[0])*p.rect.width,y:p.rect.top+30};});
  await page.mouse.move(gap.x,gap.y);expect(await page.evaluate(()=>events.filter(Boolean).at(-1).items)).toEqual([]);
});

test('touch pins source inspection until Escape',async({browser})=>{
  const context=await browser.newContext({hasTouch:true,viewport:{width:390,height:700}}),page=await context.newPage();
  await page.goto('/tests/browser/harness.html');
  const point=await page.evaluate(async()=>{const {figure}=await import('/packages/core/dist/index.js');document.querySelector('#chart').style.width='390px';window.f=figure({height:380});f.plot([0,1,2],[1,3,2]);f.setHoverMode('x');f.mount(document.querySelector('#chart'));await f.ready();const r=f.view.panels[0].rect;return {x:r.left+r.width/2,y:r.top+r.height/2};});
  await page.touchscreen.tap(point.x,point.y);expect(await page.evaluate(()=>f.view.xPinned)).toBe(true);
  await page.keyboard.press('Escape');expect(await page.evaluate(()=>f.view.xHover)).toBeUndefined();await context.close();
});

test('PNG re-renders exact target sizes and isolates concurrent exports',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=window.f=vs.figure({height:350,title:'Export'});f.fillBetween([0,1,2],[1,2,1],[3,4,3]);f.plot([0,1,2],[2,3,2],{label:'Estimate'});f.mount(document.querySelector('#chart'));await f.ready();
    const before={width:f.view.width,height:f.view.height,snapshot:JSON.stringify(f.snapshot())};
    const a=f.savefig({width:800,height:500,scale:2}),b=f.savefig({width:800,height:500,scale:4});
    const blobs=await Promise.all([a,b]),dimensions=[];let minimumAlpha=255;
    for(const blob of blobs){const bitmap=await createImageBitmap(blob);dimensions.push([bitmap.width,bitmap.height]);const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;for(let i=3;i<pixels.length;i+=4)minimumAlpha=Math.min(minimumAlpha,pixels[i]);bitmap.close();}
    const after={width:f.view.width,height:f.view.height,snapshot:JSON.stringify(f.snapshot())};
    let limit='';try{await f.savefig({width:800,height:500,scale:20});}catch(e){limit=e.message;}
    const gl=f.view.renderer.gl,maximum=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]);
    let gpuLimit='';try{await f.savefig({width:maximum+1,height:180,scale:1});}catch(e){gpuLimit=e.message;}
    return {before,after,dimensions,limit,gpuLimit,minimumAlpha,canvases:document.querySelectorAll('canvas').length};
  });
  expect(result.dimensions).toEqual([[1600,1000],[3200,2000]]);expect(result.before).toEqual(result.after);
  expect(result.limit).toContain('32000000');expect(result.canvases).toBe(2);
  expect(result.gpuLimit).toContain('GPU');
  expect(result.minimumAlpha).toBe(255);
});

test('queued PNG keeps its completed snapshot across live data and resize updates',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({height:350,title:'Original snapshot'}),line=f.plot([0,1,2],[1,3,2],{color:'#ee0000'});
    f.mount(document.querySelector('#chart'));await f.ready();const options={width:600,height:400,scale:1};
    const baseline=new Uint8Array(await (await f.savefig(options)).arrayBuffer());
    let release,captured=false;f.view.exportQueue=new Promise(resolve=>{release=resolve;});
    const snapshot=f.snapshot.bind(f);f.snapshot=()=>{captured=true;return snapshot();};
    const pending=f.savefig(options);while(!captured)await Promise.resolve();
    line.setData({y:[3,1,4]});line.setStyle({color:'#0000ee'});f.setTitle('Updated live figure');document.querySelector('#chart').style.width='460px';await f.ready();
    release();const queued=new Uint8Array(await (await pending).arrayBuffer());
    const current=new Uint8Array(await (await f.savefig(options)).arrayBuffer());
    return {same:baseline.length===queued.length&&baseline.every((b,i)=>b===queued[i]),different:baseline.length!==current.length||baseline.some((b,i)=>b!==current[i]),title:f.spec.title,canvases:document.querySelectorAll('canvas').length};
  });
  expect(result.same).toBe(true);expect(result.different).toBe(true);expect(result.title).toBe('Updated live figure');expect(result.canvases).toBe(2);
});

test('PNG allocation failure cleans up and the live figure can render again',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({height:350});f.plot([0,1,2],[1,3,2]);f.mount(document.querySelector('#chart'));await f.ready();
    const gl=f.view.renderer.gl,check=gl.checkFramebufferStatus.bind(gl);let injected=false,message='';
    gl.checkFramebufferStatus=target=>{if(!injected){injected=true;gl.enable(-1);return gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;}return check(target);};
    try{await f.savefig({width:600,height:400,scale:1});}catch(error){message=error.message;}finally{gl.checkFramebufferStatus=check;}
    f.setView({xDomain:[0,1]});await f.ready();const blob=await f.savefig({width:600,height:400,scale:1});
    return {message,size:blob.size,error:gl.getError(),framebuffer:gl.getParameter(gl.FRAMEBUFFER_BINDING),canvases:document.querySelectorAll('canvas').length};
  });
  expect(result.message).toContain('allocation failed');expect(result.size).toBeGreaterThan(0);expect(result.error).toBe(0);expect(result.framebuffer).toBeNull();expect(result.canvases).toBe(2);
});

test('closing a figure rejects queued PNG requests without leaking resources',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure();f.plot([0,1,2],[1,3,2]);f.mount(document.querySelector('#chart'));await f.ready();
    let release,captured=false;f.view.exportQueue=new Promise(resolve=>{release=resolve;});
    const snapshot=f.snapshot.bind(f);f.snapshot=()=>{captured=true;return snapshot();};
    const pending=f.savefig({width:600,height:400,scale:1}).then(()=>'',error=>error.message);
    while(!captured)await Promise.resolve();f.close();release();
    return {message:await pending,canvases:document.querySelectorAll('canvas').length};
  });
  expect(result.message).toContain('disposed');expect(result.canvases).toBe(0);
});

test('automatic point views reclaim the density gutter and density labels keep both counts',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({height:400}),x=Array.from({length:100000},(_,i)=>i/100),y=x.map((_,i)=>Math.sin(i));
    f.scatter(x,y);f.mount(document.querySelector('#chart'));await f.ready();
    const dense=f.view.panels[0],density={color:!!dense.colorLayer,footer:dense.statusHeight,right:f.view.width-dense.rect.left-dense.rect.width};
    f.setView({xDomain:[0,1],yDomain:[-1,1]});await f.ready();const sparse=f.view.panels[0],info=f.inspect()[0];
    return {density,points:{color:!!sparse.colorLayer,footer:sparse.statusHeight,right:f.view.width-sparse.rect.left-sparse.rect.width},info};
  });
  expect(result.density.color).toBe(true);expect(result.density.footer).toBeGreaterThan(0);
  expect(result.points.color).toBe(false);expect(result.points.footer).toBe(0);expect(result.points.right).toBe(16);
  expect(result.info.kind).toBe('points');expect(result.info.total).toBe(100000);expect(result.info.visible).toBeLessThan(result.info.total);
});

for(const width of [390,768,1440])for(const theme of ['light','dark'])test(`measured layout ${width}px ${theme}: Turkish labels and wrapped legend`,async({page})=>{
  await page.setViewportSize({width,height:800});
  const layout=await page.evaluate(async({width,theme})=>{
    document.querySelector('#chart').style.width=`${width}px`;
    const f=window.f=vs.figure({height:550,theme,title:'Ölçüm sonuçları'});
    for(let i=0;i<5;i++)f.plot([Date.UTC(2026,9,1),Date.UTC(2026,9,3),Date.UTC(2026,9,7)],[123456789+i*1000000,125456789,124456789],{label:`Uzun açıklamalı deney ${i+1}`});
    f.setView({xScale:'time',xLabel:'Ölçüm tarihi',yLabel:'Tutar'});
    f.setAxisFormat('y',{kind:'currency',currency:'TRY',locale:'tr-TR'});f.setAxisFormat('x',{kind:'date',locale:'tr-TR',options:{day:'numeric',month:'long',year:'numeric'}});
    f.mount(document.querySelector('#chart'));await f.ready();const p=f.view.panels[0],ctx=f.view.overlay.getContext('2d');ctx.font=`${f.view.fonts.tick}px ${f.view.theme.fontFamily}`;
    return {rootWidth:f.view.width,legendRows:p.legendRows,legendBottom:p.legendTop+(p.legendRows-1)*(f.view.fonts.legend+8),height:f.view.height,ticks:p.xTicks.map(t=>({left:t.position-ctx.measureText(t.label).width/2,right:t.position+ctx.measureText(t.label).width/2})),yLeft:Math.min(...p.yTicks.map(t=>p.rect.left-9-ctx.measureText(t.label).width)),plot:p.rect};
  },{width,theme});
  expect(layout.rootWidth).toBe(width);expect(layout.plot.width).toBeGreaterThan(40);expect(layout.yLeft).toBeGreaterThanOrEqual(0);expect(layout.legendBottom).toBeLessThan(layout.height);
  for(let i=0;i<layout.ticks.length;i++){expect(layout.ticks[i].left).toBeGreaterThanOrEqual(0);expect(layout.ticks[i].right).toBeLessThanOrEqual(width);if(i)expect(layout.ticks[i].left-layout.ticks[i-1].right).toBeGreaterThanOrEqual(7.9);}
  if(width===390)expect(layout.legendRows).toBeGreaterThan(1);
  await page.screenshot({path:`artifacts/v07/layout-${width}-${theme}.png`});
});

for(const width of [390,768,1440])for(const theme of ['light','dark'])test(`colorbar ${width}px ${theme}: readable intermediate ticks and separate counts`,async({page})=>{
  await page.setViewportSize({width,height:650});
  const result=await page.evaluate(async({width,theme})=>{
    document.querySelector('#chart').style.width=`${width}px`;
    const f=vs.figure({height:550,theme,title:'Ölçüm yoğunluğu'}),x=Array.from({length:100000},(_,i)=>(i%1000)/500-1),y=x.map((_,i)=>Math.sin(i*1.618));
    const label='Örnek / hücre';f.scatter(x,y,{representation:'density',colorbarLabel:label});f.setView({xDomain:[-.8,.8],yDomain:[-.8,.8]});
    f.mount(document.querySelector('#chart'));await f.ready();
    const panel=f.view.panels[0],ctx=f.view.overlay.getContext('2d'),fill=ctx.fillText.bind(ctx),drawn=[];
    ctx.fillText=(text,x,y,...rest)=>{drawn.push({text,x,y,width:ctx.measureText(text).width});fill(text,x,y,...rest);};f.view.drawOverlay();ctx.fillText=fill;
    return {fonts:f.view.fonts,label:drawn.some(t=>t.text===label),counts:drawn.some(t=>t.text.includes('visible /')&&t.text.includes('total')),
      ticks:drawn.filter(t=>t.x>panel.rect.left+panel.rect.width&&t.y>=panel.rect.top&&t.y<=panel.rect.top+panel.rect.height),info:f.inspect()[0]};
  },{width,theme});
  expect(result.fonts).toEqual({title:16,label:13,tick:12,legend:12});expect(result.label).toBe(true);expect(result.counts).toBe(true);
  expect(result.info.visible).toBeLessThan(result.info.total);expect(result.ticks.length).toBeGreaterThanOrEqual(3);
  for(let i=0;i<result.ticks.length;i++){expect(result.ticks[i].x+result.ticks[i].width).toBeLessThan(width);if(i)expect(result.ticks[i].y-result.ticks[i-1].y).toBeGreaterThanOrEqual(18);}
  await page.screenshot({path:`artifacts/v07/colorbar-${width}-${theme}.png`});
});
