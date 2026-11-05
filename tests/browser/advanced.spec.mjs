import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const kinds=['ecdf','spectrogram','eventTimeline','errorbar','contour','quiver','parallelCoordinates','paretoFront','phasePortrait','ternary'];
test.beforeEach(async({page})=>{await page.goto('/tests/browser/advanced-harness.html');await page.waitForFunction(()=>window.loaded);});

test('all ten chart families render, capture protocol9 and produce PNG',async({page},testInfo)=>{
  const result=await page.evaluate(async()=>{const info=await window.gallery();return {info,snapshot:window.fig.snapshot(),errors:window.events.errors};});
  expect(new Set(result.info.map(info=>info.kind))).toEqual(new Set(kinds));
  expect(result.info.every(info=>info.rendered>0&&info.total>0)).toBe(true);expect(result.snapshot.figure.protocolVersion).toBe(9);expect(result.errors).toEqual([]);
  const png=await page.evaluate(async()=>Array.from(new Uint8Array(await(await window.fig.savefig({width:1200,height:1800,scale:1})).arrayBuffer())));
  expect(png.slice(0,8)).toEqual([137,80,78,71,13,10,26,10]);expect(png.length).toBeGreaterThan(10000);
  await page.screenshot({path:testInfo.outputPath('ten-families.png'),fullPage:true});
});

test('real pointer inspection preserves source identity for every new family',async({page})=>{
  const probes=[['ecdf',2,.75,'point'],['spectrogram',20,1,'cell'],['eventTimeline',1,0,'point'],['errorbar',1,3,'point'],['contour',.5,.5,'cell'],['quiver',0,0,'point'],['parallelCoordinates',0,0,'point'],['paretoFront',1,4,'point'],['phasePortrait',0,1,'point'],['ternary',.3,Math.sqrt(3)/10,'point']];
  for(const [kind,x,y,expected] of probes){
    await page.evaluate(kind=>window.single(kind),kind);const position=await page.evaluate(([x,y])=>window.screenPoint(x,y),[x,y]);
    await page.mouse.move(position[0],position[1]);await expect.poll(()=>page.evaluate(()=>window.events.hover.filter(Boolean).at(-1)?.kind)).toBe(expected);
    const hit=await page.evaluate(()=>window.events.hover.filter(Boolean).at(-1));expect(hit.layerId).toBeTruthy();expect(hit.frameId).toBeGreaterThan(0);
    if(kind==='ecdf'){expect(hit.count).toBe(2);expect(hit.sourceIndices).toEqual([1,2]);}
    if(kind==='spectrogram'){expect(hit.row).toBe(1);expect(hit.column).toBe(1);expect(hit.value).toBe(5);}
    if(kind==='eventTimeline')expect(hit.eventId).toBe('event-a');
    if(kind==='ternary'){expect(hit.a).toBe(.6);expect(hit.b).toBe(.2);expect(hit.c).toBe(.2);}
  }
});

test('spectrogram ring uploads only appended rows and frozen HTML owns the old matrix',async({page},testInfo)=>{
  await page.evaluate(()=>window.single('spectrogram'));
  const result=await page.evaluate(async()=>{
    const fig=window.fig,layer=window.layer,before=fig.diagnostics();await layer.appendRows([4],[[8,9,10]]);await fig.ready();const after=fig.diagnostics();
    fig.freezeInspection();const old=await window.core.toHTMLAsync(fig,{source:'displayed',observation:true});
    await layer.appendRows([5],[[10,9,8]],{waitFor:'accepted'});const held=await window.core.toHTMLAsync(fig,{source:'displayed',observation:true});
    const read=html=>JSON.parse(html.match(/<script[^>]+id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
    const a=read(old),b=read(held);fig.resumeLive();await fig.ready();return {textureBytes:after.textureUploadedBytes-before.textureUploadedBytes,a,b,old,final:fig.getStreamingState(layer.id),errors:window.events.errors};
  });
  expect(result.textureBytes).toBe(12);expect(result.a.snapshot.sources).toEqual(result.b.snapshot.sources);expect(result.a.buffers).toEqual(result.b.buffers);
  expect(result.a.snapshot.figure.observation.schemaVersion).toBe(2);expect(result.a.snapshot.figure.observation.streams[0]).toMatchObject({kind:'spectrogram',retainedAxis:0,shape:[4,3],sequenceStart:1,sequenceEndExclusive:5});
  expect(result.final.retained).toBe(4);expect(result.final.nextSequence).toBe(6);expect(result.errors).toEqual([]);
  const output=testInfo.outputPath('spectrogram.html');await writeFile(output,result.old,'utf8');
  const context=await page.context().browser().newContext({offline:true}),offline=await context.newPage(),requests=[];
  offline.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  try{await offline.goto(pathToFileURL(output).href);await expect(offline.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');expect(requests).toEqual([]);}finally{await context.close();}
});

test('stable-ID group selection, exact pagination and offline membership survive',async({page})=>{
  await page.evaluate(()=>window.createGroup());
  const result=await page.evaluate(async()=>{
    window.group.selectIds(['b','d']);await window.fig.ready();const first=window.group.query({limit:1}),second=window.group.query({offset:1,limit:1,revision:first.revision});
    const html=await window.core.toHTMLAsync(window.fig,{observation:true});window.group.clear();await window.fig.ready();return {first,second,html,errors:window.events.errors};
  });
  expect(result.first.ids).toEqual(['b']);expect(result.second.ids).toEqual(['d']);expect(result.first.total).toBe(2);expect(result.html).toContain('selectedIds');expect(result.errors).toEqual([]);
});

test('short real resource stress leaves bounded sources, no queues and no failed callbacks',async({page})=>{
  await page.evaluate(()=>window.single('spectrogram'));
  const result=await page.evaluate(async()=>{
    const fig=window.fig,layer=window.layer;
    for(let i=4;i<36;i++){await layer.appendRows([i],[[i%7,i%5,i%3]]);if(i%8===0){fig.freezeInspection();await window.core.toHTMLAsync(fig,{source:'displayed',observation:true});fig.resumeLive();await fig.ready();}}
    const before=fig.diagnostics();fig.close();return {before,after:fig.diagnostics(),sourceCount:fig.registry.size,errors:window.events.errors};
  });
  expect(result.before.pending).toBe(0);expect(result.before.pendingExports).toBe(0);expect(result.before.sourceBytes).toBeLessThan(1024);expect(result.sourceCount).toBe(0);expect(result.errors).toEqual([]);
});

test('imported cohorts brush without an application controller and frozen selection stays private',async({page})=>{
  await page.evaluate(async()=>{
    await window.createGroup();window.group.selectIds(['b','d']);await window.fig.ready();
    const snapshot=window.fig.snapshot(),buffers=new Map(snapshot.sources.map(source=>[source.id,window.fig.registry.get(source.id).values.slice().buffer]));
    const copy=window.core.figure();copy.applySnapshot(snapshot,buffers);await window.mount(copy);window.group=undefined;
  });
  const brush=async(x0,y0,x1,y1)=>{
    const [a,b]=await page.evaluate(values=>[window.screenPoint(values[0],values[1],1),window.screenPoint(values[2],values[3],1)],[x0,y0,x1,y1]);
    await page.keyboard.down('Shift');await page.mouse.move(...a);await page.mouse.down();await page.mouse.move(...b);await page.mouse.up();await page.keyboard.up('Shift');
  };
  await brush(1.9,.4,2.1,.6);await expect.poll(()=>page.evaluate(()=>window.fig.spec.observationGroups[0].selectedIds)).toEqual(['b']);
  await page.evaluate(async()=>{await window.fig.ready();window.fig.freezeInspection();});
  await brush(3.9,.85,4.1,1.02);
  await expect.poll(()=>page.evaluate(()=>window.fig.view.frozenFigure.spec.observationGroups[0].selectedIds)).toEqual(['d']);
  const state=await page.evaluate(async()=>{
    await window.fig.ready({target:'displayed'});
    const html=await window.core.toHTMLAsync(window.fig,{source:'displayed',observation:true}),payload=JSON.parse(html.match(/<script[^>]+id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
    return {live:window.fig.spec.observationGroups[0].selectedIds,displayed:payload.snapshot.figure.observationGroups[0].selectedIds,errors:window.events.errors};
  });
  expect(state.live).toEqual(['b']);expect(state.displayed).toEqual(['d']);expect(state.errors).toEqual([]);
});

test('Float64 spectral values and decibels remain visible outside Float32 exponent range',async({page})=>{
  const result=await page.evaluate(async()=>{
    const f=window.core.figure({width:600,height:400}),layer=f.spectrogram([1,2],[10,20],[[1e-100,1e100],[1e-90,1e90]],{maxRows:2,valueScale:'db',dbFloor:-1200});await window.mount(f);
    const diagnostics=f.diagnostics(),png=await f.savefig({width:600,height:400,scale:1});
    layer.setOptions({valueScale:'linear'});layer.setData({z:[[1e100,1e100],[1e100,1e100]]});await f.ready();
    const canvas=f.view.renderer.canvas,copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const context=copy.getContext('2d');context.drawImage(canvas,0,0);const [x,y]=window.screenPoint(10,1),pixel=Array.from(context.getImageData(Math.round(x*f.view.dpr),Math.round(y*f.view.dpr),1,1).data);
    return {info:f.inspect(),bytes:png.size,diagnostics,constantPixel:pixel,errors:window.events.errors};
  });
  expect(result.info[0].valid).toBe(4);expect(result.bytes).toBeGreaterThan(3000);expect(result.diagnostics.textureUploadedBytes).toBe(16);expect(result.constantPixel[1]).toBeGreaterThan(80);expect(result.constantPixel[0]).toBeLessThan(100);expect(result.errors).toEqual([]);
});

test('bounded performance probes measure cold 3D picks and 12/24 dashboard workloads',async({page},testInfo)=>{
  const picking=await page.evaluate(async()=>{
    const n=500000,x=new Float64Array(n),y=new Float64Array(n),z=new Float64Array(n);
    for(let i=0;i<n;i++){x[i]=(i%1000)/1000;y[i]=Math.floor(i/1000)/500;z[i]=Math.sin(i*.01)*.2;}
    const f=window.core.figure({kind:'3d',width:800,height:500});f.scatter3d(x,y,z,{size:3});await window.mount(f);
    const r=f.view.panels[0].rect,px=r.left+r.width/2,py=r.top+r.height/2;
    let began=performance.now();f.view.hover(px,py);const coldMs=performance.now()-began,first=f.diagnostics().picking;
    const warm=[];for(let i=0;i<20;i++){began=performance.now();f.view.hover(px+i%3,py+i%2);warm.push(performance.now()-began);}
    f.view.clearHover();f.setCameraPreset('xy');await f.ready();began=performance.now();f.view.hover(px,py);const orbitColdMs=performance.now()-began;
    const stats=f.diagnostics();f.close();warm.sort((a,b)=>a-b);return {points:n,coldMs,indexBuildMs:first.lastIndexBuildMs,warmP95Ms:warm[18],orbitColdMs,indexBuilds:stats.picking.indexBuilds,contextLost:stats.contextLost,targets:{cold50ms:coldMs<=50,warm50ms:warm[18]<=50}};
  });
  expect(picking.contextLost).toBe(false);expect(picking.indexBuildMs).toBeLessThan(1000);
  const streaming=await page.evaluate(async()=>{
    const retained=100000,f=window.core.subplots({rows:3,cols:1,width:1000,height:850}),layers=[];
    for(let i=0;i<3;i++){const x=Float64Array.from({length:retained},(_,j)=>j),y=Float64Array.from({length:retained},(_,j)=>Math.sin(j*.01+i));layers.push(f.panel(i,0).plot(x,y).enableStreaming({maxPoints:retained}));}
    await window.mount(f);const samples=[];
    for(let i=0;i<32;i++){
      const x=Float64Array.from({length:100},(_,j)=>retained+i*100+j),updates=layers.map((layer,index)=>({layer,data:{x,y:Float64Array.from(x,value=>Math.sin(value*.01+index))}})),began=performance.now();
      await f.appendDataBatch(updates);samples.push(performance.now()-began);
    }
    const stats=f.diagnostics();samples.sort((a,b)=>a-b);const p95Ms=samples[Math.ceil(samples.length*.95)-1],p99Ms=samples[Math.ceil(samples.length*.99)-1];
    const windows=layers.map(layer=>f.getStreamingState(layer.id));f.close();return {series:3,retainedPerSeries:retained,batchRows:100,batches:samples.length,p95Ms,p99Ms,pending:stats.pending,sourceBytes:stats.sourceBytes,windows,cleanup:f.registry.size===0,targets:{p95_50ms:p95Ms<=50,p99_100ms:p99Ms<=100}};
  });
  expect(streaming.pending).toBe(0);expect(streaming.windows.every(window=>window.retained===100000&&window.nextSequence===103200)).toBe(true);expect(streaming.cleanup).toBe(true);
  const cards=await page.evaluate(async()=>{
    const main=document.querySelector('#chart');main.replaceChildren();main.style.cssText='width:1200px;display:grid;grid-template-columns:repeat(3,400px);margin-top:1800px';
    const figures=[],layers=[],errors=[];const began=performance.now();
    for(let i=0;i<12;i++){
      const host=document.createElement('div');host.style.cssText='width:400px;height:240px';main.append(host);
      const f=window.core.figure({width:400,height:240}),line=f.plot(Array.from({length:1000},(_,j)=>j),Array.from({length:1000},(_,j)=>Math.sin(j/20+i))).enableStreaming({maxPoints:1000});
      f.on('error',error=>errors.push(error.message));f.mount(host);figures.push(f);layers.push(line);
    }
    await Promise.all(figures.map(f=>f.ready()));window.cards=figures;window.cardLayers=layers;return {firstReadyMs:performance.now()-began,errors};
  });
  await page.waitForFunction(()=>window.cards.every(f=>f.diagnostics().offscreen));
  const updates=await page.evaluate(async()=>{
    const began=performance.now();await Promise.all(window.cards.map((f,i)=>window.cardLayers[i].appendData({x:[1000],y:[i]},{waitFor:'accepted'})));await Promise.all(window.cards.map(f=>f.ready()));
    const stats=window.cards.map(f=>f.diagnostics()),elapsedMs=performance.now()-began;for(const f of window.cards)f.close();return {elapsedMs,deferrals:stats.reduce((sum,stat)=>sum+stat.offscreenDeferrals,0),contextsLost:stats.filter(stat=>stat.contextLost).length,cleaned:window.cards.every(f=>f.registry.size===0)};
  });
  expect(cards.errors).toEqual([]);expect(updates.contextsLost).toBe(0);expect(updates.deferrals).toBeGreaterThanOrEqual(12);expect(updates.cleaned).toBe(true);
  const panels=await page.evaluate(async()=>{
    const main=document.querySelector('#chart');main.style.cssText='width:1440px;margin:0';main.replaceChildren();
    const f=window.core.subplots({rows:6,cols:4,width:1440,height:1600});for(let i=0;i<24;i++)f.panel(Math.floor(i/4),i%4).plot([0,1,2],[i,i+1,i]);
    const began=performance.now();f.mount(main);await f.ready();const firstReadyMs=performance.now()-began,info=f.inspect(),stats=f.diagnostics();f.close();return {panels:info.length,firstReadyMs,contextLost:stats.contextLost,sourceCleanup:f.registry.size===0};
  });
  expect(panels.panels).toBe(24);expect(panels.contextLost).toBe(false);expect(panels.sourceCleanup).toBe(true);
  const metrics={host:'Chromium WebGL2 / configured ANGLE',picking,streaming,dashboard:{independentFigures12:{...cards,...updates},panels24OneFigure:panels},note:'Short fixed workloads; no universal FPS or long endurance claim.'};
  await testInfo.attach('v1-performance',{body:JSON.stringify(metrics,null,2),contentType:'application/json'});
  if(process.env.VESORA_V1_OUTPUT){await mkdir(process.env.VESORA_V1_OUTPUT,{recursive:true});await writeFile(resolve(process.env.VESORA_V1_OUTPUT,'performance.json'),JSON.stringify(metrics,null,2));}
});
