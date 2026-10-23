import {expect,it,vi} from 'vitest';
import {DataRegistry} from '../../packages/core/src/data';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import {streamEntry} from '../../packages/core/src/streaming';
import {scatterSteps} from '../../packages/core/src/planning';
import type {PointPlan,Query} from '../../packages/core/src/types';
import type {WorkerRequest,WorkerResponse} from '../../packages/core/src/worker';
const query:Query={bounds:{x:[30,40],y:[50,60]},width:200,height:200,xScale:'linear',yScale:'linear',pointBudget:100000,mode:'density'};
function sources(immutable=true){const registry=new DataRegistry();registry.set('x',Float64Array.from({length:20000},(_,i)=>(i*37)%100));registry.set('y',Float64Array.from({length:20000},(_,i)=>i%101));if(immutable)for(const id of ['x','y'])registry.store.set(id,streamEntry(registry.get(id),20000));return registry;}
function expected(registry:DataRegistry,options:Query):PointPlan{const steps=scatterSteps(registry.get('x'),registry.get('y'),options);while(true){const result=steps.next();if(result.done)return result.value;}}

it('reuses fallback scatter indexes across viewport queries and releases their memory',async()=>{
  const registry=sources(),scheduler=new QueryScheduler({workerFactory:null,maxCacheBytes:0});
  try{
    for(let i=0;i<3;i++){const options={...query,width:200+i};expect(await scheduler.query('scatter','scatter','x','y',options,registry)).toEqual(expected(registry,options));}
    expect(scheduler.stats.scatterIndex.fallback).toMatchObject({builds:1,warmQueries:1,lastMode:'warm-index',retainedBytes:0});
    scheduler.release('x');expect(scheduler.stats.scatterIndex.fallback.indexBytes).toBe(0);
  }finally{scheduler.dispose();}expect(scheduler.stats.scatterIndex.fallback.indexBytes).toBe(0);
});

it('reports owned static worker indexing and reset on release/fallback/dispose',async()=>{
  const sent:WorkerResponse[]=[];let receive:(event:{data:WorkerRequest})=>void;
  const fake={onmessage:null as ((event:MessageEvent<WorkerResponse>)=>void)|null,onerror:null,onmessageerror:null as (()=>void)|null,
    terminate:vi.fn(()=>receive({data:{type:'dispose'}})),postMessage(message:WorkerRequest){const data=structuredClone(message);queueMicrotask(()=>receive({data}));}};
  vi.stubGlobal('postMessage',(message:WorkerResponse)=>{const data=structuredClone(message);sent.push(data);queueMicrotask(()=>fake.onmessage?.({data} as MessageEvent<WorkerResponse>));});vi.stubGlobal('close',vi.fn());vi.stubGlobal('onmessage',null);
  let scheduler:QueryScheduler|undefined;
  try{
    await import('../../packages/core/src/worker');receive=(globalThis as unknown as {onmessage:(event:{data:WorkerRequest})=>void}).onmessage;
    scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker,maxCacheBytes:0});const registry=sources(false);
    for(let i=0;i<3;i++){const options={...query,width:200+i};expect(await scheduler.query('scatter','scatter','x','y',options,registry)).toEqual(expected(registry,options));}
    expect(scheduler.stats.scatterIndex.worker).toMatchObject({builds:1,warmQueries:1,lastMode:'warm-index',retainedBytes:0});
    expect(scheduler.stats.scatterIndex.fallback.indexBytes).toBe(0);scheduler.release('x');
    await vi.waitFor(()=>expect(scheduler!.stats.scatterIndex.worker.indexBytes).toBe(0));
    expect(sent.some(message=>message.type==='error'||message.type==='sync-error')).toBe(false);
    fake.onmessageerror?.();expect(scheduler.stats.worker).toBe(false);expect(scheduler.stats.scatterIndex.worker.indexBytes).toBe(0);
    expect(await scheduler.query('scatter','scatter','x','y',query,registry)).toEqual(expected(registry,query));
    expect(scheduler.stats.scatterIndex.fallback.builds).toBe(0);
  }finally{scheduler?.dispose();await Promise.resolve();await Promise.resolve();vi.unstubAllGlobals();}
});
