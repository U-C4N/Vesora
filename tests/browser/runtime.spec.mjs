import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{window.vs=await import('/packages/core/dist/index.js');});
});

test('the same figure restores WebGL resources and preserves its view after context loss',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure();f.scatter([0,1,2],[0,2,1]);f.setView({xDomain:[-.5,2.5],yDomain:[-.5,2.5]});f.mount(document.querySelector('#chart'));await f.ready();
    const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_lose_context');
    const lost=new Promise(resolve=>canvas.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;
    let failure='';try{await f.ready();}catch(error){failure=error.message;}
    await new Promise(resolve=>setTimeout(resolve,50));const restored=new Promise(resolve=>canvas.addEventListener('webglcontextrestored',resolve,{once:true}));extension.restoreContext();await restored;await f.ready({timeoutMs:5000});
    const output={failure,sameCanvas:canvas===document.querySelector('canvas'),view:f.captureViews().view.xDomain,rendered:f.inspect()[0].rendered,lost:f.diagnostics().contextLost};f.close();return output;
  });
  expect(result.failure).toContain('WebGL context lost');expect(result.sameCanvas).toBe(true);expect(result.view).toEqual([-.5,2.5]);expect(result.rendered).toBe(3);expect(result.lost).toBe(false);
});

test('hot appends commit coherent frames while the producer remains active',async({page})=>{
  const result=await page.evaluate(async()=>{
    const initial=Float64Array.from({length:5000},(_,i)=>i),f=vs.figure(),line=f.plot(initial,Float64Array.from(initial,x=>2*x));line.enableStreaming({maxPoints:5000});f.mount(document.querySelector('#chart'));await f.ready();
    let producing=true,liveFrames=0,mixed=0,calls=0;const pending=[];
    f.on('representation',()=>{if(producing)liveFrames++;const frame=f.view.committedFigure,layer=frame.spec.layers[0],x=frame.registry.get(layer.data.x).values,y=frame.registry.get(layer.data.y).values;if(x.length!==y.length||x.some((value,index)=>y[index]!==value*2))mixed++;});
    await new Promise(resolve=>{const timer=setInterval(()=>{const start=5000+calls*100,x=Float64Array.from({length:100},(_,i)=>start+i);pending.push(line.appendData({x,y:Float64Array.from(x,value=>value*2)}));if(++calls===30){clearInterval(timer);producing=false;resolve();}},10);});
    await Promise.all(pending);await f.ready();const state=f.getStreamingState(line.id),diagnostics=f.diagnostics();f.close();return {liveFrames,mixed,retained:state.retained,next:state.nextSequence,frames:diagnostics.completedFrames};
  });
  expect(result.liveFrames).toBeGreaterThan(0);expect(result.mixed).toBe(0);expect(result.retained).toBe(5000);expect(result.next).toBe(8000);expect(result.frames).toBeGreaterThan(2);
});

test('ready timeout and abort release only their own waiters',async({page})=>{
  const result=await page.evaluate(async()=>{
    const Native=window.Worker;window.Worker=class{postMessage(){}terminate(){}};
    const f=vs.figure({runtime:{workerStartupTimeoutMs:10000,workerStallTimeoutMs:10000}});f.scatter([0,1],[0,1]);f.mount(document.querySelector('#chart'));
    const controller=new AbortController(),aborted=f.ready({signal:controller.signal}).catch(error=>error.name);controller.abort();
    const timeout=await f.ready({timeoutMs:20}).catch(error=>error.name),abort=await aborted,remaining=f.view.waiters.length;f.close();window.Worker=Native;return {timeout,abort,remaining};
  });
  expect(result).toEqual({timeout:'TimeoutError',abort:'AbortError',remaining:0});
});

test('a figure geometry budget rejects the frame without dropping source data',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({runtime:{maxGeometryBytes:64}});f.scatter([0,1,2,3],[0,1,2,3]);f.mount(document.querySelector('#chart'));const message=await f.ready().then(()=>'',error=>error.message),sourceBytes=f.diagnostics().sourceBytes;f.close();return {message,sourceBytes};
  });
  expect(result.message).toContain('geometry memory budget');expect(result.sourceBytes).toBe(64);
});

test('rapid 3D gestures accumulate against live camera state between frames',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({kind:'3d'});f.scatter3d([0,1],[0,1],[0,1]);f.mount(document.querySelector('#chart'));await f.ready();
    const view=f.view,panel=view.panels[0],rect=view.overlay.getBoundingClientRect(),x=panel.rect.left+panel.rect.width/2,y=panel.rect.top+panel.rect.height/2;
    view.drag={pointerId:1,panelId:'main',x,y,lastX:x,lastY:y,select:false,pan:false,bounds:panel.bounds,rect:panel.rect};
    for(const delta of [10,20])view.pointerMove(new PointerEvent('pointermove',{clientX:rect.left+x+delta,clientY:rect.top+y}));
    view.drag=undefined;
    for(let i=0;i<2;i++)view.wheel(new WheelEvent('wheel',{clientX:rect.left+x,clientY:rect.top+y,deltaY:100,cancelable:true}));
    const camera=f.captureViews().view.camera;await f.ready();f.close();return camera;
  });
  expect(result.azimuth).toBe(45);expect(result.distance).toBeCloseTo(3*Math.exp(.2),10);
});

test('hover and selection keep displayed row identity while an evicting frame is pending',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure(),line=f.plot([0,1,2],[10,20,30]);line.enableStreaming({maxPoints:3});f.setHoverMode('x');f.setView({xDomain:[-1,4],yDomain:[0,50]});f.mount(document.querySelector('#chart'));await f.ready();
    const view=f.view,panel=view.panels[0],before=f.getStreamingState(line.id),events=[];f.on('hover',event=>{if(event)events.push(event);});
    const original=view.scheduler.query.bind(view.scheduler);let release,started;
    const blocked=new Promise(resolve=>{release=resolve;}),queryStarted=new Promise(resolve=>{started=resolve;});
    view.scheduler.query=async(...args)=>{const result=await original(...args);started();await blocked;return result;};
    const append=line.appendData({x:[3],y:[40]});await queryStarted;
    const x=panel.rect.left+(0-panel.bounds.x[0])/(panel.bounds.x[1]-panel.bounds.x[0])*panel.rect.width,y=panel.rect.top+(1-(10-panel.bounds.y[0])/(panel.bounds.y[1]-panel.bounds.y[0]))*panel.rect.height;
    view.hover(x,y,true);view.inspectX(0,panel);const xhit=view.xHover.items[0],hover=events.at(-1);
    const selection=new Promise(resolve=>f.on('selection',resolve));view.select([panel.rect.left,panel.rect.top,panel.rect.left+panel.rect.width,panel.rect.top+panel.rect.height],panel);
    const selected=await selection,worker=view.scheduler.stats.worker,revision=view.committedRevision;
    release();await append;await f.ready();const after=f.getStreamingState(line.id),advanced=view.committedRevision>revision;f.close();return {before,after,hover,xhit,selected,worker,advanced};
  });
  for(const event of [result.hover,result.xhit])expect(event).toMatchObject({index:0,x:0,y:10,sequence:0,streamId:result.before.streamId,revision:result.before.revision});
  expect(result.selected).toMatchObject({count:3,indices:[0,1,2],sequences:[0,1,2],streamId:result.before.streamId,revision:result.before.revision});
  expect(result.worker).toBe(true);expect(result.after.nextSequence).toBe(4);expect(result.advanced).toBe(true);
});
