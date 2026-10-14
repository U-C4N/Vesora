import {test,expect} from '@playwright/test';

async function load(page){
  await page.goto('/tests/browser/harness.html');await page.evaluate(async()=>{window.vs=await import('/packages/core/dist/index.js');});
}
test('dark theme survives live changes, PNG, offline HTML and native export legend',async({page,context})=>{
  await load(page);
  const output=await page.evaluate(async()=>{
    window.fig=vs.figure({theme:'dark',title:'Revenue',height:360});
    fig.plot([Date.UTC(2026,0,1),Date.UTC(2026,1,1)],[100,150],{label:'Paid plans'});
    fig.setView({xScale:'time'});fig.setAxisFormat('y',{kind:'currency',currency:'TRY',locale:'tr-TR'});
    fig.setPresentation({legend:false,tooltip:false});fig.mount(document.querySelector('#chart'));await fig.ready();
    const root=document.querySelector('.vesora-figure'),background=getComputedStyle(root).backgroundColor;
    const image=await createImageBitmap(await fig.savefig()),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const corner=[...ctx.getImageData(2,2,1,1).data];
    let legendInk=0;const data=ctx.getImageData(90,320,180,24).data;
    for(let i=0;i<data.length;i+=4)if(data[i]>80||data[i+1]>80||data[i+2]>100)legendInk++;
    const html=vs.toHTML(fig),prefs={...fig.presentation};fig.setTheme('light');fig.setSize({height:300});await fig.ready();
    return {background,corner,legendInk,prefs,height:root.style.height,light:getComputedStyle(root).backgroundColor,html};
  });
  expect(output.background).toBe('rgb(15, 23, 42)');expect(output.corner).toEqual([15,23,42,255]);expect(output.legendInk).toBeGreaterThan(15);
  expect(output.prefs).toEqual({tooltip:false,legend:false});expect(output.height).toBe('300px');expect(output.light).toBe('rgb(255, 255, 255)');
  const offline=await context.newPage();await offline.route('http**',route=>route.abort());await offline.setContent(output.html);
  await expect(offline.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await expect(offline.locator('.vesora-figure')).toHaveCSS('background-color','rgb(15, 23, 42)');
  await expect(offline.locator('body')).toHaveCSS('background-color','rgb(15, 23, 42)');
  await offline.close();await page.evaluate(()=>fig.close());
});

test('typed hover and click preserve row identity, coordinates and clear on leave',async({page})=>{
  await load(page);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(async()=>{
    window.events=[];window.fig=vs.figure({height:360});fig.setView({xDomain:[0,2],yDomain:[0,2]});
    window.layer=fig.scatter([1],[1],{size:16});fig.setPresentation({tooltip:false,legend:false});
    fig.on('hover',value=>events.push({event:'hover',value}));fig.on('click',value=>events.push({event:'click',value}));
    fig.mount(document.querySelector('#chart'));await fig.ready();
  });
  const point=await page.evaluate(()=>{const r=fig.view.panels[0].rect,o=fig.view.overlay.getBoundingClientRect();return {x:o.left+r.left+r.width/2,y:o.top+r.top+r.height/2,localX:r.left+r.width/2,localY:r.top+r.height/2,leaveX:o.right-1,leaveY:o.bottom-1};});
  await page.mouse.click(point.x,point.y);
  const click=await page.evaluate(()=>events.find(item=>item.event==='click')?.value);
  expect(click).toMatchObject({kind:'point',index:0,x:1,y:1});
  expect(click.pointerPosition.clientX).toBeCloseTo(point.x,4);expect(click.pointerPosition.clientY).toBeCloseTo(point.y,4);
  expect(click.pointerPosition.x).toBeCloseTo(point.localX,4);expect(click.pointerPosition.y).toBeCloseTo(point.localY,4);
  expect(click.layerId).toBe(await page.evaluate(()=>layer.id));await page.mouse.move(point.leaveX,point.leaveY);
  await expect.poll(()=>page.evaluate(()=>events.at(-1)?.value)).toBe(null);expect(errors).toEqual([]);await page.evaluate(()=>fig.close());
});

test('throwing consumers cannot break ready, errors, updates or remount cleanup',async({page})=>{
  await load(page);
  const result=await page.evaluate(async()=>{
    const logged=[];console.error=(...args)=>logged.push(String(args[0]));
    const fig=vs.figure({height:360}),layer=fig.scatter([0,1],[0,1]);let frames=0;
    fig.on('representation',()=>{throw new Error('consumer failed');});fig.on('representation',()=>frames++);
    fig.on('error',()=>{throw new Error('error consumer failed');});fig.mount(document.querySelector('#chart'));await fig.ready();
    for(let i=0;i<5;i++){layer.setData({y:[i,i+1]});await fig.ready();}
    fig.unmount();const detached=document.querySelectorAll('#chart canvas').length;fig.mount(document.querySelector('#chart'));await fig.ready();
    fig.emit('error',{message:'test diagnostic'});const mounted=document.querySelectorAll('#chart canvas').length;fig.close();
    return {logged,frames,detached,mounted,closed:document.querySelectorAll('#chart canvas').length};
  });
  expect(result.frames).toBeGreaterThanOrEqual(7);expect(result.logged).toContain('Vesora representation callback failed');expect(result.logged).toContain('Vesora error callback failed');
  expect(result).toMatchObject({detached:0,mounted:2,closed:0});
});

test('time axes draw leap-day labels and time-positioned bars with shared Intl currency',async({page})=>{
  await load(page);
  const output=await page.evaluate(async()=>{
    const labels=[],native=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){labels.push(String(text));return native.call(this,text,...args);};
    const begin=Date.UTC(2024,1,28),end=Date.UTC(2024,2,2),fig=vs.figure({theme:'dark',height:360});
    fig.setView({xScale:'time',xDomain:[begin,end],yDomain:[0,5]});fig.setAxisFormat('y',{kind:'currency',currency:'EUR',locale:'en-US'});
    fig.bar([begin,begin+86400000,begin+2*86400000],[1,3,2],{barWidth:43200000,color:'#ff0000'});
    fig.mount(document.querySelector('#chart'));await fig.ready();
    const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let red=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>200&&pixels[i+1]<50&&pixels[i+2]<50)red++;
    const info=fig.inspect()[0],error=gl.getError();fig.close();CanvasRenderingContext2D.prototype.fillText=native;return {labels,red,info,error};
  });
  expect(output.labels).toContain('Feb 29');expect(output.labels.some(label=>label.startsWith('€'))).toBe(true);
  expect(output.red).toBeGreaterThan(500);expect(output.info).toMatchObject({kind:'bar',total:3,exact:true});expect(output.error).toBe(0);
});

test('a native GPU failure rejects ready despite throwing error handlers and remount recovers',async({page})=>{
  await load(page);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const result=await page.evaluate(async()=>{
    console.error=()=>{};const fig=vs.figure({theme:'dark'});fig.scatter([0,1],[0,1]);fig.mount(document.querySelector('#chart'));await fig.ready();
    fig.on('error',()=>{throw new Error('consumer error handler');});const failure=new Promise(resolve=>fig.on('error',resolve));
    document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();await failure;
    let message='';try{await fig.ready();}catch(error){message=error.message;}
    fig.mount(document.querySelector('#chart'));await fig.ready();const recovered=fig.inspect()[0].rendered;fig.close();return {message,recovered};
  });
  expect(result.message).toContain('WebGL context lost');expect(result.recovered).toBe(2);expect(errors).toEqual([]);
});

for(const kind of ['bar','boxplot'])test(`horizontal ${kind} native tooltip formats value-axis currency and preserves original event fields`,async({page})=>{
  await load(page);
  await page.evaluate(async kind=>{
    window.texts=[];window.hoverEvents=[];const native=CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){texts.push(String(text));return native.call(this,text,...args);};
    window.fig=vs.figure({height:360});fig.setView({xDomain:[0,1000],yDomain:[-.5,.5]});
    fig.setAxisFormat('x',{kind:'currency',currency:'USD',locale:'en-US'});fig.setAxisFormat('y',{kind:'date'});
    if(kind==='bar')fig.barh(['A'],[500]);else fig.boxplot([[100,200,300,400,500]],{labels:['A'],orientation:'horizontal'});
    fig.on('hover',event=>hoverEvents.push(event));fig.mount(document.querySelector('#chart'));await fig.ready();texts.length=0;
  },kind);
  const point=await page.evaluate(value=>{const panel=fig.view.panels[0],r=panel.rect,o=fig.view.overlay.getBoundingClientRect();return {x:o.left+r.left+(value-panel.bounds.x[0])/(panel.bounds.x[1]-panel.bounds.x[0])*r.width,y:o.top+r.top+r.height/2};},kind==='bar'?250:300);
  await page.mouse.move(point.x,point.y);
  const output=await page.evaluate(()=>({event:hoverEvents.filter(Boolean).at(-1),tooltip:texts.findLast(text=>text.includes(' · '))}));
  expect(output.event).toMatchObject({position:0,index:0});expect(output.event.pointerPosition.clientY).toBeCloseTo(point.y,4);
  if(kind==='bar'){
    expect(output.event).toMatchObject({kind:'bar',category:'A',value:500,start:0,end:500,orientation:'horizontal'});
    expect(output.tooltip).toContain('value=$500.00');expect(output.tooltip).toContain('start=$0.00');
  }else{
    expect(output.event).toMatchObject({kind:'box',group:'A',median:300,q1:200,q3:400});
    expect(output.tooltip).toContain('Q1=$200.00');expect(output.tooltip).toContain('median=$300.00');
  }
  await page.evaluate(()=>fig.close());
});

for(const scale of ['time','date-format'])test(`calendar ${scale} boundary wheel and pan clamp without native errors`,async({page})=>{
  await load(page);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(async scale=>{
    window.fig=vs.figure({height:360});fig.setView({xScale:scale==='time'?'time':'linear',xDomain:[8.639e15,8.64e15],yDomain:[0,2]});
    if(scale==='date-format')fig.setAxisFormat('x',{kind:'date'});fig.scatter([8.639e15,8.64e15],[1,1]);
    window.renderErrors=[];fig.on('error',event=>renderErrors.push(event.message));fig.mount(document.querySelector('#chart'));await fig.ready();
  },scale);
  await page.mouse.move(320,153);await page.mouse.wheel(0,1000);await page.evaluate(()=>fig.ready());
  await page.mouse.move(320,153);await page.mouse.down();await page.mouse.move(100,153,{steps:4});await page.mouse.up();await page.evaluate(()=>fig.ready());
  const state=await page.evaluate(()=>({domain:fig.spec.view.xDomain,errors:renderErrors}));
  expect(state.domain[1]).toBeLessThanOrEqual(8.64e15);expect(state.domain[0]).toBeLessThan(state.domain[1]);expect(state.errors).toEqual([]);expect(errors).toEqual([]);
  const explicit=await page.evaluate(()=>{try{fig.setView({xDomain:[8.639e15,8.641e15]});return false;}catch{return true;}finally{fig.close();}});
  expect(explicit).toBe(true);
});
