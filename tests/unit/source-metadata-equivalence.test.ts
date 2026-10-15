import {describe,expect,it} from 'vitest';
import {chunkEntry,describeData} from '../../packages/core/src/data';
import {ascending,entryExtent} from '../../packages/core/src/source-metadata';
import type {DataEntry,NumericArray} from '../../packages/core/src/types';

const scales=['linear','log','time'] as const;
function check(source:DataEntry,values:NumericArray):void {
  const all=Array.from(values);
  for(const scale of scales){
    const valid=all.filter(value=>Number.isFinite(value)&&(scale!=='log'||value>0)&&(scale!=='time'||Math.abs(value)<=8.64e15));
    const actual=entryExtent(source,scale);
    if(!valid.length)expect(actual,scale).toBeUndefined();
    else{
      expect(actual).toBeDefined();
      // Object.is checks signed zero as well as ordinary numeric extrema.
      expect(Object.is(actual![0],Math.min(...valid)),`${scale} minimum`).toBe(true);
      expect(Object.is(actual![1],Math.max(...valid)),`${scale} maximum`).toBe(true);
    }
  }
  expect(ascending(source)).toBe(all.every((value,index)=>Number.isFinite(value)&&(index===0||value>all[index-1])));
}
function checkBoth(values:NumericArray):void {
  const descriptor=describeData('source',values);
  check({descriptor,values},values);
  const boundary=Math.floor(values.length/2),chunks=chunkEntry(descriptor,[values.subarray(0,boundary) as NumericArray,values.subarray(boundary) as NumericArray]);
  check(chunks,values);expect(chunks.materializedByteLength).toBe(0);
}

describe('metadata numerical equivalence',()=>{
  it('preserves signed zero regardless of encounter order and chunk boundaries',()=>{
    for(const values of [[-0],[0],[-0,0],[0,-0],[-0,0,-0],[0,-0,0],[-1,-0,0,1]])checkBoth(Float64Array.from(values));
  });
  it('keeps finite, positive and inclusive time domains distinct',()=>{
    for(const values of [[],[NaN,Infinity,-Infinity],[-Number.MAX_VALUE,-8.64e15,-1,-0,0,Number.MIN_VALUE,1,8.64e15,Number.MAX_VALUE,NaN,Infinity],[-9e15,9e15],[-3,-2,-1]])checkBoth(Float64Array.from(values));
  });
  it('keeps strict ordering false after a duplicate, descent or non-finite sample',()=>{
    for(const values of [[-3,-2,-1,0,1,2],[1,1,2,3],[1,3,2,4],[NaN,1,2],[1,NaN,2],[1,2,NaN],[1,2,Infinity],[-Infinity,1,2]])checkBoth(Float64Array.from(values));
  });
  for(const Constructor of [Float64Array,Float32Array,Int32Array,Uint32Array,Int16Array,Uint16Array,Int8Array,Uint8Array]){
    it(`matches independently filtered extrema for ${Constructor.name}`,()=>{
      let seed=71237;
      const values=new Constructor(2048);
      for(let index=0;index<values.length;index++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        values[index]=(seed/0xffffffff-.5)*100000;
      }
      if(Constructor===Float64Array||Constructor===Float32Array){values[0]=-0;values[1]=0;values[2]=NaN;values[3]=Infinity;values[4]=-Infinity;values[5]=8.64e15;values[6]=-8.64e15;}
      checkBoth(values);
    });
  }
});
