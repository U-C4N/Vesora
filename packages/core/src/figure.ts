import {DataRegistry,toNumericArray,validateDescriptor,describeData} from './data';
import {validateDomain} from './scales';
import {parseColor} from './color';
import {FigureView} from './view';
import {axisCategories,categoryKey,encodeAxis,isStatistical,labels,statisticalOptions,validateSemantics,validateStatisticalData} from './semantics';
import type {AxisSeries} from './semantics';
import type {BarMode,BarSpecOptions,BoxplotSpecOptions,HistogramSpecOptions,StatisticalOptions} from './types';
import type {FigureSpec,FigureOptions,LayerSpec,LayerKind,LayerStyle,NumericArray,ViewSpec,ViewBookmark,ViewState,Snapshot,RepresentationInfo,PanelEntry,AnnotationSpec,AnnotationStyle,AnnotationOptions,SubplotsOptions} from './types';
import {PROTOCOL_VERSION,EXTENDED_PROTOCOL_VERSION,STATISTICS_PROTOCOL_VERSION} from './types';

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
    for(const view of views)if(view[`${axis}Scale`]!==scale||JSON.stringify(view[`${axis}Domain`])!==JSON.stringify(domain))throw new Error('Shared axis views must have matching scales and domains');
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
  for(const key of Object.keys(style))if(!['color','size','width','opacity','label','colormap','representation','colorDomain'].includes(key))throw new TypeError(`Unknown style option ${key}`);
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
  setOptions(options:Record<string,unknown>):this{this.figure.updateOptions(this.spec,options);return this;}
  setStyle(style:LayerStyle):this{validateStyle(style);Object.assign(this.spec.style,style);this.figure.changed();return this;}
  setVisible(visible:boolean):this{this.spec.visible=visible;this.figure.changed();return this;}
  remove():void{const layer=this.spec;this.figure.spec.layers=this.figure.spec.layers.filter(l=>l.id!==this.id);for(const source of Object.values(layer.data))if(!this.figure.spec.layers.some(other=>Object.values(other.data).includes(source)))this.figure.registry.release(source);this.figure.changed();}
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
  scatter(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Layer{return this.figure.addToPanel(this.id,'scatter',{x,y},options);}
  hist(samples:Series,options:HistogramOptions={}):Layer{return this.figure.addHistogram(this.id,samples,options);}
  bar(x:AxisSeries,values:Series,options:BarOptions={}):Layer{return this.figure.addBar(this.id,x,values,options,'vertical');}
  barh(y:AxisSeries,values:Series,options:BarOptions={}):Layer{return this.figure.addBar(this.id,y,values,options,'horizontal');}
  boxplot(groups:Groups,options:BoxplotOptions={}):Layer{return this.figure.addBoxplot(this.id,groups,options);}
  setBarMode(mode:BarMode):this{this.figure.setPanelBarMode(this.id,mode);return this;}
  setCategories(axis:'x'|'y',values:string[]):this{this.figure.setPanelCategories(this.id,axis,values);return this;}
  heatmap(x:Series,y:Series,z:Grid,options:LayerOptions={}):Layer{return this.figure.addToPanel(this.id,'heatmap',{x,y,z},options);}
  setView(options:Partial<ViewSpec>):this{this.figure.setPanelView(this.id,options);return this;}
  setTitle(title:string):this{this.figure.setPanelTitle(this.id,title);return this;}
  text(x:number,y:number,text:string,style:AnnotationStyle={}):Annotation{return this.figure.addAnnotation(this.id,'text',{x,y,text,...style});}
  axhline(y:number,style:AnnotationStyle={}):Annotation{return this.figure.addAnnotation(this.id,'hline',{y,...style});}
  axvline(x:number,style:AnnotationStyle={}):Annotation{return this.figure.addAnnotation(this.id,'vline',{x,...style});}
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
    validateSemantics(draft,layer=>this.layerValues(layer));this.spec.barModes=draft.barModes;this.spec.protocolVersion=Math.max(this.spec.protocolVersion,STATISTICS_PROTOCOL_VERSION);this.changed();return this;
  }
  setPanelCategories(panelId:string,axis:'x'|'y',input:string[]):this{
    this.panelView(panelId);if(!['x','y'].includes(axis))throw new Error('Category axis must be x or y');
    const key=categoryKey(this.spec,panelId,axis);
    if(this.spec.layers.some(layer=>categoryKey(this.spec,layer.panelId??'main',axis)===key))throw new Error('Set category order before adding data to this axis');
    const next=labels(input),previous=this.spec.categories?.[key]??[];
    if(previous.some((value,index)=>next[index]!==value))throw new Error('Category order is append-only');
    const draft=structuredClone(this.spec);(draft.categories??={})[key]=next;
    validateSemantics(draft,layer=>this.layerValues(layer));this.spec.categories=draft.categories;this.spec.protocolVersion=Math.max(this.spec.protocolVersion,STATISTICS_PROTOCOL_VERSION);this.changed();return this;
  }
  private layerValues(layer:LayerSpec):Record<string,NumericArray>{return Object.fromEntries(Object.entries(layer.data).map(([key,source])=>[key,this.registry.get(source).values]));}
  updateOptions(layer:LayerSpec,options:Record<string,unknown>):void{
    this.assertOpen();const next=statisticalOptions(layer.kind,{...layer.options,...options});
    if('orientation' in next&&next.orientation!==(layer.options as BarSpecOptions).orientation)throw new Error('Layer orientation cannot be changed');
    const candidate={...layer,options:next},draft=structuredClone(this.spec);draft.layers=draft.layers.map(item=>item.id===layer.id?candidate:item);
    validateSemantics(draft,item=>this.layerValues(item));layer.options=next;this.changed();
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
      const allowed=layer.kind==='hist'?['samples']:layer.kind==='bar'?['x','y','base']:['x','y','z','color'];
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
    // Prevalidate every descriptor too: an overflowing imported version must not
    // leave the first channel committed and the second channel unchanged.
    const writes=Array.from(modified,key=>{
      const source=candidate.data[key],old=this.registry.has(source)?this.registry.get(source):undefined;
      const shape=key==='z'&&(layer.kind==='surface'||layer.kind==='heatmap')?[values.y.length,values.x.length]:[values[key].length];
      return {key,descriptor:describeData(source,values[key],shape,(old?.descriptor.version??0)+1)};
    });
    for(const {key,descriptor} of writes)this.registry.set(descriptor.id,values[key],descriptor.shape,descriptor.version);
    const released=Object.values(layer.data).filter(source=>!Object.values(candidate.data).includes(source));
    Object.assign(layer,candidate);
    if(draft.categories!==undefined)this.spec.categories=draft.categories;
    if(isStatistical(layer.kind)||layer.categorical)this.spec.protocolVersion=Math.max(this.spec.protocolVersion,STATISTICS_PROTOCOL_VERSION);
    for(const source of released)if(!this.spec.layers.some(item=>Object.values(item.data).includes(source)))this.registry.release(source);
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
    return this.setPanelView('main',options);
  }
  setPanelView(panelId:string,options:Partial<ViewSpec>):this{
    const previous=this.panelView(panelId),next=copyView({...previous,...options});
    this.assertDimension(next,previous);
    const state=this.captureViews();this.replacePanelView(state,panelId,next);
    for(const axis of ['x','y'] as const)if(`${axis}Scale` in options||`${axis}Domain` in options)this.shareAxis(state,panelId,axis);
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
    }
  }
  private applyViews(state:ViewState):void{
    validateViewState(this.spec,state);
    const draft=structuredClone(this.spec);draft.view=copyView(state.view);
    for(const panel of draft.panels??[])if(panel.id!=='main')panel.view=copyView(state.panelViews![panel.id]);
    validateSemantics(draft,layer=>this.layerValues(layer));
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
    const payload:{[key:string]:unknown}=wireView(this.spec.view);
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
    this.assertOpen();if(!container)throw new Error('A mount element is required');this.view?.dispose();this.view=new FigureView(this,container);this.changed();return this;
  }
  async ready():Promise<void>{this.assertOpen();if(this.view)await this.view.ready();}
  async savefig():Promise<Blob>{this.assertOpen();if(!this.view)throw new Error('Mount the figure before exporting');await this.ready();return this.view.exportPNG();}
  inspect():Array<RepresentationInfo&{layerId:string;panelId?:string}>{return this.view?.inspect()??[];}
  on(event:FigureEvent,callback:(event:any)=>void):()=>void{let handlers=this.listeners.get(event);if(!handlers){handlers=new Set();this.listeners.set(event,handlers);}handlers.add(callback);return ()=>handlers!.delete(callback);}
  emit(event:FigureEvent,payload:any):void{for(const callback of this.listeners.get(event)??[])callback(payload);}
  changed():void{this.assertOpen();this.view?.schedule();}
  snapshot():Snapshot{this.assertOpen();return {figure:structuredClone(this.spec),sources:Array.from(this.registry.entries(),([,entry])=>structuredClone(entry.descriptor))};}
  applySnapshot(snapshot:Snapshot,buffers:Map<string,ArrayBuffer>):void{
    // Clone before touching live storage; even a non-cloneable incoming field
    // must leave the previous scene and its source registry intact.
    this.assertOpen();const spec=structuredClone(snapshot.figure);
    if(![PROTOCOL_VERSION,EXTENDED_PROTOCOL_VERSION,STATISTICS_PROTOCOL_VERSION].includes(spec.protocolVersion))throw new Error(`Unsupported protocol version ${spec.protocolVersion}`);
    if(!Array.isArray(spec.layers)||!Array.isArray(snapshot.sources))throw new TypeError('Snapshot layers and sources must be arrays');
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
      if(!['line','scatter','scatter3d','heatmap','surface','hist','bar','boxplot'].includes(layer.kind))throw new Error('Unknown layer kind');
      if(layer.panelId!==undefined&&(typeof layer.panelId!=='string'||!layer.panelId))throw new TypeError('Layer panelId must be a nonempty string');
      const panel=panels.find(item=>item.id===(layer.panelId??'main'));if(!panel)throw new Error('Layer references an unknown panel');
      if((layer.kind==='surface'||layer.kind==='scatter3d'?'3d':'2d')!==panel.view.kind)throw new Error('Layer dimensionality does not match view');
      validateStyle(layer.style);const values:Record<string,NumericArray>={};for(const [key,source] of Object.entries(layer.data)){
        if(!isStatistical(layer.kind)&&!['x','y','z','color'].includes(key))throw new Error('Unknown data channel');
        const entry=next.get(source);const grid=key==='z'&&(layer.kind==='heatmap'||layer.kind==='surface');
        if(entry.descriptor.shape.length!==(grid?2:1))throw new Error('Invalid source dimensions');values[key]=entry.values;
      }
      if(isStatistical(layer.kind))validateStatisticalData(layer,values);else this.validateLayerData(layer.kind,values);
      if(layer.kind==='heatmap'||layer.kind==='surface'){const shape=next.get(layer.data.z).descriptor.shape;if(shape[0]!==values.y.length||shape[1]!==values.x.length)throw new Error('Grid source shape does not match coordinates');}
    }
    validateSemantics(spec,layer=>Object.fromEntries(Object.entries(layer.data).map(([key,source])=>[key,next.get(source).values])));
    this.registry.clear();for(const [,entry]of next.entries())this.registry.set(entry.descriptor.id,entry.values,entry.descriptor.shape,entry.descriptor.version);
    this.spec=spec;this.view?.invalidateData();this.view?.clearInteraction();this.changed();
  }
  close():void{if(this.closed)return;this.view?.dispose();this.view=undefined;this.registry.clear();this.listeners.clear();this.closed=true;}
  private assertOpen():void{if(this.closed)throw new Error('Figure is closed');}
}
export function figure(options:FigureOptions={}):Figure{return new Figure(options);}
export function subplots(options:SubplotsOptions):Figure{
  const {rows,cols,shareX=false,shareY=false,...figureOptions}=options;
  if(!Number.isSafeInteger(rows)||!Number.isSafeInteger(cols)||rows<1||cols<1||!Number.isSafeInteger(rows*cols))throw new RangeError('Grid rows and cols must be positive safe integers');
  if(typeof shareX!=='boolean'||typeof shareY!=='boolean')throw new TypeError('Shared axis options must be booleans');
  const result=figure({...figureOptions,kind:'2d'});
  result.spec.protocolVersion=EXTENDED_PROTOCOL_VERSION;result.spec.layout={rows,cols,shareX,shareY};result.spec.panels=[];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)result.spec.panels.push(row===0&&col===0?{id:'main',row,col,title:''}:{id:`panel-${row}-${col}`,row,col,title:'',view:defaultView()});
  return result;
}
export function plot(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Figure{const f=figure();f.plot(x,y,options);return f;}
export function scatter(x:AxisSeries,y:AxisSeries,options:LayerOptions={}):Figure{const f=figure();f.scatter(x,y,options);return f;}
export function heatmap(x:Series,y:Series,z:Grid,options:LayerOptions={}):Figure{const f=figure();f.heatmap(x,y,z,options);return f;}
export function surface(x:Series,y:Series,z:Grid,options:LayerOptions={}):Figure{const f=figure();f.surface(x,y,z,options);return f;}
export function scatter3d(x:Series,y:Series,z:Series,options:LayerOptions={}):Figure{const f=figure();f.scatter3d(x,y,z,options);return f;}

export function hist(samples:Series,options:HistogramOptions={}):Figure{const f=figure();f.hist(samples,options);return f;}
export function bar(x:AxisSeries,values:Series,options:BarOptions={}):Figure{const f=figure();f.bar(x,values,options);return f;}
export function barh(y:AxisSeries,values:Series,options:BarOptions={}):Figure{const f=figure();f.barh(y,values,options);return f;}
export function boxplot(groups:Groups,options:BoxplotOptions={}):Figure{const f=figure();f.boxplot(groups,options);return f;}
