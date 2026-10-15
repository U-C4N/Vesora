import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.goto('/tests/browser/harness.html');await page.evaluate(async()=>{window.vs=await import('/packages/core/dist/index.js');});});

test('inspection survives eviction and reset, exports the displayed frame, then resumes a fenced live revision',async({page})=>{
  const result=await page.evaluate(async()=>{
    const fig=vs.figure(),line=fig.plot([0,1,2],[10,11,12]).enableStreaming({maxPoints:3});fig.mount(document.querySelector('#chart'));await fig.ready();
    const initial=fig.getInspectionState(),frozen=fig.freezeInspection(),liveView=fig.captureViews();
    await line.appendData({x:[3,4,5,6],y:[13,14,15,16]},{waitFor:'accepted'});
    fig.setInspectionView('main',{xDomain:[.5,1.5]});await fig.ready({target:'displayed'});
    const lease=fig.captureExport('displayed'),shown=[...lease.registry.get(line.spec.data.x).values],shownView=lease.snapshot.figure.view;lease.release();
    const html=vs.toHTML(fig,{source:'displayed'}),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('#vesora-payload').textContent);
    const before=fig.snapshot();let denied;try{await line.appendData({x:[7],y:[17]});}catch(e){denied={code:e.code,accepted:e.accepted};}
    const unchanged=JSON.stringify(before)===JSON.stringify(fig.snapshot());
    line.setData({x:[20,21],y:[30,31]});const resetState=fig.getStreamingState(line.id),still=fig.getDisplayedStreamingState(line.id);
    const target=fig.acceptedRevision;await fig.resumeLive();const resumed=fig.getInspectionState(),stats=fig.diagnostics();
    const livePreserved=JSON.stringify(liveView)===JSON.stringify(fig.captureViews());
    fig.close();return {initial,frozen,shown,shownView,payload,denied,unchanged,resetState,still,target,resumed,stats,livePreserved};
  });
  expect(result.frozen.displayedRevision).toBe(result.initial.displayedRevision);
  expect(result.shown).toEqual([0,1,2]);expect(result.shownView.xDomain).toEqual([.5,1.5]);expect(result.livePreserved).toBe(true);
  expect(result.payload.capture.source).toBe('displayed');expect(result.payload.capture.snapshotId).toBe(result.frozen.snapshotId);
  expect(result.denied).toEqual({code:'PRESENTATION_FROZEN',accepted:false});expect(result.unchanged).toBe(true);
  expect(result.still.streamId).not.toBe(result.resetState.streamId);
  expect(result.resumed.mode).toBe('live');expect(result.resumed.displayedRevision).toBeGreaterThanOrEqual(result.target);expect(result.stats.snapshotBytes).toBe(0);
});

test('completed static data owns bytes and budget rejection preserves the current display',async({page})=>{
  const result=await page.evaluate(async()=>{
    const input=new Float64Array([0,1,2]),fig=vs.figure({runtime:{maxSnapshotBytes:48}}),line=fig.plot(input,[10,11,12]);
    fig.mount(document.querySelector('#chart'));await fig.ready();input[1]=999;
    const state=fig.freezeInspection();let code;try{fig.captureExport('displayed');}catch(e){code=e.code;}
    const same=fig.getInspectionState();await fig.resumeLive();await fig.ready();const lease=fig.captureExport('displayed'),values=[...lease.registry.get(line.spec.data.x).values];lease.release();fig.close();return {state,same,code,values};
  });
  expect(result.code).toBe('SNAPSHOT_BUDGET_EXCEEDED');expect(result.same.snapshotId).toBe(result.state.snapshotId);expect(result.values).toEqual([0,1,2]);
});

test('an accepted append interrupted by freeze reports revision and exact sequence range',async({page})=>{
  const result=await page.evaluate(async()=>{
    const fig=vs.figure(),line=fig.plot([0,1],[1,2]).enableStreaming({maxPoints:3});fig.mount(document.querySelector('#chart'));await fig.ready();
    const pending=line.appendData({x:[2,3,4,5],y:[3,4,5,6]}).catch(e=>({code:e.code,accepted:e.accepted,revision:e.revision,ranges:e.sequenceRanges}));fig.freezeInspection();
    const error=await pending,state=fig.getStreamingState(line.id);fig.close();return {error,state,id:line.id};
  });
  expect(result.error.code).toBe('PRESENTATION_FROZEN');expect(result.error.accepted).toBe(true);expect(result.error.revision).toBeGreaterThan(0);
  expect(result.error.ranges[result.id]).toMatchObject({first:2,next:6});expect(result.state.nextSequence).toBe(6);
});

test('displayed PNG export stays valid across resume and releases every source reservation',async({page})=>{
  const result=await page.evaluate(async()=>{
    const fig=vs.figure(),line=fig.plot([0,1],[1,2]).enableStreaming({maxPoints:2});fig.mount(document.querySelector('#chart'));await fig.ready();fig.freezeInspection();
    const png=fig.savefig({source:'displayed',width:400,height:300,scale:1});await line.appendData({x:[2,3],y:[4,8]},{waitFor:'accepted'});await fig.resumeLive();const blob=await png;
    const signature=[...new Uint8Array(await blob.arrayBuffer()).slice(0,8)],stats=fig.diagnostics();fig.close();return {signature,stats};
  });
  expect(result.signature).toEqual([137,80,78,71,13,10,26,10]);expect(result.stats.pendingExports).toBe(0);expect(result.stats.snapshotBytes).toBe(0);
});

test('resuming a replacement snapshot invalidates reused source identities and versions',async({page})=>{
  const result=await page.evaluate(async()=>{
    const fig=vs.figure(),line=fig.plot([0,1,2],[0,1,0]);fig.setView({xDomain:[0,2],yDomain:[0,3]});fig.mount(document.querySelector('#chart'));await fig.ready();
    const before=[...fig.view.geometries.get(line.id).geometry.positions],snapshot=fig.snapshot(),buffers=new Map([...fig.registry.entries()].map(([id,e])=>[id,e.values.slice().buffer]));
    fig.freezeInspection();buffers.set(line.spec.data.y,new Float64Array([2,3,2]).buffer);fig.applySnapshot(snapshot,buffers);
    const held=[...fig.view.geometries.get(line.id).geometry.positions];await fig.resumeLive();const after=[...fig.view.geometries.get(line.id).geometry.positions];fig.close();return {before,held,after};
  });
  expect(result.held).toEqual(result.before);expect(result.after).not.toEqual(result.before);
});

test('chunked export refuses unreserved source copies and preserves held inspection',async({page})=>{
  const result=await page.evaluate(async()=>{
    const fig=vs.figure({runtime:{maxSnapshotBytes:128}}),line=fig.plot([0,1],[2,3]).enableStreaming({maxPoints:8});fig.mount(document.querySelector('#chart'));await fig.ready();await line.appendData({x:[2,3],y:[4,5]});const held=fig.freezeInspection();let code;
    try{await fig.savefig({source:'displayed'});}catch(error){code=error.code;}
    const html=vs.toHTML(fig,{source:'displayed'}),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('#vesora-payload').textContent);
    const materialized=[...fig.view.frozenFigure.registry.entries()].reduce((n,[,entry])=>n+(entry.materializedByteLength??0),0),after=fig.getInspectionState();fig.close();return {held,code,materialized,after,sources:payload.snapshot.sources};
  });
  expect(result.code).toBe('SNAPSHOT_BUDGET_EXCEEDED');expect(result.materialized).toBe(0);expect(result.after.snapshotId).toBe(result.held.snapshotId);expect(result.after.snapshotBytes).toBe(result.held.snapshotBytes);expect(result.sources.map(s=>s.shape)).toEqual([[4],[4]]);
});

test('completed linked predicates export exactly and frozen selection stays private',async({page})=>{
  await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:1,cols:3,width:1000,height:420});window.a=fig.panel(0,0).scatter([0,1,2,3],[0,1,2,3]);const b=fig.panel(0,1).scatter([3,2,1,0],[0,1,2,3]),h=fig.panel(0,2).hist([0,1,2,3],{bins:4});fig.linkSelection({scatter:[a,b],histogram:h});fig.mount(document.querySelector('#chart'));await fig.ready();fig.selectLinked(a.id,{x:[.5,2.5],y:[.5,2.5]});await fig.ready();
    const lease=fig.captureExport('displayed');window.initialDisplayed=lease.snapshot.figure.selectionLink;lease.release();window.initialLive=fig.snapshot().figure.selectionLink;window.frozen=fig.freezeInspection();window.events=[];fig.on('selection',e=>events.push(e));
  });
  await page.getByRole('button',{name:'Clear selection',exact:true}).click();await page.evaluate(()=>fig.ready({target:'displayed'}));
  const result=await page.evaluate(async()=>{const lease=fig.captureExport('displayed'),displayed=lease.snapshot.figure.selectionLink;lease.release();const live=fig.snapshot().figure.selectionLink,event=events.at(-1);await fig.resumeLive();const resumed=fig.getInspectionSnapshot().figure.selectionLink;fig.close();return {initialDisplayed,initialLive,displayed,live,event,frozen,resumed};});
  expect(result.initialDisplayed.selection).toEqual(result.initialLive.selection);expect(result.displayed.selection).toBeUndefined();expect(result.live).toEqual(result.initialLive);expect(result.resumed).toEqual(result.initialLive);expect(result.event).toMatchObject({mode:'frozen',snapshotId:result.frozen.snapshotId,active:false});
});

test('private frozen slices export only committed rows and invalidate changed sample selections',async({page})=>{
  const point=await page.evaluate(async()=>{
    window.fig=vs.subplots({rows:1,cols:2,kinds:[['3d','2d']],width:1000,height:420});window.surface=fig.panel(0,0).surface([0,1,2],[0,1],[[0,1,2],[10,11,12]]);window.slice=fig.panel(0,1).slice(surface,{axis:'y',index:0});
    fig.panel(0,1).setView({xDomain:[0,2],yDomain:[-1,13]});fig.mount(document.querySelector('#chart'));await fig.ready();
    const panel=fig.view.panels.find(item=>item.id==='panel-0-1'),rect=fig.view.overlay.getBoundingClientRect();
    return {x:rect.left+panel.rect.left+panel.rect.width/2,y:rect.top+panel.rect.top+(1-2/14)*panel.rect.height};
  });
  await page.mouse.click(point.x,point.y);
  const result=await page.evaluate(async()=>{
    const read=()=>{const lease=fig.captureExport('displayed');try{return {slice:lease.snapshot.figure.slices[0].index,y:[...lease.registry.get(slice.spec.data.y).values],cameraAzimuth:lease.snapshot.figure.view.camera.azimuth,selectedY:lease.snapshot.figure.inspection.selection?.y,frameId:lease.snapshot.figure.inspection.frameId};}finally{lease.release();}};
    const selected=fig.getInspectionSelection();fig.freezeInspection();const frozen=read();
    fig.setInspectionView('main',{camera:{azimuth:57,elevation:25,distance:3}});const pendingCamera=read();await fig.ready({target:'displayed'});const afterCamera=fig.getInspectionSelection(),cameraCommitted=read();
    surface.setData({z:[[20,21,22],[30,31,32]]});
    fig.setInspectionSlice(slice.id,1);const pending=read();await fig.ready({target:'displayed'});const committed=read(),selection=fig.getInspectionSelection();
    const live={slice:fig.snapshot().figure.slices[0].index,y:[...fig.registry.get(slice.spec.data.y).values]};await fig.resumeLive();const resumed=read();fig.close();return {selected,frozen,pendingCamera,afterCamera,cameraCommitted,pending,committed,selection,live,resumed};
  });
  expect(result.selected).toMatchObject({kind:'point',y:1});expect(result.afterCamera).toEqual(result.selected);
  expect(result.pendingCamera).toEqual(result.frozen);expect(result.pendingCamera.cameraAzimuth).toBe(35);expect(result.cameraCommitted.cameraAzimuth).toBe(57);
  expect(result.frozen).toMatchObject({slice:0,y:[0,1,2],selectedY:1});expect(result.pending).toMatchObject({slice:0,y:[0,1,2],selectedY:1});
  expect(result.committed).toMatchObject({slice:1,y:[10,11,12]});expect(result.committed.frameId).toBeGreaterThan(result.pending.frameId);expect(result.committed.selectedY).toBeUndefined();expect(result.selection).toBeUndefined();
  expect(result.live).toEqual({slice:0,y:[20,21,22]});expect(result.resumed).toMatchObject({slice:0,y:[20,21,22]});
});

for(const mutation of ['options','data'])test(`imported selected observation stays frozen until a ${mutation} update commits on resume`,async({page})=>{
  const point=await page.evaluate(async()=>{
    window.fig=vs.figure({height:420});window.layer=fig.hist([0,1,1,2,3,4],{bins:[0,1,2,4]});
    fig.setView({xDomain:[0,4],yDomain:[0,4]});fig.mount(document.querySelector('#chart'));await fig.ready();
    const panel=fig.view.panels[0],rect=fig.view.overlay.getBoundingClientRect();
    return {x:rect.left+panel.rect.left+1.5/4*panel.rect.width,y:rect.top+panel.rect.top+3/4*panel.rect.height};
  });
  await page.mouse.click(point.x,point.y);
  const result=await page.evaluate(async mutation=>{
    const selected=fig.getInspectionSelection(),original=fig.captureExport('displayed');
    const snapshot=structuredClone(original.snapshot),buffers=new Map([...original.registry.entries()].map(([id,entry])=>[id,entry.values.slice().buffer]));original.release();fig.close();
    const copy=vs.figure();copy.applySnapshot(snapshot,buffers);const imported=new vs.Layer(copy,snapshot.figure.layers[0].id);
    copy.mount(document.querySelector('#chart'));await copy.ready();const restored=copy.getInspectionSelection();
    imported.setStyle({color:'#ef4444'});copy.setView({xDomain:[-.5,4.5]});await copy.ready();const afterPresentation=copy.getInspectionSelection();
    const frozen=copy.freezeInspection(),lease=copy.captureExport('displayed'),sourceVersions=copy.snapshot().sources;
    if(mutation==='options')imported.setOptions({bins:[0,2,4]});else imported.setData({samples:[3,3,3,3]});
    const accepted=copy.snapshot(),held=copy.getInspectionState(),heldSelection=copy.getInspectionSelection();
    const during=copy.captureExport('displayed'),displayedSnapshot=structuredClone(during.snapshot),displayedValues=[...during.registry.get(imported.spec.data.samples).values];during.release();
    const frames=[];copy.on('frame',()=>frames.push(copy.getInspectionSelection()));await copy.resumeLive();
    const resumed=copy.getInspectionState(),resumedSelection=copy.getInspectionSelection(),retainedSnapshot=structuredClone(lease.snapshot),retainedValues=[...lease.registry.get(imported.spec.data.samples).values];
    lease.release();const bytesAfterRelease=copy.diagnostics().snapshotBytes;copy.close();
    return {selected,restored,afterPresentation,frozen,held,heldSelection,accepted,sourceVersions,displayedSnapshot,displayedValues,resumed,resumedSelection,frames,retainedSnapshot,retainedValues,bytesAfterRelease};
  },mutation);
  expect(result.selected).toMatchObject({kind:'bin',binIndex:1,count:2});expect(result.restored).toEqual(result.selected);expect(result.afterPresentation).toEqual(result.selected);
  expect(result.accepted.figure.inspection).toBeUndefined();if(mutation==='options')expect(result.accepted.sources).toEqual(result.sourceVersions);
  expect(result.held).toMatchObject({mode:'frozen',frameId:result.frozen.frameId,displayedRevision:result.frozen.displayedRevision,snapshotId:result.frozen.snapshotId});
  expect(result.held.acceptedRevision).toBeGreaterThan(result.frozen.acceptedRevision);expect(result.heldSelection).toEqual(result.selected);
  expect(result.displayedSnapshot.figure.inspection.selection).toEqual(result.selected);expect(result.displayedSnapshot.figure.layers[0].options.bins).toEqual([0,1,2,4]);expect(result.displayedValues).toEqual([0,1,1,2,3,4]);
  expect(result.resumed.mode).toBe('live');expect(result.resumed.displayedRevision).toBe(result.held.acceptedRevision);expect(result.resumedSelection).toBeUndefined();expect(result.frames.length).toBeGreaterThan(0);expect(result.frames.every(selection=>selection===undefined)).toBe(true);
  expect(result.retainedSnapshot).toEqual(result.displayedSnapshot);expect(result.retainedValues).toEqual(result.displayedValues);expect(result.bytesAfterRelease).toBe(0);
});
