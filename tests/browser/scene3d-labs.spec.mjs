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
