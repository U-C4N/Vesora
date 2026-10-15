import {expect,it} from 'vitest';
import {chunkEntry,describeData} from '../../packages/core/src/data';
import {LineIndexCache} from '../../packages/core/src/line-index';
import {planLine} from '../../packages/core/src/planning';
import type {DataEntry,NumericArray,Query} from '../../packages/core/src/types';

const base:Query={bounds:{x:[0,1],y:[-2,2]},width:32,height:120,xScale:'linear',yScale:'linear',pointBudget:100_000,mode:'auto'};
function finish<T>(steps:Generator<void,T>):T{while(true){const next=steps.next();if(next.done)return next.value;}}
function partition(id:string,values:NumericArray,cuts:number[]=[]):DataEntry{
  const edges=[0,...cuts,values.length],chunks=edges.slice(1).map((end,index)=>values.subarray(edges[index],end) as NumericArray);
  const entry=chunkEntry(describeData(id,values),chunks);
  return {descriptor:entry.descriptor,chunks:entry.chunks,get values():NumericArray{throw new Error('Indexed planner materialized immutable chunks');}};
}

it('retains the first normalized extrema across chunk and eight-row leaf boundaries',()=>{
  const count=2048,x=Float64Array.from({length:count},(_,i)=>i/(count-1)),y=new Float64Array(count).fill(10_000);
  y[8]=64;y[511]=0;y[1025]=-64;y[63]=19_968;y[1500]=20_000;y[1537]=20_032;
  const query={...base,width:1,bounds:{x:[-100,100] as [number,number],y:[-1e18,1e18] as [number,number]}};
  const cache=new LineIndexCache();
  try{
    const actual=finish(cache.plan(partition('x',x,[0,7,64,512,1000]),partition('y',y,[8,9,63,64,511,1024,1536]),query,true));
    expect(actual).toEqual(planLine(x,y,query));expect(actual?.segments.map(segment=>Array.from(segment))).toEqual([[0,8,63,count-1]]);
  }finally{cache.clear();}
});

it.each([.5,1,17.5,31])('matches exact pixel buckets with large-offset x and viewport width %s',width=>{
  const count=4096,x=Float64Array.from({length:count},(_,i)=>1e12+i/8192),y=Float64Array.from({length:count},(_,i)=>((i*37)%101)/50-1);
  const query={...base,width,bounds:{x:[1e12,1e12+1] as [number,number],y:[-2,2] as [number,number]}},cache=new LineIndexCache();
  try{expect(finish(cache.plan(partition('x',x,[1,8,1001,2048]),partition('y',y,[0,17,1000,3000]),query,true))).toEqual(planLine(x,y,query));}
  finally{cache.clear();}
});

it.each([Float32Array,Int16Array,Uint32Array])('does not prune partial nodes using out-of-bucket extrema for %s',Constructor=>{
  const count=513,x=Float64Array.from({length:count},(_,i)=>i),y=new Constructor(Array.from({length:count},(_,i)=>(i*7)%97));
  y[39]=0;y[40]=96;y[78]=0;y[79]=96;
  const query={...base,width:13.7,bounds:{x:[0,count-1] as [number,number],y:[0,100] as [number,number]}},cache=new LineIndexCache();
  try{expect(finish(cache.plan(partition('x',x,[1,10,129,401]),partition('y',y,[3,41,81,402]),query,true))).toEqual(planLine(x,y,query));}
  finally{cache.clear();}
});

it('uses the existing half-value normalization for overflowing finite domains',()=>{
  const count=128,x=Float64Array.from({length:count},(_,i)=>i),y=new Float64Array(count).fill(1e308);
  const cache=new LineIndexCache(),query={...base,width:4,bounds:{x:[0,count-1] as [number,number],y:[-1e308,1e308] as [number,number]}};
  try{expect(finish(cache.plan(partition('x',x),partition('y',y),query,true))).toEqual(planLine(x,y,query));}
  finally{cache.clear();}
});

it('keeps offset subviews and older frozen chunks independent when they share backing buffers',()=>{
  const count=1024,x=Float64Array.from({length:count},(_,i)=>i),y=Float64Array.from({length:count},(_,i)=>Math.sin(i*.3));
  const before=y.slice(),oldX=partition('x',x),oldY=partition('y',y),query={...base,width:16,bounds:{x:[0,count-1] as [number,number],y:[-2,2] as [number,number]}},cache=new LineIndexCache();
  try{
    expect(finish(cache.plan(oldX,oldY,query,true))).toEqual(planLine(x,y,query));
    const retainedX=x.subarray(257,770),retainedY=y.subarray(257,770);
    expect(finish(cache.plan(partition('x',retainedX),partition('y',retainedY),query,true))).toEqual(planLine(retainedX,retainedY,query));
    expect(finish(cache.plan(oldX,oldY,query,true))).toEqual(planLine(x,y,query));expect(y).toEqual(before);
    expect(cache.diagnostics().hits).toBeGreaterThan(0);
  }finally{cache.clear();}
  expect(cache.diagnostics().indexBytes).toBe(0);expect(cache.diagnostics().retainedBytes).toBe(0);
  // Clearing the index releases its references without detaching source storage.
  expect(y).toEqual(before);expect(oldY.chunks?.[0].buffer).toBe(y.buffer);
});
