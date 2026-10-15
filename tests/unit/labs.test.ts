import {describe,expect,it} from 'vitest';
import {Figure,subplots} from '../../packages/core/src/figure';
import {createTrajectory,createRollingSurface,sampleSurfaceGrid,createABPins} from '../../packages/core/src/labs';

describe('opt-in Labs retained data',()=>{
  it('preserves acquisition sequence when spatial x reverses and evicts whole rows',async()=>{
    const f=subplots({rows:1,cols:1,kinds:[['3d']]}),trajectory=createTrajectory(f.panel(0,0),{maxPoints:3,scalar:true});
    await trajectory.append({x:[3,2],y:[0,1],z:[1,2],values:[30,20]},{waitFor:'accepted'});const original=trajectory.getState();
    await trajectory.append({x:[1,0,-1],y:[2,3,4],z:[3,4,5],values:[10,0,-10]},{waitFor:'accepted'});
    expect(trajectory.getState()).toMatchObject({nextSequence:5,retained:3,evicted:2,revision:2});expect(trajectory.sequenceAt(0)).toBe(2);expect(trajectory.sequenceAt(0,original.sourceVersion)).toBe(0);
    const layer=trajectory.layer.spec;expect([...f.registry.get(layer.data.x).values]).toEqual([1,0,-1]);expect([...f.registry.get(layer.data.color).values]).toEqual([10,0,-10]);
    const before=f.snapshot(),state=trajectory.getState();await expect(trajectory.append({x:[9],y:[],z:[8],values:[1]})).rejects.toThrow(/align/);expect(f.snapshot()).toEqual(before);expect(trajectory.getState()).toEqual(state);
    expect(JSON.stringify(before)).not.toContain('nextSequence');expect(before.figure.layers[0].kind).toBe('line3d');trajectory.close();expect(f.spec.layers).toHaveLength(0);f.close();
  });
  it('rejects frozen rendered acknowledgements before accepting any trajectory data',async()=>{
    const f=subplots({rows:1,cols:1,kinds:[['3d']]}),t=createTrajectory(f.panel(0,0),{maxPoints:4});
    f.getInspectionState=()=>({mode:'frozen'} as ReturnType<Figure['getInspectionState']>);
    await expect(t.append({x:[0],y:[0],z:[0]})).rejects.toMatchObject({code:'PRESENTATION_FROZEN',accepted:false});expect(t.getState().nextSequence).toBe(0);
    await t.append({x:[0],y:[0],z:[0]},{waitFor:'accepted'});expect(t.getState().nextSequence).toBe(1);t.close();f.close();
  });
  it('does not alias old identity or silently overwrite external trajectory data',async()=>{
    const f=subplots({rows:1,cols:1,kinds:[['3d']]}),t=createTrajectory(f.panel(0,0),{maxPoints:2});
    await t.append({x:[0],y:[0],z:[0]},{waitFor:'accepted'});const first=t.getState().sourceVersion;
    for(let i=1;i<70;i++)await t.append({x:[i],y:[i],z:[i]},{waitFor:'accepted'});
    expect(t.sequenceAt(0,first)).toBeUndefined();t.layer.setData({x:[10,11],y:[20,21],z:[30,31]});await expect(t.append({x:[1],y:[2],z:[3]})).rejects.toThrow(/outside/);t.close();f.close();
  });
  it('retains pending and frozen displayed source identity beyond the history window',async()=>{
    const f=subplots({rows:1,cols:1,kinds:[['3d']]}),t=createTrajectory(f.panel(0,0),{maxPoints:2});await t.append({x:[0,1],y:[0,1],z:[0,1]},{waitFor:'accepted'});
    const old=t.getState(),snapshot=f.snapshot(),state=f.getInspectionState();f.emit('framepending',{...state,displayedRevision:f.acceptedRevision});
    for(let i=0;i<100;i++)await t.append({x:[i],y:[i],z:[i]},{waitFor:'accepted'});expect(t.sequenceAt(0,old.sourceVersion)).toBe(0);
    f.getInspectionSnapshot=()=>snapshot;f.emit('frame',state);f.emit('inspectionchange',{...state,mode:'frozen'});
    for(let i=0;i<100;i++)await t.append({x:[i],y:[i],z:[i]},{waitFor:'accepted'});expect(t.sequenceAt(1,old.sourceVersion)).toBe(1);t.close();f.close();
  });
  it('detects edits to every owned trajectory channel and closes after its figure',async()=>{
    for(const role of ['y','z','color']){
      const f=subplots({rows:1,cols:1,kinds:[['3d']]}),t=createTrajectory(f.panel(0,0),{maxPoints:2,scalar:true});
      await t.append({x:[0],y:[1],z:[2],values:[3]},{waitFor:'accepted'});t.layer.setData({[role]:[4]});
      await expect(t.append({x:[1],y:[2],z:[3],values:[4]},{waitFor:'accepted'})).rejects.toThrow(/outside/);f.close();expect(()=>t.close()).not.toThrow();expect(()=>t.getState()).toThrow(/closed/);
    }
  });
  it('publishes one coherent retained row window to surface and heatmap',async()=>{
    const rolling=createRollingSurface({x:[0,1,2],y:[0,1],z:[[0,1,2],[10,11,12]],maxRows:3}),f=rolling.figure,revision=f.acceptedRevision;
    await rolling.appendRows({y:[2,3],z:[[20,21,22],[30,31,32]]},{waitFor:'accepted'});
    expect(f.acceptedRevision).toBe(revision+1);expect(rolling.getState()).toMatchObject({nextSequence:4,retainedRows:3,evictedRows:1,columns:3});
    for(const layer of [rolling.surface,rolling.heatmap]){expect([...f.registry.get(layer.spec.data.y).values]).toEqual([1,2,3]);expect([...f.registry.get(layer.spec.data.z).values]).toEqual([10,11,12,20,21,22,30,31,32]);expect(f.registry.get(layer.spec.data.z).descriptor.shape).toEqual([3,3]);}
    const before=f.snapshot();await expect(rolling.appendRows({y:[4,5],z:[[1,2],[3,4]]})).rejects.toThrow(/shape/);expect(f.snapshot()).toEqual(before);await expect(rolling.appendRows({y:[3],z:[[0,0,0]]})).rejects.toThrow(/increasing/);expect(f.snapshot()).toEqual(before);rolling.close();
  });
  it('keeps the old rolling window when the combined source budget rejects the next window',async()=>{
    const r=createRollingSurface({x:[0,1],y:[0,1],z:[[0,1],[2,3]],maxRows:4,maxSourceBytes:128}),before=r.figure.snapshot();
    await expect(r.appendRows({y:[2],z:[[4,5]]},{waitFor:'accepted'})).rejects.toThrow(/exceeding/);expect(r.figure.snapshot()).toEqual(before);expect(r.getState().nextSequence).toBe(2);r.close();
  });
});

describe('Labs grid detail explicitly describes approximation',()=>{
  it('bounds retained vertices, keeps boundary coordinates and reports canonical source cells',()=>{
    const axis=Float64Array.from({length:31},(_,i)=>i),z=Float64Array.from({length:31*31},(_,i)=>i),sample=sampleSurfaceGrid(axis,axis,z,{maxVertices:30});
    expect(sample.z.length).toBeLessThanOrEqual(30);expect(sample.info.exact).toBe(false);expect(sample.info.method).toContain('approximate');expect(sample.x[0]).toBe(0);expect(sample.x.at(-1)).toBe(30);expect(sample.y.at(-1)).toBe(30);
    for(let r=0;r<sample.y.length;r++)for(let c=0;c<sample.x.length;c++)expect(sample.z[r*sample.x.length+c]).toBe(z[sample.sourceRows[r]*31+sample.sourceColumns[c]]);
  });
  it('does not bridge a missing source region when a coarse cell would otherwise hide it',()=>{
    const z=new Float64Array(25).fill(1);z[12]=NaN;
    const coarse=sampleSurfaceGrid([0,1,2,3,4],[0,1,2,3,4],z,{maxVertices:4});expect([...coarse.z].every(Number.isNaN)).toBe(true);expect(coarse.info.omittedCoarseCells).toBe(1);
    const full=sampleSurfaceGrid([0,1,2,3,4],[0,1,2,3,4],z,{maxVertices:25});expect(full.info.exact).toBe(true);expect(full.z).toEqual(z);
  });
});

describe('Labs A/B captures share their figure snapshot budget',()=>{
  it('pins owned source versions and leaves both old pins intact on replacement failure',()=>{
    const f=new Figure({kind:'3d',runtime:{maxSnapshotBytes:144}}),s=f.scatter3d([0,1,2],[0,1,2],[0,1,2]),pins=createABPins(f),a=pins.pin('A','accepted');s.setData({z:[2,3,4]});const b=pins.pin('B','accepted');
    expect(f.getInspectionState().snapshotBytes).toBe(144);const before=a.snapshot;a.snapshot.figure.title='mutable copy';expect(a.snapshot.figure.title).toBe(before.figure.title);
    expect(()=>pins.pin('A','accepted')).toThrow(/budget/);expect(pins.get('A')).toBe(a);expect(pins.get('B')).toBe(b);expect(a.snapshot.sources.find(source=>source.id===s.spec.data.z)?.version).toBe(1);
    b.release();expect(f.getInspectionState().snapshotBytes).toBe(72);const replacement=pins.pin('A','accepted');expect(replacement.snapshot.sources.find(source=>source.id===s.spec.data.z)?.version).toBe(2);expect(()=>a.snapshot).toThrow(/released/);pins.close();expect(f.getInspectionState().snapshotBytes).toBe(0);f.close();
  });
});
