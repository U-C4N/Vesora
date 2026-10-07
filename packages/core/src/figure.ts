import {DataRegistry,toNumericArray,validateDescriptor} from './data';
import {validateDomain} from './scales';
import {parseColor} from './color';
import {FigureView} from './view';
import type {FigureSpec,FigureOptions,LayerSpec,LayerKind,LayerStyle,NumericArray,ViewSpec,ViewBookmark,Snapshot,RepresentationInfo} from './types';
import {PROTOCOL_VERSION} from './types';

let serial=0;
const id=(prefix:string)=>`${prefix}-${++serial}`;
export type Series=ArrayLike<number>;
export type Grid=Series|number[][];
export type LayerOptions=LayerStyle & {values?: Series};
export type FigureEvent='selection'|'hover'|'viewchange'|'representation'|'error';
export function defaultView(kind:'2d'|'3d'='2d'):ViewSpec{return {kind,xScale:'linear',yScale:'linear',zScale:'linear',xLabel:'',yLabel:'',zLabel:'',camera:{azimuth:35,elevation:25,distance:3},pan3d:[0,0]};}
function validateView(view:ViewSpec):void{
  if(!view||!['2d','3d'].includes(view.kind))throw new Error('Invalid view kind');
  for(const axis of ['x','y','z'] as const){
    const scale=view[`${axis}Scale`];if(!['linear','log'].includes(scale))throw new Error('Scale must be linear or log');
    const domain=view[`${axis}Domain`];if(domain!==undefined)validateDomain(domain,scale);
    if(typeof view[`${axis}Label`]!=='string')throw new TypeError('Axis labels must be strings');
  }
  if(!view.camera||!['azimuth','elevation','distance'].every(key=>Number.isFinite(view.camera[key as keyof ViewSpec['camera']]))||view.camera.distance<=0)throw new Error('Invalid camera');
  if(view.pan3d!==undefined&&(!Array.isArray(view.pan3d)||view.pan3d.length!==2||!view.pan3d.every(Number.isFinite)))throw new Error('3D pan must contain two finite values');
}
function copyView(view:ViewSpec):ViewSpec{
  validateView(view);const copy=structuredClone(view);
  for(const key of ['xDomain','yDomain','zDomain','pan3d'] as const)if(copy[key]===undefined)delete copy[key];
  return copy;
}
function bookmarkName(name:string):string{
  if(typeof name!=='string'||!name.trim())throw new TypeError('Bookmark name must be a nonempty string');
  return name.trim();
}
function validateBookmarks(bookmarks:ViewBookmark[]|undefined,kind:ViewSpec['kind']):void{
  if(bookmarks===undefined)return;
  if(!Array.isArray(bookmarks))throw new TypeError('Bookmarks must be an array');
  const names=new Set<string>();
  for(const bookmark of bookmarks){
    if(!bookmark)throw new TypeError('Invalid bookmark');
    const name=bookmarkName(bookmark.name);
    if(name!==bookmark.name)throw new TypeError('Bookmark names must not have surrounding whitespace');
    if(names.has(name))throw new Error('Duplicate bookmark name');names.add(name);
    if(bookmark.note!==undefined&&typeof bookmark.note!=='string')throw new TypeError('Bookmark note must be a string');
    validateView(bookmark.view);if(bookmark.view.kind!==kind)throw new Error('Bookmark dimensionality does not match figure');
  }
}
function flatten(values:Grid):NumericArray{return toNumericArray(Array.isArray(values)&&Array.isArray(values[0])?(values as number[][]).flat():values as Series);}
export function validateStyle(style:LayerStyle):void{
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
  setData(data:Record<string,Grid>):this{this.figure.updateData(this.spec,data);return this;}
  setStyle(style:LayerStyle):this{validateStyle(style);Object.assign(this.spec.style,style);this.figure.changed();return this;}
  setVisible(visible:boolean):this{this.spec.visible=visible;this.figure.changed();return this;}
  remove():void{const layer=this.spec;this.figure.spec.layers=this.figure.spec.layers.filter(l=>l.id!==this.id);for(const source of Object.values(layer.data))if(!this.figure.spec.layers.some(other=>Object.values(other.data).includes(source)))this.figure.registry.release(source);this.figure.changed();}
}
export class Figure {
  readonly registry=new DataRegistry();
  spec:FigureSpec;
  private view?:FigureView;
  private listeners=new Map<FigureEvent,Set<(event:any)=>void>>();
  private closed=false;
  constructor(options:FigureOptions={}){
    this.spec={protocolVersion:PROTOCOL_VERSION,id:id('figure'),title:options.title??'',width:options.width??800,height:options.height??520,view:defaultView(options.kind),layers:[]};
    if(!Number.isFinite(this.spec.width)||!Number.isFinite(this.spec.height)||this.spec.width<200||this.spec.height<180)throw new RangeError('Figure dimensions must be finite and at least 200 × 180');
  }
  plot(x:Series,y:Series,options:LayerOptions={}):Layer{return this.add('line',{x,y},options);}
  scatter(x:Series,y:Series,options:LayerOptions={}):Layer{return this.add('scatter',{x,y},options);}
  scatter3d(x:Series,y:Series,z:Series,options:LayerOptions={}):Layer{return this.add('scatter3d',{x,y,z},options);}
  heatmap(x:Series,y:Series,z:Grid,options:LayerOptions={}):Layer{return this.add('heatmap',{x,y,z},options);}
  surface(x:Series,y:Series,z:Grid,options:LayerOptions={}):Layer{return this.add('surface',{x,y,z},options);}
  private add(kind:LayerKind,data:Record<string,Grid>,options:LayerOptions):Layer{
    this.assertOpen();const dimension=kind==='surface'||kind==='scatter3d'?'3d':'2d';
    if((this.spec.layers.length||this.spec.bookmarks?.length)&&this.spec.view.kind!==dimension)throw new Error('2D and 3D layers need separate figures');
    const {values,...style}=options;validateStyle(style);if(values)data={...data,color:values};
    const layer:LayerSpec={id:id('layer'),kind,data:{},style,visible:true};
    this.updateData(layer,data,false);this.spec.view.kind=dimension;this.spec.layers.push(layer);this.changed();return new Layer(this,layer.id);
  }
  updateData(layer:LayerSpec,data:Record<string,Grid>,notify=true):void{
    this.assertOpen();const values:Record<string,NumericArray>={};
    for(const [key,source] of Object.entries(layer.data))values[key]=this.registry.get(source).values;
    for(const [key,input] of Object.entries(data)){
      if(!['x','y','z','color'].includes(key))throw new Error(`Unknown data channel ${key}`);
      if(Array.isArray(input)&&Array.isArray(input[0])){const rows=input as number[][];if(key!=='z'||!(layer.kind==='heatmap'||layer.kind==='surface'))throw new Error('Point coordinates must be one-dimensional');if(rows.some(row=>row.length!==rows[0].length))throw new Error('Grid rows must have equal lengths');}
      values[key]=flatten(input);
    }
    this.validateLayerData(layer.kind,values);
    if(layer.kind==='heatmap'||layer.kind==='surface'){
      const input=data.z;
      if(Array.isArray(input)&&Array.isArray(input[0])&&(input.length!==values.y.length||(input[0] as number[]).length!==values.x.length))throw new Error('Grid z shape must equal (y.length, x.length)');
      if(!input&&layer.data.z){const shape=this.registry.get(layer.data.z).descriptor.shape;if(shape[0]!==values.y.length||shape[1]!==values.x.length)throw new Error('Supply a reshaped z grid when changing grid dimensions');}
    }
    for(const key of Object.keys(data)){
      const source=layer.data[key]??`${layer.id}-${key}`;
      const old=layer.data[key]?this.registry.get(source):undefined;
      const shape=(key==='z'&&(layer.kind==='surface'||layer.kind==='heatmap'))?[values.y.length,values.x.length]:[values[key].length];
      this.registry.set(source,values[key],shape,(old?.descriptor.version??0)+1);layer.data[key]=source;
    }
    if(notify)this.changed();
  }
  private validateLayerData(kind:LayerKind,v:Record<string,NumericArray>):void{
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
    this.assertOpen();
    const next={...this.spec.view,...options};
    if(options.kind&&options.kind!==this.spec.view.kind&&(this.spec.layers.length||this.spec.bookmarks?.length))throw new Error('Cannot change dimensionality of a populated figure');
    this.spec.view=copyView(next);this.changed();return this;
  }
  /** Replace the complete view, including clearing omitted automatic domains. */
  restoreView(view:ViewSpec):this{
    this.assertOpen();const next=copyView(view);
    if(next.kind!==this.spec.view.kind&&(this.spec.layers.length||this.spec.bookmarks?.length))throw new Error('Cannot change dimensionality of a populated figure');
    this.spec.view=next;this.view?.clearInteraction();this.changed();this.emitViewChange();return this;
  }
  /** Publish explicit resets so JSON transports do not lose omitted domains. */
  emitViewChange():void{
    const view=structuredClone(this.spec.view);
    this.emit('viewchange',{...view,xDomain:view.xDomain??null,yDomain:view.yDomain??null,zDomain:view.zDomain??null,pan3d:view.pan3d??[0,0]});
  }
  bookmark(name:string,options:{note?:string}={}):this{
    this.assertOpen();name=bookmarkName(name);
    if(options.note!==undefined&&typeof options.note!=='string')throw new TypeError('Bookmark note must be a string');
    const bookmark:ViewBookmark={name,view:copyView(this.spec.view)};
    if(options.note)bookmark.note=options.note;
    const bookmarks=this.spec.bookmarks??=[],index=bookmarks.findIndex(item=>item.name===name);
    if(index<0)bookmarks.push(bookmark);else bookmarks[index]=bookmark;
    this.spec.bookmarks=bookmarks;this.changed();return this;
  }
  restoreBookmark(name:string):this{
    this.assertOpen();name=bookmarkName(name);const bookmark=this.spec.bookmarks?.find(item=>item.name===name);
    if(!bookmark)throw new Error(`Unknown bookmark: ${name}`);return this.restoreView(bookmark.view);
  }
  removeBookmark(name:string):this{
    this.assertOpen();name=bookmarkName(name);const bookmarks=this.spec.bookmarks??[],index=bookmarks.findIndex(item=>item.name===name);
    if(index<0)throw new Error(`Unknown bookmark: ${name}`);bookmarks.splice(index,1);
    if(!bookmarks.length)delete this.spec.bookmarks;this.changed();return this;
  }
  setTitle(title:string):this{this.spec.title=title;this.changed();return this;}
  mount(container:HTMLElement):this{
    this.assertOpen();if(!container)throw new Error('A mount element is required');this.view?.dispose();this.view=new FigureView(this,container);this.changed();return this;
  }
  async ready():Promise<void>{this.assertOpen();if(this.view)await this.view.ready();}
  async savefig():Promise<Blob>{this.assertOpen();if(!this.view)throw new Error('Mount the figure before exporting');await this.ready();return this.view.exportPNG();}
  inspect():Array<RepresentationInfo&{layerId:string}>{return this.view?.inspect()??[];}
  on(event:FigureEvent,callback:(event:any)=>void):()=>void{let handlers=this.listeners.get(event);if(!handlers){handlers=new Set();this.listeners.set(event,handlers);}handlers.add(callback);return ()=>handlers!.delete(callback);}
  emit(event:FigureEvent,payload:any):void{for(const callback of this.listeners.get(event)??[])callback(payload);}
  changed():void{this.assertOpen();this.view?.schedule();}
  snapshot():Snapshot{this.assertOpen();return {figure:structuredClone(this.spec),sources:Array.from(this.registry.entries(),([,entry])=>structuredClone(entry.descriptor))};}
  applySnapshot(snapshot:Snapshot,buffers:Map<string,ArrayBuffer>):void{
    this.assertOpen();const spec=snapshot.figure;
    if(spec.protocolVersion!==PROTOCOL_VERSION)throw new Error(`Unsupported protocol version ${spec.protocolVersion}`);
    const next=new DataRegistry();const known=new Set<string>();
    if(!Number.isFinite(spec.width)||!Number.isFinite(spec.height)||spec.width<200||spec.height<180)throw new Error('Invalid figure dimensions');
    validateView(spec.view);validateBookmarks(spec.bookmarks,spec.view.kind);
    for(const source of snapshot.sources){
      validateDescriptor(source);if(known.has(source.id))throw new Error('Duplicate source id');known.add(source.id);
      const buffer=buffers.get(source.id);if(!buffer)throw new Error(`Missing buffer ${source.id}`);next.register(source,buffer);
    }
    const layerIds=new Set<string>();
    for(const layer of spec.layers){
      if(layerIds.has(layer.id))throw new Error('Duplicate layer id');layerIds.add(layer.id);
      if(!['line','scatter','scatter3d','heatmap','surface'].includes(layer.kind))throw new Error('Unknown layer kind');
      if((layer.kind==='surface'||layer.kind==='scatter3d'?'3d':'2d')!==spec.view.kind)throw new Error('Layer dimensionality does not match view');
      validateStyle(layer.style);const values:Record<string,NumericArray>={};for(const [key,source] of Object.entries(layer.data)){
        if(!['x','y','z','color'].includes(key))throw new Error('Unknown data channel');
        const entry=next.get(source);const grid=key==='z'&&(layer.kind==='heatmap'||layer.kind==='surface');
        if(entry.descriptor.shape.length!==(grid?2:1))throw new Error('Invalid source dimensions');values[key]=entry.values;
      }
      this.validateLayerData(layer.kind,values);
      if(layer.kind==='heatmap'||layer.kind==='surface'){const shape=next.get(layer.data.z).descriptor.shape;if(shape[0]!==values.y.length||shape[1]!==values.x.length)throw new Error('Grid source shape does not match coordinates');}
    }
    this.registry.clear();for(const [,entry]of next.entries())this.registry.set(entry.descriptor.id,entry.values,entry.descriptor.shape,entry.descriptor.version);
    this.spec=structuredClone(spec);this.view?.clearInteraction();this.changed();
  }
  close():void{if(this.closed)return;this.view?.dispose();this.view=undefined;this.registry.clear();this.listeners.clear();this.closed=true;}
  private assertOpen():void{if(this.closed)throw new Error('Figure is closed');}
}
export function figure(options:FigureOptions={}):Figure{return new Figure(options);}
export function plot(x:Series,y:Series,options:LayerOptions={}):Figure{const f=figure();f.plot(x,y,options);return f;}
export function scatter(x:Series,y:Series,options:LayerOptions={}):Figure{const f=figure();f.scatter(x,y,options);return f;}
export function heatmap(x:Series,y:Series,z:Grid,options:LayerOptions={}):Figure{const f=figure();f.heatmap(x,y,z,options);return f;}
export function surface(x:Series,y:Series,z:Grid,options:LayerOptions={}):Figure{const f=figure();f.surface(x,y,z,options);return f;}
export function scatter3d(x:Series,y:Series,z:Series,options:LayerOptions={}):Figure{const f=figure();f.scatter3d(x,y,z,options);return f;}
