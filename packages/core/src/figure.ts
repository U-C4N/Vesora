import {DataRegistry,toNumericArray,validateDescriptor,describeData} from './data';
import {validateDomain} from './scales';
import {parseColor} from './color';
import {FigureView} from './view';
import {validateSelectionLink} from './linked';
import {hasTypography,resolveTheme,validateTheme,validateAxisFormat} from './presentation';
import {validateBandData,validateBandStyle} from './band';
import {validateExportPNGOptions} from './export-options';
import {validateInspectionX} from './inspection';
import {appendEntry,lastValue,streamEntry,streamError,validateStreamingOptions,validateStreamState} from './streaming';
import type {DataEntry,StreamState,StreamingOptions,ReadyOptions,RuntimeOptions} from './types';
import type {AxisFormat,ThemeInput,PresentationOptions,FigureEventMap,ViewChangeEvent,FillBetweenOptions,HoverMode,ExportPNGOptions} from './types';
import type {SelectionLinkSpec,LinkedSelection,Bounds} from './types';
import {axisCategories,categoryKey,encodeAxis,isStatistical,labels,statisticalOptions,validateSemantics,validateStatisticalData} from './semantics';
import type {AxisSeries} from './semantics';
import type {BarMode,BarSpecOptions,BoxplotSpecOptions,HistogramSpecOptions,StatisticalOptions} from './types';
import type {FigureSpec,FigureOptions,LayerSpec,LayerKind,LayerStyle,NumericArray,ViewSpec,ViewBookmark,ViewState,Snapshot,RepresentationInfo,PanelEntry,AnnotationSpec,AnnotationStyle,AnnotationOptions,SubplotsOptions} from './types';
import {PROTOCOL_VERSION,EXTENDED_PROTOCOL_VERSION,STATISTICS_PROTOCOL_VERSION,LINKED_PROTOCOL_VERSION,PRESENTATION_PROTOCOL_VERSION,QUALITY_PROTOCOL_VERSION} from './types';

let serial=0;
const id=(prefix:string)=>`${prefix}-${++serial}`;
export type Series=ArrayLike<number>;
export type Grid=Series|number[][];
export type LayerOptions=LayerStyle & {values?: Series};
export type {AxisSeries} from './semantics';
export type HistogramOptions=LayerStyle & Partial<HistogramSpecOptions>;
export type BarOptions=LayerStyle & {barWidth?:number;bottom?:number|Series;left?:number|Series};
export type BoxplotOptions=LayerStyle & Partial<BoxplotSpecOptions> & {labels?:string[]};
export type Groups=Series|readonly Series[];
export type FigureEvent=keyof FigureEventMap;
export function defaultView(kind:'2d'|'3d'='2d'):ViewSpec{return {kind,xScale:'linear',yScale:'linear',zScale:'linear',xLabel:'',yLabel:'',zLabel:'',camera:{azimuth:35,elevation:25,distance:3},pan3d:[0,0]};}
function validateView(view:ViewSpec):void{
  if(!view||!['2d','3d'].includes(view.kind))throw new Error('Invalid view kind');
  for(const axis of ['x','y','z'] as const){
    const scale=view[`${axis}Scale`];if(!['linear','log','time'].includes(scale))throw new Error('Scale must be linear, log or time');
    if(scale==='time'&&(axis==='z'||view.kind==='3d'))throw new Error('Time scales require a 2D x or y axis');
    const domain=view[`${axis}Domain`];if(domain!==undefined){validateDomain(domain,scale);if(axis!=='z'&&view[`${axis}Format`]?.kind==='date')validateDomain(domain,'time');}
    if(typeof view[`${axis}Label`]!=='string')throw new TypeError('Axis labels must be strings');
  }
  for(const axis of ['x','y'] as const)if(view[`${axis}Format`]!==undefined)validateAxisFormat(view[`${axis}Format`]!);
  if(!view.camera||!['azimuth','elevation','distance'].every(key=>Number.isFinite(view.camera[key as keyof ViewSpec['camera']]))||view.camera.distance<=0)throw new Error('Invalid camera');
  if(view.pan3d!==undefined&&(!Array.isArray(view.pan3d)||view.pan3d.length!==2||!view.pan3d.every(Number.isFinite)))throw new Error('3D pan must contain two finite values');
}
function copyView(view:ViewSpec):ViewSpec{
  validateView(view);const copy=structuredClone(view);
  for(const key of ['xDomain','yDomain','zDomain','pan3d','xFormat','yFormat'] as const)if(copy[key]===undefined)delete copy[key];
  for(const axis of ['x','y'] as const)if(copy[`${axis}Format`]!==undefined)copy[`${axis}Format`]=validateAxisFormat(copy[`${axis}Format`]!);
  return copy;
}
function bookmarkName(name:string):string{
  if(typeof name!=='string'||!name.trim())throw new TypeError('Bookmark name must be a nonempty string');
  return name.trim();
}
function panelEntries(spec:FigureSpec):PanelEntry[]{
  return spec.panels?.map(panel=>({...panel,view:panel.id==='main'?spec.view:panel.view!}))??[{id:'main',row:0,col:0,title:'',view:spec.view}];
}
function validateLayout(spec:FigureSpec):void{
  if(spec.layout===undefined&&spec.panels===undefined)return;
  const layout=spec.layout;
  if(!layout||!Array.isArray(spec.panels))throw new Error('Layout and panels must be supplied together');
  if(!Number.isSafeInteger(layout.rows)||!Number.isSafeInteger(layout.cols)||layout.rows<1||layout.cols<1||!Number.isSafeInteger(layout.rows*layout.cols))throw new RangeError('Grid rows and cols must be positive safe integers');
  if(typeof layout.shareX!=='boolean'||typeof layout.shareY!=='boolean')throw new TypeError('Shared axis options must be booleans');
  if(spec.panels.length!==layout.rows*layout.cols)throw new Error('Grid must contain exactly one panel per cell');
  const ids=new Set<string>(),cells=new Set<string>();
  for(const panel of spec.panels){
    if(!panel||typeof panel.id!=='string'||!panel.id||ids.has(panel.id))throw new Error('Panel ids must be nonempty and unique');
    if(!Number.isInteger(panel.row)||!Number.isInteger(panel.col)||panel.row<0||panel.col<0||panel.row>=layout.rows||panel.col>=layout.cols)throw new RangeError('Panel is outside the grid');
    const cell=`${panel.row},${panel.col}`;if(cells.has(cell))throw new Error('Duplicate panel cell');
    ids.add(panel.id);cells.add(cell);
    if(typeof panel.title!=='string')throw new TypeError('Panel title must be a string');
    if(panel.id==='main'){
      if(panel.row!==0||panel.col!==0||panel.view!==undefined)throw new Error('The main panel must occupy (0, 0) and use the figure view');
    }else{validateView(panel.view!);if(panel.view!.kind!=='2d')throw new Error('Grid panels must be 2D');}
  }
  if(!ids.has('main')||spec.view.kind!=='2d')throw new Error('Grid requires a main 2D panel');
}
function captureViews(spec:FigureSpec):ViewState{
  const result:ViewState={view:copyView(spec.view)};
  if(spec.layout)result.panelViews=Object.fromEntries(panelEntries(spec).filter(panel=>panel.id!=='main').map(panel=>[panel.id,copyView(panel.view)]));
  return result;
}
function validateViewState(spec:FigureSpec,state:ViewState):void{
  if(!state)throw new TypeError('A view state is required');
  validateView(state.view);
  const secondary=panelEntries(spec).filter(panel=>panel.id!=='main');
  if(spec.layout){
    if(!state.panelViews||Array.isArray(state.panelViews)||typeof state.panelViews!=='object')throw new Error('Grid view state requires panelViews');
    const keys=Object.keys(state.panelViews);
    if(keys.length!==secondary.length||keys.some(key=>!secondary.some(panel=>panel.id===key)))throw new Error('View state must include every secondary panel exactly once');
  }else if(state.panelViews!==undefined)throw new Error('A single view cannot contain panelViews');
  const views=[state.view,...secondary.map(panel=>state.panelViews![panel.id])];
  for(const view of views){validateView(view);if(spec.layout&&view.kind!=='2d')throw new Error('Grid views must be 2D');}
  for(const axis of ['x','y'] as const){
    if(!spec.layout?.[axis==='x'?'shareX':'shareY'])continue;
    const scale=state.view[`${axis}Scale`],domain=state.view[`${axis}Domain`];
    for(const view of views)if(view[`${axis}Scale`]!==scale||JSON.stringify(view[`${axis}Domain`])!==JSON.stringify(domain)||JSON.stringify(view[`${axis}Format`])!==JSON.stringify(state.view[`${axis}Format`]))throw new Error('Shared axis views must have matching scales, domains and formats');
  }
}
function validateAnnotation(annotation:AnnotationSpec,panels:PanelEntry[]):void{
  if(!annotation||typeof annotation.id!=='string'||!annotation.id)throw new TypeError('Annotation id must be a nonempty string');
  if(!['text','hline','vline'].includes(annotation.kind))throw new Error('Unknown annotation kind');
  if(annotation.panelId!==undefined&&(typeof annotation.panelId!=='string'||!annotation.panelId))throw new TypeError('Annotation panelId must be a nonempty string');
  const panel=panels.find(item=>item.id===(annotation.panelId??'main'));
  if(!panel)throw new Error('Annotation references an unknown panel');
  if(panel.view.kind!=='2d')throw new Error('Annotations require a 2D panel');
  const required=annotation.kind==='text'?['x','y']:annotation.kind==='hline'?['y']:['x'];
  for(const coordinate of ['x','y'] as const){
    if(required.includes(coordinate)){if(typeof annotation[coordinate]!=='number'||!Number.isFinite(annotation[coordinate]))throw new TypeError('Annotation coordinates must be finite numbers');}
    else if(annotation[coordinate]!==undefined)throw new TypeError(`Unexpected annotation coordinate ${coordinate}`);
  }
  if(annotation.kind==='text'){if(typeof annotation.text!=='string')throw new TypeError('Annotation text must be a string');}
  else if(annotation.text!==undefined)throw new TypeError('Reference lines do not accept text');
  const style=annotation.style;if(!style||typeof style!=='object'||Array.isArray(style))throw new TypeError('Annotation style must be an object');
  for(const key of Object.keys(style))if(!['color','width','opacity','fontSize'].includes(key))throw new TypeError(`Unknown annotation style ${key}`);
  if(style.color!==undefined){if(typeof style.color!=='string')throw new TypeError('Annotation color must be a string');parseColor(style.color);}
  for(const key of ['width','fontSize'] as const)if(style[key]!==undefined&&(typeof style[key]!=='number'||!Number.isFinite(style[key])||style[key]!<=0))throw new RangeError(`${key} must be finite and positive`);
  if(style.opacity!==undefined&&(typeof style.opacity!=='number'||!Number.isFinite(style.opacity)||style.opacity<0||style.opacity>1))throw new RangeError('opacity must be between 0 and 1');
}
function annotationUpdate(annotation:AnnotationSpec,options:AnnotationOptions):AnnotationSpec{
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Annotation options must be an object');
  const next=structuredClone(annotation);
  for(const [key,value] of Object.entries(options)){
    if(['x','y','text'].includes(key))(next as any)[key]=value;
    else if(['color','width','opacity','fontSize'].includes(key))(next.style as any)[key]=value;
    else throw new TypeError(`Unknown annotation option ${key}`);
  }
  return next;
}
function validateBookmarks(bookmarks:ViewBookmark[]|undefined,spec:FigureSpec):void{
  if(bookmarks===undefined)return;
  if(!Array.isArray(bookmarks))throw new TypeError('Bookmarks must be an array');
  const names=new Set<string>();
  for(const bookmark of bookmarks){
    if(!bookmark)throw new TypeError('Invalid bookmark');
    const name=bookmarkName(bookmark.name);
    if(name!==bookmark.name)throw new TypeError('Bookmark names must not have surrounding whitespace');
    if(names.has(name))throw new Error('Duplicate bookmark name');names.add(name);
    if(bookmark.note!==undefined&&typeof bookmark.note!=='string')throw new TypeError('Bookmark note must be a string');
    validateViewState(spec,bookmark);if(bookmark.view.kind!==spec.view.kind)throw new Error('Bookmark dimensionality does not match figure');
  }
}
function flatten(values:Grid):NumericArray{return toNumericArray(Array.isArray(values)&&Array.isArray(values[0])?(values as number[][]).flat():values as Series);}
export function validateStyle(style:LayerStyle):void{
  if(!style||typeof style!=='object'||Array.isArray(style))throw new TypeError('Style must be an object');
  for(const key of Object.keys(style))if(!['color','size','width','opacity','label','colormap','representation','colorDomain','colorbarLabel'].includes(key))throw new TypeError(`Unknown style option ${key}`);
  for(const key of ['label','colorbarLabel'] as const)if(style[key]!==undefined&&typeof style[key]!=='string')throw new TypeError(`${key} must be a string`);
  if(style.color!==undefined)parseColor(style.color);
  for(const key of ['width','size'] as const)if(style[key]!==undefined&&(!Number.isFinite(style[key])||style[key]!<=0))throw new RangeError(`${key} must be finite and positive`);
  if(style.opacity!==undefined&&(!Number.isFinite(style.opacity)||style.opacity<0||style.opacity>1))throw new RangeError('opacity must be between 0 and 1');
  if(style.representation!==undefined&&!['auto','points','density'].includes(style.representation))throw new Error('Invalid representation');
  if(style.colormap!==undefined&&!['viridis','magma'].includes(style.colormap))throw new Error('Invalid colormap');
  if(style.colorDomain)validateDomain(style.colorDomain,'linear');
}
export class Layer {
  constructor(readonly figure:Figure,readonly id:string){}
  get spec():LayerSpec{const layer=this.figure.spec.layers.find(l=>l.id===this.id);if(!layer)throw new Error('Layer has been removed');return layer;}
  setData(data:Record<string,unknown>):this{this.figure.updateData(this.spec,data);return this;}
  enableStreaming(options:StreamingOptions):this{this.figure.enableStreaming(this,options);return this;}
  appendData(data:Record<string,unknown>):Promise<void>{return this.figure.appendDataBatch([{layer:this,data}]);}
  disableStreaming():this{this.figure.disableStreaming(this.id);return this;}
  setOptions(options:Record<string,unknown>):this{this.figure.updateOptions(this.spec,options);return this;}
  setStyle(style:LayerStyle):this{this.figure.updateStyle(this.spec,style);return this;}
  setVisible(visible:boolean):this{this.figure.updateVisibility(this.spec,visible);return this;}
  remove():void{const layer=this.spec;this.figure.disableStreaming(this.id);this.figure.unlinkLayer(this.id);this.figure.spec.layers=this.figure.spec.layers.filter(l=>l.id!==this.id);for(const source of Object.values(layer.data))if(!this.figure.spec.layers.some(other=>Object.values(other.data).includes(source)))this.figure.registry.release(source);this.figure.changed();}
}
export interface SelectionLinkOptions {scatter: [Layer,Layer] | Layer[]; histogram: Layer}
export class SelectionLink {
  constructor(readonly figure:Figure,readonly id:string){}
  clear():void{this.figure.clearLinkedSelection(this.id);}
  remove():void{this.figure.removeSelectionLink(this.id);}
}
export class Annotation {
  constructor(readonly figure:Figure,readonly id:string){}
  get spec():AnnotationSpec{const item=this.figure.spec.annotations?.find(annotation=>annotation.id===this.id);if(!item)throw new Error('Annotation has been removed');return item;}
  update(options:AnnotationOptions):this{this.figure.updateAnnotation(this.id,options);return this;}
  remove():void{this.figure.removeAnnotation(this.id);}
}
/** A panel shares its figure's data registry, renderer and lifecycle. */
export class Panel {
  constructor(readonly figure:Figure,readonly id:string){}
  get view():ViewSpec{return this.figure.panelView(this.id);}
  plot(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Layer{return this.figure.addToPanel(this.id,'line',{x,y},options);}
  fillBetween(x:Series,lower:Series,upper:Series,options:FillBetweenOptions={}):Layer{return this.figure.addToPanel(this.id,'band',{x,lower,upper},{...options,opacity:options.opacity===undefined?.18:options.opacity});}
  scatter(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Layer{return this.figure.addToPanel(this.id,'scatter',{x,y},options);}
  hist(samples:Series,options:HistogramOptions={}):Layer{return this.figure.addHistogram(this.id,samples,options);}
  bar(x:AxisSeries,values:Series,options:BarOptions={}):Layer{return this.figure.addBar(this.id,x,values,options,'vertical');}
  barh(y:AxisSeries,values:Series,options:BarOptions={}):Layer{return this.figure.addBar(this.id,y,values,options,'horizontal');}
  boxplot(groups:Groups,options:BoxplotOptions={}):Layer{return this.figure.addBoxplot(this.id,groups,options);}
  setBarMode(mode:BarMode):this{this.figure.setPanelBarMode(this.id,mode);return this;}
  setCategories(axis:'x'|'y',values:string[]):this{this.figure.setPanelCategories(this.id,axis,values);return this;}
  heatmap(x:Series,y:Series,z:Grid,options:LayerOptions={}):Layer{return this.figure.addToPanel(this.id,'heatmap',{x,y,z},options);}
  setView(options:Partial<ViewSpec>):this{this.figure.setPanelView(this.id,options);return this;}
  setAxisFormat(axis:'x'|'y',format:AxisFormat|null):this{this.figure.setAxisFormat(axis,format,this.id);return this;}
  setTitle(title:string):this{this.figure.setPanelTitle(this.id,title);return this;}
  text(x:number,y:number,text:string,style:AnnotationStyle={}):Annotation{return this.figure.addAnnotation(this.id,'text',{x,y,text,...style});}
  axhline(y:number,style:AnnotationStyle={}):Annotation{return this.figure.addAnnotation(this.id,'hline',{y,...style});}
  axvline(x:number,style:AnnotationStyle={}):Annotation{return this.figure.addAnnotation(this.id,'vline',{x,...style});}
}
export class Figure {
  readonly registry=new DataRegistry();
  readonly streams=new Map<string,StreamState>();
  readonly runtime:Readonly<RuntimeOptions>;
  private streamWaiters=new Set<{ids:Set<string>;reject:(error:Error)=>void}>();
  private semanticChecks=new WeakMap<DataEntry,Set<string>>();
  private semanticScans=0;
  spec:FigureSpec;
  private view?:FigureView;
  private listeners=new Map<FigureEvent,Set<(event:any)=>void>>();
  private closed=false;
  private pendingLink?:SelectionLinkSpec;
  private notifiedLink='';
  readonly presentation:Required<PresentationOptions>={tooltip:true,legend:true};
  private knownStreamIds=new Set<string>();
  constructor(options:FigureOptions={}){
    const runtime={...options.runtime};
    for(const value of Object.values(runtime))if(!Number.isSafeInteger(value)||value!<1)throw new RangeError('Runtime limits must be positive safe integers');
    this.runtime=Object.freeze(runtime);
    this.spec={protocolVersion:PROTOCOL_VERSION,id:id('figure'),title:options.title??'',width:options.width??800,height:options.height??520,view:defaultView(options.kind),layers:[]};
    if(!Number.isFinite(this.spec.width)||!Number.isFinite(this.spec.height)||this.spec.width<200||this.spec.height<180)throw new RangeError('Figure dimensions must be finite and at least 200 × 180');
    if(options.theme!==undefined)this.setTheme(options.theme);
  }
  getStreamingState(layerId:string):StreamState|undefined{const state=this.streams.get(layerId);return state?{...state}:undefined;}
  private nextStreamId():string{
    let candidate:string|undefined;try{const uuid=globalThis.crypto?.randomUUID?.();if(uuid)candidate=`stream-${uuid}`;}catch{/* Some hosts do not expose secure-context randomness. */}
    candidate??=id('stream');
    while(this.knownStreamIds.has(candidate)||[...this.streams.values()].some(state=>state.streamId===candidate))candidate=id('stream');
    this.knownStreamIds.add(candidate);return candidate;
  }
  private validateCurrentSemantics(spec:FigureSpec):void{
    const validate=(layer:LayerSpec,axis:'x'|'y',kind:string,values:NumericArray)=>{
      const entry=this.registry.get(layer.data[axis]);let checked=this.semanticChecks.get(entry);
      if(checked?.has(kind))return;
      if(kind==='inspection')validateInspectionX(values);
      else if(values.some(value=>Number.isFinite(value)&&Math.abs(value)>8.64e15))throw new RangeError('Time coordinates must be epoch milliseconds within the JavaScript Date range');
      this.semanticScans++;if(!checked){checked=new Set();this.semanticChecks.set(entry,checked);}checked.add(kind);
    };
    validateSemantics(spec,layer=>this.layerValues(layer),{inspection:(layer,values)=>validate(layer,'x','inspection',values),time:(layer,axis,values)=>validate(layer,axis,'time',values)});
  }
  private assertStreamingLayer(layer:LayerSpec):void{
    this.assertMutableLayer(layer.id);
    if(!['line','scatter'].includes(layer.kind)||this.panelView(layer.panelId??'main').kind!=='2d'||layer.categorical||layer.data.z)
      throw new TypeError('Streaming requires a numeric 2D line or scatter without z coordinates');
  }
  private checkSourceBudget(writes:Map<string,DataEntry>,replace=false,released:ReadonlySet<string>=new Set()):void{
    const maximum=this.runtime.maxSourceBytes;if(maximum===undefined)return;
    let bytes=0;if(!replace)for(const [source,entry] of this.registry.entries())if(!writes.has(source)&&!released.has(source))bytes+=entry.descriptor.byteLength;
    for(const entry of writes.values())bytes+=entry.descriptor.byteLength;
    if(bytes>maximum)throw streamError('SOURCE_BUDGET_EXCEEDED',`Sources require ${bytes} bytes, exceeding maxSourceBytes=${maximum}`);
  }
  private rejectStreamWaiters(layerId?:string):void{
    for(const waiter of [...this.streamWaiters])if(layerId===undefined||waiter.ids.has(layerId)){this.streamWaiters.delete(waiter);waiter.reject(streamError('STREAM_RESET','Streaming was reset, disabled, or detached before rendering completed'));}
  }
  enableStreaming(layer:Layer,options:StreamingOptions):void{
    this.assertOpen();validateStreamingOptions(options);if(layer.figure!==this)throw new Error('Layer belongs to another figure');
    const spec=layer.spec;this.assertStreamingLayer(spec);
    const previous=this.streams.get(layer.id);if(previous){if(previous.maxPoints!==options.maxPoints)throw new Error('Disable streaming before changing maxPoints');return;}
    const count=this.registry.get(spec.data.x).descriptor.shape[0],writes=new Map<string,DataEntry>(),data={...spec.data};
    for(const [channel,source]of Object.entries(data)){
      const old=this.registry.get(source);let target=source;
      if(this.spec.layers.some(other=>Object.entries(other.data).some(([key,value])=>value===source&&(other.id!==layer.id||key!==channel)))){
        target=`${layer.id}-${channel}-stream`;while(this.registry.has(target)||writes.has(target))target+='-new';
      }
      const entry=streamEntry(old,options.maxPoints,old.descriptor.version+1);
      entry.descriptor.id=target;writes.set(target,entry);data[channel]=target;
    }
    const referenced=new Set(this.spec.layers.flatMap(item=>Object.values(item===spec?data:item.data))),released=new Set(Object.values(spec.data).filter(source=>!referenced.has(source)));
    this.checkSourceBudget(writes,false,released);
    for(const [source,entry]of writes)this.registry.store.set(source,entry);
    spec.data=data;for(const source of released)this.registry.release(source);this.streams.set(layer.id,{streamId:this.nextStreamId(),maxPoints:options.maxPoints,nextSequence:count,revision:0,retained:Math.min(count,options.maxPoints),evicted:Math.max(0,count-options.maxPoints)});
    this.changed();
  }
  disableStreaming(layerId:string):void{
    this.assertOpen();if(!this.streams.has(layerId))return;this.rejectStreamWaiters(layerId);this.streams.delete(layerId);this.changed();
  }
  /** Restore transport metadata after an ordinary retained-window snapshot.
   * Metadata stays outside FigureSpec, preserving scene protocols 1–6. */
  restoreStreaming(states:Record<string,StreamState>):void{
    this.assertOpen();if(!states||typeof states!=='object'||Array.isArray(states))throw new TypeError('Stream metadata must be an object');
    const restored=new Map<string,StreamState>(),writes=new Map<string,DataEntry>();
    for(const [layerId,state]of Object.entries(states)){
      const layer=this.spec.layers.find(item=>item.id===layerId);if(!layer)throw new Error('Stream metadata references an unknown layer');this.assertStreamingLayer(layer);
      validateStreamState(state,this.registry.get(layer.data.x).descriptor.shape[0]);
      for(const source of Object.values(layer.data)){
        if(this.spec.layers.some(other=>other.id!==layerId&&Object.values(other.data).includes(source)))throw new Error('Streaming sources cannot be shared across layers');
        writes.set(source,streamEntry(this.registry.get(source),state.maxPoints));
      }
      restored.set(layerId,{...state});
    }
    this.checkSourceBudget(writes);this.rejectStreamWaiters();this.streams.clear();
    for(const [layerId,state]of restored){this.streams.set(layerId,state);this.knownStreamIds.add(state.streamId);}
    for(const [source,entry]of writes)this.registry.store.set(source,entry);
    this.changed(true);
  }
  /** Validate every layer/channel before publishing a multi-series append. */
  appendDataBatch(updates:Array<{layer:Layer;data:Record<string,unknown>}>):Promise<void>{
    try{
      this.assertOpen();if(!Array.isArray(updates))throw new TypeError('Append updates must be an array');
      if(this.streamWaiters.size>=64)throw streamError('STREAM_BACKPRESSURE','Too many pending appends; await appendData before submitting more data');
      const writes=new Map<string,DataEntry>(),states=new Map<string,StreamState>(),seen=new Set<string>();
      for(const {layer,data}of updates){
        if(!(layer instanceof Layer)||layer.figure!==this||seen.has(layer.id))throw new Error('Append each layer of this figure at most once');seen.add(layer.id);
        const spec=layer.spec,state=this.streams.get(layer.id);if(!state)throw new Error('Enable streaming before appending');this.assertStreamingLayer(spec);
        const channels=Object.keys(spec.data);
        if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==channels.length||channels.some(channel=>!Object.hasOwn(data,channel)))throw new TypeError('Append must supply every existing channel exactly once');
        const nextEntries=new Map<string,DataEntry>(),added:Record<string,NumericArray>={};
        for(const channel of channels){const source=spec.data[channel],prepared=appendEntry(this.registry.get(source),data[channel] as Series,state.maxPoints);nextEntries.set(source,prepared.entry);added[channel]=prepared.added;}
        const count=added.x.length;if(channels.some(channel=>added[channel].length!==count))throw new RangeError('Append channels must have equal lengths');
        if(!count)continue;
        const view=this.panelView(spec.panelId??'main');
        if(this.spec.hoverMode==='x'&&spec.kind==='line'&&spec.visible){
          let previous=lastValue(this.registry.get(spec.data.x));
          for(const value of added.x){if(!Number.isFinite(value)||previous!==undefined&&value<=previous)throw new RangeError('X inspection requires finite, strictly increasing x coordinates');previous=value;}
        }
        for(const axis of ['x','y']as const)if((view[`${axis}Scale`]==='time'||view[`${axis}Format`]?.kind==='date')&&added[axis].some(value=>Number.isFinite(value)&&Math.abs(value)>8.64e15))throw new RangeError('Time coordinates must be within the JavaScript Date range');
        const nextSequence=state.nextSequence+count,retained=Math.min(state.maxPoints,state.retained+count),revision=state.revision+1;
        if(!Number.isSafeInteger(nextSequence)||!Number.isSafeInteger(revision))throw new RangeError('Streaming sequence exceeds the safe integer range');
        states.set(layer.id,{...state,nextSequence,revision,retained,evicted:nextSequence-retained});
        for(const [source,entry]of nextEntries)writes.set(source,entry);
      }
      if(!states.size)return Promise.resolve();this.checkSourceBudget(writes);
      for(const [source,entry]of writes)this.registry.store.set(source,entry);
      for(const [layerId,state]of states)this.streams.set(layerId,state);
      this.changed(true);
      if(!this.view)return Promise.resolve();
      const view=this.view,ids=new Set(states.keys());
      return new Promise<void>((resolve,reject)=>{
        const waiter={ids,reject};this.streamWaiters.add(waiter);
        void view.ready().then(()=>{if(this.streamWaiters.delete(waiter))resolve();},error=>{if(this.streamWaiters.delete(waiter))reject(error);});
      });
    }catch(error){return Promise.reject(error);}
  }
  setTheme(theme:ThemeInput):this{this.assertOpen();const next=resolveTheme(theme);this.spec.theme=next;this.spec.protocolVersion=Math.max(this.spec.protocolVersion,hasTypography(next)?QUALITY_PROTOCOL_VERSION:PRESENTATION_PROTOCOL_VERSION);this.changed();return this;}
  setHoverMode(mode:HoverMode):this{
    this.assertOpen();if(!['nearest','x'].includes(mode))throw new TypeError('Hover mode must be nearest or x');const draft={...this.spec,hoverMode:mode};this.validateCurrentSemantics(draft);
    this.spec.hoverMode=mode;this.spec.protocolVersion=Math.max(this.spec.protocolVersion,QUALITY_PROTOCOL_VERSION);this.view?.clearInteraction();this.changed();return this;
  }
  updateStyle(layer:LayerSpec,style:LayerStyle):void{
    this.assertOpen();validateStyle(style);if(layer.kind==='band')validateBandStyle(style);
    Object.assign(layer.style,style);if(style.colorbarLabel!==undefined)this.spec.protocolVersion=Math.max(this.spec.protocolVersion,QUALITY_PROTOCOL_VERSION);this.changed();
  }
  updateVisibility(layer:LayerSpec,visible:boolean):void{
    this.assertOpen();if(typeof visible!=='boolean')throw new TypeError('Layer visibility must be a boolean');
    const draft={...this.spec,layers:this.spec.layers.map(item=>item===layer?{...item,visible}:item)};
    this.validateCurrentSemantics(draft);layer.visible=visible;this.changed();
  }
  setAxisFormat(axis:'x'|'y',format:AxisFormat|null,panelId='main'):this{
    this.assertOpen();if(axis!=='x'&&axis!=='y')throw new TypeError('Axis format requires x or y');
    const next=format===null?undefined:validateAxisFormat(format);
    return this.setPanelView(panelId,{[`${axis}Format`]:next});
  }
  setPresentation(options:PresentationOptions):this{
    this.assertOpen();if(!options||typeof options!=='object')throw new TypeError('Presentation options must be an object');
    for(const [key,value]of Object.entries(options))if(!['tooltip','legend'].includes(key)||typeof value!=='boolean')throw new TypeError('Presentation options must contain tooltip/legend booleans');
    Object.assign(this.presentation,options);this.changed();return this;
  }
  setSize(options:{width?:number;height?:number}):this{
    this.assertOpen();if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='width'&&key!=='height'))throw new TypeError('Size options must contain width/height');const width=options.width??this.spec.width,height=options.height??this.spec.height;
    if(!Number.isFinite(width)||width<200||!Number.isFinite(height)||height<180)throw new RangeError('Figure dimensions must be finite and at least 200 × 180');
    this.spec.width=width;this.spec.height=height;this.changed();return this;
  }
  /** Detach browser resources while retaining data, subscribers and completed state. */
  unmount():this{this.assertOpen();this.rejectStreamWaiters();this.view?.dispose();this.view=undefined;this.pendingLink=undefined;return this;}
  linkSelection(options:SelectionLinkOptions):SelectionLink{
    this.assertOpen();
    if(this.spec.selectionLink)throw new Error('A figure supports one selection link. Remove it before relinking.');
    if(!options||!Array.isArray(options.scatter)||options.scatter.length!==2||!options.histogram)throw new Error('Link two scatter layers and one histogram.');
    for(const layer of [...options.scatter,options.histogram])if(!(layer instanceof Layer)||layer.figure!==this)throw new Error('Linked layers must belong to this figure.');
    for(const layer of [...options.scatter,options.histogram])if(this.streams.has(layer.id))throw new Error('Disable streaming before attaching a selection link.');
    const link:SelectionLinkSpec={id:id('link'),scatter:[options.scatter[0].spec.id,options.scatter[1].spec.id],histogram:options.histogram.spec.id,generation:1,sequence:0};
    const draft={...this.spec,protocolVersion:Math.max(this.spec.protocolVersion,LINKED_PROTOCOL_VERSION),selectionLink:link};
    validateSelectionLink(draft,this.registry);
    this.isolateSelectionSources(draft,this.registry);this.view?.invalidateData();
    this.spec.selectionLink=link;this.spec.protocolVersion=draft.protocolVersion;this.pendingLink=undefined;this.notifiedLink='';this.changed();
    return new SelectionLink(this,link.id);
  }
  /** Linked sources own their storage: sorting a caller's TypedArray must not
   * change a cohort or its exported data without a versioned API update. */
  private isolateSelectionSources(spec:FigureSpec,registry:DataRegistry):void{
    const link=spec.selectionLink;if(!link)return;
    const members=new Set([...link.scatter,link.histogram]);
    const ids=new Set(spec.layers.filter(layer=>members.has(layer.id)).flatMap(layer=>Object.values(layer.data)));
    // Allocate every copy first so allocation failure leaves the registry intact.
    // Values are identical; retaining their versions preserves scene parity.
    const copies=Array.from(ids,id=>{const entry=registry.get(id);return [id,{descriptor:structuredClone(entry.descriptor),values:entry.values.slice() as NumericArray}] as const;});
    for(const [id,entry] of copies)registry.store.set(id,entry);
  }
  /** Internal viewer entry point; the completed predicate alone enters snapshots. */
  selectLinked(layerId:string,bounds:Bounds):void{
    this.assertOpen();const link=this.selectionRequest();
    if(!link||!link.scatter.includes(layerId))throw new Error('Selection must originate in a linked scatter.');
    const next={...structuredClone(link),sequence:link.sequence+1,selection:{originLayerId:layerId,bounds:structuredClone(bounds)}};
    validateSelectionLink({...this.spec,selectionLink:next},this.registry);
    if(!this.view)throw new Error('Mount the figure before selecting observations.');
    this.pendingLink=next;this.changed();
  }
  selectionRequest():SelectionLinkSpec|undefined{return this.pendingLink??this.spec.selectionLink;}
  clearLinkedSelection(linkId:string):void{
    this.assertOpen();const link=this.selectionRequest();if(!link||link.id!==linkId)throw new Error('Selection link has been removed.');
    if(!link.selection)return;
    const next=structuredClone(link);next.sequence++;delete next.selection;
    validateSelectionLink({...this.spec,selectionLink:next},this.registry);
    if(this.view)this.pendingLink=next;else this.spec.selectionLink=next;
    this.changed();
  }
  removeSelectionLink(linkId:string):void{
    this.assertOpen();if(this.spec.selectionLink?.id!==linkId)throw new Error('Selection link has been removed.');
    delete this.spec.selectionLink;this.pendingLink=undefined;this.notifiedLink='';this.changed();
  }
  unlinkLayer(layerId:string):void{const link=this.spec.selectionLink;if(link&&(link.scatter.includes(layerId)||link.histogram===layerId))this.removeSelectionLink(link.id);}
  private assertMutableLayer(layerId:string):void{
    const link=this.spec.selectionLink;
    if(link&&(link.scatter.includes(layerId)||link.histogram===layerId))throw new Error('Linked data and histogram options are fixed. Remove the selection link before updating.');
  }
  commitLinkedSelection(link:SelectionLinkSpec,event:LinkedSelection):void{
    const current=this.selectionRequest();if(!current||current.id!==link.id||current.generation!==link.generation||current.sequence!==link.sequence)return;
    this.spec.selectionLink=structuredClone(link);this.pendingLink=undefined;
    const token=`${link.id}:${link.generation}:${link.sequence}`;
    if(token!==this.notifiedLink){this.notifiedLink=token;this.emit('selection',event);}
  }
  private allocateId(prefix:'layer'|'annotation'):string{
    // Imported snapshots can contain IDs generated by another runtime, or arbitrary
    // source names. Reserve every possible layer channel before adding any data.
    let candidate:string;
    do{candidate=id(prefix);}while(
      candidate===this.spec.id||this.spec.layers.some(layer=>layer.id===candidate)||
      this.spec.annotations?.some(annotation=>annotation.id===candidate)||this.registry.has(candidate)||
      prefix==='layer'&&['x','y','z','color','base','samples','g0'].some(channel=>this.registry.has(`${candidate}-${channel}`))
    );
    return candidate;
  }
  plot(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Layer{return this.add('line',{x,y},options);}
  fillBetween(x:Series,lower:Series,upper:Series,options:FillBetweenOptions={}):Layer{return this.add('band',{x,lower,upper},{...options,opacity:options.opacity===undefined?.18:options.opacity});}
  scatter(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Layer{return this.add('scatter',{x,y},options);}
  hist(samples:Series,options:HistogramOptions={}):Layer{return this.addHistogram('main',samples,options);}
  bar(x:AxisSeries,values:Series,options:BarOptions={}):Layer{return this.addBar('main',x,values,options,'vertical');}
  barh(y:AxisSeries,values:Series,options:BarOptions={}):Layer{return this.addBar('main',y,values,options,'horizontal');}
  boxplot(groups:Groups,options:BoxplotOptions={}):Layer{return this.addBoxplot('main',groups,options);}
  setBarMode(mode:BarMode):this{return this.setPanelBarMode('main',mode);}
  setCategories(axis:'x'|'y',values:string[]):this{return this.setPanelCategories('main',axis,values);}
  scatter3d(x:Series,y:Series,z:Series,options:LayerOptions={}):Layer{return this.add('scatter3d',{x,y,z},options);}
  heatmap(x:Series,y:Series,z:Grid,options:LayerOptions={}):Layer{return this.add('heatmap',{x,y,z},options);}
  surface(x:Series,y:Series,z:Grid,options:LayerOptions={}):Layer{return this.add('surface',{x,y,z},options);}
  private add(kind:LayerKind,data:Record<string,unknown>,options:LayerOptions):Layer{
    return this.addToPanel('main',kind,data,options);
  }
  addToPanel(panelId:string,kind:LayerKind,data:Record<string,unknown>,options:LayerOptions={},statOptions?:StatisticalOptions):Layer{
    this.assertOpen();const view=this.panelView(panelId),dimension=kind==='surface'||kind==='scatter3d'?'3d':'2d';
    if(this.spec.layout&&dimension!=='2d')throw new Error('Grid panels support 2D layers only');
    if((this.spec.layers.length||this.spec.bookmarks?.length||this.spec.annotations?.length)&&view.kind!==dimension)throw new Error('2D and 3D layers need separate figures');
    if(kind==='band')validateBandStyle(options);
    const {values,...style}=options;validateStyle(style);if(values)data={...data,color:values};
    const layer:LayerSpec={id:this.allocateId('layer'),kind,data:{},style,visible:true};
    if(statOptions)layer.options=statisticalOptions(kind,statOptions);
    if(panelId!=='main')layer.panelId=panelId;
    this.updateData(layer,data,false);view.kind=dimension;this.spec.layers.push(layer);this.changed();return new Layer(this,layer.id);
  }
  addHistogram(panelId:string,samples:Series,options:HistogramOptions):Layer{
    const {bins=10,range,density=false,cumulative=false,...style}=options;
    return this.addToPanel(panelId,'hist',{samples},style,statisticalOptions('hist',{bins,...(range!=null?{range}:{}),density,cumulative}));
  }
  addBar(panelId:string,positions:AxisSeries,values:Series,options:BarOptions,orientation:'vertical'|'horizontal'):Layer{
    const {barWidth=0.8,bottom,left,...style}=options;
    if(orientation==='vertical'&&left!==undefined||orientation==='horizontal'&&bottom!==undefined)throw new Error('Use bottom for bar and left for barh');
    const data=orientation==='vertical'?{x:positions,y:values,base:bottom??0}:{x:values,y:positions,base:left??0};
    return this.addToPanel(panelId,'bar',data,style,{orientation,barWidth});
  }
  addBoxplot(panelId:string,groups:Groups,options:BoxplotOptions):Layer{
    const {labels:groupLabels,orientation='vertical',whis=1.5,showfliers=true,boxWidth=0.6,...style}=options;
    return this.addToPanel(panelId,'boxplot',{groups,...(groupLabels!==undefined?{labels:groupLabels}:{})},style,{orientation,whis,showfliers,boxWidth});
  }
  setPanelBarMode(panelId:string,mode:BarMode):this{
    this.panelView(panelId);const draft=structuredClone(this.spec);(draft.barModes??={})[panelId]=mode;
    this.validateCurrentSemantics(draft);this.spec.barModes=draft.barModes;this.spec.protocolVersion=Math.max(this.spec.protocolVersion,STATISTICS_PROTOCOL_VERSION);this.changed();return this;
  }
  setPanelCategories(panelId:string,axis:'x'|'y',input:string[]):this{
    this.panelView(panelId);if(!['x','y'].includes(axis))throw new Error('Category axis must be x or y');
    const key=categoryKey(this.spec,panelId,axis);
    if(this.spec.layers.some(layer=>categoryKey(this.spec,layer.panelId??'main',axis)===key))throw new Error('Set category order before adding data to this axis');
    const next=labels(input),previous=this.spec.categories?.[key]??[];
    if(previous.some((value,index)=>next[index]!==value))throw new Error('Category order is append-only');
    const draft=structuredClone(this.spec);(draft.categories??={})[key]=next;
    this.validateCurrentSemantics(draft);this.spec.categories=draft.categories;this.spec.protocolVersion=Math.max(this.spec.protocolVersion,STATISTICS_PROTOCOL_VERSION);this.changed();return this;
  }
  private layerValues(layer:LayerSpec):Record<string,NumericArray>{return Object.fromEntries(Object.entries(layer.data).map(([key,source])=>[key,this.registry.get(source).values]));}
  updateOptions(layer:LayerSpec,options:Record<string,unknown>):void{
    this.assertMutableLayer(layer.id);
    this.assertOpen();const next=statisticalOptions(layer.kind,{...layer.options,...options});
    if('orientation' in next&&next.orientation!==(layer.options as BarSpecOptions).orientation)throw new Error('Layer orientation cannot be changed');
    const candidate={...layer,options:next},draft=structuredClone(this.spec);draft.layers=draft.layers.map(item=>item.id===layer.id?candidate:item);
    this.validateCurrentSemantics(draft);layer.options=next;this.changed();
  }
  panelEntries():PanelEntry[]{this.assertOpen();return panelEntries(this.spec);}
  panelView(panelId='main'):ViewSpec{this.assertOpen();const panel=panelEntries(this.spec).find(item=>item.id===panelId);if(!panel)throw new Error(`Unknown panel: ${panelId}`);return panel.view;}
  panelLayers(panelId='main'):LayerSpec[]{this.panelView(panelId);return this.spec.layers.filter(layer=>(layer.panelId??'main')===panelId);}
  panel(row:number,col:number):Panel{
    this.assertOpen();if(!Number.isInteger(row)||!Number.isInteger(col))throw new RangeError('Panel row and col must be integers');
    const panel=panelEntries(this.spec).find(item=>item.row===row&&item.col===col);if(!panel)throw new RangeError('Panel is outside the grid');return new Panel(this,panel.id);
  }
  setPanelTitle(panelId:string,title:string):this{
    this.panelView(panelId);if(typeof title!=='string')throw new TypeError('Panel title must be a string');
    if(this.spec.panels)this.spec.panels.find(panel=>panel.id===panelId)!.title=title;else this.spec.title=title;
    this.changed();return this;
  }
  text(x:number,y:number,text:string,style:AnnotationStyle={}):Annotation{return this.addAnnotation('main','text',{x,y,text,...style});}
  axhline(y:number,style:AnnotationStyle={}):Annotation{return this.addAnnotation('main','hline',{y,...style});}
  axvline(x:number,style:AnnotationStyle={}):Annotation{return this.addAnnotation('main','vline',{x,...style});}
  addAnnotation(panelId:string,kind:AnnotationSpec['kind'],options:AnnotationOptions):Annotation{
    this.assertOpen();this.panelView(panelId);
    const base:AnnotationSpec={id:this.allocateId('annotation'),kind,style:{}};if(panelId!=='main')base.panelId=panelId;
    const annotation=annotationUpdate(base,options);validateAnnotation(annotation,panelEntries(this.spec));
    (this.spec.annotations??=[]).push(annotation);this.spec.protocolVersion=Math.max(this.spec.protocolVersion,EXTENDED_PROTOCOL_VERSION);this.changed();return new Annotation(this,annotation.id);
  }
  updateAnnotation(annotationId:string,options:AnnotationOptions):void{
    this.assertOpen();const index=this.spec.annotations?.findIndex(annotation=>annotation.id===annotationId)??-1;
    if(index<0)throw new Error('Annotation has been removed');
    const next=annotationUpdate(this.spec.annotations![index],options);validateAnnotation(next,panelEntries(this.spec));this.spec.annotations![index]=next;this.changed();
  }
  removeAnnotation(annotationId:string):void{
    this.assertOpen();const index=this.spec.annotations?.findIndex(annotation=>annotation.id===annotationId)??-1;
    if(index<0)throw new Error('Annotation has been removed');this.spec.annotations!.splice(index,1);if(!this.spec.annotations!.length)delete this.spec.annotations;this.changed();
  }
  updateData(layer:LayerSpec,data:Record<string,unknown>,notify=true):void{
    this.assertMutableLayer(layer.id);
    this.assertOpen();
    if(!data||typeof data!=='object'||Array.isArray(data))throw new TypeError('Data must be an object');
    const candidate=structuredClone(layer),draft=structuredClone(this.spec),inputs={...data};
    const values=this.layerValues(layer),modified=new Set<string>();
    if(layer.kind==='boxplot'){
      for(const key of Object.keys(inputs))if(!['groups','labels'].includes(key))throw new Error(`Unknown boxplot data channel ${key}`);
      const axis=(candidate.options as BoxplotSpecOptions).orientation==='vertical'?'x':'y';
      let count=values[axis]?.length??0;
      if(Object.hasOwn(inputs,'groups')){
        const input=inputs.groups as Groups;
        const groups:readonly Series[]=Array.isArray(input)&&input.length>0&&typeof input[0]!=='number'?input as readonly Series[]:[input as Series];
        count=groups.length;
        for(const key of Object.keys(values))if(/^g\d+$/.test(key)){delete values[key];delete candidate.data[key];}
        groups.forEach((group,index)=>{values[`g${index}`]=toNumericArray(group);modified.add(`g${index}`);});
      }
      if(Object.hasOwn(inputs,'labels')||!values[axis]||values[axis].length!==count){
        const names=Object.hasOwn(inputs,'labels')?labels(inputs.labels):Array.from({length:count},(_,i)=>String(i+1));
        if(names.length!==count)throw new Error('Boxplot labels must match group count');
        values[axis]=encodeAxis(draft,candidate,axis,names);modified.add(axis);
      }
    }else{
      if(layer.kind==='bar'){
        const horizontal=(candidate.options as BarSpecOptions).orientation==='horizontal';
        const alias=horizontal?'left':'bottom',wrong=horizontal?'bottom':'left';
        if(Object.hasOwn(inputs,wrong))throw new Error(`Use ${alias} for this orientation`);
        if(Object.hasOwn(inputs,alias)){
          if(Object.hasOwn(inputs,'base'))throw new Error('Supply baseline only once');
          inputs.base=inputs[alias];delete inputs[alias];
        }
      }
      const allowed=layer.kind==='hist'?['samples']:layer.kind==='bar'?['x','y','base']:layer.kind==='band'?['x','lower','upper']:['x','y','z','color'];
      for(const [key,input]of Object.entries(inputs)){
        if(!allowed.includes(key))throw new Error(`Unknown data channel ${key}`);
        if(key==='base')continue;
        if((key==='x'||key==='y')&&(['line','scatter'].includes(layer.kind)||(layer.kind==='bar'&&key===((candidate.options as BarSpecOptions).orientation==='vertical'?'x':'y'))))values[key]=encodeAxis(draft,candidate,key,input as AxisSeries);
        else{
          if(Array.isArray(input)&&Array.isArray(input[0])){
            const rows=input as number[][];
            if(key!=='z'||!(layer.kind==='heatmap'||layer.kind==='surface'))throw new Error('Point coordinates must be one-dimensional');
            if(rows.some(row=>row.length!==rows[0].length))throw new Error('Grid rows must have equal lengths');
          }
          values[key]=flatten(input as Grid);
        }
        modified.add(key);
      }
      if(Object.hasOwn(inputs,'base')){
        const input=inputs.base;
        values.base=typeof input==='number'?new Float64Array(values.x?.length??0).fill(input):toNumericArray(input as Series);
        modified.add('base');
      }
    }
    if(isStatistical(candidate.kind))validateStatisticalData(candidate,values);else this.validateLayerData(candidate.kind,values);
    if(layer.kind==='heatmap'||layer.kind==='surface'){
      const input=inputs.z;
      if(Array.isArray(input)&&Array.isArray(input[0])&&(input.length!==values.y.length||input[0].length!==values.x.length))throw new Error('Grid z shape must equal (y.length, x.length)');
      if(input===undefined&&layer.data.z){const shape=this.registry.get(layer.data.z).descriptor.shape;if(shape[0]!==values.y.length||shape[1]!==values.x.length)throw new Error('Supply a reshaped z grid when changing grid dimensions');}
    }
    for(const key of modified){
      let source=layer.data[key]??`${layer.id}-${key}`;
      // Imported scenes may share sources, including two channels of one layer.
      // A public layer update owns its data: detach before changing shared storage.
      const shared=layer.data[key]!==undefined&&this.spec.layers.some(item=>Object.entries(item.data).some(([channel,id])=>id===source&&(item.id!==layer.id||channel!==key)));
      if(shared)source=`${layer.id}-${key}`;
      if(!layer.data[key]||shared)while(this.registry.has(source)||Object.values(candidate.data).includes(source))source+='-new';
      candidate.data[key]=source;
    }
    const index=draft.layers.findIndex(item=>item.id===layer.id);
    if(index<0){
      draft.layers.push(candidate);
      const panel=draft.panels?.find(item=>item.id===(layer.panelId??'main'));
      const view=panel&&panel.id!=='main'?panel.view!:draft.view;
      view.kind=layer.kind==='surface'||layer.kind==='scatter3d'?'3d':'2d';
    }else draft.layers[index]=candidate;
    validateSemantics(draft,item=>item.id===candidate.id?values:this.layerValues(item));
    const streaming=this.streams.get(layer.id),streamCount=values.x?.length??0;
    if(streaming){this.assertStreamingLayer(candidate);for(const channel of Object.keys(values))modified.add(channel);}
    // Prevalidate every descriptor too: an overflowing imported version must not
    // leave the first channel committed and the second channel unchanged.
    const writes=Array.from(modified,key=>{
      const source=candidate.data[key],old=this.registry.has(source)?this.registry.get(source):undefined;
      const shape=key==='z'&&(layer.kind==='surface'||layer.kind==='heatmap')?[values.y.length,values.x.length]:[values[key].length];
      return {key,descriptor:describeData(source,values[key],shape,(old?.descriptor.version??0)+1)};
    });
    const entries=new Map<string,DataEntry>(writes.map(({key,descriptor})=>{
      const entry:DataEntry={descriptor,values:values[key]};return [descriptor.id,streaming?streamEntry(entry,streaming.maxPoints):entry];
    }));
    this.checkSourceBudget(entries);
    if(streaming)this.rejectStreamWaiters(layer.id);
    for(const [source,entry]of entries)this.registry.store.set(source,entry);
    const released=Object.values(layer.data).filter(source=>!Object.values(candidate.data).includes(source));
    Object.assign(layer,candidate);
    if(draft.categories!==undefined)this.spec.categories=draft.categories;
    if(isStatistical(layer.kind)||layer.categorical)this.spec.protocolVersion=Math.max(this.spec.protocolVersion,STATISTICS_PROTOCOL_VERSION);
    if(layer.kind==='band'||layer.style.colorbarLabel!==undefined)this.spec.protocolVersion=Math.max(this.spec.protocolVersion,QUALITY_PROTOCOL_VERSION);
    for(const source of released)if(!this.spec.layers.some(item=>Object.values(item.data).includes(source)))this.registry.release(source);
    if(streaming)this.streams.set(layer.id,{streamId:this.nextStreamId(),maxPoints:streaming.maxPoints,nextSequence:streamCount,revision:0,retained:Math.min(streamCount,streaming.maxPoints),evicted:Math.max(0,streamCount-streaming.maxPoints)});
    if(notify)this.changed();
  }
  private validateLayerData(kind:LayerKind,v:Record<string,NumericArray>):void{
    if(kind==='band'){validateBandData(v);return;}
    if(!v.x||!v.y)throw new Error('x and y are required');
    if(kind==='heatmap'||kind==='surface'){
      if(!v.x.length||!v.y.length)throw new Error('Grid requires at least a 1 × 1 grid');
      if(v.color)throw new Error('Grid colors are determined by z values');
      if(!v.z||v.z.length!==v.x.length*v.y.length)throw new Error('Grid z shape must equal (y.length, x.length)');
      if(kind==='surface'&&(v.x.length<2||v.y.length<2))throw new Error('Surface requires at least a 2 × 2 grid');
      for(const axis of [v.x,v.y])for(let i=0;i<axis.length;i++)if(!Number.isFinite(axis[i])||(i>0&&axis[i]<=axis[i-1]))throw new Error('Grid coordinates must be finite and strictly increasing');
    }else if(v.x.length!==v.y.length||(kind==='scatter3d'&&(!v.z||v.z.length!==v.x.length)))throw new Error('Point coordinates must have equal lengths');
    if(v.color&&v.color.length!==v.x.length)throw new Error('Color values must match point count');
  }
  setView(options:Partial<ViewSpec>):this{
    return this.setPanelView('main',options);
  }
  setPanelView(panelId:string,options:Partial<ViewSpec>):this{
    const previous=this.panelView(panelId),next=copyView({...previous,...options});
    this.assertDimension(next,previous);
    const state=this.captureViews();this.replacePanelView(state,panelId,next);
    for(const axis of ['x','y'] as const)if(`${axis}Scale` in options||`${axis}Domain` in options||`${axis}Format` in options)this.shareAxis(state,panelId,axis);
    this.applyViews(state);return this;
  }
  private assertDimension(next:ViewSpec,previous:ViewSpec):void{
    if(this.spec.layout&&next.kind!=='2d')throw new Error('Grid views must be 2D');
    if(this.spec.annotations?.length&&next.kind!=='2d')throw new Error('Annotations require a 2D panel');
    if(next.kind!==previous.kind&&(this.spec.layers.length||this.spec.bookmarks?.length))throw new Error('Cannot change dimensionality of a populated figure');
  }
  private replacePanelView(state:ViewState,panelId:string,view:ViewSpec):void{
    if(panelId==='main')state.view=view;else state.panelViews![panelId]=view;
  }
  private shareAxis(state:ViewState,panelId:string,axis:'x'|'y'):void{
    if(!this.spec.layout?.[axis==='x'?'shareX':'shareY'])return;
    const source=panelId==='main'?state.view:state.panelViews![panelId];
    for(const view of [state.view,...Object.values(state.panelViews??{})]){
      view[`${axis}Scale`]=source[`${axis}Scale`];
      const domain=source[`${axis}Domain`];if(domain===undefined)delete view[`${axis}Domain`];else view[`${axis}Domain`]=[...domain];
      const format=source[`${axis}Format`];if(format===undefined)delete view[`${axis}Format`];else view[`${axis}Format`]=structuredClone(format);
    }
  }
  private applyViews(state:ViewState):void{
    validateViewState(this.spec,state);
    const draft=structuredClone(this.spec);draft.view=copyView(state.view);
    for(const panel of draft.panels??[])if(panel.id!=='main')panel.view=copyView(state.panelViews![panel.id]);
    this.validateCurrentSemantics(draft);
    if([draft.view,...(draft.panels??[]).flatMap(panel=>panel.view?[panel.view]:[])].some(view=>view.xScale==='time'||view.yScale==='time'||view.xFormat!==undefined||view.yFormat!==undefined))this.spec.protocolVersion=Math.max(this.spec.protocolVersion,PRESENTATION_PROTOCOL_VERSION);
    this.spec.view=copyView(state.view);
    for(const panel of this.spec.panels??[])if(panel.id!=='main')panel.view=copyView(state.panelViews![panel.id]);
    this.changed();
  }
  captureViews():ViewState{this.assertOpen();return captureViews(this.spec);}
  restoreViews(state:ViewState):this{
    this.assertOpen();validateViewState(this.spec,state);this.assertDimension(state.view,this.spec.view);
    this.applyViews(state);this.view?.clearInteraction();this.emitViewChange();return this;
  }
  /** Replace the complete view, including clearing omitted automatic domains. */
  restoreView(view:ViewSpec):this{
    return this.restorePanelView('main',view);
  }
  restorePanelView(panelId:string,view:ViewSpec):this{
    const previous=this.panelView(panelId),next=copyView(view);this.assertDimension(next,previous);
    const state=this.captureViews();this.replacePanelView(state,panelId,next);
    this.shareAxis(state,panelId,'x');this.shareAxis(state,panelId,'y');
    this.applyViews(state);this.view?.clearInteraction();this.emitViewChange(panelId);return this;
  }
  /** Publish explicit resets so JSON transports do not lose omitted domains. */
  emitViewChange(panelId='main'):void{
    this.panelView(panelId);
    const wireView=(input:ViewSpec)=>{const view=structuredClone(input);return {...view,xDomain:view.xDomain??null,yDomain:view.yDomain??null,zDomain:view.zDomain??null,pan3d:view.pan3d??[0,0]};};
    const payload:ViewChangeEvent=wireView(this.spec.view);
    if(this.spec.layout){payload.panelId=panelId;payload.panelViews=Object.fromEntries(this.panelEntries().filter(panel=>panel.id!=='main').map(panel=>[panel.id,wireView(panel.view)]));}
    this.emit('viewchange',payload);
  }
  bookmark(name:string,options:{note?:string}={}):this{
    this.assertOpen();name=bookmarkName(name);
    if(options.note!==undefined&&typeof options.note!=='string')throw new TypeError('Bookmark note must be a string');
    const bookmark:ViewBookmark={name,...this.captureViews()};
    if(options.note)bookmark.note=options.note;
    const bookmarks=this.spec.bookmarks??=[],index=bookmarks.findIndex(item=>item.name===name);
    if(index<0)bookmarks.push(bookmark);else bookmarks[index]=bookmark;
    this.spec.bookmarks=bookmarks;this.changed();return this;
  }
  restoreBookmark(name:string):this{
    this.assertOpen();name=bookmarkName(name);const bookmark=this.spec.bookmarks?.find(item=>item.name===name);
    if(!bookmark)throw new Error(`Unknown bookmark: ${name}`);return this.restoreViews(bookmark);
  }
  removeBookmark(name:string):this{
    this.assertOpen();name=bookmarkName(name);const bookmarks=this.spec.bookmarks??[],index=bookmarks.findIndex(item=>item.name===name);
    if(index<0)throw new Error(`Unknown bookmark: ${name}`);bookmarks.splice(index,1);
    if(!bookmarks.length)delete this.spec.bookmarks;this.changed();return this;
  }
  setTitle(title:string):this{this.spec.title=title;this.changed();return this;}
  mount(container:HTMLElement):this{
    this.assertOpen();if(!container)throw new Error('A mount element is required');this.unmount();try{this.view=new FigureView(this,container);}catch(error){this.emit('error',{message:error instanceof Error?error.message:String(error)});throw error;}this.changed();return this;
  }
  async ready(options:ReadyOptions={}):Promise<void>{this.assertOpen();if(options.signal?.aborted)throw new DOMException('Waiting for the figure was aborted','AbortError');if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<=0))throw new RangeError('timeoutMs must be positive');if(this.view)await this.view.ready(options);}
  async savefig(options:ExportPNGOptions={}):Promise<Blob>{
    this.assertOpen();const validated=validateExportPNGOptions(options),view=this.view;
    if(!view)throw new Error('Mount the figure before exporting');
    // The view owns its ready/capture transaction. Retain that owner across an
    // unmount/remount instead of reading this.view again after an async wait.
    return view.exportPNG(validated);
  }
  /** Transport export of an invocation-time snapshot using the mounted GPU. */
  async savefigSnapshot(snapshot:Snapshot,buffers:Map<string,ArrayBuffer>,options:ExportPNGOptions={}):Promise<Blob>{
    this.assertOpen();if(!this.view)throw new Error('Mount the figure before exporting');
    return this.view.exportSnapshotPNG(snapshot,buffers,validateExportPNGOptions(options));
  }
  inspect():Array<RepresentationInfo&{layerId:string;panelId?:string}>{return this.view?.inspect()??[];}
  diagnostics(){return {sourceBytes:Array.from(this.registry.entries(),([,entry])=>entry.descriptor.byteLength).reduce((sum,bytes)=>sum+bytes,0),semanticScans:this.semanticScans,pendingAppends:this.streamWaiters.size,streams:Object.fromEntries(Array.from(this.streams,([key,state])=>[key,{...state}])),...this.view?.diagnostics()};}
  on<K extends FigureEvent>(event:K,callback:(event:FigureEventMap[K])=>void):()=>void{let handlers=this.listeners.get(event);if(!handlers){handlers=new Set();this.listeners.set(event,handlers);}handlers.add(callback);return ()=>handlers!.delete(callback);}
  emit<K extends FigureEvent>(event:K,payload:FigureEventMap[K]):void{
    for(const callback of [...(this.listeners.get(event)??[])])try{callback(payload);}catch(error){try{console.error(`Vesora ${event} callback failed`,error);}catch{/* Diagnostics cannot interrupt ready/error settlement. */}}
  }
  changed(streaming=false):void{this.assertOpen();this.view?.schedule(streaming);}
  snapshot():Snapshot{this.assertOpen();return {figure:structuredClone(this.spec),sources:Array.from(this.registry.entries(),([,entry])=>structuredClone(entry.descriptor))};}
  applySnapshot(snapshot:Snapshot,buffers:Map<string,ArrayBuffer>):void{
    // Clone before touching live storage; even a non-cloneable incoming field
    // must leave the previous scene and its source registry intact.
    this.assertOpen();const spec=structuredClone(snapshot.figure);
    if(![PROTOCOL_VERSION,EXTENDED_PROTOCOL_VERSION,STATISTICS_PROTOCOL_VERSION,LINKED_PROTOCOL_VERSION,PRESENTATION_PROTOCOL_VERSION,QUALITY_PROTOCOL_VERSION].includes(spec.protocolVersion))throw new Error(`Unsupported protocol version ${spec.protocolVersion}`);
    const presentationViews=[spec.view,...(spec.panels??[]).flatMap(panel=>panel.view?[panel.view]:[]),...(spec.bookmarks??[]).flatMap(bookmark=>[bookmark.view,...Object.values(bookmark.panelViews??{})])];
    if(spec.theme!==undefined)validateTheme(spec.theme);
    if(spec.protocolVersion<PRESENTATION_PROTOCOL_VERSION&&(spec.theme!==undefined||presentationViews.some(view=>view&&(view.xScale==='time'||view.yScale==='time'||view.xFormat!==undefined||view.yFormat!==undefined))))throw new Error('Themes, time scales and axis formats require protocol version 5');
    if(!Array.isArray(spec.layers)||!Array.isArray(snapshot.sources))throw new TypeError('Snapshot layers and sources must be arrays');
    if(spec.protocolVersion<QUALITY_PROTOCOL_VERSION&&(spec.hoverMode!==undefined||spec.theme&&hasTypography(spec.theme)||spec.layers.some(layer=>layer.kind==='band'||layer.style?.colorbarLabel!==undefined)))throw new Error('Bands, x inspection, role typography and colorbar labels require protocol version 6');
    if(spec.protocolVersion===PROTOCOL_VERSION&&(spec.layout!==undefined||spec.panels!==undefined||spec.annotations!==undefined||spec.layers.some(layer=>layer.panelId!==undefined)||spec.bookmarks?.some(bookmark=>bookmark.panelViews!==undefined)))throw new Error('Panels and annotations require protocol version 2');
    if(spec.protocolVersion<STATISTICS_PROTOCOL_VERSION&&(spec.categories!==undefined||spec.barModes!==undefined||spec.layers.some(layer=>isStatistical(layer.kind)||layer.options!==undefined||layer.categorical!==undefined)))throw new Error('Statistics and categories require protocol version 3');
    const next=new DataRegistry();const known=new Set<string>();
    if(!Number.isFinite(spec.width)||!Number.isFinite(spec.height)||spec.width<200||spec.height<180)throw new Error('Invalid figure dimensions');
    validateView(spec.view);validateLayout(spec);validateViewState(spec,captureViews(spec));validateBookmarks(spec.bookmarks,spec);
    const panels=panelEntries(spec),annotationIds=new Set<string>();
    if(spec.annotations!==undefined&&!Array.isArray(spec.annotations))throw new TypeError('Annotations must be an array');
    for(const annotation of spec.annotations??[]){
      validateAnnotation(annotation,panels);if(annotationIds.has(annotation.id))throw new Error('Duplicate annotation id');annotationIds.add(annotation.id);
    }
    for(const source of snapshot.sources){
      validateDescriptor(source);if(known.has(source.id))throw new Error('Duplicate source id');known.add(source.id);
      const buffer=buffers.get(source.id);if(!buffer)throw new Error(`Missing buffer ${source.id}`);next.register(source,buffer);
    }
    const layerIds=new Set<string>();
    for(const layer of spec.layers){
      if(typeof layer.id!=='string'||!layer.id)throw new Error('Layer id must be a nonempty string');
      if(layerIds.has(layer.id))throw new Error('Duplicate layer id');layerIds.add(layer.id);
      if(!['line','scatter','scatter3d','heatmap','surface','hist','bar','boxplot','band'].includes(layer.kind))throw new Error('Unknown layer kind');
      if(typeof layer.visible!=='boolean')throw new TypeError('Layer visibility must be a boolean');
      if(layer.panelId!==undefined&&(typeof layer.panelId!=='string'||!layer.panelId))throw new TypeError('Layer panelId must be a nonempty string');
      const panel=panels.find(item=>item.id===(layer.panelId??'main'));if(!panel)throw new Error('Layer references an unknown panel');
      if((layer.kind==='surface'||layer.kind==='scatter3d'?'3d':'2d')!==panel.view.kind)throw new Error('Layer dimensionality does not match view');
      validateStyle(layer.style);if(layer.kind==='band')validateBandStyle(layer.style);const values:Record<string,NumericArray>={};for(const [key,source] of Object.entries(layer.data)){
        if(!isStatistical(layer.kind)&&!(layer.kind==='band'?['x','lower','upper']:['x','y','z','color']).includes(key))throw new Error('Unknown data channel');
        const entry=next.get(source);const grid=key==='z'&&(layer.kind==='heatmap'||layer.kind==='surface');
        if(entry.descriptor.shape.length!==(grid?2:1))throw new Error('Invalid source dimensions');values[key]=entry.values;
      }
      if(isStatistical(layer.kind))validateStatisticalData(layer,values);else this.validateLayerData(layer.kind,values);
      if(layer.kind==='heatmap'||layer.kind==='surface'){const shape=next.get(layer.data.z).descriptor.shape;if(shape[0]!==values.y.length||shape[1]!==values.x.length)throw new Error('Grid source shape does not match coordinates');}
    }
    validateSemantics(spec,layer=>Object.fromEntries(Object.entries(layer.data).map(([key,source])=>[key,next.get(source).values])));
    validateSelectionLink(spec,next);
    this.isolateSelectionSources(spec,next);
    this.checkSourceBudget(new Map(next.entries()),true);this.rejectStreamWaiters();this.streams.clear();
    this.registry.clear();for(const [,entry]of next.entries())this.registry.set(entry.descriptor.id,entry.values,entry.descriptor.shape,entry.descriptor.version);
    this.spec=spec;this.pendingLink=undefined;this.notifiedLink='';this.view?.invalidateData();this.view?.clearInteraction();this.changed();
  }
  close():void{if(this.closed)return;this.rejectStreamWaiters();this.streams.clear();this.view?.dispose();this.view=undefined;this.registry.clear();this.listeners.clear();this.closed=true;}
  private assertOpen():void{if(this.closed)throw new Error('Figure is closed');}
}
export function figure(options:FigureOptions={}):Figure{return new Figure(options);}
export function subplots(options:SubplotsOptions):Figure{
  const {rows,cols,shareX=false,shareY=false,...figureOptions}=options;
  if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(cols)||rows<1||cols<1||!Number.isSafeInteger(rows*cols))throw new RangeError('Grid rows and cols must be positive safe integers');
  if(typeof shareX!=='boolean'||typeof shareY!=='boolean')throw new TypeError('Shared axis options must be booleans');
  const result=figure({...figureOptions,kind:'2d'});
  result.spec.protocolVersion=Math.max(result.spec.protocolVersion,EXTENDED_PROTOCOL_VERSION);result.spec.layout={rows,cols,shareX,shareY};result.spec.panels=[];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)result.spec.panels.push(row===0&&col===0?{id:'main',row,col,title:''}:{id:`panel-${row}-${col}`,row,col,title:'',view:defaultView()});
  return result;
}
export function plot(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Figure{const f=figure();f.plot(x,y,options);return f;}
export function fillBetween(x:Series,lower:Series,upper:Series,options:FillBetweenOptions={}):Figure{const f=figure();f.fillBetween(x,lower,upper,options);return f;}
export function scatter(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Figure{const f=figure();f.scatter(x,y,options);return f;}
export function heatmap(x:Series,y:Series,z:Grid,options:LayerOptions={}):Figure{const f=figure();f.heatmap(x,y,z,options);return f;}
export function surface(x:Series,y:Series,z:Grid,options:LayerOptions={}):Figure{const f=figure();f.surface(x,y,z,options);return f;}
export function scatter3d(x:Series,y:Series,z:Series,options:LayerOptions={}):Figure{const f=figure();f.scatter3d(x,y,z,options);return f;}

export function hist(samples:Series,options:HistogramOptions={}):Figure{const f=figure();f.hist(samples,options);return f;}
export function bar(x:AxisSeries,values:Series,options:BarOptions={}):Figure{const f=figure();f.bar(x,values,options);return f;}
export function barh(y:AxisSeries,values:Series,options:BarOptions={}):Figure{const f=figure();f.barh(y,values,options);return f;}
export function boxplot(groups:Groups,options:BoxplotOptions={}):Figure{const f=figure();f.boxplot(groups,options);return f;}
