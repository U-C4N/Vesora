import {describe,expect,it} from 'vitest';
import {Figure,subplots,defaultView} from '../../packages/core/src/figure';
import {buildGeometry} from '../../packages/core/src/geometry';
import {cameraMatrix,cameraPreset,geometryByteLength,identity,normalAspectScale,scientificAspect} from '../../packages/core/src/renderer';
import {pick3D,project3D,picking3DStats} from '../../packages/core/src/picking3d';
import type {Bounds,Domain,LayerSpec} from '../../packages/core/src/types';

const bounds:Bounds={x:[0,1],y:[0,1]},zDomain:Domain=[-1,1],rect={left:0,top:0,width:200,height:200};
const geometry=(fig:Figure,layer:LayerSpec,b:Bounds=bounds,z:Domain=zDomain)=>buildGeometry(layer,fig.registry,b,z,fig.panelView(layer.panelId??'main'),200,200);
const buffers=(fig:Figure)=>new Map([...fig.registry.entries()].map(([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer]));

describe('protocol 7 scientific 3D contracts',()=>{
  it('rejects malformed or downgraded inspection metadata atomically',()=>{
    const f=new Figure(),layer=f.plot([0,1],[1,2]),original=f.snapshot(),snapshot=f.snapshot();snapshot.figure.inspection={capturedAt:'bad date',frameId:-1};snapshot.figure.protocolVersion=7;
    expect(()=>f.applySnapshot(snapshot,buffers(f))).toThrow(/capture metadata/);expect(f.snapshot()).toEqual(original);
    snapshot.figure.inspection={capturedAt:new Date(0).toISOString(),frameId:1,selection:{kind:'point',layerId:'missing',pointerPosition:{x:0,y:0,clientX:0,clientY:0}}};expect(()=>f.applySnapshot(snapshot,buffers(f))).toThrow(/captured selection/);
    snapshot.figure.inspection.selection!.layerId=layer.id;f.applySnapshot(snapshot,buffers(f));snapshot.figure.protocolVersion=6;expect(()=>f.applySnapshot(snapshot,buffers(f))).toThrow(/protocol version 7/);
  });
  it('owns mixed fixed panels and restores every view without changing panel dimensions',()=>{
    for(const kinds of [[['3d','2d']],[['2d','3d']]] as Array<Array<Array<'2d'|'3d'>>>){
      const f=subplots({rows:1,cols:2,kinds}),spatial=f.panel(0,kinds[0][0]==='3d'?0:1),flat=f.panel(0,kinds[0][0]==='2d'?0:1);
      spatial.surface([0,1],[0,1],[[0,1],[1,0]]);flat.plot([0,1],[1,2]);spatial.setCameraPreset('xz');f.bookmark('Mixed');spatial.setCameraPreset('yz');f.restoreBookmark('Mixed');
      expect(spatial.view.camera).toEqual(cameraPreset('xz'));expect(f.spec.protocolVersion).toBe(7);
      const copy=new Figure();copy.applySnapshot(f.snapshot(),buffers(f));expect(copy.snapshot()).toEqual(f.snapshot());
      const before=f.snapshot();expect(()=>spatial.plot([0],[0])).toThrow(/dimensionality/);expect(f.snapshot()).toEqual(before);
      const legacy=f.snapshot();legacy.figure.protocolVersion=6;expect(()=>copy.applySnapshot(legacy,buffers(f))).toThrow(/protocol version 7/);
    }
    expect(()=>subplots({rows:1,cols:2,kinds:[['3d','2d']],shareX:true})).toThrow(/all-2D/);
    expect(()=>subplots({rows:1,cols:2,kinds:[['3d']]})).toThrow(/match/);
  });
  it('stores scalar surface grids separately and rejects malformed updates atomically',()=>{
    const f=new Figure(),layer=f.surface([0,1],[0,1],[[0,1],[1,0]],{values:[[1,2],[3,4]],colorDomain:[1,4]});
    expect(f.registry.get(layer.spec.data.color).descriptor.shape).toEqual([2,2]);expect(f.spec.protocolVersion).toBe(7);
    const a=geometry(f,layer.spec);layer.setData({color:[[4,3],[2,1]]});const b=geometry(f,layer.spec);
    expect(b.positions).toEqual(a.positions);expect(b.colors).not.toEqual(a.colors);
    const before=f.snapshot();expect(()=>layer.setData({z:[[3,4],[5,6]],color:[[1,2,3,4]]})).toThrow(/shape/);expect(f.snapshot()).toEqual(before);
    const copy=new Figure();copy.applySnapshot(f.snapshot(),buffers(f));expect(copy.snapshot()).toEqual(f.snapshot());
    expect(()=>f.scatter3d([0],[0],[0],{shading:'smooth'})).toThrow(/surface/);
  });
  it('materializes exact non-square row and column slices and propagates one atomic update',()=>{
    const f=subplots({rows:1,cols:3,kinds:[['3d','2d','2d']]}),s=f.panel(0,0).surface([10,20,30,40],[5,6,7],[[0,1,2,3],[4,5,6,7],[8,9,NaN,11]]);
    const column=f.panel(0,1).slice(s,{axis:'x',index:2}),row=f.panel(0,2).slice(s,{axis:'y',index:1});
    expect([...f.registry.get(column.spec.data.x).values]).toEqual([5,6,7]);expect([...f.registry.get(column.spec.data.y).values]).toEqual([2,6,NaN]);
    expect([...f.registry.get(row.spec.data.x).values]).toEqual([10,20,30,40]);expect([...f.registry.get(row.spec.data.y).values]).toEqual([4,5,6,7]);
    const revision=f.acceptedRevision;s.setData({z:[[10,11,12,13],[14,15,16,17],[18,19,20,21]]});expect(f.acceptedRevision).toBe(revision+1);
    expect([...f.registry.get(column.spec.data.y).values]).toEqual([12,16,20]);column.setIndex(3);expect([...f.registry.get(column.spec.data.y).values]).toEqual([13,17,21]);
    const before=f.snapshot();expect(()=>column.setIndex(4)).toThrow(/outside/);expect(()=>column.setData({y:[0,0,0]})).toThrow(/derived/);expect(()=>s.setData({x:[0,1,2,3]})).toThrow(/dependent/);expect(()=>s.remove()).toThrow(/dependent/);expect(f.snapshot()).toEqual(before);
    const copy=new Figure();copy.applySnapshot(f.snapshot(),buffers(f));expect(copy.snapshot()).toEqual(f.snapshot());
    const invalid=buffers(f);invalid.set(column.spec.data.y,new Float64Array([0,0,0]).buffer);expect(()=>copy.applySnapshot(f.snapshot(),invalid)).toThrow(/do not match/);
    column.remove();row.remove();s.remove();expect(f.spec.slices).toBeUndefined();
  });
  it('prevalidates the combined source and derived profile memory before committing',()=>{
    const f=subplots({rows:1,cols:2,kinds:[['3d','2d']],runtime:{maxSourceBytes:112}}),surface=f.panel(0,0).surface([0,1],[0,1],[[0,1],[2,3]]);f.panel(0,1).slice(surface,{axis:'x',index:0});
    const before=f.snapshot();expect(()=>surface.setData({color:[[1,2],[3,4]],z:new Float64Array([4,5,6,7])})).toThrow(/exceeding/);expect(f.snapshot()).toEqual(before);
    const copy=new Figure();copy.applySnapshot(f.snapshot(),buffers(f));expect(copy.spec.slices).toHaveLength(1);expect(before.sources.length).toBe(5);
  });
});

describe('indexed 3D geometry and scientific camera',()=>{
  it('keeps equal-axis transforms finite across overflow and very unequal valid domains',()=>{
    const view={...defaultView('3d'),equalAspect:true},aspect=scientificAspect(view,{x:[-1e308,1e308],y:[0,1]},[0,2])!;
    expect(aspect[0]).toBe(1);expect(aspect.every(value=>Number.isFinite(value)&&value>0)).toBe(true);
    expect([...cameraMatrix(35,25,3,1,[0,0],aspect)].every(Number.isFinite)).toBe(true);
    const ordinary=scientificAspect(view,{x:[0,100],y:[0,2]},[0,1])!;expect(ordinary[1]/ordinary[2]).toBeCloseTo(2);expect(ordinary[0]/ordinary[2]).toBeCloseTo(100);
  });
  it('shares vertices, preserves triangle identity and constructs optional normals/wireframe',()=>{
    const f=new Figure(),s=f.surface([0,1],[0,1],[[0,0],[0,0]],{shading:'smooth',wireframe:true}),g=geometry(f,s.spec);
    expect(g.positions.length).toBe(12);expect(g.indices?.length).toBe(6);expect(g.sourceIndices).toEqual(new Uint32Array([0,1]));expect(g.wireframeIndices?.length).toBe(10);
    for(let i=0;i<g.normals!.length;i+=3)expect([...g.normals!.slice(i,i+3)]).toEqual([0,0,1]);
    expect(geometryByteLength(g)).toBeGreaterThan(g.positions.byteLength+g.colors.byteLength);
    s.setData({color:[[NaN,1],[2,3]]});expect(geometry(f,s.spec).indices?.length).toBe(0);
  });
  it('keeps genuine 3D trajectory segments and gaps with screen-width attributes',()=>{
    const f=new Figure(),line=f.plot3d([0,1,NaN,0,1],[0,1,0,1,0],[0,.5,0,-.5,0],{width:7}),g=geometry(f,line.spec);
    expect(g.primitive).toBe('triangles');expect(g.positions.length).toBe(36);expect(g.sourceIndices).toEqual(new Uint32Array([0,3]));expect(g.lineSides?.length).toBe(12);expect(g.lineDirections?.length).toBe(36);expect(g.width).toBe(7);
    expect([...g.positions].every(Number.isFinite)).toBe(true);expect(f.spec.protocolVersion).toBe(7);
  });
  it('uses orthographic presets with explicit relative box aspect',()=>{
    const camera=cameraPreset('xy'),m=cameraMatrix(camera.azimuth,camera.elevation,camera.distance,1,[0,0],[2,1,1]);
    const origin=project3D([0,0,0],m,rect),x=project3D([1,0,0],m,rect),y=project3D([0,1,0],m,rect);
    expect(x[0]-origin[0]).toBeCloseTo((origin[1]-y[1])*2);expect(x[1]).toBeCloseTo(origin[1]);
    const f=new Figure({kind:'3d'});expect(()=>f.setView({boxAspect:[0,1,1]})).toThrow(/positive/);f.setView({boxAspect:[2,1,1]});expect(f.spec.protocolVersion).toBe(7);
  });
  it('keeps smooth normals perpendicular to the displayed plane after nonuniform aspect scaling',()=>{
    const f=new Figure(),s=f.surface([0,100],[0,1],[[0,1],[0,1]],{shading:'smooth'}),g=geometry(f,s.spec,{x:[0,100],y:[0,1]},[0,1]);
    const correction=normalAspectScale([100,1,1]),n=Array.from(g.normals!.subarray(0,3),(value,i)=>value*correction[i]);
    expect(n[0]*100+n[2]).toBeCloseTo(0,6);expect(n[2]).toBeGreaterThan(0);expect(normalAspectScale()).toEqual([1,1,1]);
  });
});

describe('committed geometry CPU picking',()=>{
  it('keeps coplanar point/surface picks in the same draw order under orthographic rotation',()=>{
    for(const pointFirst of [false,true]){
      const f=new Figure({kind:'3d'}),point=()=>f.scatter3d([.25],[.7],[0],{color:'#ff0000',size:18}),surface=()=>f.surface([0,1],[0,1],[[0,0],[0,0]],{wireframe:true});
      if(pointFirst){point();surface();}else{surface();point();}f.setCameraPreset('xy');const camera=f.spec.view.camera,matrix=cameraMatrix(camera.azimuth,camera.elevation,camera.distance,1),p=project3D([-.5,.4,0],matrix,rect);
      const hit=pick3D(f.spec.layers.map(layer=>({layer,geometry:geometry(f,layer)})),f.registry,matrix,rect,p[0],p[1]);expect(hit?.kind).toBe(pointFirst?'point3d':'surface');
    }
  });
  it('reuses projected bins and narrows candidates until geometry or camera changes',()=>{
    const f=new Figure(),x=Float64Array.from({length:10_000},(_,i)=>(i%100)/99),y=Float64Array.from(x,(_,i)=>Math.floor(i/100)/99),s=f.scatter3d(x,y,new Float64Array(x.length),{size:2}),g=geometry(f,s.spec),items=[{layer:s.spec,geometry:g}],before=picking3DStats.indexBuilds;
    pick3D(items,f.registry,identity,rect,50,50);expect(picking3DStats.indexBuilds).toBe(before+1);expect(picking3DStats.lastCandidates).toBeLessThan(1000);expect(picking3DStats.lastPrimitiveCount).toBe(10_000);
    pick3D(items,f.registry,identity,rect,150,150);expect(picking3DStats.indexBuilds).toBe(before+1);
    const changed=new Float32Array(identity);changed[12]=.1;pick3D(items,f.registry,changed,rect,100,100);expect(picking3DStats.indexBuilds).toBe(before+2);
    s.setData({z:new Float64Array(x.length).fill(.5)});pick3D([{layer:s.spec,geometry:geometry(f,s.spec)}],f.registry,changed,rect,100,100);expect(picking3DStats.indexBuilds).toBe(before+3);
  });
  it('picks the front visible object regardless of layer order and rejects out-of-panel hits',()=>{
    const f=new Figure(),surface=f.surface([0,1],[0,1],[[0,0],[0,0]]),point=f.scatter3d([.5],[.5],[.5],{size:12});
    const items=()=>[surface,point].map(layer=>({layer:layer.spec,geometry:geometry(f,layer.spec)}));
    expect(pick3D(items(),f.registry,identity,rect,100,100)?.kind).toBe('surface');point.setData({z:[-.5]});
    const hit=pick3D(items().reverse(),f.registry,identity,rect,100,100);expect(hit).toMatchObject({kind:'point3d',index:0,z:-.5,interpolated:false});
    expect(pick3D(items(),f.registry,identity,rect,-1,100)).toBeUndefined();
  });
  it('returns source cell/triangle and interpolation separately from sample identity',()=>{
    const f=new Figure(),s=f.surface([0,1],[0,1],[[0,0],[0,0]],{values:[[0,1],[2,3]]}),hit=pick3D([{layer:s.spec,geometry:geometry(f,s.spec)}],f.registry,identity,rect,150,150);
    expect(hit).toMatchObject({kind:'surface',cell:[0,0],triangle:0,x:.75,y:.25,z:0,value:1.25,interpolated:true});expect(hit?.index).toBeUndefined();expect(hit?.barycentric?.reduce((a,b)=>a+b,0)).toBeCloseTo(1);
  });
  it('maps log-axis hits through the displayed transform and picks line segments with width',()=>{
    const f=new Figure(),line=f.plot3d([1,100],[0,1],[0,0],{width:8});f.setView({xScale:'log'});const b:Bounds={x:[1,100],y:[0,1]},g=geometry(f,line.spec,b),hit=pick3D([{layer:line.spec,geometry:g}],f.registry,identity,rect,100,100,{bounds:b,zDomain,view:f.spec.view});
    expect(hit).toMatchObject({kind:'segment3d',indices:[0,1],t:.5,y:.5,z:0});expect(hit?.x).toBeCloseTo(10);
    expect(pick3D([{layer:line.spec,geometry:g}],f.registry,identity,rect,100,120)).toBeUndefined();
  });
});

describe('imported scientific style parity',()=>{
  it('rejects surface-only options on imported point layers without replacing the current scene',()=>{
    const source=new Figure();source.scatter3d([0,1],[0,1],[0,1]);
    const destination=new Figure();destination.plot([0,1],[4,5]);const before=destination.snapshot();
    for(const style of [{shading:'smooth' as const},{wireframe:true},{wireframe:false}]){
      const snapshot=source.snapshot();snapshot.figure.protocolVersion=7;Object.assign(snapshot.figure.layers[0].style,style);
      expect(()=>destination.applySnapshot(snapshot,buffers(source))).toThrow(/require a surface/);
      expect(destination.snapshot()).toEqual(before);
      expect([...destination.registry.get(destination.spec.layers[0].data.y).values]).toEqual([4,5]);
    }
    source.close();destination.close();
  });
});
