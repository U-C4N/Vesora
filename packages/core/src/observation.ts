import {OBSERVATION_PROTOCOL_VERSION} from './types';
import type {ChannelSemanticsPatch,DataDescriptor,FigureSemantics,FigureSpec,LayerSpec,MetadataScalar,ObservationRecord,SourceSemantics} from './types';

const REPRESENTATIONS:Record<LayerSpec['kind'],readonly string[]>={line:['line'],line3d:['line'],scatter:['points','density'],scatter3d:['points'],heatmap:['grid'],surface:['surface'],hist:['hist'],bar:['bar'],boxplot:['boxplot'],band:['band']};

function require(condition:unknown,message:string):asserts condition{if(!condition)throw new TypeError(`Invalid observation metadata: ${message}`);}
function object(value:unknown,keys:readonly string[]|undefined,label:string):Record<string,unknown>{
  require(value!==null&&typeof value==='object'&&!Array.isArray(value),`${label} must be a plain object`);
  const prototype=Object.getPrototypeOf(value);require(prototype===Object.prototype||prototype===null,`${label} must be a plain object`);
  for(const key of Reflect.ownKeys(value)){
    require(typeof key==='string'&&(!keys||keys.includes(key)),`Unknown ${label} field ${String(key)}`);
    const descriptor=Object.getOwnPropertyDescriptor(value,key)!;
    require(Object.hasOwn(descriptor,'value')&&descriptor.enumerable,`${label} must contain enumerable data properties`);
  }
  return value as Record<string,unknown>;
}
function array(value:unknown,max:number,label:string):unknown[]{
  require(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype,`${label} must be an array`);
  require(value.length<=max&&Reflect.ownKeys(value).length===value.length+1,`${label} contains too many or invalid entries`);
  for(let i=0;i<value.length;i++)require(Object.hasOwn(value,i)&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,String(i))!,'value'),`${label} cannot contain holes or accessors`);
  return value;
}
function text(value:unknown,max:number,label:string):string{
  require(typeof value==='string'&&value.trim().length>0&&value.length<=max,`${label} must be nonempty text of at most ${max} characters`);return value;
}
function identifier(value:unknown,label:string):string{require(typeof value==='string'&&value.length>0,`${label} must be a nonempty string`);return value;}
function integer(value:unknown,label:string):number{require(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0,`${label} must be a nonnegative safe integer`);return value;}
function scalar(value:unknown):MetadataScalar{
  require(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=1024,'Transform parameters must be finite JSON scalars (strings at most 1024 characters)');return value as MetadataScalar;
}

/** Validate and return a detached canonical declaration; never execute external transforms. */
export function validateSourceSemantics(value:unknown):SourceSemantics{
  const input=object(value,['name','quantity','unit','dimension','origin','transforms'],'source semantics');
  require(Object.keys(input).length>0,'A source declaration needs at least one supplied field');
  const entries:Array<[string,unknown]>=[];
  for(const key of ['name','quantity','unit','dimension'])if(Object.hasOwn(input,key))entries.push([key,text(input[key],256,key)]);
  if(Object.hasOwn(input,'origin')){
    const origin=object(input.origin,['datasetId','field','reference'],'origin'),copy:Array<[string,string]>=[['datasetId',text(origin.datasetId,256,'datasetId')]];
    if(Object.hasOwn(origin,'field'))copy.push(['field',text(origin.field,256,'field')]);
    if(Object.hasOwn(origin,'reference'))copy.push(['reference',text(origin.reference,2048,'reference')]);
    entries.push(['origin',Object.fromEntries(copy)]);
  }
  if(Object.hasOwn(input,'transforms'))entries.push(['transforms',array(input.transforms,16,'transforms').map(value=>{
    const transform=object(value,['execution','name','version','parameters'],'transform');
    require(transform.execution==='external','Transforms must declare execution: external');
    const copy:Array<[string,unknown]>=[['execution','external'],['name',text(transform.name,256,'transform name')]];
    if(Object.hasOwn(transform,'version'))copy.push(['version',text(transform.version,256,'transform version')]);
    if(Object.hasOwn(transform,'parameters')){
      const parameters=object(transform.parameters,undefined,'transform parameters'),keys=Object.keys(parameters).sort();require(keys.length<=32,'At most 32 transform parameters are allowed');
      copy.push(['parameters',Object.fromEntries(keys.map(key=>[text(key,64,'parameter key'),scalar(parameters[key])]))]);
    }
    return Object.fromEntries(copy);
  })]);
  return Object.fromEntries(entries) as SourceSemantics;
}

/** Channel patches replace declarations; aliased channels must agree in one transaction. */
export function patchFigureSemantics(spec:FigureSpec,layer:LayerSpec,value:ChannelSemanticsPatch):FigureSemantics|undefined{
  const patch=object(value,undefined,'channel semantics patch'),updates=new Map<string,SourceSemantics|null>();
  for(const [channel,value]of Object.entries(patch)){
    require(Object.hasOwn(layer.data,channel),`Unknown layer channel ${channel}`);
    const source=layer.data[channel],next=value===null?null:validateSourceSemantics(value);
    if(updates.has(source))require(JSON.stringify(updates.get(source))===JSON.stringify(next),'Conflicting declarations for aliased channels');
    updates.set(source,next);
  }
  const declarations=new Map(Object.entries(spec.semantics?.sources??{}).map(([source,declaration])=>[source,validateSourceSemantics(declaration)]));
  for(const [source,value]of updates)if(value===null)declarations.delete(source);else declarations.set(source,value);
  return declarations.size?{schemaVersion:1,sources:Object.fromEntries(declarations)}:undefined;
}

/** Pure validation against the candidate scene/registry; callers commit only after this succeeds. */
export function validateObservationMetadata(spec:FigureSpec,sources:readonly DataDescriptor[]):void{
  const hasSemantics=Object.hasOwn(spec,'semantics'),hasObservation=Object.hasOwn(spec,'observation');
  if(!hasSemantics&&!hasObservation)return;
  require(spec.protocolVersion===OBSERVATION_PROTOCOL_VERSION,'Semantics and observations require protocol version 8');
  require(Array.isArray(sources)&&Array.isArray(spec.layers),'Source and layer arrays are required');
  const descriptors=new Map(sources.map(source=>[source.id,source])),layers=new Map(spec.layers.map(layer=>[layer.id,layer]));
  require(descriptors.size===sources.length&&layers.size===spec.layers.length,'Source/layer identities must be unique');
  if(hasSemantics){
    const semantics=object(spec.semantics,['schemaVersion','sources'],'semantics');require(semantics.schemaVersion===1,'Unsupported semantics schema');
    const declarations=object(semantics.sources,undefined,'semantic sources');require(Object.keys(declarations).length<=sources.length,'Too many semantic declarations');
    for(const [id,value]of Object.entries(declarations)){require(descriptors.has(id),`Unknown semantic source ${id}`);validateSourceSemantics(value);}
  }
  if(!hasObservation)return;
  const observation=object(spec.observation,['schemaVersion','source','capturedAt','sourceVersions','streams','representation'],'observation');
  require(observation.schemaVersion===1,'Unsupported observation schema');require(observation.source==='accepted'||observation.source==='displayed','Unknown observation source');
  require(typeof observation.capturedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observation.capturedAt)&&Number.isFinite(Date.parse(observation.capturedAt))&&new Date(observation.capturedAt).toISOString()===observation.capturedAt,'capturedAt must be a UTC ISO timestamp with milliseconds');
  const versions=array(observation.sourceVersions,sources.length,'sourceVersions'),seen=new Set<string>();
  require(versions.length===sources.length,'sourceVersions must cover every source exactly once');
  for(const value of versions){
    const entry=object(value,['id','version'],'source version'),id=identifier(entry.id,'Source ID');require(descriptors.has(id)&&!seen.has(id),'Unknown or duplicate source version');seen.add(id);
    require(integer(entry.version,'Source version')===descriptors.get(id)!.version,'Observation source version differs from descriptor');
  }
  const streams=array(observation.streams,spec.layers.length,'streams'),streamLayers=new Set<string>();
  for(const value of streams){
    const stream=object(value,['layerId','streamId','revision','sequenceStart','sequenceEndExclusive'],'stream'),layerId=identifier(stream.layerId,'Stream layer ID'),layer=layers.get(layerId);
    require(layer&&!streamLayers.has(layerId),'Unknown or duplicate stream layer');streamLayers.add(layerId);identifier(stream.streamId,'Stream ID');integer(stream.revision,'Stream revision');
    const start=integer(stream.sequenceStart,'Sequence start'),end=integer(stream.sequenceEndExclusive,'Sequence end');require(end>=start,'Stream sequence interval is reversed');
    require((layer.kind==='line'||layer.kind==='scatter')&&!layer.categorical,'Stream records require a numeric line/scatter layer');
    const panelId=layer.panelId??'main',view=panelId==='main'?spec.view:spec.panels?.find(panel=>panel.id===panelId)?.view;
    require(view?.kind==='2d','Stream records require a 2D panel');
    require(Object.hasOwn(layer.data,'x')&&Object.hasOwn(layer.data,'y')&&Object.keys(layer.data).every(key=>['x','y','color'].includes(key)),'Invalid stream channels');
    for(const id of Object.values(layer.data)){
      const descriptor=descriptors.get(id);require(descriptor&&descriptor.shape.length===1&&descriptor.shape[0]===end-start,'Stream interval must match every retained source row count');
    }
  }
  const representation=object(observation.representation,['status','frameId','snapshotId','layers'],'representation');
  require(representation.status==='not-evaluated'||representation.status==='rendered','Unknown representation status');
  if(representation.status==='not-evaluated'){require(Object.keys(representation).length===1,'Unevaluated representation cannot contain frame details');return;}
  require(observation.source==='displayed','Accepted observations cannot claim a rendered representation');
  integer(representation.frameId,'Frame ID');if(Object.hasOwn(representation,'snapshotId'))identifier(representation.snapshotId,'Snapshot ID');
  const records=array(representation.layers,spec.layers.length,'representation layers'),rendered=new Set<string>();
  const panels=new Set(spec.panels?.map(panel=>panel.id)??['main']);
  for(const value of records){
    const entry=object(value,['layerId','panelId','kind','total','visible','rendered','exact','method','valid','omitted','rangeExcluded','totalTriangles','omittedTriangles'],'representation layer');
    const layerId=identifier(entry.layerId,'Representation layer ID'),layer=layers.get(layerId);require(layer&&!rendered.has(layerId),'Unknown or duplicate representation layer');rendered.add(layerId);
    if(Object.hasOwn(entry,'panelId'))require(panels.has(identifier(entry.panelId,'Panel ID'))&&entry.panelId===(layer.panelId??'main'),'Representation panel differs from its layer');
    else require((layer.panelId??'main')==='main','Secondary-panel representation needs its panel ID');
    require(Object.hasOwn(REPRESENTATIONS,layer.kind)&&REPRESENTATIONS[layer.kind].includes(entry.kind as string),'Representation kind differs from its layer');
    for(const key of ['total','visible','rendered'])integer(entry[key],key);
    for(const key of ['valid','omitted','rangeExcluded','totalTriangles','omittedTriangles'])if(Object.hasOwn(entry,key))integer(entry[key],key);
    require(typeof entry.exact==='boolean','Representation exact must be boolean');text(entry.method,256,'Representation method');
  }
}

/** Detached imported record for public access. */
export function cloneObservation(record:ObservationRecord|undefined):ObservationRecord|undefined{return record===undefined?undefined:structuredClone(record);}
