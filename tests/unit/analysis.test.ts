import {describe,it,expect} from 'vitest';
import {Figure,subplots} from '../../packages/core/src/figure';
import {createRunComparison,linkObservations,validateObservationGroups} from '../../packages/core/src/analysis';

describe('run comparison source alignment',()=>{
  it('defaults to exact event-shifted matches and declares input lineage',()=>{
    const source=new Float64Array([2,6]),runs=[{id:'a',x:[10,11,12],y:[1,2,3],eventOffset:10,unit:'K'},{id:'b',x:[20,22],y:source,eventOffset:20,unit:'K'}];
    const exact=createRunComparison(runs);source[0]=99;
    expect(exact.rows.map(row=>row.values.b)).toEqual([2,null,6]);expect(exact.runs[1].y[0]).toBe(2);
    expect(exact.rows.map(row=>row.deltas.b)).toEqual([1,null,3]);expect(exact.lineage.parameters.unitConversion).toBe(false);
  });
  it('interpolates only adjacent finite samples within a declared gap',()=>{
    const runs=[{id:'a',x:[0,1,2,3],y:[0,0,0,0]},{id:'b',x:[0,2,4],y:[2,6,NaN]}];
    const linear=createRunComparison(runs,{alignment:'linear',maxGap:2});
    expect(linear.rows[1].samples.b).toEqual({value:4,sourceIndices:[0,1],interpolated:true});expect(linear.rows[3].values.b).toBeNull();
    expect(createRunComparison(runs,{alignment:'linear',maxGap:1}).rows[1].values.b).toBeNull();
    expect(createRunComparison(runs,{alignment:'nearest',tolerance:1}).rows[1].samples.b.sourceIndices).toEqual([0]);
  });
  it('rejects duplicates, unsorted x, incompatible units and unknown offset runs',()=>{
    const runs=[{id:'a',x:[0,1],y:[1,2],unit:'K'},{id:'b',x:[0,1],y:[3,4],unit:'C'}];
    expect(()=>createRunComparison(runs)).toThrow(/units differ/);expect(createRunComparison(runs,{allowUnitMismatch:true}).rows[0].deltas.b).toBe(2);
    expect(()=>createRunComparison([{...runs[0],x:[1,1]}, {...runs[1],unit:'K'}])).toThrow(/increasing/);
    expect(()=>createRunComparison([runs[0],{...runs[1],id:'a'}])).toThrow(/unique/);
    expect(()=>createRunComparison(runs,{allowUnitMismatch:true,eventOffsets:{missing:2}})).toThrow(/Unknown/);
  });
  it('keeps finite interpolation across extreme signed domains and accepts ordinary ID strings',()=>{
    const result=createRunComparison([{id:'a',x:[0],y:[0]},{id:'toString',x:[-1e308,1e308],y:[-1,1]}],{alignment:'linear',eventOffsets:{}});
    expect(result.rows[0].values.toString).toBe(0);expect(result.rows[0].samples.toString.interpolated).toBe(true);
  });
  it('reports dimensionless ratios while retaining residual deltas and masking zero or missing reference values',()=>{
    const result=createRunComparison([{id:'reference',x:[0,1,2,3,4],y:[0,2,NaN,1e-308,-2]},{id:'candidate',x:[0,1,2,3,4],y:[1,6,3,1e308,4]}]);
    expect(result.rows.map(row=>row.ratios.candidate)).toEqual([null,3,null,null,-2]);
    expect(result.rows.map(row=>row.deltas.candidate)).toEqual([1,4,null,1e308,6]);
    expect(result.rows[1].ratios.reference).toBe(1);expect(result.rows[0].ratios.reference).toBeNull();
  });
});

describe('observation dictionaries and complete queries',()=>{
  it('maps differing layer order by explicit ID, with complete bounded pages and revision fences',()=>{
    const fig=subplots({rows:1,cols:2}),left=fig.scatter([1,2,3],[2,3,4]),right=fig.panel(0,1).scatter([30,10,20],[4,2,3]);
    const link=linkObservations(fig,{datasetId:'trial',rowIds:['a','b','c'],members:[{layer:left},{layer:right,rowIds:['c','a','b']}]});
    link.setPredicate({layerId:right.id,ranges:{x:[10,20]}});const first=link.query({limit:1});
    expect(first.ids).toEqual(['a']);expect(first.total).toBe(2);expect(link.query({offset:1,revision:first.revision}).ids).toEqual(['b']);
    link.selectIds([]);expect(link.query().total).toBe(0);expect(()=>link.query({revision:first.revision})).toThrow(/STALE/);
    link.clear();expect(link.query().active).toBe(false);expect(link.query().total).toBe(3);
    const snapshot=fig.snapshot();expect(snapshot.figure.observationGroups![0].members[1].rowIds).toEqual(['c','a','b']);
    link.dispose();link.dispose();expect(fig.spec.observationGroups).toBeUndefined();fig.close();
  });
  it('queries all 12005 selected records without pretending the event preview is complete',()=>{
    const fig=new Figure(),count=12005,values=Array.from({length:count},(_,i)=>i),layer=fig.scatter(values,values);
    const link=linkObservations(fig,{datasetId:'large',rowIds:values.map(i=>`r${i}`),members:[{layer}]});
    fig.emit('selection',{kind:'points',layerId:layer.id,indices:values.slice(0,10000),count,truncated:true});
    expect(link.query().active).toBe(false);
    link.selectBounds(layer.id,{x:[0,count],y:[0,count]});const page=link.query({limit:10000});
    expect(page.total).toBe(count);expect(link.query({offset:10000,limit:10000,revision:page.revision}).ids).toHaveLength(2005);
    link.dispose();fig.close();
  });
  it('resolves ECDF ties from all original source indices in a full geometric predicate',()=>{
    const fig=new Figure(),layer=fig.ecdf([2,1,2,3]),link=linkObservations(fig,{datasetId:'trial',rowIds:['r0','r1','r2','r3'],members:[{layer}]});
    fig.emit('selection',{kind:'points',layerId:layer.id,indices:[],count:0,truncated:true,bounds:{x:[1.9,2.1],y:[0,1]}} as any);
    expect(link.query().ids).toContain('r0');expect(link.query().ids).toContain('r2');
    link.dispose();fig.close();
  });
  it('brushes parallel dimensions in source units and rejects cell/window joins',()=>{
    const fig=new Figure(),layer=fig.parallelCoordinates({cost:[3,1,2],quality:[4,3,5]});
    const link=linkObservations(fig,{datasetId:'trial',rowIds:['a','b','c'],members:[{layer}]});
    link.setPredicate({layerId:layer.id,ranges:{cost:[1,2],quality:[4,5]}});expect(link.query().ids).toEqual(['c']);link.dispose();fig.close();
    const grid=new Figure(),spectrogram=grid.spectrogram([0,1],[10],[[1],[2]]);
    expect(()=>linkObservations(grid,{datasetId:'x',rowIds:['a','b'],members:[{layer:spectrogram}]})).toThrow(/Cell\/window/);grid.close();
  });
  it('validates dictionaries atomically, owns caller mappings, and cleans up after figure close',()=>{
    const fig=new Figure(),layer=fig.scatter([1,2],[3,4]),ids=['a','b'],initial=fig.snapshot();
    expect(()=>linkObservations(fig,{datasetId:'trial',rowIds:['a','a'],members:[{layer}]})).toThrow(/unique/);expect(fig.snapshot()).toEqual(initial);
    const link=linkObservations(fig,{datasetId:'trial',rowIds:ids,members:[{layer}]});ids[0]='changed';expect(link.query().ids).toEqual(['a','b']);
    const bad=structuredClone(fig.spec.observationGroups!);bad[0].members[0].rowIds.pop();expect(()=>validateObservationGroups(bad,fig.spec,fig.registry)).toThrow(/match source rows/);
    fig.close();link.dispose();
  });
  it('invalidates a live query after source replacement even when imported descriptors reuse IDs and versions',()=>{
    const fig=new Figure(),layer=fig.scatter([1,2],[3,4]),link=linkObservations(fig,{datasetId:'d',rowIds:['a','b'],members:[{layer}]});
    const snapshot=fig.snapshot(),buffers=new Map([...fig.registry.entries()].map(([id,entry])=>[id,entry.values.slice().buffer as ArrayBuffer]));
    new Float64Array(buffers.get(layer.spec.data.x)!)[0]=99;fig.applySnapshot(snapshot,buffers);
    expect(()=>link.query()).toThrow(/STALE/);link.dispose();fig.close();
  });
});
