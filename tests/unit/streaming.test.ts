import {describe,expect,it,vi} from 'vitest';
import {Figure,Layer,subplots} from '../../packages/core/src/figure';
import {appendEntry,streamEntry} from '../../packages/core/src/streaming';
import {describeData} from '../../packages/core/src/data';
import {ascending,entryExtent} from '../../packages/core/src/source-metadata';
import {lineSteps} from '../../packages/core/src/planning';
import type {NumericArray} from '../../packages/core/src/types';

const values=(figure:Figure,id:string)=>Array.from(figure.registry.get(id).values);
const buffers=(figure:Figure)=>new Map(Array.from(figure.registry.entries(),([id,entry])=>[id,entry.values.slice().buffer as ArrayBuffer]));

describe('bounded streaming transactions',()=>{
  it('releases a same-layer imported source alias and budgets the resulting owned channels',()=>{
    const original=new Figure(),originalLayer=original.plot([0,1],[2,3]),snapshot=original.snapshot(),shared=originalLayer.spec.data.x;
    snapshot.figure.layers[0].data.y=shared;snapshot.sources=snapshot.sources.filter(source=>source.id===shared);
    const copy=new Figure({runtime:{maxSourceBytes:32}});copy.applySnapshot(snapshot,new Map([[shared,original.registry.get(shared).values.slice().buffer as ArrayBuffer]]));
    const layer=new Layer(copy,originalLayer.id);layer.enableStreaming({maxPoints:2});
    expect(copy.registry.has(shared)).toBe(false);expect(copy.registry.size).toBe(2);expect(layer.spec.data.x).not.toBe(layer.spec.data.y);
    expect(copy.diagnostics().sourceBytes).toBe(32);expect(values(copy,layer.spec.data.x)).toEqual([0,1]);expect(values(copy,layer.spec.data.y)).toEqual([0,1]);original.close();copy.close();
  });
  it('keeps an imported source that another layer still references',()=>{
    const original=new Figure(),a=original.plot([0,1],[2,3]),b=original.plot([4,5],[6,7]),snapshot=original.snapshot(),shared=a.spec.data.x,removed=b.spec.data.x;
    snapshot.figure.layers[1].data.x=shared;snapshot.sources=snapshot.sources.filter(source=>source.id!==removed);
    const copy=new Figure();copy.applySnapshot(snapshot,buffers(original));new Layer(copy,a.id).enableStreaming({maxPoints:2});
    expect(copy.registry.has(shared)).toBe(true);expect(copy.spec.layers[1].data.x).toBe(shared);expect(values(copy,shared)).toEqual([0,1]);original.close();copy.close();
  });
  it('cannot reuse an externally restored epoch even when the UUID provider repeats',()=>{
    vi.stubGlobal('crypto',{randomUUID:()=> 'external-epoch'});
    try{
      const figure=new Figure(),layer=figure.plot([0],[1]).enableStreaming({maxPoints:2}),state=figure.getStreamingState(layer.id)!;
      figure.restoreStreaming({[layer.id]:{...state,streamId:'stream-external-epoch'}});layer.setData({x:[2],y:[3]});
      const next=figure.getStreamingState(layer.id)!.streamId;expect(next).not.toBe('stream-external-epoch');
      layer.disableStreaming();layer.enableStreaming({maxPoints:2});expect(figure.getStreamingState(layer.id)!.streamId).not.toBe('stream-external-epoch');expect(figure.getStreamingState(layer.id)!.streamId).not.toBe(next);figure.close();
    }finally{vi.unstubAllGlobals();}
  });
  it('owns inputs, retains a bounded window and keeps immutable old revisions',async()=>{
    const figure=new Figure(),x=Float64Array.of(0,1),layer=figure.plot(x,[10,11]).enableStreaming({maxPoints:3});
    x[0]=999;const old=figure.registry.get(layer.spec.data.x),input=Float64Array.of(2,3,4);
    await layer.appendData({x:input,y:[12,13,14]});input[0]=999;
    expect(values(figure,layer.spec.data.x)).toEqual([2,3,4]);expect([...old.values]).toEqual([0,1]);
    expect(figure.getStreamingState(layer.id)).toMatchObject({nextSequence:5,retained:3,evicted:2,revision:1});
    const before=figure.snapshot();await layer.appendData({x:[],y:[]});expect(figure.snapshot()).toEqual(before);
    await layer.appendData({x:[5,6,7,8,9],y:[15,16,17,18,19]});
    expect(values(figure,layer.spec.data.x)).toEqual([7,8,9]);expect(figure.diagnostics().sourceBytes).toBe(48);figure.close();
  });
  it('rejects a bad multi-layer batch without publishing its valid prefix',async()=>{
    const figure=new Figure(),a=figure.plot([0],[1]).enableStreaming({maxPoints:5}),b=figure.scatter([0],[2]).enableStreaming({maxPoints:5});
    const before=figure.snapshot(),states=figure.diagnostics().streams;
    await expect(figure.appendDataBatch([{layer:a,data:{x:[1],y:[3]}},{layer:b,data:{x:[1,2],y:[4]}}])).rejects.toThrow(/equal lengths/);
    expect(figure.snapshot()).toEqual(before);expect(figure.diagnostics().streams).toEqual(states);
    await figure.appendDataBatch([{layer:a,data:{x:[1],y:[3]}},{layer:b,data:{x:[1],y:[4]}}]);
    expect(values(figure,a.spec.data.y)).toEqual([1,3]);expect(values(figure,b.spec.data.y)).toEqual([2,4]);figure.close();
  });
  it('keeps dtype and required scalar color channels',async()=>{
    const figure=new Figure(),layer=figure.scatter(new Int16Array([1]),new Float32Array([2]),{values:new Uint8Array([3])}).enableStreaming({maxPoints:2});
    await expect(layer.appendData({x:[2],y:[3]})).rejects.toThrow(/every existing channel/);
    await expect(layer.appendData({x:[40000],y:[3],color:[4]})).rejects.toThrow(/exactly/);
    await expect(layer.appendData({x:new Float64Array([2]),y:[3],color:[4]})).rejects.toThrow(/dtype/);
    await layer.appendData({x:[2],y:[3],color:[4]});
    expect(figure.registry.get(layer.spec.data.x).values).toBeInstanceOf(Int16Array);
    expect(values(figure,layer.spec.data.color)).toEqual([3,4]);figure.close();
  });
  it('validates x inspection across batches and preserves missing y samples',async()=>{
    const figure=new Figure(),layer=figure.plot([0,1],[2,3]).enableStreaming({maxPoints:3});figure.setHoverMode('x');
    const before=figure.snapshot();await expect(layer.appendData({x:[1],y:[4]})).rejects.toThrow(/increasing/);expect(figure.snapshot()).toEqual(before);
    await layer.appendData({x:[2,3],y:[NaN,5]});expect(values(figure,layer.spec.data.y)).toEqual([3,NaN,5]);
    figure.setHoverMode('nearest');await layer.appendData({x:[-1,NaN],y:[1,2]});figure.close();
  });
  it('resets stream identity on setData and keeps its capacity',async()=>{
    const figure=new Figure(),layer=figure.plot([0],[1]).enableStreaming({maxPoints:2}),old=figure.getStreamingState(layer.id)!;
    layer.setData({x:[10,11,12],y:[20,21,22]});const next=figure.getStreamingState(layer.id)!;
    expect(next.streamId).not.toBe(old.streamId);expect(next).toMatchObject({maxPoints:2,nextSequence:3,retained:2,evicted:1,revision:0});
    expect(values(figure,layer.spec.data.x)).toEqual([11,12]);await layer.appendData({x:[13],y:[23]});
    layer.disableStreaming();await expect(layer.appendData({x:[14],y:[24]})).rejects.toThrow(/Enable streaming/);figure.close();
  });
  it('exports ordinary retained snapshots and restores separate runtime metadata',async()=>{
    const figure=new Figure(),layer=figure.plot([0,1],[2,3]).enableStreaming({maxPoints:2});await layer.appendData({x:[2],y:[4]});
    const snapshot=figure.snapshot();expect(snapshot.figure.protocolVersion).toBe(1);expect(JSON.stringify(snapshot)).not.toContain('streamId');
    const copy=new Figure();copy.applySnapshot(snapshot,buffers(figure));expect(copy.streams.size).toBe(0);
    copy.restoreStreaming(figure.diagnostics().streams);expect(copy.getStreamingState(layer.id)).toEqual(figure.getStreamingState(layer.id));
    expect(copy.snapshot()).toEqual(snapshot);figure.close();copy.close();
  });
  it('rejects unsupported types and both directions of streaming/linked membership',()=>{
    const figure=subplots({rows:1,cols:3}),a=figure.panel(0,0).scatter([0],[1]),b=figure.panel(0,1).scatter([0],[1]),h=figure.panel(0,2).hist([1]);
    expect(()=>h.enableStreaming({maxPoints:2})).toThrow(/numeric 2D/);
    a.enableStreaming({maxPoints:2});expect(()=>figure.linkSelection({scatter:[a,b],histogram:h})).toThrow(/Disable streaming/);a.disableStreaming();
    const link=figure.linkSelection({scatter:[a,b],histogram:h});expect(()=>a.enableStreaming({maxPoints:2})).toThrow(/Linked data/);link.remove();a.enableStreaming({maxPoints:2});figure.close();
    const category=new Figure();expect(()=>category.plot(['a'],[1]).enableStreaming({maxPoints:1})).toThrow(/numeric/);category.close();
  });
  it('enforces a source budget before any append mutation',async()=>{
    const figure=new Figure({runtime:{maxSourceBytes:48}}),layer=figure.plot([0],[0]).enableStreaming({maxPoints:10}),before=figure.snapshot();
    await expect(layer.appendData({x:[1,2,3],y:[1,2,3]})).rejects.toMatchObject({code:'SOURCE_BUDGET_EXCEEDED'});expect(figure.snapshot()).toEqual(before);figure.close();
  });
  it('does not rescan unchanged source invariants on view changes',()=>{
    const figure=new Figure(),layer=figure.plot([0,1,2],[1,2,3]);figure.setHoverMode('x');figure.setView({xScale:'time'});
    const scans=figure.diagnostics().semanticScans;
    for(let i=0;i<20;i++)figure.setView({xDomain:[i,i+10]});expect(figure.diagnostics().semanticScans).toBe(scans);
    layer.setData({x:[10,11,12]});figure.setView({xDomain:[10,12]});expect(figure.diagnostics().semanticScans).toBeGreaterThan(scans);figure.close();
  });
  it('bounds outstanding append promises and rejects them promptly on reset',async()=>{
    const figure=new Figure(),layer=figure.plot([],[]).enableStreaming({maxPoints:2});
    (figure as any).view={schedule(){},ready(){return new Promise(()=>{});},dispose(){}};
    const pending=Array.from({length:64},(_,i)=>layer.appendData({x:[i],y:[i]}).catch(error=>error));
    await expect(layer.appendData({x:[64],y:[64]})).rejects.toMatchObject({code:'STREAM_BACKPRESSURE'});
    layer.setData({x:[],y:[]});expect((await Promise.all(pending)).every(error=>error.code==='STREAM_RESET')).toBe(true);
    figure.close();
  });
});

it('chunk storage holds no evicted oversized backing buffer',()=>{
  const input=new Float64Array(100_000).map((_,i)=>i);
  const initial=streamEntry({descriptor:describeData('x',input),values:input},1000);
  const next=appendEntry(initial,Float64Array.of(100_000),1000).entry;
  expect(next.chunks!.reduce((n,chunk)=>n+chunk.buffer.byteLength,0)).toBeLessThanOrEqual(1000*8);
  expect(next.values[999]).toBe(100_000);expect(initial.values[999]).toBe(99_999);
});

it('cached chunk metadata updates exactly when retained extrema leave the window',()=>{
  const array=Float64Array.of(-10,2,3),entry=streamEntry({descriptor:describeData('x',array),values:array},3);
  expect(entryExtent(entry,'linear')).toEqual([-10,3]);expect(entryExtent(entry,'log')).toEqual([2,3]);expect(ascending(entry)).toBe(true);
  const next=appendEntry(entry,[4],3).entry;expect(entryExtent(next,'linear')).toEqual([2,4]);expect(ascending(next)).toBe(true);
  const unordered=appendEntry(next,[0],3).entry;expect(ascending(unordered)).toBe(false);expect(entryExtent(entry,'linear')).toEqual([-10,3]);
});

it('monotone viewport queries retain identical crossing geometry and missing-data gaps',()=>{
  const x=Float64Array.from({length:1000},(_,i)=>i),y=x.map(i=>i%53===0?NaN:Math.sin(i/20));
  const finish=(steps:Generator)=>{let value=steps.next();while(!value.done)value=steps.next();return value.value;};
  for(const [lo,hi]of [[100,200],[100.1,100.9],[-10,-1],[999,1200],[0,999]]){
    const query={bounds:{x:[lo,hi] as [number,number],y:[-.5,.5] as [number,number]},width:100,height:100,xScale:'linear' as const,yScale:'linear' as const,pointBudget:5000,mode:'auto' as const};
    expect(finish(lineSteps(x,y,query,true))).toEqual(finish(lineSteps(x,y,query)));
  }
});
