import {describe,expect,it} from 'vitest';
import {Figure,Layer,subplots} from '../../packages/core/src/figure';
import {OBSERVATION_PROTOCOL_VERSION} from '../../packages/core/src/index';
import {validateObservationMetadata,validateSourceSemantics} from '../../packages/core/src/observation';
import type {LayerKind,ObservationRecord,RepresentationInfo,Snapshot,SourceSemantics} from '../../packages/core/src/types';

const buffers=(figure:Figure)=>new Map([...figure.registry.entries()].map(([id,entry])=>[id,entry.values.slice().buffer as ArrayBuffer]));
function record(snapshot:Snapshot):ObservationRecord{return {schemaVersion:1,source:'accepted',capturedAt:'2026-10-23T10:00:00.000Z',
  sourceVersions:snapshot.sources.map(({id,version})=>({id,version})),streams:[],representation:{status:'not-evaluated'}};}
function fixture(){
  const source=new Figure(),line=source.plot([0,1],[273,274]);line.setSemantics({x:{name:'Zaman',quantity:'time',unit:'s'},y:{name:'Sıcaklık',unit:'K',origin:{datasetId:'ölçüm-17'}}});
  const snapshot=source.snapshot();snapshot.figure.observation=record(snapshot);
  const copy=new Figure();copy.applySnapshot(snapshot,buffers(source));return {source,line,snapshot,copy,layer:new Layer(copy,line.id)};
}
function expectUnchanged(figure:Figure,fn:()=>unknown){const before=figure.snapshot(),bytes=buffers(figure),revision=figure.acceptedRevision;
  expect(fn).toThrow();expect(figure.snapshot()).toEqual(before);expect(buffers(figure)).toEqual(bytes);expect(figure.acceptedRevision).toBe(revision);}

describe('source declarations',()=>{
  it('clones bounded inert metadata on input and output, patches by channel, and promotes only metadata scenes',()=>{
    const figure=new Figure(),line=figure.plot([0,1],[273,274]),initial=figure.snapshot();expect(initial.figure.protocolVersion).toBe(1);expect(initial.figure.semantics).toBeUndefined();
    const declaration:SourceSemantics={name:'Sıcaklık 🌡',quantity:'temperature',unit:'K',dimension:'temperature',origin:{datasetId:'experiment',field:'sensor',reference:'https://example.invalid/inert'},transforms:[{execution:'external',name:'calibration',version:'2',parameters:{offset:2,note:'',enabled:true,unknown:null}}]};
    expect(line.setSemantics({x:{unit:'s'},y:declaration})).toBe(line);expect(figure.spec.protocolVersion).toBe(OBSERVATION_PROTOCOL_VERSION);
    declaration.origin!.datasetId='changed';declaration.transforms![0].parameters!.offset=999;
    const read=line.getSemantics();read.y.unit='changed';read.y.transforms![0].parameters!.offset=100;
    expect(line.getSemantics().y).toMatchObject({unit:'K',origin:{datasetId:'experiment'},transforms:[{parameters:{offset:2}}]});
    line.setSemantics({y:{quantity:'new'}});expect(line.getSemantics()).toEqual({x:{unit:'s'},y:{quantity:'new'}});
    line.setSemantics({y:null});expect(line.getSemantics()).toEqual({x:{unit:'s'}});line.setSemantics({x:null});
    expect(figure.spec.semantics).toBeUndefined();expect(figure.spec.protocolVersion).toBe(8);expect(figure.spec.view.yLabel).toBe('');figure.close();
  });
  it.each([
    {},{unit:''},{unit:' '.repeat(2)},{unit:'a'.repeat(257)},{unit:undefined},{unknown:'x'},
    {origin:{datasetId:'x',extra:1}},{origin:{datasetId:'x',reference:'r'.repeat(2049)}},
    {transforms:[{execution:'javascript',name:'run'}]},{transforms:Array.from({length:17},()=>({execution:'external',name:'n'}))},
    {transforms:[{execution:'external',name:'n',parameters:{value:Infinity}}]},
    {transforms:[{execution:'external',name:'n',parameters:{value:()=>0}}]},
    {transforms:[{execution:'external',name:'n',parameters:{value:{nested:1}}}]},
    {transforms:[{execution:'external',name:'n',parameters:{value:'x'.repeat(1025)}}]},
    {transforms:[{execution:'external',name:'n',parameters:Object.fromEntries(Array.from({length:33},(_,i)=>['p'+i,i]))}]},
  ])('rejects invalid declarations without a valid-prefix commit (%j)',invalid=>{
    const {source,copy,layer}=fixture();expectUnchanged(copy,()=>layer.setSemantics({x:{unit:'ms'},y:invalid as SourceSemantics}));source.close();copy.close();
  });
  it('rejects unknown channels, nonplain records, cycles and accessors without evaluating metadata getters',()=>{
    const {source,copy,layer}=fixture();expectUnchanged(copy,()=>layer.setSemantics({z:{unit:'m'}}));
    class Metadata {unit='m';}expectUnchanged(copy,()=>layer.setSemantics({y:new Metadata()}));
    const cyclic:any={transforms:[{execution:'external',name:'bad',parameters:{}}]};cyclic.transforms[0].parameters.self=cyclic;
    expectUnchanged(copy,()=>layer.setSemantics({y:cyclic}));let calls=0;
    const getter=Object.defineProperty({},'unit',{enumerable:true,get(){calls++;return 'm';}});
    expectUnchanged(copy,()=>layer.setSemantics({y:getter}));expect(calls).toBe(0);source.close();copy.close();
  });
  it('retains dangerous parameter and source-ID keys as own inert data',()=>{
    const value=validateSourceSemantics(JSON.parse('{"unit":"m","transforms":[{"execution":"external","name":"safe","parameters":{"__proto__":"inert","constructor":2,"prototype":null}}]}'));
    expect(Object.hasOwn(value.transforms![0].parameters!,'__proto__')).toBe(true);expect(value.transforms![0].parameters!.__proto__).toBe('inert');
    expect(Object.getPrototypeOf(value.transforms![0].parameters!)).toBe(Object.prototype);expect(({} as any).inert).toBeUndefined();
    const source=new Figure(),line=source.plot([0],[1]),snapshot=source.snapshot(),old=line.spec.data.x;
    snapshot.figure.layers[0].data.x='__proto__';snapshot.sources.find(entry=>entry.id===old)!.id='__proto__';
    const raw=buffers(source);raw.set('__proto__',raw.get(old)!);const copy=new Figure();copy.applySnapshot(snapshot,raw);
    const imported=new Layer(copy,line.id);imported.setSemantics({x:{unit:'s'}});expect(Object.hasOwn(copy.spec.semantics!.sources,'__proto__')).toBe(true);
    expect(imported.getSemantics()).toEqual({x:{unit:'s'}});copy.close();source.close();
  });
  it('rejects conflicting same-source patches atomically and accepts order-independent equivalent aliases',()=>{
    const source=new Figure(),line=source.plot([0,1],[2,3]),snapshot=source.snapshot(),shared=line.spec.data.x;
    snapshot.figure.layers[0].data.y=shared;snapshot.sources=snapshot.sources.filter(entry=>entry.id===shared);
    const copy=new Figure();copy.applySnapshot(snapshot,buffers(source));const imported=new Layer(copy,line.id);
    expectUnchanged(copy,()=>imported.setSemantics({x:{unit:'s'},y:{unit:'m'}}));
    imported.setSemantics({x:{quantity:'time',unit:'s'},y:{unit:'s',quantity:'time'}});expect(imported.getSemantics().x).toEqual(imported.getSemantics().y);
    expectUnchanged(copy,()=>imported.setSemantics({x:null,y:{unit:'s'}}));
    imported.setData({y:[8,9]});expect(imported.spec.data.x).not.toBe(imported.spec.data.y);
    expect(imported.getSemantics()).toEqual({x:{quantity:'time',unit:'s'},y:{quantity:'time',unit:'s'}});
    imported.remove();expect(copy.spec.semantics).toBeUndefined();expect(copy.registry.size).toBe(0);copy.close();source.close();
  });
  it('preserves shared declarations until the last reference and migrates streaming copy-on-write sources',async()=>{
    const source=new Figure(),a=source.plot([0,1],[2,3]),b=source.plot([4,5],[6,7]);a.setSemantics({x:{unit:'s'}});
    const snapshot=source.snapshot(),removed=b.spec.data.x;snapshot.figure.layers[1].data.x=a.spec.data.x;snapshot.sources=snapshot.sources.filter(entry=>entry.id!==removed);
    const copy=new Figure();copy.applySnapshot(snapshot,buffers(source));const aa=new Layer(copy,a.id),bb=new Layer(copy,b.id),shared=aa.spec.data.x;
    aa.enableStreaming({maxPoints:2});expect(aa.spec.data.x).not.toBe(shared);expect(copy.spec.semantics!.sources[shared]).toEqual({unit:'s'});
    await aa.appendData({x:[2],y:[4]},{waitFor:'accepted'});aa.setData({x:[10,11],y:[12,13]});expect(aa.getSemantics()).toEqual({x:{unit:'s'}});
    bb.remove();expect(Object.hasOwn(copy.spec.semantics!.sources,shared)).toBe(false);expect(aa.getSemantics()).toEqual({x:{unit:'s'}});copy.close();source.close();
  });
  it('preserves independent slice declarations across source updates without inventing inheritance',()=>{
    const figure=subplots({rows:1,cols:2,kinds:[['3d','2d']]}),surface=figure.panel(0,0).surface([0,1],[0,1],[[1,2],[3,4]]);
    surface.setSemantics({z:{unit:'K'}});const slice=figure.panel(0,1).slice(surface,{axis:'x',index:0});expect(slice.getSemantics()).toEqual({});
    slice.setSemantics({y:{quantity:'declared independently'}});surface.setData({z:[[5,6],[7,8]]});slice.setIndex(1);
    expect(surface.getSemantics()).toEqual({z:{unit:'K'}});expect(slice.getSemantics()).toEqual({y:{quantity:'declared independently'}});figure.close();
  });
});

describe('portable observation imports',()=>{
  it.each<[LayerKind,RepresentationInfo['kind'][]]>([
    ['line',['line']],['line3d',['line']],['scatter',['points','density']],['scatter3d',['points']],['heatmap',['grid']],
    ['surface',['surface']],['hist',['hist']],['bar',['bar']],['boxplot',['boxplot']],['band',['band']],
  ])('requires the rendered %s representation to agree with its scene layer',(layerKind,valid)=>{
    const figure=new Figure(),line=figure.plot([0,1],[2,3]),snapshot=figure.snapshot();snapshot.figure.protocolVersion=8;snapshot.figure.layers[0].kind=layerKind;
    // Test metadata compatibility; numeric scene-shape validation is independent.
    snapshot.figure.observation={...record(snapshot),source:'displayed',representation:{status:'rendered',frameId:1,layers:[{layerId:line.id,kind:valid[0],total:2,visible:2,rendered:2,exact:true,method:'test'}]}};
    const representation=snapshot.figure.observation.representation;if(representation.status!=='rendered')throw new Error('test');
    for(const kind of ['points','density','line','grid','surface','hist','bar','boxplot','band'] as const){
      representation.layers[0].kind=kind;
      if(valid.includes(kind))expect(()=>validateObservationMetadata(snapshot.figure,snapshot.sources)).not.toThrow();
      else expect(()=>validateObservationMetadata(snapshot.figure,snapshot.sources)).toThrow(/kind/);
    }
    figure.close();
  });
  it('preserves legacy scene protocols 1–7 without manufacturing metadata',()=>{
    const source=new Figure();source.plot([0],[1]);for(let version=1;version<=7;version++){
      const snapshot=source.snapshot();snapshot.figure.protocolVersion=version;const copy=new Figure();copy.applySnapshot(snapshot,buffers(source));
      expect(copy.snapshot()).toEqual(snapshot);expect(copy.getObservation()).toBeUndefined();copy.close();
    }source.close();
  });
  it('clones imported observations while keeping the protocol-7 inspection contract independent',()=>{
    const {source,snapshot,copy,layer}=fixture();snapshot.figure.inspection={capturedAt:'2026-10-23T10:00:00.000Z',frameId:4};copy.applySnapshot(snapshot,buffers(source));
    const read=copy.getObservation()!;read.sourceVersions[0].version=999;expect(copy.getObservation()).toEqual(snapshot.figure.observation);
    expectUnchanged(copy,()=>layer.setData({y:[2]}));expectUnchanged(copy,()=>layer.setSemantics({y:{unit:'x'.repeat(257)}}));
    layer.setStyle({width:3});expect(copy.getObservation()).toBeUndefined();expect(copy.spec.inspection).toEqual(snapshot.figure.inspection);
    expect(layer.getSemantics().y.unit).toBe('K');source.close();copy.close();
  });
  it.each(['view','title','visibility','semantics','data','annotation','selection'] as const)('invalidates the imported complete-scene record on %s changes',kind=>{
    const {source,copy,layer}=fixture();
    if(kind==='view')copy.setView({xDomain:[0,2]});else if(kind==='title')copy.setTitle('changed');else if(kind==='visibility')layer.setVisible(false);
    else if(kind==='semantics')layer.setSemantics({y:{unit:'°C'}});else if(kind==='data')layer.setData({y:[2,3]});else if(kind==='annotation')copy.text(0,1,'changed');else copy.invalidateObservation();
    expect(copy.getObservation()).toBeUndefined();expect(copy.spec.semantics).toBeDefined();source.close();copy.close();
  });
  it('validates accepted/export ownership separately from a live figure and records bounded stream windows',async()=>{
    const figure=new Figure(),line=figure.plot([0,1],[273,274]).setSemantics({x:{unit:'s'},y:{unit:'K'}}).enableStreaming({maxPoints:2});
    await line.appendData({x:[2],y:[275]},{waitFor:'accepted'});const lease=figure.captureExport('accepted');
    const captured=structuredClone(lease.observation!);expect(captured.representation).toEqual({status:'not-evaluated'});
    expect(captured.streams[0]).toMatchObject({layerId:line.id,sequenceStart:1,sequenceEndExclusive:3});
    lease.snapshot.figure.observation=captured;lease.snapshot.figure.protocolVersion=8;validateObservationMetadata(lease.snapshot.figure,lease.snapshot.sources);
    await line.appendData({x:[3],y:[276]},{waitFor:'accepted'});line.setSemantics({y:{unit:'°C'}});
    expect([...lease.registry.get(line.spec.data.y).values]).toEqual([274,275]);expect(lease.snapshot.figure.semantics!.sources[line.spec.data.y].unit).toBe('K');
    expect(lease.observation).toEqual(captured);expect(figure.getObservation()).toBeUndefined();lease.release();figure.close();
  });
  it.each([
    (s:Snapshot)=>{s.figure.protocolVersion=7;},
    (s:Snapshot)=>{s.figure.semantics!.schemaVersion=2 as 1;},
    (s:Snapshot)=>{s.figure.semantics!.sources.unknown={unit:'s'};},
    (s:Snapshot)=>{s.figure.observation!.schemaVersion=2 as 1;},
    (s:Snapshot)=>{s.figure.observation!.sourceVersions.pop();},
    (s:Snapshot)=>{s.figure.observation!.sourceVersions[1]=s.figure.observation!.sourceVersions[0];},
    (s:Snapshot)=>{s.figure.observation!.sourceVersions[0].version++;},
    (s:Snapshot)=>{s.figure.observation!.sourceVersions[0].id='unknown';},
    (s:Snapshot)=>{s.figure.observation!.capturedAt='2026-02-30T10:00:00.000Z';},
    (s:Snapshot)=>{s.figure.observation!.capturedAt='2026-10-23T10:00:00+00:00';},
    (s:Snapshot)=>{s.figure.observation!.representation={status:'rendered',frameId:1,layers:[]};},
    (s:Snapshot)=>{s.figure.observation!.streams=[{layerId:s.figure.layers[0].id,streamId:'epoch',revision:0,sequenceStart:0,sequenceEndExclusive:3}];},
    (s:Snapshot)=>{s.figure.observation!.streams=[{layerId:'unknown',streamId:'epoch',revision:0,sequenceStart:0,sequenceEndExclusive:2}];},
    (s:Snapshot)=>{s.figure.observation!.streams=[{layerId:s.figure.layers[0].id,streamId:'epoch',revision:-1,sequenceStart:0,sequenceEndExclusive:2}];},
  ])('rejects invalid metadata before any numeric import mutation (%#)',mutate=>{
    const {source,snapshot,copy}=fixture();mutate(snapshot);const incoming=buffers(source);new Float64Array(incoming.get(snapshot.sources[0].id)!)[0]=900;
    expectUnchanged(copy,()=>copy.applySnapshot(snapshot,incoming));source.close();copy.close();
  });
  it('rejects nonplain metadata before structuredClone could erase its prototype',()=>{
    const {source,snapshot,copy}=fixture();class Declaration {unit='K';}
    snapshot.figure.semantics!.sources[snapshot.sources[0].id]=new Declaration();expectUnchanged(copy,()=>copy.applySnapshot(snapshot,buffers(source)));source.close();copy.close();
  });
  it('validates displayed layer/panel attribution and surface triangle counts without a generic rendered <= total rule',()=>{
    const figure=subplots({rows:1,cols:2,kinds:[['2d','3d']]}),surface=figure.panel(0,1).surface([0,1,2],[0,1,2],[[1,2,3],[4,5,6],[7,8,9]]);
    const snapshot=figure.snapshot();snapshot.figure.protocolVersion=8;snapshot.figure.observation={...record(snapshot),source:'displayed',representation:{status:'rendered',frameId:7,layers:[{layerId:surface.id,panelId:surface.spec.panelId,kind:'surface',total:9,visible:9,rendered:16,exact:true,method:'triangles',totalTriangles:16,omittedTriangles:0}]}};
    expect(()=>validateObservationMetadata(snapshot.figure,snapshot.sources)).not.toThrow();const before=structuredClone(snapshot);
    const representation=snapshot.figure.observation.representation;if(representation.status!=='rendered')throw new Error('test');
    representation.layers[0].panelId='main';expect(()=>validateObservationMetadata(snapshot.figure,snapshot.sources)).toThrow(/panel/);
    snapshot.figure.observation=before.figure.observation;const next=snapshot.figure.observation!.representation;if(next.status!=='rendered')throw new Error('test');
    next.layers.push({...next.layers[0]});expect(()=>validateObservationMetadata(snapshot.figure,snapshot.sources)).toThrow(/too many|duplicate/);figure.close();
  });
});
