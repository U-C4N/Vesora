import {describe,expect,it} from 'vitest';
import {chunkEntry,describeData} from '../../packages/core/src/data';
import {LineIndexCache} from '../../packages/core/src/line-index';
import {lineSteps} from '../../packages/core/src/planning';
import type {DataEntry,LineResult,NumericArray,Query} from '../../packages/core/src/types';

const query=(patch:Partial<Query>={}):Query=>({bounds:{x:[0,1],y:[-2,2]},width:32,height:200,xScale:'linear',yScale:'linear',pointBudget:10000,mode:'auto',...patch});
function finish<T>(steps:Generator<void,T>):T{while(true){const step=steps.next();if(step.done)return step.value;}}
function entry(id:string,chunks:NumericArray[],version=0):DataEntry{
  const length=chunks.reduce((n,chunk)=>n+chunk.length,0),descriptor=describeData(id,new Float64Array(length),undefined,version);
  return chunkEntry(descriptor,chunks);
}
function split(values:Float64Array,sizes:number[]):Float64Array[]{let offset=0;return sizes.map(size=>{const chunk=values.slice(offset,offset+size);offset+=size;return chunk;});}
function exact(cache:LineIndexCache,x:DataEntry,y:DataEntry,q:Query):LineResult{
  const expected=finish(lineSteps(x,y,q,true)),actual=finish(cache.plan(x,y,q,true));
  expect(actual).toEqual(expected);expect(actual).toBeDefined();return actual!;
}
function random(seed=139){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x1_0000_0000;};}

describe('exact immutable-chunk line index',()=>{
  it('matches every retained index and representation field across random independent chunk partitions',()=>{
    const rng=random(),cache=new LineIndexCache();
    for(let trial=0;trial<30;trial++){
      const length=1000+Math.floor(rng()*5000),x=Float64Array.from({length},(_,i)=>i/(length-1)),y=Float64Array.from({length},()=>rng()*4-2);
      const partition=()=>{const sizes:number[]=[];let remaining=length;while(remaining){const size=Math.min(remaining,1+Math.floor(rng()*151));sizes.push(size);remaining-=size;if(rng()<.2)sizes.push(0);}return sizes;};
      const xs=entry('x',split(x,partition())),ys=entry('y',split(y,partition()));
      const q=query({width:1+rng()*90});exact(cache,xs,ys,q);const builds=cache.diagnostics().builds;
      exact(cache,xs,ys,q);expect(cache.diagnostics().builds).toBe(builds);expect(cache.diagnostics().hits).toBeGreaterThan(0);
    }
  });

  it('finds the earliest normalized extremum rather than the raw extremum',()=>{
    const length=256,x=entry('x',[Float64Array.from({length},(_,i)=>i)]),values=new Float64Array(length).fill(10000);
    values[0]=10000;values[1]=64;values[2]=0;values[length-1]=20000;
    const y=entry('y',split(values,[8,17,231])),q=query({bounds:{x:[0,length],y:[-1e18,1e18]},width:1});
    const result=exact(new LineIndexCache(),x,y,q);
    expect([...result.segments[0]]).toEqual([0,1,255]);
  });

  it('preserves exact ties when an overflowing span collapses all y values',()=>{
    const x=entry('x',[Float64Array.from({length:128},(_,i)=>i)]),y=entry('y',[Float64Array.from({length:128},(_,i)=>[2,1,3,4][i%4])]);
    const result=exact(new LineIndexCache(),x,y,query({bounds:{x:[0,128],y:[-1e308,1e308]},width:1}));
    expect([...result.segments[0]]).toEqual([0,127]);
  });

  it('handles overflowing finite domains, adjacent large values, subnormal values, and time bounds',()=>{
    const cases:Array<{x:Float64Array;y:Float64Array;q:Query}>=[
      {x:Float64Array.from({length:512},(_,i)=>(i/511*2-1)*1e308),y:Float64Array.from({length:512},(_,i)=>Math.sin(i)*1e308),q:query({bounds:{x:[-1e308,1e308],y:[-1e308,1e308]},width:64})},
      {x:Float64Array.from({length:512},(_,i)=>1e16+i*2),y:Float64Array.from({length:512},(_,i)=>1e16+(i%17)*2),q:query({bounds:{x:[1e16,1e16+1024],y:[1e16,1e16+34]},width:64})},
      {x:Float64Array.from({length:512},(_,i)=>i*Number.MIN_VALUE),y:Float64Array.from({length:512},(_,i)=>(i%8)*Number.MIN_VALUE),q:query({bounds:{x:[0,512*Number.MIN_VALUE],y:[0,8*Number.MIN_VALUE]},width:64})},
      {x:Float64Array.from({length:512},(_,i)=>8.64e15-1024+i),y:Float64Array.from({length:512},(_,i)=>-8.64e15+i%17),q:query({bounds:{x:[8.64e15-1024,8.64e15],y:[-8.64e15,-8.64e15+100]},xScale:'time',yScale:'time',width:64})},
    ];
    for(const {x,y,q} of cases)exact(new LineIndexCache(),entry('x',split(x,[0,7,301,204])),entry('y',split(y,[99,0,1,412])),q);
  });

  it('falls back for mutable arrays, unsupported scales, sparse queries, clipping, and gaps',()=>{
    const values=Float64Array.from({length:256},(_,i)=>i),x=entry('x',[values]),y=entry('y',[new Float64Array(256).fill(1)]),cache=new LineIndexCache(),q=query({bounds:{x:[0,256],y:[0,2]}});
    expect(finish(cache.plan({descriptor:x.descriptor,values},y,q,true))).toBeUndefined();
    expect(finish(cache.plan(x,y,q,false))).toBeUndefined();
    for(const patch of [{width:8193},{width:100},{bounds:{x:[1,256] as [number,number],y:[0,2] as [number,number]}},{bounds:{x:[0,256] as [number,number],y:[0,.5] as [number,number]}},{xScale:'log' as const,bounds:{x:[1,256] as [number,number],y:[0,2] as [number,number]}},{yScale:'log' as const,bounds:{x:[0,256] as [number,number],y:[.1,2] as [number,number]}}])expect(finish(cache.plan(x,y,{...q,...patch},true))).toBeUndefined();
    for(const invalid of [NaN,Infinity,-Infinity]){const withGap=new Float64Array(256).fill(1);withGap[127]=invalid;expect(finish(cache.plan(x,entry('gap',[withGap]),q,true))).toBeUndefined();}
    const outsideTime=new Float64Array(256).fill(9e15);
    expect(finish(cache.plan(x,entry('time',[outsideTime]),query({bounds:{x:[0,256],y:[0,8.64e15]},yScale:'time'}),true))).toBeUndefined();
  });

  it('throws the same vertex-budget error as the uncached planner',()=>{
    const x=entry('x',[Float64Array.from({length:256},(_,i)=>i/255)]),y=entry('y',[Float64Array.from({length:256},(_,i)=>Math.sin(i))]),q=query({pointBudget:2});
    let oracle:unknown;try{finish(lineSteps(x,y,q,true));}catch(error){oracle=error;}
    expect(()=>finish(new LineIndexCache().plan(x,y,q,true))).toThrowError((oracle as Error).message);
    expect(()=>finish(new LineIndexCache().plan(x,y,query({pointBudget:0}),true))).toThrow(/pointBudget/);
  });

  it('reuses unchanged blocks across rolling windows without altering a frozen old entry',()=>{
    const cache=new LineIndexCache(),q=query({bounds:{x:[0,1000],y:[-2,2]}}),chunks=Array.from({length:4},(_,j)=>Float64Array.from({length:128},(_,i)=>Math.sin((j*128+i)/13)));
    const oldX=entry('x',[Float64Array.from({length:512},(_,i)=>i)]),oldY=entry('y',chunks),old=exact(cache,oldX,oldY,q),builds=cache.diagnostics().builds;
    const newX=entry('x',[Float64Array.from({length:512},(_,i)=>64+i)],1),newY=entry('y',[chunks[0].subarray(64),...chunks.slice(1),Float64Array.from({length:64},(_,i)=>Math.sin((512+i)/13))],1);
    exact(cache,newX,newY,q);expect(cache.diagnostics().builds).toBe(builds+2);
    expect(exact(cache,oldX,oldY,q)).toEqual(old);
  });

  it('accounts shared full backing storage once and releases every retained byte on clear',()=>{
    const backing=new Float64Array(4096),chunks=[backing.subarray(0,256),backing.subarray(256,512)],x=entry('x',[Float64Array.from({length:512},(_,i)=>i/511)]),cache=new LineIndexCache();
    exact(cache,x,entry('y',chunks),query());const stats=cache.diagnostics();
    expect(stats.retainedBytes).toBe(backing.buffer.byteLength);expect(stats.indexBytes).toBe(2*(32*32+192));
    cache.clear();expect(cache.diagnostics()).toMatchObject({indexBytes:0,retainedBytes:0,builds:2});
    const tooSmall=new LineIndexCache(10000);expect(finish(tooSmall.plan(x,entry('y',chunks),query(),true))).toBeUndefined();
    expect(tooSmall.diagnostics()).toEqual({indexBytes:0,retainedBytes:0,builds:0,hits:0});
  });

  it('evicts least-recently used entries and refuses an oversized working set before allocation',()=>{
    const size=256,bytes=size*8+32*32+192,cache=new LineIndexCache(bytes*2),x=entry('x',[Float64Array.from({length:size},(_,i)=>i/(size-1))]),a=entry('a',[new Float64Array(size)]),b=entry('b',[new Float64Array(size).fill(1)]),c=entry('c',[new Float64Array(size).fill(-1)]),q=query();
    exact(cache,x,a,q);exact(cache,x,b,q);exact(cache,x,a,q);exact(cache,x,c,q);expect(cache.diagnostics().builds).toBe(3);
    exact(cache,x,a,q);expect(cache.diagnostics().builds).toBe(3);exact(cache,x,b,q);expect(cache.diagnostics().builds).toBe(4);
    expect(cache.diagnostics().indexBytes+cache.diagnostics().retainedBytes).toBeLessThanOrEqual(bytes*2);
    const tiny=new LineIndexCache(bytes-1);expect(finish(tiny.plan(x,a,q,true))).toBeUndefined();expect(tiny.diagnostics().builds).toBe(0);
    const many=entry('many',[...a.chunks!,...b.chunks!,...c.chunks!]),manyX=entry('mx',[Float64Array.from({length:size*3},(_,i)=>i/(size*3-1))]);
    const empty=new LineIndexCache(bytes*2);expect(finish(empty.plan(manyX,many,q,true))).toBeUndefined();expect(empty.diagnostics().builds).toBe(0);
    for(const budget of [-1,NaN,Infinity,.5])expect(()=>new LineIndexCache(budget)).toThrow(/budget/);
  });

  it('cooperates during initial construction and safely falls back after eviction while suspended',()=>{
    const size=131072,x=entry('x',[Float64Array.from({length:size},(_,i)=>i/(size-1))]),y=entry('y',[Float64Array.from({length:size},(_,i)=>Math.sin(i))]),cache=new LineIndexCache(),steps=cache.plan(x,y,query(),true);
    expect(steps.next().done).toBe(false);expect(cache.diagnostics().builds).toBe(1);
    cache.clear();expect(finish(steps)).toBeUndefined();expect(cache.diagnostics().indexBytes+cache.diagnostics().retainedBytes).toBe(0);
    const rebuilt=cache.plan(x,y,query(),true);let yields=0,result:LineResult|undefined;
    while(true){const next=rebuilt.next();if(next.done){result=next.value;break;}yields++;}
    expect(yields).toBe(2);expect(result).toEqual(finish(lineSteps(x,y,query(),true)));
  });

  it('suspends dense wide queries without retaining evicted tree references',()=>{
    const size=10000,x=entry('x',[Float64Array.from({length:size},(_,i)=>i/(size-1))]),y=entry('y',[Float64Array.from({length:size},(_,i)=>Math.sin(i))]),q=query({width:2048}),cache=new LineIndexCache(),steps=cache.plan(x,y,q,true);
    expect(steps.next().done).toBe(false);cache.clear();expect(finish(steps)).toBeUndefined();expect(cache.diagnostics().indexBytes).toBe(0);
    exact(cache,x,y,q);
  });

  it('shares an incomplete build safely between interleaved queries without duplicate reservations',()=>{
    const size=150000,x=entry('x',[Float64Array.from({length:size},(_,i)=>i/(size-1))]),y=entry('y',[Float64Array.from({length:size},(_,i)=>Math.sin(i))]),cache=new LineIndexCache(),q=query(),a=cache.plan(x,y,q,true),b=cache.plan(x,y,q,true);
    expect(a.next().done).toBe(false);const reserved=cache.diagnostics();expect(b.next().done).toBe(false);
    expect(cache.diagnostics()).toMatchObject({builds:1,indexBytes:reserved.indexBytes,retainedBytes:reserved.retainedBytes});
    const expected=finish(lineSteps(x,y,q,true));expect(finish(a)).toEqual(expected);expect(finish(b)).toEqual(expected);
    expect(cache.diagnostics().builds).toBe(1);
  });

  it('cannot repopulate a cleared cache when suspended exactly between complete chunks',()=>{
    const size=65536,x=entry('x',[Float64Array.from({length:size*2},(_,i)=>i/(size*2-1))]),y=entry('y',[new Float64Array(size),new Float64Array(size)]),cache=new LineIndexCache(),steps=cache.plan(x,y,query(),true);
    expect(steps.next().done).toBe(false);expect(cache.diagnostics().builds).toBe(1);cache.clear();
    expect(finish(steps)).toBeUndefined();expect(cache.diagnostics()).toEqual({indexBytes:0,retainedBytes:0,builds:1,hits:0});
  });

  it('locates exact pixel boundaries within, between, and after empty x chunks',()=>{
    const size=1025,values=Float64Array.from({length:size},(_,i)=>1e12+i/1024),ys=entry('y',[Float64Array.from({length:size},(_,i)=>Math.sin(i)*Math.cos(i/11))]);
    const chunks=split(values,[0,1,127,0,1,63,0,64,256,1,0,255,256,1,0]);
    expect(chunks.reduce((sum,chunk)=>sum+chunk.length,0)).toBe(size);
    const xs=entry('x',chunks),cache=new LineIndexCache();
    for(const width of [.5,1,8,17.5,128,255.5])exact(cache,xs,ys,query({bounds:{x:[1e12,1e12+1],y:[-2,2]},width}));
    // Every complete source chunk falls in the same normalized pixel column.
    exact(cache,xs,ys,query({bounds:{x:[-1e308,1e308],y:[-2,2]},width:64}));
  });

  it('falls back safely when another query evicts a prepared tree between pixel batches',()=>{
    const size=10000,x=entry('x',[Float64Array.from({length:size},(_,i)=>i/(size-1))]),a=entry('a',[Float64Array.from({length:size},(_,i)=>Math.sin(i))]),b=entry('b',[Float64Array.from({length:size},(_,i)=>Math.cos(i))]),bytes=size*8+2048*32+192,cache=new LineIndexCache(bytes),q=query({width:2048}),pending=cache.plan(x,a,q,true);
    expect(pending.next().done).toBe(false);exact(cache,x,b,query());
    expect(finish(pending)).toBeUndefined();expect(cache.diagnostics().builds).toBe(2);
    exact(cache,x,b,query());expect(cache.diagnostics().builds).toBe(2);
    expect(cache.diagnostics().indexBytes+cache.diagnostics().retainedBytes).toBe(bytes);
    exact(cache,x,a,q);expect(cache.diagnostics().builds).toBe(3);
  });
});
