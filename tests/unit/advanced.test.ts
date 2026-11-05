import {describe,it,expect} from 'vitest';
import {figure,subplots} from '../../packages/core/src/figure';
import {buildAdvancedGeometry,prepareAdvanced,queryECDF} from '../../packages/core/src/advanced';
import type {Layer} from '../../packages/core/src/figure';
import {linkObservations} from '../../packages/core/src/analysis';

function values(layer:Layer,key:string):number[]{return Array.from(layer.figure.registry.get(layer.spec.data[key]).values);}
function wire(fig:ReturnType<typeof figure>){const snapshot=fig.snapshot();const buffers=new Map([...fig.registry.entries()].map(([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer]));return {snapshot,buffers};}
let seed=53271;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;}

describe('advanced scientific source contracts',()=>{
  it('queries exact observed percentile ranks, inclusive thresholds and strict exceedances without altering raw samples',()=>{
    const samples=new Float64Array([50,1,1,NaN,3,Infinity,2,-Infinity]),before=samples.slice();
    expect(queryECDF(samples,{probability:0})).toMatchObject({count:5,omitted:3,quantile:1,sourceKind:'quantile-ties',sourceCount:2,sourceIndices:[1,2]});
    expect(queryECDF(samples,{probability:1})).toMatchObject({quantile:50,sourceIndices:[0]});
    const result=queryECDF(samples,{probability:.99,threshold:2});expect(result).toMatchObject({count:5,omitted:3,quantile:50,cumulativeCount:3,exceedanceCount:2,probability:.6,sourceKind:'at-or-below',sourceCount:3,sourceIndices:[1,2,6],truncated:false});
    expect(samples).toEqual(before);expect(queryECDF([...new Array(99).fill(1),10000],{probability:.99}).quantile).toBe(1);
  });
  it('bounds empirical identity previews while retaining complete counts and tied memberships',()=>{
    const samples=[NaN,...new Array(12001).fill(7),8],ties=queryECDF(samples,{probability:.5}),threshold=queryECDF(samples,{threshold:7});
    for(const result of [ties,threshold]){expect(result.sourceCount).toBe(12001);expect(result.sourceIndices).toHaveLength(10000);expect(result.sourceIndices[0]).toBe(1);expect(result.sourceIndices[9999]).toBe(10000);expect(result.truncated).toBe(true);}
    expect(threshold.cumulativeCount).toBe(12001);expect(threshold.exceedanceCount).toBe(1);expect(threshold.probability).toBe(12001/12002);
  });
  it('defines empty empirical queries and rejects invalid query parameters rather than fabricating results',()=>{
    expect(queryECDF([NaN,Infinity],{probability:.99,threshold:5})).toEqual({count:0,omitted:2,quantile:null,cumulativeCount:0,exceedanceCount:0,probability:null,sourceIndices:[],sourceCount:0,truncated:false,sourceKind:'at-or-below'});
    expect(queryECDF([1,2])).toEqual({count:2,omitted:0,sourceIndices:[],sourceCount:0,truncated:false,sourceKind:'none'});
    for(const probability of [-.1,1.1,NaN,Infinity])expect(()=>queryECDF([1],{probability})).toThrow(/probability/);
    for(const threshold of [NaN,Infinity,-Infinity])expect(()=>queryECDF([1],{threshold})).toThrow(/threshold/);
    expect(()=>queryECDF([1],{percentile:99} as never)).toThrow(/Unknown/);
  });
  it('retains empirical ties and matches brute-force ECDF/strict-CCDF probabilities',()=>{
    const fig=figure(),samples=Array.from({length:120},()=>Math.floor(random()*11)-5);samples.push(NaN,Infinity);
    for(const complementary of [false,true]){
      const layer=fig.ecdf(samples,{complementary}),prepared=prepareAdvanced(layer.spec,fig.registry);
      for(const item of prepared.items){const value=item.value as number,expected=samples.filter(Number.isFinite).filter(x=>complementary?x>value:x<=value).length/120;expect(item.probability).toBe(expected);expect((item.sourceIndices as number[]).every(index=>samples[index]===value)).toBe(true);}
      expect(prepared.info.valid).toBe(120);expect(prepared.info.omitted).toBe(2);expect(prepared.items).toHaveLength(new Set(samples.filter(Number.isFinite)).size);
    }fig.close();
  });
  it('agrees with brute-force dominance for all four objective directions, including duplicates',()=>{
    const x=Array.from({length:90},()=>Math.floor(random()*13)),y=Array.from({length:90},()=>Math.floor(random()*13));x.push(x[0]);y.push(y[0]);
    for(const first of ['min','max'] as const)for(const second of ['min','max'] as const){
      const fig=figure(),layer=fig.paretoFront(x,y,{objectives:[first,second]}),p=prepareAdvanced(layer.spec,fig.registry),sx=first==='min'?1:-1,sy=second==='min'?1:-1;
      for(const item of p.items){const i=item.sourceIndex!;const dominated=x.some((_,j)=>sx*x[j]<=sx*x[i]&&sy*y[j]<=sy*y[i]&&(x[j]!==x[i]||y[j]!==y[i]));expect(item.nondominated).toBe(!dominated);}
      fig.close();
    }
  });
  it('copies caller buffers, and rejects every invalid replacement before source/option mutation',()=>{
    const fig=figure(),x=new Float64Array([1,2]),lower=new Float64Array([.5,1.5]);const layer=fig.errorbar(x,[2,3],{xLower:lower,xUpper:[1.5,2.5]});x[0]=99;lower[0]=-99;
    expect(values(layer,'x')).toEqual([1,2]);expect(values(layer,'xLower')).toEqual([.5,1.5]);const before=wire(fig);
    expect(()=>layer.setData({xLower:[2,3]})).toThrow(/bounds/);expect(()=>layer.setData({oops:[1,2]})).toThrow(/channels/);expect(()=>layer.setOptions({capSize:-1})).toThrow();
    expect(fig.snapshot()).toEqual(before.snapshot);for(const [id,buffer]of before.buffers)expect(new Uint8Array(fig.registry.get(id).values.buffer)).toEqual(new Uint8Array(buffer));fig.close();
  });
  it('keeps bounded spectrogram rows, immutable captured buffers, exact intervals and invalid append atomicity',async()=>{
    const fig=figure(),layer=fig.spectrogram([0,1,2],[10,20],[[1,2],[3,4],[5,6]],{maxRows:2,valueScale:'db'}),before=fig.captureExport();
    expect(values(layer,'y')).toEqual([1,2]);expect(values(layer,'z')).toEqual([3,4,5,6]);expect(layer.spec.options).toMatchObject({sequenceStart:1,sequenceEnd:3});
    await layer.appendRows([3,4],[[7,8],[9,10]]);expect(values(layer,'y')).toEqual([3,4]);expect(values(layer,'z')).toEqual([7,8,9,10]);expect(layer.spec.options).toMatchObject({sequenceStart:3,sequenceEnd:5});
    const oldSource=before.registry.get(before.snapshot.figure.layers[0].data.z);expect(Array.from(oldSource.values)).toEqual([3,4,5,6]);
    const accepted=fig.snapshot();await expect(layer.appendRows([6],[[11,12]])).rejects.toThrow(/cadence/);await expect(layer.appendRows([5],[[-1,12]])).rejects.toThrow(/nonnegative/);expect(fig.snapshot()).toEqual(accepted);
    expect(fig.getStreamingState(layer.id)).toMatchObject({maxPoints:2,nextSequence:5,retained:2,evicted:3});layer.setOptions({maxRows:1});expect(values(layer,'y')).toEqual([4]);expect(layer.spec.options).toMatchObject({sequenceStart:0,sequenceEnd:1});before.release();fig.close();
  });
  it('masks contour cells and interpolates a planar grid without changing original scalar samples',()=>{
    const fig=figure(),layer=fig.contour([0,1],[0,1],[[0,1],[1,2]],{levels:[1]}),p=prepareAdvanced(layer.spec,fig.registry);
    expect(p.marks.length).toBeGreaterThan(0);for(const mark of p.marks)if(mark.kind==='segment'){expect(mark.x0+mark.y0).toBeCloseTo(1,12);expect(mark.x1+mark.y1).toBeCloseTo(1,12);}
    layer.setData({z:[[0,NaN],[1,2]]});expect(prepareAdvanced(layer.spec,fig.registry).marks).toHaveLength(0);expect(values(layer,'z')).toEqual([0,NaN,1,2]);
    const filled=fig.contourf([0,1],[0,1],[[0,1],[1,2]],{levels:[.5,1.5]}),f=prepareAdvanced(filled.spec,fig.registry);expect(f.marks.some(m=>m.kind==='polygon')).toBe(true);expect(f.info.exact).toBe(false);fig.close();
  });
  it('preserves typed spectrogram channel dtypes and rejects a narrowing or changing append atomically',async()=>{
    const fig=figure(),layer=fig.spectrogram(new Float32Array([0,1]),new Float64Array([10,20]),new Float32Array([1,2,3,4]),{maxRows:2});
    await layer.appendRows(new Float32Array([2]),new Float32Array([5,6]),{waitFor:'accepted'});expect(fig.registry.get(layer.spec.data.y).descriptor.dtype).toBe('float32');expect(fig.registry.get(layer.spec.data.z).descriptor.dtype).toBe('float32');
    const before=fig.snapshot();await expect(layer.appendRows([3],[7,8],{waitFor:'accepted'})).rejects.toThrow(/dtype/);expect(fig.snapshot()).toEqual(before);fig.close();
  });
  it('keeps special projection constraints and barycentric source values across protocol9 import',()=>{
    const fig=figure(),layer=fig.ternary([2,0],[0,2],[0,0],{sum:2}),p=prepareAdvanced(layer.spec,fig.registry);expect(fig.spec.view.projection).toBe('ternary');expect(p.marks.filter(m=>m.kind==='point').map(m=>m.kind==='point'?[m.x,m.y]:[])).toEqual([[0,0],[1,0]]);
    const before=fig.snapshot();expect(()=>fig.plot([0,1],[0,1])).toThrow(/Cartesian/);expect(()=>fig.setView({xScale:'log'})).toThrow();expect(fig.snapshot()).toEqual(before);
    const exported=wire(fig),restored=figure();restored.applySnapshot(exported.snapshot,exported.buffers);expect(restored.spec.protocolVersion).toBe(9);expect(values(new (layer.constructor as typeof Layer)(restored,layer.id),'a')).toEqual([2,0]);
    const bad=structuredClone(exported.snapshot);bad.figure.protocolVersion=8;expect(()=>restored.applySnapshot(bad,exported.buffers)).toThrow(/protocol version 9/);restored.close();fig.close();
    const shared=subplots({rows:1,cols:2,shareX:true});expect(()=>shared.panel(0,1).parallelCoordinates({a:[1,2],b:[3,4]})).toThrow(/share/);expect(shared.spec.layers).toHaveLength(0);shared.close();
  });
  it('creates all ten families on Figure/Panel with genuine geometry and raw-source picking items',()=>{
    const figs=Array.from({length:10},()=>figure()),layers=[figs[0].ccdf([1,1,2]),figs[1].spectrogram([0,1],[1,2],[[1,2],[3,4]]),figs[2].eventTimeline([{id:'start',start:0,lane:'A'},{id:'task',start:1,end:2,lane:'B'}]),figs[3].errorbar([1],[2],{yLower:[1],yUpper:[3]}),figs[4].contourf([0,1],[0,1],[[0,1],[1,2]],{levels:[1]}),figs[5].quiver([0],[0],[1],[1]),figs[6].parallelCoordinates({a:[1,2],b:[3,4]}),figs[7].paretoFront([1,2,3],[3,1,2]),figs[8].hysteresis([0,1,0],[0,1,2],{sequence:[1,2,3]}),figs[9].ternary([1],[1],[1],{normalize:true})];
    layers.forEach((layer,i)=>{const p=prepareAdvanced(layer.spec,figs[i].registry);expect(figs[i].spec.protocolVersion).toBe(9);expect(p.info.valid).toBeGreaterThan(0);if(layer.spec.kind!=='spectrogram'){const geometry=buildAdvancedGeometry(p,p.bounds,figs[i].spec.view,640,400,layer.spec.style);expect(geometry.positions.length).toBeGreaterThan(0);expect([...geometry.positions].every(Number.isFinite)).toBe(true);expect(p.items.some(item=>item.sourceIndex!==undefined)).toBe(true);}const {snapshot,buffers}=wire(figs[i]),restored=figure();restored.applySnapshot(snapshot,buffers);expect(restored.snapshot()).toEqual(snapshot);restored.close();figs[i].close();});
    const grid=subplots({rows:1,cols:2});grid.panel(0,0).ecdf([1,2]);grid.panel(0,1).phasePortrait([0,1],[1,0]);expect(grid.spec.layers.map(l=>l.panelId??'main')).toEqual(['main','panel-0-1']);grid.close();
  });
  it('keeps observation identity immutable until unlink and removes stale group references with a member',()=>{
    const fig=figure(),layer=fig.ecdf([3,1,2]),group=linkObservations(fig,{datasetId:'test',rowIds:['a','b','c'],members:[{layer}]});group.selectIds(['b']);
    const before=fig.snapshot();expect(()=>layer.setData({samples:[9,8,7]})).toThrow(/observation group/i);expect(()=>layer.setOptions({complementary:true})).toThrow(/observation group/i);expect(fig.snapshot()).toEqual(before);
    const {snapshot,buffers}=wire(fig),copy=figure();copy.applySnapshot(snapshot,buffers);expect(copy.spec.observationGroups?.[0].selectedIds).toEqual(['b']);copy.close();
    layer.remove();expect(fig.spec.observationGroups).toBeUndefined();expect(()=>group.query()).toThrow(/removed/);fig.close();
  });
});
