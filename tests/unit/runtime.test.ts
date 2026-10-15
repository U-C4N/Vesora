import {describe,it,expect,vi} from 'vitest';
import {chunkEntry,DataRegistry,describeData} from '../../packages/core/src/data';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import {hoverCandidates,hoverIndexSteps,selectionSteps} from '../../packages/core/src/interaction';
import {runSteps} from '../../packages/core/src/planning';
import type {Query} from '../../packages/core/src/types';
import type {WorkerRequest,WorkerResponse} from '../../packages/core/src/worker';

const query:Query={bounds:{x:[0,10],y:[0,10]},width:100,height:100,xScale:'linear',yScale:'linear',pointBudget:100,mode:'auto'};
const arrays=()=>{const registry=new DataRegistry();registry.set('x',Float64Array.of(1,2));registry.set('y',Float64Array.of(1,2));return registry;};

describe('runtime recovery and immutable source transport',()=>{
  it('selects an older displayed source locally without replacing newer worker sources',async()=>{
    const sent:WorkerRequest[]=[],registry=arrays(),historical=new DataRegistry();
    for(const [id,entry]of registry.entries())historical.store.set(id,entry);
    const fake={onmessage:null as ((event:MessageEvent<WorkerResponse>)=>void)|null,onerror:null,onmessageerror:null,terminate(){},postMessage(message:WorkerRequest){
      sent.push(message);if(message.type==='query')queueMicrotask(()=>fake.onmessage?.({data:{type:'result',requestId:message.requestId,result:{kind:'points',indices:new Uint32Array(),info:{kind:'points',total:0,visible:0,rendered:0,exact:true,method:'test'}}}} as MessageEvent<WorkerResponse>));
    }};
    const scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker});
    try{
      registry.set('x',Float64Array.of(50,60));registry.set('y',Float64Array.of(50,60));registry.set('new',Float64Array.of(70,80));
      await scheduler.query('current','scatter','x','y',query,registry);await scheduler.query('new-layer','scatter','new','y',query,registry);
      const count=sent.length,result=await scheduler.querySelection('old-selection','x','y',{x:[0,3],y:[0,3]},historical);
      expect(Array.from(result.indices)).toEqual([0,1]);expect(result.count).toBe(2);expect(sent.length).toBe(count);expect(scheduler.stats.worker).toBe(true);
    }finally{scheduler.dispose();}
  });
  it('sends only new chunks after the initial registration without evaluating lazy source values',async()=>{
    const sent:WorkerRequest[]=[];let reads=0;
    const fake={onmessage:null as ((event:MessageEvent<WorkerResponse>)=>void)|null,onerror:null,onmessageerror:null,terminate(){},postMessage(message:WorkerRequest){
      sent.push(message);if(message.type==='query')queueMicrotask(()=>fake.onmessage?.({data:{type:'result',requestId:message.requestId,result:{kind:'points',indices:new Uint32Array(),info:{kind:'points',total:0,visible:0,rendered:0,exact:true,method:'test'}}}} as MessageEvent<WorkerResponse>));
    }};
    const registry=arrays(),scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker});
    const first=Float64Array.of(1,2),second=Float64Array.of(3,4),added=Float64Array.of(5);
    const install=(version:number,chunks:Float64Array[])=>{const entry=chunkEntry(describeData('x',new Float64Array(chunks.reduce((n,c)=>n+c.length,0)),undefined,version),chunks);registry.store.set('x',{descriptor:entry.descriptor,chunks:entry.chunks,get values(){reads++;return entry.values;}});};
    try{
      install(1,[first,second]);await scheduler.query('line','scatter','x','y',query,registry);
      install(2,[second,added]);await scheduler.query('line','scatter','x','y',query,registry);
      const messages=sent.filter((message):message is Extract<WorkerRequest,{type:'register-chunks'}>=>message.type==='register-chunks');
      expect(messages).toHaveLength(2);expect(messages[1].baseVersion).toBe(1);expect(messages[1].parts[0]).toEqual({reuse:1,offset:0,length:2});
      expect(messages[1].parts[1]).toEqual({values:added});expect(reads).toBe(0);expect(scheduler.stats.transferredBytes).toBe(56);
    }finally{scheduler.dispose();}
  });

  it('keeps worker chunk identities for full reuse while trimmed views preserve previous queries',async()=>{
    const sent:WorkerResponse[]=[],get=vi.spyOn(DataRegistry.prototype,'get');
    vi.stubGlobal('postMessage',(message:WorkerResponse)=>sent.push(message));vi.stubGlobal('close',vi.fn());vi.stubGlobal('onmessage',null);
    try{
      await import('../../packages/core/src/worker');
      const receive=(data:WorkerRequest)=>(globalThis as unknown as {onmessage(event:{data:WorkerRequest}):void}).onmessage({data});
      const register=(id:string,version:number,length:number,parts:Extract<WorkerRequest,{type:'register-chunks'}>['parts'],baseVersion?:number)=>receive({type:'register-chunks',descriptor:describeData(id,new Float64Array(length),undefined,version),parts,baseVersion});
      const run=async(requestId:number)=>{
        const start=get.mock.results.length;receive({type:'query',requestId,key:'line',kind:'line',xId:'x',yId:'y',query});
        const x=get.mock.results[start].value,y=get.mock.results[start+1].value;
        await vi.waitFor(()=>expect(sent.some(message=>message.type==='result'&&message.requestId===requestId)).toBe(true));
        return {x,y};
      };
      register('x',1,6,[{values:Float64Array.of(0,1,2,3)},{values:Float64Array.of(4,5)}]);
      register('y',1,6,[{values:Float64Array.of(1,2,3,4)},{values:Float64Array.of(5,6)}]);
      const initial=await run(1);
      for(const id of ['x','y'])register(id,2,5,[{reuse:0,offset:1,length:3},{reuse:1,offset:0,length:2}],1);
      const trimmed=await run(2);
      for(const axis of ['x','y'] as const){
        expect(trimmed[axis].chunks[1]).toBe(initial[axis].chunks[1]);
        expect(trimmed[axis].chunks[0]).not.toBe(initial[axis].chunks[0]);expect(trimmed[axis].chunks[0].buffer).toBe(initial[axis].chunks[0].buffer);
        expect(trimmed[axis].chunks[0].byteOffset).toBe(initial[axis].chunks[0].byteOffset+Float64Array.BYTES_PER_ELEMENT);
      }
      expect([...initial.x.values]).toEqual([0,1,2,3,4,5]);expect([...trimmed.x.values]).toEqual([1,2,3,4,5]);
      expect([...initial.y.values]).toEqual([1,2,3,4,5,6]);expect([...trimmed.y.values]).toEqual([2,3,4,5,6]);
      for(const id of ['x','y'])register(id,3,5,[{reuse:0,offset:0,length:3},{reuse:1,offset:0,length:2}],2);
      const reused=await run(3);
      for(const axis of ['x','y'] as const)for(let index=0;index<2;index++)expect(reused[axis].chunks[index]).toBe(trimmed[axis].chunks[index]);
      expect(sent.filter(message=>message.type==='error'||message.type==='sync-error')).toEqual([]);receive({type:'dispose'});
    }finally{get.mockRestore();vi.unstubAllGlobals();}
  });

  it('falls back after a message decoding failure and settles the pending query',async()=>{
    const fake={onmessage:null,onerror:null,onmessageerror:null as (()=>void)|null,postMessage(){},terminate:vi.fn()};
    const scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker});
    try{const pending=scheduler.query('points','scatter','x','y',query,arrays());fake.onmessageerror?.();expect((await pending).info.visible).toBe(2);expect(scheduler.stats.worker).toBe(false);expect(fake.terminate).toHaveBeenCalledOnce();}finally{scheduler.dispose();}
  });

  it('recovers a silent worker startup without leaving ready work pending',async()=>{
    vi.useFakeTimers();const fake={onmessage:null,onerror:null,onmessageerror:null,postMessage(){},terminate(){}};
    const scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker,workerStartupTimeoutMs:20,workerStallTimeoutMs:50});
    try{const pending=scheduler.query('points','scatter','x','y',query,arrays());await vi.advanceTimersByTimeAsync(30);expect((await pending).info.visible).toBe(2);expect(scheduler.stats.pending).toBe(0);expect(scheduler.stats.worker).toBe(false);}finally{scheduler.dispose();vi.useRealTimers();}
  });
});

describe('bounded interactive queries',()=>{
  it('counts every selected row while bounding the preview and filtering missing scalar colors',async()=>{
    const x=new Float64Array(15000).fill(2),y=x.slice(),color=x.slice();color[0]=NaN;
    const result=await runSteps(selectionSteps(x,y,query.bounds,color));expect(result.count).toBe(14999);expect(result.indices).toHaveLength(10000);expect(result.indices[0]).toBe(1);expect(result.truncated).toBe(true);
  });
  it('cancels an independent selection before consuming another data chunk',async()=>{
    const x=new Float64Array(200000);let cancel=false;const pending=runSteps(selectionSteps(x,x,query.bounds),()=>cancel);cancel=true;await expect(pending).rejects.toMatchObject({name:'AbortError'});
  });
  it('limits hover candidates to neighboring screen cells while retaining exact source indices',async()=>{
    const x=Float64Array.from({length:1000},(_,i)=>i),y=new Float64Array(1000).fill(5),indices=Uint32Array.from({length:1000},(_,i)=>i);
    const index=await runSteps(hoverIndexSteps(x,y,[indices],{x:[0,1000],y:[0,10]},1000,100,'linear','linear'));
    const found=hoverCandidates(index,501,50);expect(found).toContain(501);expect(found.length).toBeLessThan(60);expect(found).not.toContain(100);
  });
});
