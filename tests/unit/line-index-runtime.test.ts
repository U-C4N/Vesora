import {expect,it,vi} from 'vitest';
import {DataRegistry} from '../../packages/core/src/data';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import {appendEntry,streamEntry} from '../../packages/core/src/streaming';
import {lineSteps} from '../../packages/core/src/planning';
import type {LineResult,Query} from '../../packages/core/src/types';
import type {WorkerRequest,WorkerResponse} from '../../packages/core/src/worker';

const query:Query={bounds:{x:[-1,30_000],y:[-2,2]},width:100,height:200,xScale:'linear',yScale:'linear',pointBudget:100_000,mode:'auto'};
function sources(count=20_000):DataRegistry {
  const registry=new DataRegistry(),x=Float64Array.from({length:count},(_,i)=>i);
  registry.set('x',x);registry.set('y',Float64Array.from(x,value=>Math.sin(value*.17)));
  for(const id of ['x','y'])registry.store.set(id,streamEntry(registry.get(id),count));
  return registry;
}
function expected(registry:DataRegistry,options:Query):LineResult {
  const steps=lineSteps(registry.get('x'),registry.get('y'),options,true);
  while(true){const next=steps.next();if(next.done)return next.value;}
}

it('reuses fallback indexes across queries and eviction without changing retained sample indices',async()=>{
  const registry=sources(),scheduler=new QueryScheduler({workerFactory:null});
  try{
    expect(await scheduler.query('line','line','x','y',query,registry)).toEqual(expected(registry,query));
    const initial=scheduler.stats.lineIndex.fallback;
    expect(initial.indexBytes).toBeGreaterThan(0);expect(initial.retainedBytes).toBeGreaterThan(0);
    const second={...query,width:101};
    expect(await scheduler.query('line','line','x','y',second,registry)).toEqual(expected(registry,second));
    expect(scheduler.stats.lineIndex.fallback.builds).toBe(initial.builds);
    expect(scheduler.stats.lineIndex.fallback.hits).toBeGreaterThan(initial.hits);
    const oldY=registry.get('y'),x=Float64Array.from({length:100},(_,i)=>20_000+i);
    registry.store.set('x',appendEntry(registry.get('x'),x,20_000).entry);
    registry.store.set('y',appendEntry(oldY,Float64Array.from(x,value=>Math.sin(value*.17)),20_000).entry);
    expect(await scheduler.query('line','line','x','y',query,registry)).toEqual(expected(registry,query));
    expect(oldY.chunks?.[0][0]).toBe(0);expect(registry.get('y').chunks?.[0][0]).toBe(Math.sin(17));
    scheduler.release('y');
    expect(scheduler.stats.lineIndex.fallback.indexBytes).toBe(0);
    expect(scheduler.stats.lineIndex.fallback.retainedBytes).toBe(0);
  }finally{scheduler.dispose();}
});

it('does not rebuild a released index after cooperative cancellation',async()=>{
  const registry=sources(200_000),scheduler=new QueryScheduler({workerFactory:null});
  const options={...query,bounds:{x:[-1,200_001] as [number,number],y:[-2,2] as [number,number]}};
  try{
    const pending=scheduler.query('line','line','x','y',options,registry);
    scheduler.release('y');
    await expect(pending).rejects.toMatchObject({name:'AbortError'});
    await new Promise(resolve=>setTimeout(resolve,10));
    expect(scheduler.stats.lineIndex.fallback.indexBytes).toBe(0);
    expect(scheduler.stats.lineIndex.fallback.retainedBytes).toBe(0);
    expect(scheduler.stats.pending).toBe(0);
  }finally{scheduler.dispose();}
});

it('reports real worker index ownership and releases it without losing result parity',async()=>{
  const sent:WorkerResponse[]=[];
  let receive:(event:{data:WorkerRequest})=>void;
  const fake={onmessage:null as ((event:MessageEvent<WorkerResponse>)=>void)|null,onerror:null,onmessageerror:null as (()=>void)|null,terminate:vi.fn(()=>receive({data:{type:'dispose'}})),
    postMessage(message:WorkerRequest){const data=structuredClone(message);queueMicrotask(()=>receive({data}));}};
  vi.stubGlobal('postMessage',(message:WorkerResponse)=>{const data=structuredClone(message);sent.push(data);queueMicrotask(()=>fake.onmessage?.({data} as MessageEvent<WorkerResponse>));});
  vi.stubGlobal('close',vi.fn());vi.stubGlobal('onmessage',null);
  let scheduler:QueryScheduler|undefined;
  try{
    await import('../../packages/core/src/worker');
    receive=(globalThis as unknown as {onmessage:(event:{data:WorkerRequest})=>void}).onmessage;
    const registry=sources();scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker});
    expect(await scheduler.query('line','line','x','y',query,registry)).toEqual(expected(registry,query));
    expect(scheduler.stats.lineIndex.worker.indexBytes).toBeGreaterThan(0);
    expect(sent.filter(message=>message.type==='line-index-stats')).toHaveLength(0);
    expect(sent.find(message=>message.type==='result')).toMatchObject({lineIndex:{indexBytes:scheduler.stats.lineIndex.worker.indexBytes}});
    expect(scheduler.stats.lineIndex.fallback.indexBytes).toBe(0);
    scheduler.release('y');
    await vi.waitFor(()=>expect(scheduler!.stats.lineIndex.worker.indexBytes).toBe(0));
    expect(scheduler.stats.lineIndex.worker.retainedBytes).toBe(0);
    expect(sent.some(message=>message.type==='error'||message.type==='sync-error')).toBe(false);
    expect(await scheduler.query('line','line','x','y',query,registry)).toEqual(expected(registry,query));
    const stale=scheduler.stats.lineIndex.worker;expect(stale.indexBytes).toBeGreaterThan(0);
    fake.onmessageerror?.();
    fake.onmessage?.({data:{type:'line-index-stats',stats:stale}} as MessageEvent<WorkerResponse>);
    expect(scheduler.stats.worker).toBe(false);expect(scheduler.stats.lineIndex.worker.indexBytes).toBe(0);
    const local={...query,width:101};
    expect(await scheduler.query('line','line','x','y',local,registry)).toEqual(expected(registry,local));
    expect(scheduler.stats.lineIndex.fallback.indexBytes).toBeGreaterThan(0);
    scheduler.dispose();
    fake.onmessage?.({data:{type:'line-index-stats',stats:stale}} as MessageEvent<WorkerResponse>);
    expect(scheduler.stats.lineIndex.fallback.indexBytes).toBe(0);expect(scheduler.stats.lineIndex.worker.retainedBytes).toBe(0);
    scheduler=undefined;
    await Promise.resolve();await Promise.resolve();
    expect(fake.terminate).toHaveBeenCalledOnce();
  }finally{scheduler?.dispose();await Promise.resolve();await Promise.resolve();vi.unstubAllGlobals();}
});
