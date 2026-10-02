import {describe,expect,it} from 'vitest';
import {Figure} from '../../packages/core/src/figure';

describe('public Figure semantic model',()=>{
  it('retains typed dtype, source identity and layer identity across updates',()=>{
    const figure=new Figure({title:'Precision'}),line=figure.plot(new Float64Array([1e12,1e12+.01]),new Float32Array([1,2]));
    const before=figure.snapshot(),id=line.id,xId=line.spec.data.x;
    expect(before.sources.find(source=>source.id===xId)?.dtype).toBe('float64');
    line.setData({x:new Float64Array([1e12,1e12+.02])}).setStyle({width:3});
    expect(line.id).toBe(id);expect(line.spec.data.x).toBe(xId);
    expect(figure.registry.get(xId).descriptor.version).toBe(2);
    expect(line.spec.style.width).toBe(3);expect(figure.spec.layers).toHaveLength(1);
    figure.close();expect(figure.registry.size).toBe(0);
  });
  it('rejects invalid coordinate updates without altering valid data',()=>{
    const figure=new Figure(),line=figure.plot([0,1],[2,3]);
    const before=figure.snapshot();
    expect(()=>line.setData({x:[0,1,2]})).toThrow(/equal lengths/);
    expect(figure.snapshot()).toEqual(before);
    expect(()=>figure.setView({xScale:'log',xDomain:[0,1]})).toThrow(/positive/);
    expect(figure.spec.view.xScale).toBe('linear');
  });
  it('normalizes grid shape and reconstructs a protocol snapshot',()=>{
    const figure=new Figure(),surface=figure.surface([0,1,2],[0,1],[[1,2,3],[4,5,6]]);
    const snapshot=figure.snapshot();
    expect(snapshot.figure.view.kind).toBe('3d');
    expect(snapshot.sources.find(source=>source.id===surface.spec.data.z)?.shape).toEqual([2,3]);
    const buffers=new Map(Array.from(figure.registry.entries(),([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer]));
    const copy=new Figure();copy.applySnapshot(snapshot,buffers);
    expect(copy.snapshot()).toEqual(snapshot);
    expect([...copy.registry.get(surface.spec.data.z).values]).toEqual([1,2,3,4,5,6]);
    expect(()=>copy.scatter([1],[2])).toThrow(/separate figures/);
  });
  it('releases only the removed layer sources',()=>{
    const figure=new Figure(),line=figure.plot([0,1],[0,1]);figure.scatter([2],[3]);
    expect(figure.registry.size).toBe(4);line.remove();
    expect(figure.registry.size).toBe(2);expect(figure.spec.layers).toHaveLength(1);
  });
  it('rejects transposed or implicit grid reshaping atomically',()=>{
    const figure=new Figure();
    expect(()=>figure.heatmap([0,1,2],[0,1],[[1,2],[3,4],[5,6]])).toThrow(/shape/);
    const layer=figure.heatmap([0,1,2],[0,1],[[1,2,3],[4,5,6]]),before=figure.snapshot();
    expect(()=>layer.setData({x:[0,1],y:[0,1,2]})).toThrow(/reshaped/);
    expect(figure.snapshot()).toEqual(before);
  });
  it('retains data sources referenced by other layers in imported scenes',()=>{
    const figure=new Figure(),first=figure.scatter([0,1],[0,1]);
    const second=figure.scatter([2,3],[2,3]);
    second.spec.data=first.spec.data;first.remove();
    expect(figure.registry.get(second.spec.data.x).values.length).toBe(2);
  });
});
