/** Opt-in experiments. Exports contain retained, ordinary static scene layers. */
import {Figure,Layer,Panel,subplots} from './figure';
import type {Grid,Series,LayerOptions} from './figure';
import type {AppendOptions,ExportPNGOptions,Snapshot,ThemeInput} from './types';
import type {SnapshotLease} from './snapshot-store';
import {encodeHTMLSnapshot} from './html-export';

export interface TrajectoryState {streamId:string;revision:number;nextSequence:number;retained:number;evicted:number;maxPoints:number;sourceVersion:number}
export interface TrajectoryBatch {x:Series;y:Series;z:Series;values?:Series}
let serial=0;
function capacity(value:number,minimum=1):number{if(!Number.isSafeInteger(value)||value<minimum)throw new RangeError(`Capacity must be an integer of at least ${minimum}`);return value;}
function numeric(values:Series,name:string):void{if(!values||!Number.isSafeInteger(values.length)||values.length<0)throw new TypeError(`${name} must be an array of numbers`);for(let i=0;i<values.length;i++)if(typeof values[i]!=='number')throw new TypeError(`${name} must contain numbers`);}
function tail(previous:Float64Array,added:Series,maximum:number):Float64Array{
  const retained=Math.min(maximum,previous.length+added.length),out=new Float64Array(retained),take=Math.min(added.length,retained),old=retained-take;
  out.set(previous.subarray(previous.length-old),0);for(let i=0;i<take;i++)out[old+i]=added[added.length-take+i];return out;
}

/** Bounded spatial trajectory. Sequence is acquisition order, never spatial x. */
export class LiveTrajectory {
  readonly layer:Layer;
  readonly maxPoints:number;
  private arrays:Record<'x'|'y'|'z'|'color',Float64Array>={x:new Float64Array(0),y:new Float64Array(0),z:new Float64Array(0),color:new Float64Array(0)};
  private next=0;private revision=0;private disposed=false;
  private sourceVersion?:number;
  private sources:Record<string,{id:string;version:number}>={};
  private identities=new Map<number,{first:number;count:number;acceptedRevision:number}>();
  private pendingVersion?:number;private displayedVersion?:number;private cleanup:Array<()=>void>=[];
  private readonly streamId=`labs-trajectory-${++serial}`;
  constructor(panel:Panel,options:{maxPoints:number;scalar?:boolean;style?:Omit<LayerOptions,'values'>}){
    this.maxPoints=capacity(options.maxPoints);this.scalar=options.scalar??false;
    this.layer=panel.plot3d([],[],[],{...options.style,...(this.scalar?{values:[]}: {})});this.remember();
    const figure=panel.figure;
    this.cleanup.push(figure.on('framepending',state=>{let revision=-1;for(const [version,identity]of this.identities)if(identity.acceptedRevision<=state.displayedRevision&&identity.acceptedRevision>revision){revision=identity.acceptedRevision;this.pendingVersion=version;}}));
    const displayed=()=>{const snapshot=figure.getInspectionSnapshot(),layer=snapshot.figure.layers.find(item=>item.id===this.layer.id);this.displayedVersion=layer?snapshot.sources.find(source=>source.id===layer.data.x)?.version:undefined;this.prune();};
    this.cleanup.push(figure.on('frame',()=>{displayed();this.pendingVersion=undefined;this.prune();}),figure.on('inspectionchange',displayed));
  }
  private readonly scalar:boolean;
  private assertOpen():void{if(this.disposed)throw new Error('Labs trajectory is closed');const spec=this.layer.spec;if(Object.keys(spec.data).length!==Object.keys(this.sources).length||Object.entries(this.sources).some(([role,source])=>spec.data[role]!==source.id||this.layer.figure.registry.get(source.id).descriptor.version!==source.version))throw new Error('Trajectory source data was changed outside its Labs producer');}
  private prune():void{const unpinned=[...this.identities.keys()].filter(version=>version!==this.pendingVersion&&version!==this.displayedVersion&&version!==this.sourceVersion);while(unpinned.length>64)this.identities.delete(unpinned.shift()!);}
  private remember():void{const figure=this.layer.figure;this.sources=Object.fromEntries(Object.entries(this.layer.spec.data).map(([role,id])=>[role,{id,version:figure.registry.get(id).descriptor.version}]));const version=this.sources.x.version;this.sourceVersion=version;this.identities.set(version,{first:this.next-this.arrays.x.length,count:this.arrays.x.length,acceptedRevision:figure.acceptedRevision});this.prune();}
  getState():TrajectoryState{this.assertOpen();return {streamId:this.streamId,revision:this.revision,nextSequence:this.next,retained:this.arrays.x.length,evicted:this.next-this.arrays.x.length,maxPoints:this.maxPoints,sourceVersion:this.layer.figure.registry.get(this.layer.spec.data.x).descriptor.version};}
  /** Unknown/expired displayed revisions return undefined rather than aliasing a newer row. */
  sequenceAt(index:number,sourceVersion=this.getState().sourceVersion):number|undefined{const frame=this.identities.get(sourceVersion);return frame&&Number.isSafeInteger(index)&&index>=0&&index<frame.count?frame.first+index:undefined;}
  async append(batch:TrajectoryBatch,options:AppendOptions={}):Promise<TrajectoryState>{
    this.assertOpen();const figure=this.layer.figure,waitFor=options.waitFor??'rendered';if(waitFor!=='accepted'&&waitFor!=='rendered')throw new TypeError('waitFor must be accepted or rendered');
    if(waitFor==='rendered'&&figure.getInspectionState().mode==='frozen')throw Object.assign(new Error('Use accepted acknowledgement while inspection is frozen'),{code:'PRESENTATION_FROZEN',accepted:false});
    for(const key of ['x','y','z'] as const)numeric(batch[key],key);const count=batch.x.length;
    if(batch.y.length!==count||batch.z.length!==count||this.scalar&&(!batch.values||batch.values.length!==count)||!this.scalar&&batch.values!==undefined)throw new Error('Trajectory channels must align with the configured scalar channel');
    if(batch.values)numeric(batch.values,'values');if(!Number.isSafeInteger(this.next+count))throw new RangeError('Trajectory sequence exceeds the safe integer range');
    if(count){const next={x:tail(this.arrays.x,batch.x,this.maxPoints),y:tail(this.arrays.y,batch.y,this.maxPoints),z:tail(this.arrays.z,batch.z,this.maxPoints),color:this.scalar?tail(this.arrays.color,batch.values!,this.maxPoints):this.arrays.color};
      this.layer.setData({x:next.x,y:next.y,z:next.z,...(this.scalar?{color:next.color}:{})});this.arrays=next;this.next+=count;this.revision++;this.remember();}
    const accepted=this.getState();if(waitFor==='rendered')await figure.ready({target:'live'});return accepted;
  }
  close():void{if(this.disposed)return;try{if(this.layer.figure.spec.layers.some(layer=>layer.id===this.layer.id)&&this.layer.figure.registry.store.has(this.sources.x?.id))this.layer.remove();}finally{for(const remove of this.cleanup)remove();this.cleanup=[];this.arrays={x:new Float64Array(0),y:new Float64Array(0),z:new Float64Array(0),color:new Float64Array(0)};this.identities.clear();this.sources={};this.disposed=true;}}
}
export function createTrajectory(panel:Panel,options:ConstructorParameters<typeof LiveTrajectory>[1]):LiveTrajectory{return new LiveTrajectory(panel,options);}

function grid(values:Grid,rows:number,columns:number):Float64Array{
  if(Array.isArray(values)&&Array.isArray(values[0])){if(values.length!==rows||(values as number[][]).some(row=>row.length!==columns))throw new Error('Grid shape does not match rows and fixed columns');return Float64Array.from((values as number[][]).flat());}
  numeric(values as Series,'z');if((values as Series).length!==rows*columns)throw new Error('Grid shape does not match rows and fixed columns');return Float64Array.from(values as Series);
}
function ownBuffers(figure:Figure):Map<string,ArrayBuffer>{return new Map([...figure.registry.entries()].map(([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer]));}

export interface RollingSurfaceState {revision:number;nextSequence:number;retainedRows:number;evictedRows:number;maxRows:number;columns:number}
/** An owned two-panel figure; atomic core snapshots publish surface and heatmap together. */
export class RollingSurface {
  readonly figure:Figure;readonly surface:Layer;readonly heatmap:Layer;readonly maxRows:number;
  private readonly x:Float64Array;private y:Float64Array;private z:Float64Array;private next:number;private revision=0;private disposed=false;
  constructor(options:{x:Series;y:Series;z:Grid;maxRows:number;title?:string;theme?:ThemeInput;maxSourceBytes?:number;maxSnapshotBytes?:number}){
    this.maxRows=capacity(options.maxRows,2);numeric(options.x,'x');numeric(options.y,'y');if(options.x.length<2||options.y.length<2)throw new Error('Rolling surfaces require at least two columns and initial rows');
    for(const axis of [options.x,options.y])for(let i=0;i<axis.length;i++)if(!Number.isFinite(axis[i])||i>0&&axis[i]<=axis[i-1])throw new Error('Rolling grid coordinates must be finite and strictly increasing');
    this.x=Float64Array.from(options.x);this.next=options.y.length;this.y=Float64Array.from(options.y).slice(-this.maxRows);this.z=grid(options.z,options.y.length,this.x.length).slice(-this.y.length*this.x.length);
    this.figure=subplots({rows:1,cols:2,kinds:[['3d','2d']],title:options.title??'Labs · rolling surface',theme:options.theme,runtime:{...(options.maxSourceBytes!==undefined?{maxSourceBytes:options.maxSourceBytes}:{}),...(options.maxSnapshotBytes!==undefined?{maxSnapshotBytes:options.maxSnapshotBytes}:{})}});
    try{this.surface=this.figure.panel(0,0).surface(this.x,this.y,this.z);this.heatmap=this.figure.panel(0,1).heatmap(this.x,this.y,this.z);}catch(error){this.figure.close();throw error;}
  }
  getState():RollingSurfaceState{if(this.disposed)throw new Error('Rolling surface is closed');return {revision:this.revision,nextSequence:this.next,retainedRows:this.y.length,evictedRows:this.next-this.y.length,maxRows:this.maxRows,columns:this.x.length};}
  async appendRows(batch:{y:Series;z:Grid},options:AppendOptions={}):Promise<RollingSurfaceState>{
    this.getState();const waitFor=options.waitFor??'rendered';if(waitFor!=='accepted'&&waitFor!=='rendered')throw new TypeError('waitFor must be accepted or rendered');
    if(waitFor==='rendered'&&this.figure.getInspectionState().mode==='frozen')throw Object.assign(new Error('Use accepted acknowledgement while inspection is frozen'),{code:'PRESENTATION_FROZEN',accepted:false});
    if(this.figure.streams.size)throw new Error('The owned rolling-surface figure cannot contain independent core streams');
    numeric(batch.y,'y');if(!batch.y.length)return this.getState();if(!Number.isSafeInteger(this.next+batch.y.length))throw new RangeError('Row sequence exceeds the safe integer range');
    for(let i=0;i<batch.y.length;i++)if(!Number.isFinite(batch.y[i])||batch.y[i]<=(i?batch.y[i-1]:this.y[this.y.length-1]))throw new Error('Rolling row coordinates must be finite and strictly increasing');
    const added=grid(batch.z,batch.y.length,this.x.length),nextY=tail(this.y,batch.y,this.maxRows),nextZ=tail(this.z,added,this.maxRows*this.x.length),staged=new Figure({runtime:this.figure.runtime});
    try{
      staged.applySnapshot(this.figure.snapshot(),ownBuffers(this.figure));
      for(const id of [this.surface.id,this.heatmap.id])new Layer(staged,id).setData({y:nextY,z:nextZ});
      this.figure.applySnapshot(staged.snapshot(),ownBuffers(staged));
    }finally{staged.close();}
    this.y=nextY;this.z=nextZ;this.next+=batch.y.length;this.revision++;const accepted=this.getState();if(waitFor==='rendered')await this.figure.ready({target:'live'});return accepted;
  }
  close():void{if(this.disposed)return;this.figure.close();this.y=new Float64Array(0);this.z=new Float64Array(0);this.disposed=true;}
}
export function createRollingSurface(options:ConstructorParameters<typeof RollingSurface>[0]):RollingSurface{return new RollingSurface(options);}

export interface SurfaceDetail {
  x:Float64Array;y:Float64Array;z:Float64Array;sourceColumns:Uint32Array;sourceRows:Uint32Array;
  info:{exact:boolean;method:string;sourceVertices:number;retainedVertices:number;omittedCoarseCells:number;maxSourceCellSpan:[number,number]};
}
/** Budgeted, explicitly approximate grid detail; callers own the full source data. */
export function sampleSurfaceGrid(x:Series,y:Series,z:Grid,options:{maxVertices:number}):SurfaceDetail{
  const budget=capacity(options.maxVertices,4);numeric(x,'x');numeric(y,'y');if(x.length<2||y.length<2)throw new Error('Surface detail requires a 2 × 2 grid');
  for(const axis of [x,y])for(let i=0;i<axis.length;i++)if(!Number.isFinite(axis[i])||i&&axis[i]<=axis[i-1])throw new Error('Grid coordinates must be finite and strictly increasing');
  const values=grid(z,y.length,x.length),exact=x.length*y.length<=budget;
  let rows=exact?y.length:Math.max(2,Math.min(y.length,Math.floor(Math.sqrt(budget*y.length/x.length)))),columns=exact?x.length:Math.max(2,Math.min(x.length,Math.floor(budget/rows)));
  while(rows*columns>budget)if(rows>=columns&&rows>2)rows--;else columns--;
  const select=(length:number,count:number)=>Uint32Array.from({length:count},(_,i)=>Math.round(i*(length-1)/(count-1))),sourceRows=select(y.length,rows),sourceColumns=select(x.length,columns),out=new Float64Array(rows*columns),mask=new Uint8Array(rows*columns);
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++)out[r*columns+c]=values[sourceRows[r]*x.length+sourceColumns[c]];
  let omitted=0;
  if(!exact)for(let r=0;r<rows-1;r++)for(let c=0;c<columns-1;c++){
    let missing=false;for(let sr=sourceRows[r];sr<=sourceRows[r+1]&&!missing;sr++)for(let sc=sourceColumns[c];sc<=sourceColumns[c+1];sc++)if(!Number.isFinite(values[sr*x.length+sc])){missing=true;break;}
    if(missing){omitted++;mask[r*columns+c]=mask[r*columns+c+1]=mask[(r+1)*columns+c]=mask[(r+1)*columns+c+1]=1;}
  }
  for(let i=0;i<mask.length;i++)if(mask[i])out[i]=NaN;
  const maximumSpan=(indices:Uint32Array)=>{let maximum=0;for(let i=1;i<indices.length;i++)maximum=Math.max(maximum,indices[i]-indices[i-1]);return maximum;};
  return {x:Float64Array.from(sourceColumns,i=>x[i]),y:Float64Array.from(sourceRows,i=>y[i]),z:out,sourceColumns,sourceRows,info:{exact,method:exact?'full regular grid':'approximate boundary-preserving grid sampling; missing coarse cells omitted',sourceVertices:x.length*y.length,retainedVertices:out.length,omittedCoarseCells:omitted,maxSourceCellSpan:[maximumSpan(sourceColumns),maximumSpan(sourceRows)]}};
}

export interface PinnedSnapshot {readonly snapshot:Snapshot;readonly bytes:number;readonly capturedAt:string;toHTML():string;exportPNG(options?:ExportPNGOptions):Promise<Blob>;release():void}
export class ABPins {
  private entries=new Map<'A'|'B',{lease:SnapshotLease;pin:PinnedSnapshot}>();
  constructor(private readonly figure:Figure){}
  pin(slot:'A'|'B',source:'accepted'|'displayed'='displayed'):PinnedSnapshot{
    if(slot!=='A'&&slot!=='B')throw new TypeError('Pin slot must be A or B');
    const lease=this.figure.captureExport(source),previous=this.entries.get(slot);let released=false;
    const ensure=()=>{if(released||!lease.registry.store.size&&lease.snapshot.sources.length)throw new Error('Pinned snapshot has been released');};
    const pin:PinnedSnapshot={get snapshot(){ensure();return structuredClone(lease.snapshot);},get bytes(){return lease.bytes;},get capturedAt(){return lease.capturedAt;},
      toHTML:()=>{ensure();return encodeHTMLSnapshot(lease.snapshot,lease.registry);},
      exportPNG:async options=>{ensure();return this.figure.savefigSnapshot(lease.snapshot,new Map(lease.registry.entries()),{...options,source:'displayed'});},
      release:()=>{if(released)return;released=true;lease.release();if(this.entries.get(slot)?.pin===pin)this.entries.delete(slot);}};
    this.entries.set(slot,{lease,pin});previous?.pin.release();return pin;
  }
  get(slot:'A'|'B'):PinnedSnapshot|undefined{return this.entries.get(slot)?.pin;}
  close():void{for(const {pin}of [...this.entries.values()])pin.release();this.entries.clear();}
}
export function createABPins(figure:Figure):ABPins{return new ABPins(figure);}
