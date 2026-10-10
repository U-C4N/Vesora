import {describe,expect,it} from 'vitest';
import {Figure,subplots} from '../../packages/core/src/figure';
import type {Snapshot} from '../../packages/core/src/types';

const buffers=(f:Figure)=>new Map(Array.from(f.registry.entries(),([id,e])=>[id,e.values.buffer.slice(e.values.byteOffset,e.values.byteOffset+e.values.byteLength) as ArrayBuffer]));
const data=(f:Figure,id:string)=>Array.from(f.registry.get(id).values);

describe('statistical facade and transactions',()=>{
  it('stores raw histogram samples with explicit options and protocol 3',()=>{
    const f=new Figure(),h=f.hist(new Float32Array([1,2,NaN,3]),{density:true,cumulative:true});
    expect(h.spec.kind).toBe('hist');expect(h.spec.options).toEqual({bins:10,density:true,cumulative:true});
    expect(f.registry.get(h.spec.data.samples).descriptor.dtype).toBe('float32');
    expect(f.spec.protocolVersion).toBe(3);f.axhline(0);expect(f.spec.protocolVersion).toBe(3);
    h.setOptions({bins:[0,1,3]});expect(h.spec.options).toMatchObject({bins:[0,1,3]});
    const before=f.snapshot();expect(()=>h.setOptions({range:[0,3]})).toThrow();expect(f.snapshot()).toEqual(before);
    h.setData({samples:[3,4]});expect(data(f,h.spec.data.samples)).toEqual([3,4]);
    h.remove();expect(f.registry.size).toBe(0);expect(f.spec.protocolVersion).toBe(3);
  });
  it('validates histogram inputs before allocation',()=>{
    for(const options of [{bins:0},{bins:1.2},{bins:1e9},{bins:[0,0]},{bins:[0,Infinity]},{bins:[0,1],range:[0,1]},{density:1}]){
      const f=new Figure(),before=f.snapshot();expect(()=>f.hist([1],options as any)).toThrow();expect(f.snapshot()).toEqual(before);
    }
  });
  it('stores bars and enforces panel-wide layout constraints atomically',()=>{
    const f=new Figure(),a=f.bar(['A','B'],[2,-3],{label:'first'}),b=f.bar(['B','C'],[4,5]);
    expect(a.spec.options).toEqual({orientation:'vertical',barWidth:.8});
    expect(data(f,a.spec.data.base)).toEqual([0,0]);expect(data(f,b.spec.data.x)).toEqual([1,2]);
    f.setBarMode('stack');const before=f.snapshot();
    expect(()=>a.setData({bottom:1})).toThrow(/zero/);expect(f.snapshot()).toEqual(before);
    expect(()=>b.setOptions({barWidth:.5})).toThrow(/matching/);expect(f.snapshot()).toEqual(before);
    expect(()=>f.bar(['A','A'],[1,2])).toThrow(/unique/);expect(f.snapshot()).toEqual(before);
    f.setBarMode('overlay');a.setData({bottom:2});b.setOptions({barWidth:.5});
    const overlay=f.snapshot();expect(()=>f.setBarMode('stack')).toThrow();expect(f.snapshot()).toEqual(overlay);
    expect(()=>f.barh(['A'],[1])).toThrow();expect(f.snapshot()).toEqual(overlay);
  });
  it('keeps baseline lengths explicit and recognizes aliases',()=>{
    const f=new Figure(),a=f.barh(['A'],[2],{left:3});
    expect(data(f,a.spec.data.base)).toEqual([3]);const before=f.snapshot();
    expect(()=>a.setData({y:['A','B'],x:[4,5]})).toThrow(/equal/);expect(f.snapshot()).toEqual(before);
    a.setData({y:['A','B'],x:[4,5],left:1});expect(data(f,a.spec.data.base)).toEqual([1,1]);
  });
  it('rejects string-valued bars rather than treating values as a second category axis',()=>{
    const f=new Figure();expect(()=>f.bar(['A'],['bad'] as any)).toThrow();expect(f.registry.size).toBe(0);
    const b=f.bar(['A'],[2]);const before=f.snapshot();expect(()=>b.setData({y:['bad']})).toThrow();expect(f.snapshot()).toEqual(before);
  });
  it('stores ragged boxplot groups independently and supports atomic replacement',()=>{
    const f=new Figure(),b=f.boxplot([[1,2],new Float32Array([3,4,100]),[]],{labels:['A','B','empty']});
    expect(b.spec.categorical).toEqual({x:true});expect(f.registry.get(b.spec.data.g1).descriptor.dtype).toBe('float32');
    const before=f.snapshot();expect(()=>b.setData({groups:[[3]],labels:['A','B']})).toThrow();expect(f.snapshot()).toEqual(before);
    const old=b.spec.data.g2;b.setData({groups:[[5],[6]],labels:['B','C']});
    expect(data(f,b.spec.data.x)).toEqual([1,3]);expect(f.registry.has(old)).toBe(false);
    b.setOptions({showfliers:false});expect(b.spec.options).toMatchObject({showfliers:false});
    expect(()=>b.setOptions({orientation:'horizontal'})).toThrow(/orientation/);
  });
  it('rejects log on statistical layers and avoids mutation on view restore',()=>{
    const f=new Figure();f.hist([1,2]);const before=f.snapshot();
    expect(()=>f.setView({yScale:'log'})).toThrow(/linear/);expect(f.snapshot()).toEqual(before);
    expect(()=>f.restoreView({...f.spec.view,xScale:'log'})).toThrow(/linear/);expect(f.snapshot()).toEqual(before);
    const g=new Figure();g.setView({yScale:'log'});const state=g.snapshot();expect(()=>g.hist([1])).toThrow(/linear/);expect(g.snapshot()).toEqual(state);
  });
});

describe('categorical coordinates',()=>{
  it('preserves strings as axis semantics and retains input line order',()=>{
    const f=new Figure();f.setCategories('x',['B','A']);const l=f.plot(['A','B','A'],[1,2,3]);
    expect(data(f,l.spec.data.x)).toEqual([1,0,1]);expect(l.spec.categorical).toEqual({x:true});
    l.setData({y:[4,5,6]});expect(l.spec.categorical).toEqual({x:true});
    l.setData({x:['new','B','A']});expect(f.spec.categories).toEqual({'x:main':['B','A','new']});
    expect(()=>f.setCategories('x',['A','B'])).toThrow(/before/);
  });
  it('handles both axes categorically without broadening numeric-only layers',()=>{
    const f=new Figure(),l=f.scatter(['a','b'],['low','high']);expect(l.spec.categorical).toEqual({x:true,y:true});
    const before=f.snapshot();expect(()=>f.scatter([1,2],['low','high'])).toThrow(/mix/);expect(f.snapshot()).toEqual(before);
    expect(()=>f.heatmap([1],[1],[[1]])).toThrow(/mix/);
    const g=new Figure();expect(()=>g.heatmap(['a'] as any,[1],[[1]])).toThrow();
  });
  it('shares append-only category identities and keeps bookmarks independent',()=>{
    const f=subplots({rows:1,cols:2,shareX:true}),left=f.bar(['B','A'],[1,2]);
    f.bookmark('initial');const right=f.panel(0,1).scatter(['A','C'],[4,5]);
    expect(data(f,right.spec.data.x)).toEqual([1,2]);expect(f.spec.categories).toEqual({'x:shared':['B','A','C']});
    left.setVisible(false);left.remove();f.restoreBookmark('initial');expect(f.spec.categories!['x:shared']).toEqual(['B','A','C']);
    const before=f.snapshot();expect(()=>right.setData({x:['ghost'],y:[1,2]})).toThrow();expect(f.snapshot()).toEqual(before);
    expect(()=>f.panel(0,1).setView({xScale:'log'})).toThrow();expect(f.snapshot()).toEqual(before);
  });
  it('rejects conversion from numeric axes and mixed lists without allocating labels',()=>{
    const f=new Figure();f.plot([0,1],[2,3]);const before=f.snapshot();
    expect(()=>f.scatter(['a','b'],[4,5])).toThrow(/mix/);expect(f.snapshot()).toEqual(before);
    const empty=new Figure();expect(()=>empty.plot(['a',1] as any,[1,2])).toThrow();expect(empty.spec.categories).toBeUndefined();
  });
  it('never reorders or truncates category identities after all layers are removed',()=>{
    const f=new Figure();f.setCategories('x',['B','A']);const layer=f.bar(['A','B'],[1,2]);
    f.setView({xDomain:[-.5,.5]});f.bookmark('B');layer.remove();const before=f.snapshot();
    expect(()=>f.setCategories('x',['A','B'])).toThrow(/append-only/);
    expect(()=>f.setCategories('x',['B'])).toThrow(/append-only/);expect(f.snapshot()).toEqual(before);
    f.setCategories('x',['B','A','C']);f.restoreBookmark('B');
    const newLayer=f.bar(['C','B'],[3,4]);expect(data(f,newLayer.spec.data.x)).toEqual([2,0]);
    expect(f.spec.view.xDomain).toEqual([-.5,.5]);
  });
});

describe('v3 snapshots',()=>{
  it('rejects non-cloneable incoming scenes before replacing live sources',()=>{
    const target=new Figure(),layer=target.plot([1],[2]),source=new Figure();source.hist([3]);
    const before=target.snapshot(),s=source.snapshot();(s.figure as any).extra=()=>{};
    expect(()=>target.applySnapshot(s,buffers(source))).toThrow();
    expect(target.snapshot()).toEqual(before);expect(data(target,layer.spec.data.x)).toEqual([1]);
  });
  it('requires 2D for bar-mode metadata even before data is added',()=>{
    const f=new Figure({kind:'3d'}),before=f.snapshot();
    expect(()=>f.setBarMode('stack')).toThrow(/2D/);expect(f.snapshot()).toEqual(before);
    const s=f.snapshot();s.figure.protocolVersion=3;s.figure.barModes={main:'group'};
    expect(()=>f.applySnapshot(s,buffers(f))).toThrow(/2D/);expect(f.snapshot()).toEqual(before);
  });
  it('detaches aliased imported sources on public layer updates',()=>{
    const f=new Figure();f.plot([1,2],[3,4]);f.plot([1,2],[5,6]);const s=f.snapshot();
    s.figure.layers[1].data.x=s.figure.layers[0].data.x;
    f.applySnapshot(s,buffers(f));const first=f.spec.layers[0],second=f.spec.layers[1],shared=second.data.x;
    f.updateData(first,{x:[1,2,3],y:[4,5,6]});
    expect(first.data.x).not.toBe(shared);expect(data(f,shared)).toEqual([1,2]);expect(data(f,second.data.y)).toEqual([5,6]);
  });
  it('prevalidates all source versions before writing any channel',()=>{
    const f=new Figure();f.plot([1,2],[3,4]);const s=f.snapshot();s.sources.find(source=>source.id===s.figure.layers[0].data.y)!.version=Number.MAX_SAFE_INTEGER;
    f.applySnapshot(s,buffers(f));const before=f.snapshot();
    expect(()=>f.updateData(f.spec.layers[0],{x:[7,8],y:[9,10]})).toThrow(/version/);
    expect(f.snapshot()).toEqual(before);expect(data(f,f.spec.layers[0].data.x)).toEqual([1,2]);
  });
  it('round-trips raw sources, category maps and bar modes',()=>{
    const f=subplots({rows:2,cols:2});f.hist([1,2,3],{bins:[0,2,4]});
    f.panel(0,1).bar(['a','b'],[2,-1]);f.panel(0,1).setBarMode('stack');
    f.panel(1,0).boxplot([[1,2,20],[]]);f.panel(1,1).plot(['a','b'],[2,3]);
    f.bookmark('all');const g=new Figure();g.applySnapshot(f.snapshot(),buffers(f));expect(g.snapshot()).toEqual(f.snapshot());
  });
  it('rejects malformed extensions and retains the last valid scene',()=>{
    const source=new Figure();source.bar(['a'],[2]);const target=new Figure();target.plot([1],[2]);const before=target.snapshot();
    const bad=(edit:(s:Snapshot)=>void)=>{const snapshot=source.snapshot();edit(snapshot);expect(()=>target.applySnapshot(snapshot,buffers(source))).toThrow();expect(target.snapshot()).toEqual(before);};
    bad(s=>{s.figure.protocolVersion=2;});bad(s=>{s.figure.categories!['x:main']=[];});
    bad(s=>{s.figure.layers[0].options={orientation:'vertical',barWidth:-1};});
    bad(s=>{s.figure.barModes={absent:'group'};});bad(s=>{s.figure.layers[0].categorical={x:false} as any;});
    bad(s=>{delete s.figure.layers[0].options;});
  });
});
