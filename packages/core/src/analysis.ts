import type {Figure, Layer} from './figure';
import type {DataRegistry} from './data';
import type {Bounds, DataEntry, FigureSpec, LayerSpec} from './types';
import {isAdvancedLayer,prepareAdvanced} from './advanced';
import {selectAdvanced} from './advanced-view';

export interface ComparisonRun {
  id:string; label?:string; x:ArrayLike<number>; y:ArrayLike<number>;
  unit?:string; xUnit?:string; eventOffset?:number;
}
export interface RunComparisonOptions {
  alignment?:'exact'|'nearest'|'linear'; referenceRunId?:string; tolerance?:number; maxGap?:number;
  eventOffsets?:Record<string,number>; allowUnitMismatch?:boolean;
}
export interface ComparisonSample {value:number|null;sourceIndices:number[];interpolated:boolean;distance?:number}
export interface ComparisonRow {x:number;values:Record<string,number|null>;deltas:Record<string,number|null>;ratios:Record<string,number|null>;samples:Record<string,ComparisonSample>}
export interface RunComparison {
  referenceRunId:string; alignment:'exact'|'nearest'|'linear'; rows:ComparisonRow[];
  runs:Array<{id:string;label:string;x:Float64Array;y:Float64Array;unit?:string;xUnit?:string;eventOffset:number}>;
  lineage:{algorithm:'vesora-run-comparison';version:1;alignment:string;referenceRunId:string;inputs:Array<{runId:string;count:number;eventOffset:number}>;parameters:{tolerance:number|null;maxGap:number|null;unitConversion:false}};
}
const finite=(value:unknown,name:string,nonnegative=false):number=>{if(typeof value!=='number'||!Number.isFinite(value)||nonnegative&&value<0)throw new RangeError(`${name} must be ${nonnegative?'nonnegative and ':''}finite`);return value;};
const text=(value:unknown,name:string):string=>{if(typeof value!=='string'||!value)throw new TypeError(`${name} must be a nonempty string`);return value;};
function uniqueIds(values:readonly string[],name:string):void{if(!Array.isArray(values))throw new TypeError(`${name} must be an array`);const seen=new Set<string>();for(const value of values){text(value,name);if(seen.has(value))throw new Error(`${name} must be unique`);seen.add(value);}}
function lowerBound(values:ArrayLike<number>,value:number):number{let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<value)lo=mid+1;else hi=mid;}return lo;}

/** Align owned source samples. Missing values never become zero or bridge a gap. */
export function createRunComparison(input:readonly ComparisonRun[],options:RunComparisonOptions={}):RunComparison {
  if(!Array.isArray(input)||input.length<2)throw new RangeError('A comparison requires at least two runs');
  uniqueIds(input.map(run=>run.id),'Run IDs');
  const alignment=options.alignment??'exact';if(!['exact','nearest','linear'].includes(alignment))throw new TypeError('Unknown comparison alignment');
  const tolerance=options.tolerance===undefined?0:finite(options.tolerance,'tolerance',true);
  const maxGap=options.maxGap===undefined?Infinity:finite(options.maxGap,'maxGap',true);
  if(options.allowUnitMismatch!==undefined&&typeof options.allowUnitMismatch!=='boolean')throw new TypeError('allowUnitMismatch must be boolean');
  for(const key of Object.keys(options.eventOffsets??{}))if(!input.some(run=>run.id===key))throw new Error(`Unknown event-offset run ${key}`);
  const runs=input.map(run=>{
    if(!run.x||!run.y||!Number.isSafeInteger(run.x.length)||run.x.length!==run.y.length)throw new RangeError('Run x/y lengths must match');
    for(const name of ['label','unit','xUnit'] as const)if(run[name]!==undefined&&typeof run[name]!=='string')throw new TypeError(`${name} must be a string`);
    const offset=finite(options.eventOffsets&&Object.hasOwn(options.eventOffsets,run.id)?options.eventOffsets[run.id]:run.eventOffset??0,'eventOffset');
    const x=new Float64Array(run.x.length),y=new Float64Array(run.y.length);let previous=-Infinity;
    for(let i=0;i<x.length;i++){
      x[i]=finite(run.x[i],'Run x')-offset;if(!Number.isFinite(x[i])||x[i]<=previous)throw new RangeError('Run x must remain finite and strictly increasing after the event shift');previous=x[i];
      if(typeof run.y[i]!=='number')throw new TypeError('Run y must contain numbers');y[i]=run.y[i];
    }
    return {id:run.id,label:run.label??run.id,x,y,...(run.unit===undefined?{}:{unit:run.unit}),...(run.xUnit===undefined?{}:{xUnit:run.xUnit}),eventOffset:offset};
  });
  const referenceRunId=options.referenceRunId??runs[0].id,reference=runs.find(run=>run.id===referenceRunId);if(!reference)throw new Error('Unknown reference run');
  if(!options.allowUnitMismatch)for(const run of runs)if(run.unit!==reference.unit||run.xUnit!==reference.xUnit)throw new Error('Run units differ; declare matching units or explicitly allowUnitMismatch. Values are never converted.');
  const sample=(run:typeof runs[number],x:number):ComparisonSample=>{
    const right=lowerBound(run.x,x),missing=():ComparisonSample=>({value:null,sourceIndices:[],interpolated:false});
    if(right<run.x.length&&run.x[right]===x)return {value:Number.isFinite(run.y[right])?run.y[right]:null,sourceIndices:[right],interpolated:false,distance:0};
    if(alignment==='exact')return missing();
    if(alignment==='nearest'){
      const left=right-1,index=left>=0&&(right===run.x.length||x-run.x[left]<=run.x[right]-x)?left:right;
      if(index>=run.x.length||index<0||Math.abs(run.x[index]-x)>tolerance)return missing();
      // A nearby sample across a declared missing row must not mask the gap.
      if(left>=0&&right<run.x.length&&(!Number.isFinite(run.y[left])||!Number.isFinite(run.y[right])))return missing();
      return {value:Number.isFinite(run.y[index])?run.y[index]:null,sourceIndices:[index],interpolated:false,distance:Math.abs(run.x[index]-x)};
    }
    const left=right-1;if(left<0||right>=run.x.length||run.x[right]-run.x[left]>maxGap||!Number.isFinite(run.y[left])||!Number.isFinite(run.y[right]))return missing();
    const span=run.x[right]-run.x[left],t=Number.isFinite(span)?(x-run.x[left])/span:(x/2-run.x[left]/2)/(run.x[right]/2-run.x[left]/2),value=(1-t)*run.y[left]+t*run.y[right];
    return {value:Number.isFinite(value)?value:null,sourceIndices:[left,right],interpolated:true};
  };
  const rows=Array.from(reference.x,x=>{
    const samples=Object.fromEntries(runs.map(run=>[run.id,sample(run,x)])),values=Object.fromEntries(runs.map(run=>[run.id,samples[run.id].value]));
    const base=values[referenceRunId],deltas=Object.fromEntries(runs.map(run=>{const value=values[run.id],delta=value===null||base===null?null:value-base;return [run.id,delta===null||Number.isFinite(delta)?delta:null];}));
    const ratios=Object.fromEntries(runs.map(run=>{const value=values[run.id],ratio=value===null||base===null||base===0?null:value/base;return [run.id,ratio===null||Number.isFinite(ratio)?ratio:null];}));
    return {x,values,deltas,ratios,samples};
  });
  return {referenceRunId,alignment,rows,runs,lineage:{algorithm:'vesora-run-comparison',version:1,alignment,referenceRunId,inputs:runs.map(run=>({runId:run.id,count:run.x.length,eventOffset:run.eventOffset})),parameters:{tolerance:alignment==='nearest'?tolerance:null,maxGap:alignment==='linear'&&Number.isFinite(maxGap)?maxGap:null,unitConversion:false}}};
}

export interface ObservationGroupSpec {
  id:string;datasetId:string;rowIds:string[];members:Array<{layerId:string;rowIds:string[]}>;
  selectedIds?:string[];generation:number;sequence:number;
}
export interface ObservationLinkOptions {
  id?:string;datasetId:string;rowIds:readonly string[];
  members:ReadonlyArray<{layerId?:string;layer?:Layer;rowIds?:readonly string[]}>;
}
export interface ObservationPredicate {layerId:string;ranges:Record<string,readonly [number,number]>}
export interface ObservationQueryOptions {offset?:number;limit?:number;revision?:string}
export interface ObservationPage {ids:string[];total:number;offset:number;limit:number;nextOffset:number|null;revision:string;active:boolean}
export interface ObservationController {
  readonly id:string;selectIds(ids:readonly string[]):void;setPredicate(predicate:ObservationPredicate|null):void;
  selectBounds(layerId:string,bounds:Bounds):void;query(options?:ObservationQueryOptions):ObservationPage;clear():void;dispose():void;
}
export function observationRowCount(layer:LayerSpec,registry:Pick<DataRegistry,'get'>):number {
  const source=layer.kind==='ecdf'?layer.data.samples:layer.kind==='parallelCoordinates'?layer.data.c0:layer.kind==='ternary'?layer.data.a:layer.kind==='spectrogram'?layer.data.y:layer.kind==='contour'?layer.data.z:layer.data.x??layer.data.samples;
  if(!source)throw new Error(`Layer ${layer.id} does not have an observation-row domain`);
  const descriptor=registry.get(source).descriptor;return layer.kind==='contour'?descriptor.shape.reduce((a,b)=>a*b,1):descriptor.shape[0];
}
/** Shared importer/setter validation; does not mutate source ownership or selection. */
export function validateObservationGroups(groups:readonly ObservationGroupSpec[]|undefined,spec:FigureSpec,registry:Pick<DataRegistry,'get'>):void {
  if(groups===undefined)return;if(!Array.isArray(groups))throw new TypeError('Observation groups must be an array');
  const ids=new Set<string>(),usedLayers=new Set<string>();
  for(const group of groups){
    text(group.id,'Group id');text(group.datasetId,'Dataset id');if(ids.has(group.id))throw new Error('Duplicate observation group ID');ids.add(group.id);uniqueIds(group.rowIds,'Dataset row IDs');
    for(const value of [group.generation,group.sequence])if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Observation generation/sequence must be nonnegative safe integers');
    if(!Array.isArray(group.members)||!group.members.length)throw new RangeError('Observation groups require at least one member');
    const domain=new Set(group.rowIds),members=new Set<string>();
    for(const member of group.members){
      text(member.layerId,'Member layer id');const layer=spec.layers.find(layer=>layer.id===member.layerId);if(!layer||members.has(member.layerId)||usedLayers.has(member.layerId))throw new Error('Observation members must reference unique existing layers');members.add(member.layerId);usedLayers.add(member.layerId);
      if(layer.kind==='spectrogram'||layer.kind==='contour')throw new Error('Cell/window layers have a separate identity domain and cannot join raw observation rows');
      uniqueIds(member.rowIds,'Member row IDs');if(member.rowIds.length!==observationRowCount(layer,registry)||member.rowIds.some((id:string)=>!domain.has(id)))throw new RangeError('Member row IDs must match source rows and belong to the dataset dictionary');
    }
    if(group.selectedIds!==undefined){uniqueIds(group.selectedIds,'Selected row IDs');if(group.selectedIds.some((id:string)=>!domain.has(id)))throw new Error('Selected IDs must belong to the dataset dictionary');}
  }
}
function sourceToken(spec:FigureSpec,registry:Pick<DataRegistry,'get'>,members:ObservationGroupSpec['members']):string {
  return JSON.stringify(members.map(member=>{const layer=spec.layers.find(layer=>layer.id===member.layerId);if(!layer)throw new Error('Observation member was removed');return [layer.id,layer.kind,Object.entries(layer.data).map(([key,id])=>[key,id,registry.get(id).descriptor.version,registry.get(id).descriptor.shape])];}));
}
/** Stable dictionary identity, complete predicate membership and revision-fenced pages. */
export function linkObservations(figure:Figure,options:ObservationLinkOptions):ObservationController {
  for(const member of options.members)if(member.layer&&member.layer.figure!==figure)throw new Error('Observation members must belong to the supplied figure');
  const rowIds=Array.from(options.rowIds),id=options.id??`observations-${figure.spec.observationGroups?.length??0}`;
  const group:ObservationGroupSpec={id,datasetId:options.datasetId,rowIds,members:options.members.map(member=>({layerId:member.layerId??member.layer?.id??'',rowIds:Array.from(member.rowIds??rowIds)})),generation:0,sequence:0};
  if(figure.spec.observationGroups?.some(other=>other.id===id))throw new Error('Observation group ID already exists');
  validateObservationGroups([...(figure.spec.observationGroups??[]),group],figure.spec,figure.registry);
  let disposed=false;
  figure.setObservationGroups([...(figure.spec.observationGroups??[]),group]);
  const baseline=sourceToken(figure.spec,figure.registry,group.members),baselineEntries=new Map(group.members.flatMap(member=>Object.values(figure.spec.layers.find(layer=>layer.id===member.layerId)!.data)).map(id=>[id,figure.registry.get(id)]));
  const current=():ObservationGroupSpec=>{
    if(disposed)throw new Error('Observation controller is disposed');figure.snapshot();
    const entry=figure.spec.observationGroups?.find(entry=>entry.id===id);if(!entry)throw new Error('Observation group was removed');
    if(sourceToken(figure.spec,figure.registry,entry.members)!==baseline||[...baselineEntries].some(([id,before])=>figure.registry.get(id)!==before))throw new Error('STALE_OBSERVATIONS: source rows changed; relink using explicit current row IDs');return entry;
  };
  const commit=(ids:readonly string[]|undefined)=>{
    const previous=current(),next=structuredClone(previous);if(previous.sequence===Number.MAX_SAFE_INTEGER)throw new RangeError('Observation sequence exhausted');next.sequence++;
    if(ids===undefined)delete next.selectedIds;else next.selectedIds=Array.from(ids);
    const groups=(figure.spec.observationGroups??[]).map(entry=>entry.id===id?next:entry);validateObservationGroups(groups,figure.spec,figure.registry);figure.setObservationGroups(groups);
  };
  const selectIds=(ids:readonly string[])=>{uniqueIds(ids,'Selected row IDs');const wanted=new Set(ids),entry=current(),domain=new Set(entry.rowIds);if(ids.some(id=>!domain.has(id)))throw new Error('Unknown observation row ID');commit(entry.rowIds.filter(id=>wanted.has(id)));};
  const setPredicate=(predicate:ObservationPredicate|null)=>{
    if(predicate===null){commit(undefined);return;}const entry=current(),member=entry.members.find(member=>member.layerId===predicate.layerId),layer=figure.spec.layers.find(layer=>layer.id===predicate.layerId);
    if(!member||!layer)throw new Error('Predicate layer must belong to the observation group');
    if(!predicate.ranges||!Object.keys(predicate.ranges).length)throw new Error('A predicate requires at least one channel range');
    const channels=Object.entries(predicate.ranges).map(([key,range])=>{
      const axis=layer.kind==='parallelCoordinates'?(layer.options as {axes?:Array<{key:string}>})?.axes?.findIndex(axis=>axis.key===key):-1;
      const channel=axis!==undefined&&axis>=0?`c${axis}`:key,source=layer.data[channel];if(!source)throw new Error(`Unknown observation channel ${key}`);
      if(!Array.isArray(range)||range.length!==2||!range.every(Number.isFinite)||range[0]>range[1])throw new RangeError('Predicate ranges must be ordered finite pairs');
      const values=figure.registry.get(source).values;if(values.length!==member.rowIds.length)throw new Error('Predicate channels must share the observation row domain');return {values,range};
    });
    const selected:string[]=[];for(let i=0;i<member.rowIds.length;i++)if(channels.every(({values,range})=>Number.isFinite(values[i])&&values[i]>=range[0]&&values[i]<=range[1]))selected.push(member.rowIds[i]);selectIds(selected);
  };
  const selectBounds=(layerId:string,bounds:Bounds)=>{
    if(!bounds||!(['x','y'] as const).every(axis=>Array.isArray(bounds[axis])&&bounds[axis].length===2&&bounds[axis].every(Number.isFinite)&&bounds[axis][0]<=bounds[axis][1]))throw new RangeError('Selection bounds must contain finite ordered x/y ranges');
    const entry=current(),member=entry.members.find(member=>member.layerId===layerId),layer=figure.spec.layers.find(layer=>layer.id===layerId);if(!member||!layer)throw new Error('Bounds layer must belong to the observation group');
    if(layer.kind==='parallelCoordinates')throw new Error('Use source-axis range predicates for parallel coordinates');
    if(isAdvancedLayer(layer)){const rows=selectAdvanced(prepareAdvanced(layer,figure.registry),bounds);selectIds(rows.map(index=>member.rowIds[index]).filter((id):id is string=>id!==undefined));}
    else setPredicate({layerId,ranges:{x:bounds.x,y:bounds.y}});
  };
  const unsubscribe=figure.on('selection',event=>{
    const member=group.members.find(member=>member.layerId===event.layerId);if(!member)return;
    const selection=event as typeof event&{bounds?:Bounds;indices?:number[];sourceIndices?:number[];truncated?:boolean;sourceKind?:string;predicate?:ObservationPredicate;sourceRevision?:number;observationGroupsCommitted?:boolean;mode?:string};
    if(selection.observationGroupsCommitted||selection.mode==='frozen')return;
    if(selection.sourceKind==='cell'||selection.sourceKind==='window')return;
    if(selection.sourceRevision!==undefined&&selection.sourceRevision!==figure.acceptedRevision)return;
    if(selection.predicate){setPredicate(selection.predicate);return;}
    if(selection.bounds){
      selectBounds(event.layerId,selection.bounds);return;
    }
    if(selection.sourceIndices&&!selection.truncated){selectIds(selection.sourceIndices.map(index=>member.rowIds[index]).filter((id):id is string=>id!==undefined));return;}
    if(selection.indices&&!selection.truncated)selectIds(selection.indices.map(index=>member.rowIds[index]).filter((id):id is string=>id!==undefined));
    // A truncated preview never substitutes for complete predicate membership.
  });
  return {id,selectIds,setPredicate,selectBounds,
    query:(options={})=>{
      const entry=current(),revision=`${entry.generation}:${entry.sequence}:${baseline}`;if(options.revision!==undefined&&options.revision!==revision)throw new Error('STALE_OBSERVATIONS: query revision changed');
      const offset=options.offset??0,limit=options.limit??1000;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>10000)throw new RangeError('Query offset must be nonnegative and limit from 1 through 10000');
      const ids=entry.selectedIds??entry.rowIds;return {ids:ids.slice(offset,offset+limit),total:ids.length,offset,limit,nextOffset:offset+limit<ids.length?offset+limit:null,revision,active:entry.selectedIds!==undefined};
    },clear:()=>commit(undefined),dispose:()=>{if(disposed)return;disposed=true;unsubscribe();try{figure.setObservationGroups((figure.spec.observationGroups??[]).filter(entry=>entry.id!==id));}catch(error){if(!(error instanceof Error)||!/closed/i.test(error.message))throw error;}}};
}
