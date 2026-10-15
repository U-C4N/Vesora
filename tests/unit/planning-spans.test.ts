import {expect,it} from 'vitest';
import {chunkEntry,describeData} from '../../packages/core/src/data';
import {lineSteps,scatterSteps} from '../../packages/core/src/planning';
import type {DataEntry,NumericArray,Query} from '../../packages/core/src/types';

const query:Query={bounds:{x:[0,8],y:[-2,2]},width:320,height:180,xScale:'linear',yScale:'linear',pointBudget:200_000,mode:'points'};
function finish<T>(steps:Generator<void,T>):{result:T;yields:number}{
  let yields=0;while(true){const step=steps.next();if(step.done)return {result:step.value,yields};yields++;}
}
function partition(id:string,values:NumericArray,boundaries:number[]):DataEntry {
  const cuts=[0,...boundaries,values.length],chunks=cuts.slice(1).map((end,index)=>values.slice(cuts[index],end) as NumericArray);
  const entry=chunkEntry(describeData(id,values),chunks);
  // Any accidental fallback to the contiguous getter invalidates this test.
  return {descriptor:entry.descriptor,chunks:entry.chunks,get values():NumericArray{throw new Error('Planner materialized a chunked source');}};
}

it.each([Float64Array,Float32Array,Int32Array,Uint32Array,Int16Array,Uint16Array,Int8Array,Uint8Array])('aligns differently partitioned %s coordinates without copying',Constructor=>{
  const x=new Constructor([0,1,2,3,4,5,6,7,8]),y=new Float32Array([0,1,-1,0,2,-2,1,0,1]);
  const xe=partition('x',x,[0,1,1,4,6,9]),ye=partition('y',y,[2,5,5,7]);
  for(const mode of ['points','density','auto'] as const){
    const options={...query,mode};
    expect(finish(scatterSteps(xe,ye,options))).toEqual(finish(scatterSteps(x,y,options)));
  }
  expect(finish(lineSteps(xe,ye,query))).toEqual(finish(lineSteps(x,y,query)));
  expect(finish(lineSteps(xe,ye,query,true))).toEqual(finish(lineSteps(x,y,query,true)));
});

it('preserves crossing segments and NaN gaps at storage boundaries',()=>{
  const x=new Float64Array([-2,2,NaN,-2,2]),y=new Float64Array([0,0,0,1,1]);
  const options={...query,bounds:{x:[-1,1] as [number,number],y:[-2,2] as [number,number]}};
  const xe=partition('x',x,[1,2,2,3,4]),ye=partition('y',y,[0,3]);
  const result=finish(lineSteps(xe,ye,options)).result;
  expect(result.segments.map(segment=>Array.from(segment))).toEqual([[0,1],[3,4]]);
  expect(result.info.visible).toBe(0);
  expect(result).toEqual(finish(lineSteps(x,y,options)).result);
});

it('keeps sorted viewport neighbors when the clipped range starts inside a span',()=>{
  const x=Float64Array.from({length:15},(_,i)=>i),y=new Float64Array(15).fill(1);
  const options={...query,bounds:{x:[4.2,8.8] as [number,number],y:[0,2] as [number,number]}};
  const result=finish(lineSteps(partition('x',x,[2,5,8,9]),partition('y',y,[1,4,7,12]),options,true)).result;
  expect(result).toEqual(finish(lineSteps(x,y,options,true)).result);
  expect(Array.from(result.segments[0])).toEqual([4,5,6,7,8,9]);
});

it('handles empty sources and empty chunks without inventing a cooperative step',()=>{
  const empty=new Float64Array(0),xe=partition('x',empty,[0,0]),ye=partition('y',empty,[]);
  expect(finish(lineSteps(xe,ye,query,true))).toEqual(finish(lineSteps(empty,empty,query,true)));
  expect(finish(scatterSteps(xe,ye,query))).toEqual(finish(scatterSteps(empty,empty,query)));
  expect(finish(lineSteps(xe,ye,query)).yields).toBe(0);
  expect(finish(scatterSteps(xe,ye,query)).yields).toBe(0);
});

it.each([65_535,65_536,65_537])('yields by logical blocks, not storage spans, for %i rows',count=>{
  const x=Float64Array.from({length:count},(_,i)=>i),y=new Float32Array(count).fill(1);
  const xe=partition('x',x,[1,100,32_000,65_534]),ye=partition('y',y,[0,512,16_384,65_535]);
  const options={...query,bounds:{x:[0,count] as [number,number],y:[0,2] as [number,number]}};
  const expected=Math.ceil(count/65_536);
  const line=finish(lineSteps(xe,ye,options));
  expect(line.yields).toBe(expected);
  expect(line.result).toEqual(finish(lineSteps(x,y,options)).result);
  expect(finish(scatterSteps(xe,ye,{...options,mode:'density'})).yields).toBe(expected);
  const points=finish(scatterSteps(xe,ye,options));
  expect(points.yields).toBe(expected*2);
  if(points.result.kind!=='points')throw new Error('Expected exact original points');
  expect(points.result.indices.length).toBe(count);
  expect(points.result.indices[count-1]).toBe(count-1);
});

it('preserves gaps and extrema across the 65,536-row cooperative boundary',()=>{
  const count=65_540,x=Float64Array.from({length:count},(_,i)=>i),y=new Float64Array(count);
  y[65_534]=2;y[65_535]=NaN;y[65_536]=-2;
  const options={...query,bounds:{x:[0,count] as [number,number],y:[-3,3] as [number,number]}};
  const result=finish(lineSteps(partition('x',x,[16_384,65_536]),partition('y',y,[65_535,65_537]),options)).result;
  expect(result).toEqual(finish(lineSteps(x,y,options)).result);
  expect(result.segments).toHaveLength(2);
  expect(result.segments[0].at(-1)).toBe(65_534);
  expect(result.segments[1][0]).toBe(65_536);
});
