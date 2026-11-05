import {describe,it,expect,vi} from 'vitest';
import {figure} from '../../packages/core/src/figure';
import {prepareAdvanced,buildAdvancedGeometry} from '../../packages/core/src/advanced';
import {pickAdvanced,selectAdvanced,highlightAdvanced} from '../../packages/core/src/advanced-view';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import {linkObservations} from '../../packages/core/src/analysis';
import {validateObservationMetadata} from '../../packages/core/src/observation';
import type {PreparedAdvanced} from '../../packages/core/src/advanced';
import type {SnapshotLease} from '../../packages/core/src/snapshot-store';
import type {WorkerRequest,WorkerResponse} from '../../packages/core/src/worker';

describe('advanced completed-source integration',()=>{
  it('picks the right-continuous tied point at an ECDF corner and preserves full membership behind bounded hover previews',()=>{
    const fig=figure(),layer=fig.ecdf([...new Array(12001).fill(1),2,3]),p=prepareAdvanced(layer.spec,fig.registry),bounds={x:[0,4] as [number,number],y:[0,1] as [number,number]},rect={left:0,top:0,width:400,height:300};
    const probability=12001/12003,hit=pickAdvanced(p,layer.spec,bounds,fig.spec.view,rect,100,(1-probability)*300)!;
    expect(hit.value).toBe(1);expect(hit.probability).toBe(probability);expect(hit.sourceKind).toBe('aggregate');expect(hit.sourceCount).toBe(12001);expect(hit.sourceIndices).toHaveLength(10000);expect(hit.truncated).toBe(true);
    const selected=selectAdvanced(p,{x:[.99,1.01],y:[probability-.000001,probability+.000001]});expect(selected).toHaveLength(12001);expect(selected[0]).toBe(0);expect(selected[selected.length-1]).toBe(12000);
    const highlighted=highlightAdvanced(p,new Set([12000]));expect(highlighted.marks.some(mark=>mark.itemIndex===0)).toBe(true);expect(highlighted.items).toBe(p.items);fig.close();
  });
  it('leaves exact CCDF zero in the source-derived result while log rendering omits the unrepresentable endpoint',()=>{
    const fig=figure(),layer=fig.ccdf([1,2,3]),p=prepareAdvanced(layer.spec,fig.registry),zero=p.items.find(item=>item.value===3)!;
    expect(zero.probability).toBe(0);expect(p.marks.some(mark=>mark.kind==='point'&&mark.y===0)).toBe(true);
    const view={...fig.spec.view,yScale:'log' as const},geometry=buildAdvancedGeometry(p,{x:[0,4],y:[.01,1]},view,400,300,layer.spec.style);
    expect(geometry.positions.length).toBeGreaterThan(0);expect([...geometry.positions].every(Number.isFinite)).toBe(true);expect(p.items.find(item=>item.value===3)!.probability).toBe(0);fig.close();
  });
  it('cancels superseded cooperative preparation and caches only the newest source-version result',async()=>{
    const fig=figure(),layer=fig.ecdf([1,2,3]),scheduler=new QueryScheduler({workerFactory:null});
    try{
      const old=scheduler.queryAdvanced('advanced',layer.spec,fig.registry),rejected=expect(old).rejects.toMatchObject({name:'AbortError'});layer.setData({samples:[8,8,9]});
      const current=await scheduler.queryAdvanced('advanced',layer.spec,fig.registry);await rejected;expect(current.items.map(item=>item.value)).toEqual([8,9]);expect(await scheduler.queryAdvanced('advanced',layer.spec,fig.registry)).toBe(current);
      scheduler.release(layer.spec.data.samples);expect(scheduler.stats.cacheEntries).toBe(0);expect(scheduler.stats.pending).toBe(0);
    }finally{scheduler.dispose();fig.close();}expect(scheduler.stats.cacheBytes).toBe(0);
  });
  it('runs the actual advanced worker message handler, drops stale responses and recovers to fallback with parity',async()=>{
    let receive:(event:{data:WorkerRequest})=>void;const sent:WorkerResponse[]=[],requests:WorkerRequest[]=[];
    const fake={onmessage:null as ((event:MessageEvent<WorkerResponse>)=>void)|null,onerror:null,onmessageerror:null as (()=>void)|null,
      terminate:vi.fn(()=>receive({data:{type:'dispose'}})),postMessage(message:WorkerRequest){requests.push(structuredClone(message));const data=structuredClone(message);queueMicrotask(()=>receive({data}));}};
    vi.stubGlobal('postMessage',(message:WorkerResponse)=>{const data=structuredClone(message);sent.push(data);queueMicrotask(()=>fake.onmessage?.({data} as MessageEvent<WorkerResponse>));});vi.stubGlobal('close',vi.fn());vi.stubGlobal('onmessage',null);
    const fig=figure(),layer=fig.ecdf([1,2,3]);let scheduler:QueryScheduler|undefined;
    try{
      await import('../../packages/core/src/worker');receive=(globalThis as unknown as {onmessage:typeof receive}).onmessage;
      scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker});const previous=prepareAdvanced(layer.spec,fig.registry),old=scheduler.queryAdvanced('advanced',layer.spec,fig.registry),rejected=expect(old).rejects.toMatchObject({name:'AbortError'});
      layer.setData({samples:[10,10,12]});const current=await scheduler.queryAdvanced('advanced',layer.spec,fig.registry);await rejected;expect(current).toEqual(prepareAdvanced(layer.spec,fig.registry));
      const oldId=(requests.find(request=>request.type==='advanced') as Extract<WorkerRequest,{type:'advanced'}>).requestId;
      fake.onmessage?.({data:{type:'result',requestId:oldId,result:previous}} as MessageEvent<WorkerResponse>);expect(await scheduler.queryAdvanced('advanced',layer.spec,fig.registry)).toBe(current);
      fake.onmessageerror?.();expect(scheduler.stats.worker).toBe(false);layer.setData({samples:[20,21,21]});expect(await scheduler.queryAdvanced('advanced',layer.spec,fig.registry)).toEqual(prepareAdvanced(layer.spec,fig.registry));expect(sent.some(message=>message.type==='error'||message.type==='sync-error')).toBe(false);
    }finally{scheduler?.dispose();await Promise.resolve();await Promise.resolve();fig.close();vi.unstubAllGlobals();}
    expect(fake.terminate).toHaveBeenCalledOnce();expect(scheduler!.stats.pending).toBe(0);expect(scheduler!.stats.workerSourceBytes).toBe(0);
  });
  it('records schema2 retained grid identity, rejects shape/range tampering and releases failed snapshot reservations',async()=>{
    const fig=figure({runtime:{maxSnapshotBytes:100}}),layer=fig.spectrogram([0,1,2],[10,20],[[1,2],[3,4],[5,6]],{maxRows:3});await layer.appendRows([3],[[7,8]],{waitFor:'accepted'});
    const lease=fig.captureExport();const snapshot=structuredClone(lease.snapshot);snapshot.figure.observation=structuredClone(lease.observation!);
    expect(snapshot.figure.observation).toMatchObject({schemaVersion:2,streams:[{kind:'spectrogram',retainedAxis:0,shape:[3,2],sequenceStart:1,sequenceEndExclusive:4}]});expect(()=>validateObservationMetadata(snapshot.figure,snapshot.sources)).not.toThrow();
    const shape=structuredClone(snapshot);shape.figure.observation!.streams[0].shape=[2,3];expect(()=>validateObservationMetadata(shape.figure,shape.sources)).toThrow(/shape/);
    const interval=structuredClone(snapshot);interval.figure.observation!.streams[0].sequenceEndExclusive++;expect(()=>validateObservationMetadata(interval.figure,interval.sources)).toThrow(/sequence/);
    const shifted=structuredClone(snapshot);shifted.figure.observation!.streams[0].sequenceStart++;shifted.figure.observation!.streams[0].sequenceEndExclusive++;expect(()=>validateObservationMetadata(shifted.figure,shifted.sources)).toThrow(/sequence/);
    expect(()=>fig.captureExport()).toThrow(/Snapshot requires/);expect(fig.diagnostics().snapshotBytes).toBe(88);lease.release();lease.release();expect(fig.diagnostics().snapshotBytes).toBe(0);fig.close();
  });
  it('owns original and imported linked member buffers without re-copying on every cohort edit',()=>{
    const fig=figure(),x=new Float64Array([1,2,3]),y=new Float64Array([4,5,6]),layer=fig.scatter(x,y),link=linkObservations(fig,{datasetId:'owned',rowIds:['a','b','c'],members:[{layer}]});
    const owned=fig.registry.get(layer.spec.data.x);expect(owned.values).not.toBe(x);x.fill(999);y.fill(999);expect([...owned.values]).toEqual([1,2,3]);link.selectIds(['b']);expect(fig.registry.get(layer.spec.data.x)).toBe(owned);
    const snapshot=fig.snapshot(),buffers=new Map([...fig.registry.entries()].map(([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer])),copy=figure();copy.applySnapshot(snapshot,buffers);
    new Float64Array(buffers.get(layer.spec.data.x)!).fill(555);expect([...copy.registry.get(layer.spec.data.x).values]).toEqual([1,2,3]);copy.close();link.dispose();fig.close();
  });
  it('matches 32 seeded 256-action retained-row models through append, replacement, invalid updates and independent captures',async()=>{
    for(let trial=1;trial<=32;trial++){
      let state=trial*9973;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
      const fig=figure({runtime:{maxSnapshotBytes:512}}),layer=fig.spectrogram([], [10,20],[],{maxRows:3}),leases:Array<{lease:SnapshotLease;y:number[];z:number[]}>=[];let modelY:number[]=[],modelZ:number[]=[],nextTime=0,sequence=0;
      try{
        for(let action=0;action<256;action++){
          const kind=Math.floor(random()*7);
          if(kind<2){const count=1+Math.floor(random()*4),time=Array.from({length:count},()=>nextTime++),z=Array.from({length:count*2},()=>Math.floor(random()*1000));await layer.appendRows(time,z,{waitFor:'accepted'});modelY=[...modelY,...time].slice(-3);modelZ=[...modelZ,...z].slice(-6);sequence+=count;}
          else if(kind===2){const count=Math.floor(random()*4),time=Array.from({length:count},()=>nextTime++),z=Array.from({length:count*2},()=>Math.floor(random()*1000));layer.setData({y:time,z});modelY=time;modelZ=z;sequence=count;}
          else if(kind===3){if(leases.length===4)leases.shift()!.lease.release();leases.push({lease:fig.captureExport(),y:[...modelY],z:[...modelZ]});}
          else if(kind===4){leases.shift()?.lease.release();}
          else if(kind===5){const before=fig.snapshot();await expect(layer.appendRows([nextTime], [1],{waitFor:'accepted'})).rejects.toThrow(/shape/);expect(fig.snapshot()).toEqual(before);}
          else layer.setOptions({valueScale:random()<.5?'linear':'db'});
          expect([...fig.registry.get(layer.spec.data.y).values]).toEqual(modelY);expect([...fig.registry.get(layer.spec.data.z).values]).toEqual(modelZ);
          expect(layer.spec.options).toMatchObject({sequenceStart:sequence-modelY.length,sequenceEnd:sequence});expect(fig.getStreamingState(layer.id)).toMatchObject({nextSequence:sequence,retained:modelY.length,evicted:sequence-modelY.length});
          for(const capture of leases){const saved=capture.lease.snapshot.figure.layers[0];expect([...capture.lease.registry.get(saved.data.y).values]).toEqual(capture.y);expect([...capture.lease.registry.get(saved.data.z).values]).toEqual(capture.z);}
        }
      }finally{for(const entry of leases)entry.lease.release();expect(fig.diagnostics().snapshotBytes).toBe(0);fig.close();expect(fig.registry.size).toBe(0);}
    }
  });
});
