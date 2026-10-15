import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{window.vs=await import('/packages/core/dist/index.js');window.labs=await import('/packages/core/dist/labs.js');});
});

test('accepted pins share one Figure snapshot budget across mount and unmount',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({kind:'3d',runtime:{maxSnapshotBytes:144}});f.scatter3d([0,1,2],[1,2,3],[2,3,4]);
    const pins=labs.createABPins(f),a=pins.pin('A','accepted'),b=pins.pin('B','accepted'),before=f.diagnostics().snapshotBytes;
    f.mount(document.querySelector('#chart'));await f.ready();let rejected;
    try{f.freezeInspection();}catch(error){rejected=error.code;}
    const denied={bytes:f.diagnostics().snapshotBytes,mode:f.getInspectionState().mode,pins:[a.bytes,b.bytes]};
    b.release();f.freezeInspection();const held=f.diagnostics().snapshotBytes;
    f.unmount();const unmounted={bytes:f.diagnostics().snapshotBytes,html:a.toHTML().includes('vesora-payload')};
    f.mount(document.querySelector('#chart'));await f.ready();const lease=f.captureExport('accepted'),remounted=f.diagnostics().snapshotBytes;
    f.close();const closed=f.diagnostics().snapshotBytes;let released;
    try{a.toHTML();}catch(error){released=error.message;}
    lease.release();pins.close();return {before,rejected,denied,held,unmounted,remounted,closed,released};
  });
  expect(result.before).toBe(144);expect(result.rejected).toBe('SNAPSHOT_BUDGET_EXCEEDED');
  expect(result.denied).toEqual({bytes:144,mode:'live',pins:[72,72]});expect(result.held).toBe(144);
  expect(result.unmounted).toEqual({bytes:72,html:true});expect(result.remounted).toBe(144);
  expect(result.closed).toBe(0);expect(result.released).toBe('Pinned snapshot has been released');
});

test('indexed surfaces, smooth shading and wireframe render and camera-only frames upload no buffers',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.subplots({rows:1,cols:2,kinds:[['3d','2d']],width:900,height:420}),x=Float64Array.from({length:40},(_,i)=>i/39),z=Float64Array.from({length:1600},(_,i)=>Math.sin(x[i%40]*5)*Math.cos(x[Math.floor(i/40)]*5));
    const s=f.panel(0,0).surface(x,x,z,{shading:'smooth',wireframe:true}),slice=f.panel(0,1).slice(s,{axis:'x',index:15});f.mount(document.querySelector('#chart'));await f.ready();
    const before=f.diagnostics();f.setCameraPreset('xy');await f.ready();const after=f.diagnostics(),canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let colored=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>35)colored++;
    const events=[];f.on('hover',event=>{if(event)events.push(event);});const p=f.view.panels[0];f.view.hover(p.rect.left+p.rect.width/2,p.rect.top+p.rect.height/2,true);
    slice.setIndex(20);await f.ready();const html=vs.toHTML(f),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('#vesora-payload').textContent),png=await f.savefig({width:1000,height:500}),bitmap=await createImageBitmap(png);
    const output={uploadedBefore:before.uploadedBytes,uploadedAfter:after.uploadedBytes,buildsBefore:before.geometryBuilds,buildsAfter:after.geometryBuilds,colored,error:gl.getError(),hit:events.at(-1),protocol:payload.snapshot.figure.protocolVersion,slice:payload.snapshot.figure.slices[0],png:[bitmap.width,bitmap.height]};f.close();return output;
  });
  expect(result.uploadedAfter).toBe(result.uploadedBefore);expect(result.buildsAfter).toBe(result.buildsBefore);expect(result.colored).toBeGreaterThan(500);expect(result.error).toBe(0);expect(result.hit?.kind).toBe('surface');expect(result.protocol).toBe(7);expect(result.slice.index).toBe(20);expect(result.png).toEqual([1000,500]);
});

test('3D trajectory width is measured in screen pixels',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({kind:'3d',width:640,height:400}),line=f.plot3d([0,1],[0,0],[0,0],{color:'#ff0000',width:2});f.setView({xDomain:[0,1],yDomain:[-1,1],zDomain:[-1,1]});f.setCameraPreset('xy');f.mount(document.querySelector('#chart'));await f.ready();
    const count=()=>{const gl=document.querySelector('canvas').getContext('webgl2'),pixels=new Uint8Array(gl.canvas.width*gl.canvas.height*4);gl.readPixels(0,0,gl.canvas.width,gl.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>pixels[i+1]+80&&pixels[i]>pixels[i+2]+80)red++;return red;};
    const thin=count();line.setStyle({width:10});await f.ready();const thick=count(),error=document.querySelector('canvas').getContext('webgl2').getError();f.close();return {thin,thick,error};
  });
  expect(result.thin).toBeGreaterThan(100);expect(result.thick).toBeGreaterThan(result.thin*3);expect(result.error).toBe(0);
});

test('Labs trajectories and A/B pins export exact retained static samples',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.subplots({rows:1,cols:1,kinds:[['3d']],width:640,height:400}),t=labs.createTrajectory(f.panel(0,0),{maxPoints:4}),pins=labs.createABPins(f);f.mount(document.querySelector('#chart'));await t.append({x:[3,2,1],y:[0,1,2],z:[0,.1,.2]});
    const a=pins.pin('A','displayed');await t.append({x:[0,-1,-2],y:[3,4,5],z:[.3,.4,.5]});const b=pins.pin('B','displayed');
    const decode=pin=>{const payload=JSON.parse(new DOMParser().parseFromString(pin.toHTML(),'text/html').querySelector('#vesora-payload').textContent),layer=payload.snapshot.figure.layers[0],encoded=payload.buffers.find(buffer=>buffer.id===layer.data.x).base64,bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return {kind:layer.kind,x:Array.from(new Float64Array(bytes.buffer)),json:JSON.stringify(payload.snapshot)};};
    const before=f.diagnostics().snapshotBytes,first=decode(a),second=decode(b),image=await a.exportPNG({width:800,height:450}),bitmap=await createImageBitmap(image),state=t.getState();pins.close();const after=f.diagnostics().snapshotBytes;t.close();f.close();return {first,second,state,before,after,png:[bitmap.width,bitmap.height]};
  });
  expect(result.first).toMatchObject({kind:'line3d',x:[3,2,1]});expect(result.second).toMatchObject({kind:'line3d',x:[1,0,-1,-2]});expect(result.first.json).not.toContain('nextSequence');expect(result.state).toMatchObject({nextSequence:6,retained:4,evicted:2});expect(result.before).toBeGreaterThan(0);expect(result.after).toBe(0);expect(result.png).toEqual([800,450]);
});

test('Labs rolling rows commit coherent panels and materialize static exported geometry',async({page})=>{
  const result=await page.evaluate(async()=>{
    const rolling=labs.createRollingSurface({x:[0,1,2],y:[0,1],z:[[0,1,0],[1,0,1]],maxRows:4});rolling.figure.mount(document.querySelector('#chart'));await rolling.figure.ready();await rolling.appendRows({y:[2,3,4],z:[[2,3,2],[3,2,3],[4,3,4]]});
    const html=vs.toHTML(rolling.figure),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('#vesora-payload').textContent),state=rolling.getState(),info=rolling.figure.inspect(),error=document.querySelector('canvas').getContext('webgl2').getError();rolling.close();return {state,kinds:payload.snapshot.figure.layers.map(layer=>layer.kind),shapes:payload.snapshot.sources.filter(source=>source.shape.length===2).map(source=>source.shape),info,error};
  });
  expect(result.state).toMatchObject({retainedRows:4,evictedRows:1,nextSequence:5});expect(result.kinds).toEqual(['surface','heatmap']);expect(result.shapes).toEqual([[4,3],[4,3]]);expect(result.error).toBe(0);
});

test('A/B PNG reserves chunk copies once and preserves captured dimensions after resize',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.figure({width:640,height:400,runtime:{maxSnapshotBytes:128}}),line=f.plot([0,1],[2,3]).enableStreaming({maxPoints:4}),pins=labs.createABPins(f);
    f.mount(document.querySelector('#chart'));await f.ready();await line.appendData({x:[2,3],y:[4,5]});
    const pin=pins.pin('A'),captured=[pin.snapshot.figure.width,pin.snapshot.figure.height],before=f.diagnostics();
    f.setSize({width:900,height:600});await f.ready();const live=[f.view.width,f.view.height];
    const blob=await pin.exportPNG(),bitmap=await createImageBitmap(blob),after=f.diagnostics(),png=[bitmap.width,bitmap.height];bitmap.close();
    const explicit=await createImageBitmap(await pin.exportPNG({width:700,height:350})),sized=[explicit.width,explicit.height];explicit.close();
    pins.close();const released=f.diagnostics().snapshotBytes;f.close();return {captured,live,png,sized,before,after,released};
  });
  expect(result.before.snapshotBytes).toBe(64);expect(result.after.snapshotBytes).toBe(64);
  expect(result.after.snapshotCopiedBytes).toBe(result.before.snapshotCopiedBytes);expect(result.after.exportCopiedBytes-result.before.exportCopiedBytes).toBe(64);
  expect(result.png).toEqual(result.captured);expect(result.png).not.toEqual(result.live);expect(result.sized).toEqual([700,350]);expect(result.released).toBe(0);
});

test('frozen Labs trajectory identity survives more than the bounded history window',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=vs.subplots({rows:1,cols:1,kinds:[['3d']],width:640,height:400}),t=labs.createTrajectory(f.panel(0,0),{maxPoints:2});f.setCameraPreset('xy');f.mount(document.querySelector('#chart'));await t.append({x:[0,1],y:[0,0],z:[0,0]});
    const original=t.getState(),frozen=f.freezeInspection(),hits=[];f.on('hover',hit=>{if(hit)hits.push(hit);});
    for(let i=0;i<100;i++)await t.append({x:[i+2],y:[0],z:[0]},{waitFor:'accepted'});
    const p=f.view.panels[0];f.view.hover(p.rect.left+p.rect.width/2,p.rect.top+p.rect.height/2,true);const hit=hits.at(-1),before=f.getInspectionState(),sequence=hit?t.sequenceAt(hit.indices[0],hit.sourceVersions.x):undefined;
    await f.resumeLive();const after=f.getInspectionState();t.close();f.close();return {original,frozen,before,after,hit,sequence};
  });
  expect(result.hit?.kind).toBe('segment3d');expect(result.hit.sourceVersions.x).toBe(result.original.sourceVersion);expect(result.sequence).toBe(0);expect(result.before.displayedRevision).toBe(result.frozen.displayedRevision);expect(result.after.displayedRevision).toBe(result.after.acceptedRevision);expect(result.after.mode).toBe('live');
});

test('wireframe surfaces and coplanar points share rendered and picked depth ties',async({page})=>{
  const results=await page.evaluate(async()=>{
    const output=[];
    for(const pointFirst of [false,true]){
      const f=vs.figure({kind:'3d',width:640,height:400}),point=()=>f.scatter3d([.25],[.7],[0],{color:'#ff0000',size:18}),surface=()=>f.surface([0,1],[0,1],[[0,0],[0,0]],{wireframe:true});
      if(pointFirst){point();surface();}else{surface();point();}f.setView({xDomain:[0,1],yDomain:[0,1],zDomain:[-1,1]});f.setCameraPreset('xy');f.mount(document.querySelector('#chart'));await f.ready();
      const p=f.view.panels[0],px=p.rect.left+p.rect.width/2-.5*(1.9/3)*p.rect.height/2,py=p.rect.top+p.rect.height/2-.4*(1.9/3)*p.rect.height/2,gl=document.querySelector('canvas').getContext('webgl2'),pixel=new Uint8Array(4);gl.readPixels(Math.floor(px),gl.canvas.height-1-Math.floor(py),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      let hit;f.on('hover',event=>hit=event);f.view.hover(px,py,true);output.push({pointFirst,red:pixel[0]>pixel[1]+80&&pixel[0]>pixel[2]+80,kind:hit?.kind,depthFunction:gl.getParameter(gl.DEPTH_FUNC),less:gl.LESS,error:gl.getError()});f.close();
    }return output;
  });
  expect(results).toHaveLength(2);for(const result of results){expect(result.red).toBe(result.pointFirst);expect(result.kind).toBe(result.pointFirst?'point3d':'surface');expect(result.depthFunction).toBe(result.less);expect(result.error).toBe(0);}
});

test('mixed shader programs preserve pixels and selection across style changes, export and context restore',async({page})=>{
  const click=await page.evaluate(async()=>{
    const prototype=WebGL2RenderingContext.prototype,originals={},queries={uniform:0,attribute:0,deletedPrograms:0};
    for(const [name,counter]of [['getUniformLocation','uniform'],['getAttribLocation','attribute'],['deleteProgram','deletedPrograms']]){
      originals[name]=prototype[name];prototype[name]=function(...args){queries[counter]++;return originals[name].apply(this,args);};
    }
    const f=vs.subplots({rows:1,cols:2,kinds:[['2d','3d']],width:1000,height:440}),plain=f.panel(0,0),space=f.panel(0,1);
    plain.scatter([.25],[.75],{color:'#ff0000',size:20});plain.plot([.1,.9],[.25,.25],{color:'#0000ff',width:6});
    const surface=space.surface([0,1],[0,1],[[.2,.2],[.2,.2]],{colorDomain:[0,1],shading:'unlit'});
    space.plot3d([.1,.9],[.6,.6],[.8,.8],{color:'#0000ff',width:8});const point=space.scatter3d([.25],[.75],[.9],{color:'#00ff00',size:20});
    plain.setView({xDomain:[0,1],yDomain:[0,1]});space.setView({xDomain:[0,1],yDomain:[0,1],zDomain:[0,1]});space.setCameraPreset('xy');
    f.mount(document.querySelector('#chart'));await f.ready();
    const canvas=f.view.renderer.canvas,gl=canvas.getContext('webgl2');
    const position=(panelIndex,x,y)=>{const {rect}=f.view.panels[panelIndex];return panelIndex===0?[rect.left+x*rect.width,rect.top+(1-y)*rect.height]:[rect.left+rect.width/2+(2*x-1)*(1.9/3)*rect.height/2,rect.top+rect.height/2-(2*y-1)*(1.9/3)*rect.height/2];};
    const positions={red:position(0,.25,.75),blue2d:position(0,.5,.25),green:position(1,.25,.75),blue3d:position(1,.5,.6),surface:position(1,.75,.25)};
    const sample=()=>{const result={};for(const [name,[x,y]]of Object.entries(positions)){const pixel=new Uint8Array(4);gl.readPixels(Math.floor(x),canvas.height-1-Math.floor(y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);result[name]=[...pixel];}result.error=gl.getError();return result;};
    window.shaderCase={f,space,surface,point,canvas,gl,positions,sample,queries,originals,initial:sample(),warm:{...queries}};
    const bounds=f.view.overlay.getBoundingClientRect();return {x:bounds.left+positions.green[0],y:bounds.top+positions.green[1]};
  });
  await page.mouse.click(click.x,click.y);
  const result=await page.evaluate(async()=>{
    const {f,space,surface,point,canvas,gl,positions,sample,queries,originals,initial,warm}=window.shaderCase;
    try{
      const selected=f.getInspectionSelection(),states=[];
      for(const style of [{shading:'smooth',wireframe:true},{shading:'unlit',wireframe:false},{shading:'unlit',wireframe:true},{shading:'smooth',wireframe:false},{shading:'unlit',wireframe:false}]){
        surface.setStyle(style);await f.ready();states.push({style,pixels:sample(),queries:{...queries},deletedBuffers:f.diagnostics().bufferDeletes,selection:f.getInspectionSelection()});
      }
      surface.setStyle({shading:'smooth',wireframe:true});await f.ready();const beforeExport=sample();
      const bitmap=await createImageBitmap(await f.savefig({source:'displayed',width:f.view.width,height:f.view.height,scale:1})),image=document.createElement('canvas');image.width=bitmap.width;image.height=bitmap.height;
      const context=image.getContext('2d');context.drawImage(bitmap,0,0);bitmap.close();const png={};for(const [name,[x,y]]of Object.entries(positions))png[name]=[...context.getImageData(Math.floor(x),Math.floor(y),1,1).data];
      const afterExportQueries={...queries};space.setCameraPreset('xy');await f.ready();const afterExport=sample(),afterExportFrameQueries={...queries};
      const extension=gl.getExtension('WEBGL_lose_context'),lost=new Promise(resolve=>canvas.addEventListener('webglcontextlost',resolve,{once:true}));extension.loseContext();await lost;
      await new Promise(resolve=>setTimeout(resolve,50));const restored=new Promise(resolve=>canvas.addEventListener('webglcontextrestored',resolve,{once:true}));extension.restoreContext();await restored;await f.ready({timeoutMs:5000});
      const afterRestore=sample(),restoreQueries={...queries};space.setCameraPreset('xy');await f.ready();const restoredFrameQueries={...queries},restoredSelection=f.getInspectionSelection(),beforeCloseDeleted=queries.deletedPrograms;
      f.close();return {pointId:point.id,initial,warm,selected,states,png,beforeExport,afterExport,afterExportQueries,afterExportFrameQueries,afterRestore,restoreQueries,restoredFrameQueries,restoredSelection,closedPrograms:queries.deletedPrograms-beforeCloseDeleted};
    }finally{f.close();for(const [name,original]of Object.entries(originals))WebGL2RenderingContext.prototype[name]=original;}
  });
  const expectColors=pixels=>{
    expect(pixels.red.slice(0,3)).toEqual([255,0,0]);expect(pixels.green.slice(0,3)).toEqual([0,255,0]);
    expect(pixels.blue2d.slice(0,3)).toEqual([0,0,255]);expect(pixels.blue3d.slice(0,3)).toEqual([0,0,255]);
  };
  expectColors(result.initial);expect(result.selected).toMatchObject({kind:'point3d',layerId:result.pointId,x:.25,y:.75,z:.9});
  for(const state of result.states){expectColors(state.pixels);expect(state.pixels.error).toBe(0);expect(state.queries.uniform).toBe(result.warm.uniform);expect(state.queries.attribute).toBe(result.warm.attribute);expect(state.selection).toEqual(result.selected);}
  expect(result.states[1].deletedBuffers).toBeGreaterThan(result.states[0].deletedBuffers);
  expect(result.states[1].pixels.surface).toEqual(result.initial.surface);expect(result.states[4].pixels.surface).toEqual(result.initial.surface);
  expect(result.states[0].pixels.surface.slice(0,3).reduce((a,b)=>a+b,0)).toBeLessThan(result.initial.surface.slice(0,3).reduce((a,b)=>a+b,0)-10);
  // The PNG includes axis/grid overlays, so a grid crossing may blend the blue line.
  for(const name of ['blue2d','blue3d']){expect(result.png[name][2]).toBeGreaterThan(200);expect(result.png[name][2]-Math.max(...result.png[name].slice(0,2))).toBeGreaterThan(100);}
  expect(result.png.red.slice(0,3)).toEqual([255,0,0]);expect(result.png.green.slice(0,3)).toEqual([0,255,0]);
  expect(result.afterExport).toEqual(result.beforeExport);expect(result.afterExportFrameQueries).toEqual(result.afterExportQueries);
  expect(result.afterRestore).toEqual(result.beforeExport);expect(result.restoreQueries.uniform).toBeGreaterThan(result.afterExportFrameQueries.uniform);
  expect(result.restoredFrameQueries).toEqual(result.restoreQueries);expect(result.restoredSelection).toEqual(result.selected);expect(result.closedPrograms).toBe(2);
});
