import {describe,expect,it} from 'vitest';
import {chunkEntry,describeData} from '../../packages/core/src/data';
import {ascending,entryExtent} from '../../packages/core/src/source-metadata';
import type {DataEntry,Domain,ScaleKind} from '../../packages/core/src/types';

const scales=['linear','log','time'] as const;
function entry(chunks:Float64Array[]):DataEntry {
  const length=chunks.reduce((total,chunk)=>total+chunk.length,0);
  return chunkEntry({id:'source',dtype:'float64',shape:[length],version:0,byteLength:length*8},chunks);
}
function expectBounds(source:DataEntry,expected:Record<ScaleKind,Domain|undefined>):void {
  for(const scale of scales)expect(entryExtent(source,scale),scale).toEqual(expected[scale]);
}

describe('chunk metadata ownership',()=>{
  it('keeps cached chunk bounds and old windows intact when shared chunks are merged and evicted',()=>{
    const left=Float64Array.of(-9e15,-10,-2),middle=Float64Array.of(1,2,3),right=Float64Array.of(4,5,9e15);
    const old=entry([left,middle]),next=entry([middle,right]),evicted=entry([right]);
    const oldBounds={linear:[-9e15,3],log:[1,3],time:[-10,3]} as const;
    for(const scale of scales)expect(entryExtent(old,scale)).toEqual(oldBounds[scale]);
    expectBounds(next,{linear:[1,9e15],log:[1,9e15],time:[1,5]});
    expectBounds(evicted,{linear:[4,9e15],log:[4,9e15],time:[4,5]});
    // A new entry using an already cached chunk must not inherit another
    // window's extrema through the first merged bound's mutable pair.
    expectBounds(entry([left]),{linear:[-9e15,-2],log:undefined,time:[-10,-2]});
    expectBounds(entry([middle]),{linear:[1,3],log:[1,3],time:[1,3]});
    for(const scale of scales)expect(entryExtent(old,scale)).toEqual(oldBounds[scale]);
    for(const source of [old,next,evicted]){
      expect(ascending(source)).toBe(true);
      expect(source.materializedByteLength).toBe(0);
    }
  });

  it('returns independent extent copies without exposing entry or shared chunk summaries',()=>{
    const shared=Float64Array.of(-4,1,2),source=entry([shared,Float64Array.of(5)]);
    const expected={linear:[-4,5],log:[1,5],time:[-4,5]} satisfies Record<ScaleKind,Domain>;
    for(const scale of scales){
      const first=entryExtent(source,scale)!,second=entryExtent(source,scale)!;
      expect(first).not.toBe(second);
      first[0]=-Infinity;first[1]=Infinity;second.reverse();
      expect(entryExtent(source,scale)).toEqual(expected[scale]);
    }
    expectBounds(entry([shared]),{linear:[-4,2],log:[1,2],time:[-4,2]});
    expect(ascending(source)).toBe(true);
  });

  const cases:Array<{name:string;chunks:number[][];sorted:boolean}>=[
    {name:'empty input',chunks:[[],[]],sorted:true},
    {name:'empty chunks between increasing values',chunks:[[],[-2,-1],[],[1,2],[]],sorted:true},
    {name:'duplicate chunk boundary',chunks:[[1,2],[],[2,3]],sorted:false},
    {name:'descending chunk boundary',chunks:[[1,3],[2,4]],sorted:false},
    {name:'descending values within a chunk',chunks:[[1],[3,2],[4]],sorted:false},
    {name:'NaN gaps and infinities',chunks:[[NaN,-Infinity],[-3,1],[Infinity,NaN]],sorted:false},
    {name:'no finite values',chunks:[[NaN],[],[Infinity,-Infinity]],sorted:false},
    {name:'no logarithmic values',chunks:[[-2,-1],[-0]],sorted:true},
    {name:'signed zero extrema',chunks:[[-0],[0]],sorted:false},
    {name:'inclusive time boundaries and excluded outer values',chunks:[[-9e15,-8.64e15],[],[0],[8.64e15,9e15]],sorted:true},
    {name:'no valid time values',chunks:[[-9e15],[9e15]],sorted:true},
  ];
  for(const {name,chunks,sorted} of cases)it(`matches contiguous metadata for ${name}`,()=>{
    const source=entry(chunks.map(chunk=>Float64Array.from(chunk))),values=Float64Array.from(chunks.flat());
    const contiguous={descriptor:describeData('contiguous',values),values};
    for(const scale of scales)expect(entryExtent(source,scale),scale).toEqual(entryExtent(contiguous,scale));
    expect(ascending(source)).toBe(sorted);expect(ascending(source)).toBe(ascending(contiguous));
    expect(source.materializedByteLength).toBe(0);
  });
});
