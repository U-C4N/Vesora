import {DataRegistry,toNumericArray} from './data';
import {createNormalizer, extent, validateDomain} from './scales';
import {parseColor, colorMap} from './color';
import type {Geometry} from './renderer';
import type {AdvancedKind, AdvancedSpecOptions, Bounds, ContourSpecOptions, DataStore, Domain, ECDFSpecOptions, ErrorbarSpecOptions, EventTimelineSpecOptions, LayerSpec, LayerStyle, NumericArray, ParallelSpecOptions, ParetoSpecOptions, PhaseSpecOptions, QuiverSpecOptions, RepresentationInfo, SpectrogramSpecOptions, TernarySpecOptions, ViewSpec} from './types';

export const ADVANCED_KINDS: readonly AdvancedKind[] = ['ecdf','spectrogram','eventTimeline','errorbar','contour','quiver','parallelCoordinates','paretoFront','phasePortrait','ternary'];
export function isAdvancedLayer(layer:LayerSpec | string):boolean{return ADVANCED_KINDS.includes((typeof layer==='string'?layer:layer.kind) as AdvancedKind);}
export type AdvancedMark = (
  | {kind:'point';x:number;y:number}
  | {kind:'segment';x0:number;y0:number;x1:number;y1:number}
  | {kind:'rect';x0:number;y0:number;x1:number;y1:number}
  | {kind:'polygon';points:[number,number][]}
) & {itemIndex:number;sourceIndex?:number;role:string;scalar?:number;pixelSize?:number};
export interface AdvancedItem {index:number;sourceIndex?:number;[key:string]:unknown}
export interface PreparedAdvanced {kind:AdvancedKind;layerId:string;bounds:Bounds;marks:AdvancedMark[];items:AdvancedItem[];info:RepresentationInfo; colorDomain?:Domain;axes?:Array<{key:string;label:string;domain:Domain;scale:'linear'|'log';reverse?:boolean}>}
export interface ECDFQueryOptions {probability?:number;threshold?:number}
export interface ECDFQueryResult {
  count:number;omitted:number;quantile?:number|null;
  cumulativeCount?:number;exceedanceCount?:number;probability?:number|null;
  sourceIndices:number[];sourceCount:number;truncated:boolean;
  sourceKind:'quantile-ties'|'at-or-below'|'none';
}

/** Exact empirical queries over finite source samples. Threshold comparisons are inclusive,
 * exceedances are strict, and quantiles use observed nearest ranks (p=0 selects the minimum).
 * Identity previews follow source order, with ties retained and a 10,000-index payload cap. */
export function queryECDF(samples:ArrayLike<number>,options:ECDFQueryOptions={}):ECDFQueryResult {
  const raw=object(options,'ECDF query options');for(const key of Object.keys(raw))if(key!=='probability'&&key!=='threshold')throw new TypeError(`Unknown ECDF query option ${key}`);
  const p=options.probability,threshold=options.threshold;
  if(p!==undefined&&(typeof p!=='number'||!Number.isFinite(p)||p<0||p>1))throw new RangeError('probability must be finite and in [0, 1]');
  if(threshold!==undefined&&(typeof threshold!=='number'||!Number.isFinite(threshold)))throw new RangeError('threshold must be finite');
  const values=toNumericArray(samples),sorted=p===undefined?undefined:[] as number[],result:ECDFQueryResult={count:0,omitted:0,sourceIndices:[],sourceCount:0,truncated:false,sourceKind:threshold!==undefined?'at-or-below':p!==undefined?'quantile-ties':'none'};
  let cumulative=0;
  for(let index=0;index<values.length;index++){
    const value=values[index];if(!Number.isFinite(value)){result.omitted++;continue;}result.count++;sorted?.push(value);
    if(threshold!==undefined&&value<=threshold){cumulative++;if(result.sourceIndices.length<10000)result.sourceIndices.push(index);}
  }
  if(sorted){sorted.sort((a,b)=>a-b);result.quantile=sorted.length?sorted[Math.max(0,Math.ceil(p!*sorted.length)-1)]:null;}
  if(threshold!==undefined){result.cumulativeCount=cumulative;result.exceedanceCount=result.count-cumulative;result.probability=result.count?cumulative/result.count:null;result.sourceCount=cumulative;}
  else if(p!==undefined&&result.quantile!==null)for(let index=0;index<values.length;index++)if(Number.isFinite(values[index])&&values[index]===result.quantile){result.sourceCount++;if(result.sourceIndices.length<10000)result.sourceIndices.push(index);}
  result.truncated=result.sourceCount>result.sourceIndices.length;return result;
}

function object(value:unknown,name:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${name} must be an object`);return value as Record<string,unknown>;}
function positive(value:unknown,name:string,zero=false):asserts value is number{if(typeof value!=='number'||!Number.isFinite(value)||(zero?value<0:value<=0))throw new RangeError(`${name} must be finite and ${zero?'nonnegative':'positive'}`);}
function bool(value:unknown,name:string):void{if(typeof value!=='boolean')throw new TypeError(`${name} must be boolean`);}
function strings(value:unknown,name:string,unique=false):string[]{if(!Array.isArray(value)||value.some(v=>typeof v!=='string')||unique&&new Set(value).size!==value.length)throw new TypeError(`${name} must be ${unique?'unique ':''}strings`);return [...value];}

/** Canonical serializable options. No executable transforms enter a scene. */
export function advancedOptions(kind:AdvancedKind,input:unknown={}):AdvancedSpecOptions {
  const raw=object(input,`${kind} options`), allowed:Record<AdvancedKind,string[]>={
    ecdf:['complementary'],spectrogram:['maxRows','valueScale','dbReference','dbFloor','sequenceStart','sequenceEnd'],eventTimeline:['lanes','labels','eventIds'],errorbar:['capSize'],contour:['levels','filled'],quiver:['scale','normalize','headSize'],parallelCoordinates:['axes'],paretoFront:['objectives','showAll','connect'],phasePortrait:['direction','closed'],ternary:['sum','normalize','tolerance','labels','connect'],
  };
  for(const key of Object.keys(raw))if(!allowed[kind].includes(key))throw new TypeError(`Unknown ${kind} option ${key}`);
  if(kind==='ecdf'){const o={complementary:false,...raw} as ECDFSpecOptions;bool(o.complementary,'complementary');return o;}
  if(kind==='spectrogram'){
    const o={maxRows:256,valueScale:'linear',dbReference:1,dbFloor:-120,sequenceStart:0,sequenceEnd:0,...raw} as SpectrogramSpecOptions;
    if(!Number.isSafeInteger(o.maxRows)||o.maxRows<1||o.maxRows>0xffff_ffff)throw new RangeError('maxRows must be an integer from 1 through 2^32-1');
    if(!['linear','db'].includes(o.valueScale))throw new TypeError('valueScale must be linear or db');positive(o.dbReference,'dbReference');
    if(!Number.isFinite(o.dbFloor))throw new RangeError('dbFloor must be finite');
    if(!Number.isSafeInteger(o.sequenceStart)||!Number.isSafeInteger(o.sequenceEnd)||o.sequenceStart<0||o.sequenceEnd<o.sequenceStart||o.sequenceEnd-o.sequenceStart>o.maxRows)throw new RangeError('Invalid retained spectrogram sequence interval');
    return o;
  }
  if(kind==='eventTimeline'){
    const o={lanes:['Events'],labels:[],eventIds:[],...raw} as EventTimelineSpecOptions;
    o.lanes=strings(o.lanes,'lanes',true);o.labels=strings(o.labels,'labels');o.eventIds=strings(o.eventIds,'eventIds',true);
    if(!o.lanes.length||o.lanes.some(v=>!v)||o.eventIds.some(v=>!v))throw new TypeError('Lane names and event IDs must be nonempty');return o;
  }
  if(kind==='errorbar'){const o={capSize:6,...raw} as ErrorbarSpecOptions;positive(o.capSize,'capSize',true);return o;}
  if(kind==='contour'){
    const o={levels:[],filled:false,...raw} as ContourSpecOptions;bool(o.filled,'filled');
    if(!Array.isArray(o.levels)||!o.levels.length||o.levels.length>1024||o.levels.some((v,i)=>!Number.isFinite(v)||i>0&&v<=o.levels[i-1]))throw new RangeError('Contour levels must be 1–1024 finite strictly increasing numbers');
    o.levels=[...o.levels];return o;
  }
  if(kind==='quiver'){const o={scale:1,normalize:false,headSize:6,...raw} as QuiverSpecOptions;positive(o.scale,'scale');positive(o.headSize,'headSize');bool(o.normalize,'normalize');return o;}
  if(kind==='parallelCoordinates'){
    if(!Array.isArray(raw.axes)||raw.axes.length<2||raw.axes.length>256)throw new RangeError('Parallel coordinates require 2–256 axes');
    const axes=raw.axes.map((axis,index)=>{
      const a=object(axis,`axis ${index}`);for(const key of Object.keys(a))if(!['key','label','scale','reverse','domain'].includes(key))throw new TypeError(`Unknown parallel axis option ${key}`);
      if(typeof a.key!=='string'||!a.key)throw new TypeError('Parallel axis key must be nonempty');
      const result={key:a.key,label:a.label??a.key,scale:a.scale??'linear',reverse:a.reverse??false,...(a.domain!==undefined?{domain:a.domain}: {})} as ParallelSpecOptions['axes'][number];
      if(typeof result.label!=='string'||!['linear','log'].includes(result.scale))throw new TypeError('Invalid parallel axis label or scale');bool(result.reverse,'reverse');if(result.domain)result.domain=[...validateDomain(result.domain,result.scale)];return result;
    });
    if(new Set(axes.map(a=>a.key)).size!==axes.length)throw new Error('Parallel axis keys must be unique');return {axes};
  }
  if(kind==='paretoFront'){
    const o={objectives:['min','min'],showAll:true,connect:true,...raw} as ParetoSpecOptions;
    if(!Array.isArray(o.objectives)||o.objectives.length!==2||o.objectives.some(v=>v!=='min'&&v!=='max'))throw new TypeError('objectives must contain exactly two min/max directions');
    o.objectives=[...o.objectives];bool(o.showAll,'showAll');bool(o.connect,'connect');return o;
  }
  if(kind==='phasePortrait'){const o={direction:true,closed:false,...raw} as PhaseSpecOptions;bool(o.direction,'direction');bool(o.closed,'closed');return o;}
  const o={sum:1,normalize:false,tolerance:1e-6,labels:['A','B','C'],connect:false,...raw} as TernarySpecOptions;
  positive(o.sum,'sum');positive(o.tolerance,'tolerance',true);bool(o.normalize,'normalize');bool(o.connect,'connect');
  const names=strings(o.labels,'labels');if(names.length!==3)throw new Error('Ternary requires three labels');o.labels=names as [string,string,string];return o;
}

export function advancedChannels(kind:AdvancedKind,values:Record<string,NumericArray>,options:AdvancedSpecOptions):string[]{
  if(kind==='ecdf')return ['samples'];
  if(kind==='spectrogram'||kind==='contour')return ['x','y','z'];
  if(kind==='eventTimeline')return ['x','y','end'];
  if(kind==='errorbar')return ['x','y',...['xLower','xUpper','yLower','yUpper'].filter(k=>Object.hasOwn(values,k))];
  if(kind==='quiver')return ['x','y','u','v'];
  if(kind==='parallelCoordinates')return (options as ParallelSpecOptions).axes.map((_,i)=>`c${i}`);
  if(kind==='phasePortrait')return ['x','y',...['time','sequence'].filter(k=>Object.hasOwn(values,k))];
  if(kind==='ternary')return ['a','b','c'];return ['x','y'];
}
function increasing(values:NumericArray,name:string):void{for(let i=0;i<values.length;i++)if(!Number.isFinite(values[i])||i>0&&values[i]<=values[i-1])throw new Error(`${name} must be finite and strictly increasing`);}
export function validateSpectrogramCadence(time:ArrayLike<number>,previous?:ArrayLike<number>):void{
  const prefix=previous?Array.from(previous).slice(-2):[],values=[...prefix,...Array.from(time)];
  if(values.length<3)return;const step=values[1]-values[0];
  for(let i=2;i<values.length;i++){const expected=values[i-1]+step,tolerance=Math.max(1,Math.abs(expected),Math.abs(values[i]))*Number.EPSILON*16+Math.abs(step)*1e-9;if(Math.abs(values[i]-expected)>tolerance)throw new Error('Spectrogram time cadence must be regular; represent missing hops with explicit NaN rows');}
}
export function validateAdvancedData(layer:LayerSpec,v:Record<string,NumericArray>,view?:ViewSpec):void {
  const kind=layer.kind as AdvancedKind,o=advancedOptions(kind,layer.options),keys=advancedChannels(kind,v,o);
  if(Object.keys(v).length!==keys.length||keys.some(k=>!v[k]))throw new Error(`Invalid ${kind} data channels`);
  const projection=kind==='parallelCoordinates'?'parallel':kind==='ternary'?'ternary':'cartesian';
  if(view&&(view.kind!=='2d'||(view.projection??'cartesian')!==projection))throw new Error(`${kind} requires a ${projection} 2D projection`);
  if(view&&projection!=='cartesian'&&(view.xScale!=='linear'||view.yScale!=='linear'))throw new Error('Special projections use per-axis scales, not Cartesian log/time scales');
  if(kind==='ecdf'){if(view&&view.yScale==='time')throw new Error('ECDF probabilities require linear or log y scales');return;}
  if(kind==='spectrogram'||kind==='contour'){
    if(!v.x.length||kind==='contour'&&(v.x.length<2||v.y.length<2)||v.z.length!==v.x.length*v.y.length)throw new Error('Grid z shape must equal (y.length, x.length); contour requires at least 2×2');
    increasing(v.x,'Grid x');increasing(v.y,'Grid y');
    if(kind==='spectrogram'){
      const s=o as SpectrogramSpecOptions;if(v.y.length>s.maxRows||s.sequenceEnd-s.sequenceStart!==v.y.length)throw new Error('Spectrogram retained rows must match its sequence interval');
      validateSpectrogramCadence(v.y);
      if(view&&view.yScale==='log')throw new Error('Spectrogram time requires a linear or time y scale');
      if(s.valueScale==='db'&&v.z.some(value=>Number.isFinite(value)&&value<0))throw new Error('dB power inputs must be nonnegative');
    }
    if(view)for(const axis of ['x','y'] as const)if(view[`${axis}Scale`]==='log'&&v[axis].some(value=>value<=0))throw new Error('Log grid coordinates must be positive');return;
  }
  const count=v[keys[0]].length;
  if(keys.some(k=>v[k].length!==count))throw new Error(`${kind} channels must have equal lengths`);
  if(kind==='eventTimeline'){
    const e=o as EventTimelineSpecOptions;if(e.labels.length!==count||e.eventIds.length!==count)throw new Error('Event labels and IDs must match event count');
    for(let i=0;i<count;i++)if(!Number.isFinite(v.x[i])||!Number.isFinite(v.end[i])||v.end[i]<v.x[i]||!Number.isInteger(v.y[i])||v.y[i]<0||v.y[i]>=e.lanes.length)throw new Error('Events require finite ordered endpoints and valid lane codes');
    if(view&&(view.yScale!=='linear'||view.xScale==='log'))throw new Error('Event timeline uses numeric/time x and linear lane y');
  }
  if(kind==='errorbar'){
    if(!v.xLower&&!v.yLower)throw new Error('Provide at least one errorbar bound pair');
    for(const axis of ['x','y'] as const){const lower=v[`${axis}Lower`],upper=v[`${axis}Upper`];if(!!lower!==!!upper)throw new Error(`Provide both ${axis}Lower and ${axis}Upper`);
      if(lower)for(let i=0;i<count;i++){const nominal=v[axis][i];if([nominal,lower[i],upper[i]].every(Number.isFinite)&&(lower[i]>nominal||upper[i]<nominal))throw new Error('Error bounds must enclose the nominal value');if(view?.[`${axis}Scale`]==='log'&&[nominal,lower[i],upper[i]].some(value=>Number.isFinite(value)&&value<=0))throw new Error('Log errorbar coordinates and bounds must be positive');}
    }
  }
  if(kind==='quiver'&&view&&(view.xScale!=='linear'||view.yScale!=='linear'))throw new Error('Quiver requires linear numeric axes; vectors are in data-coordinate units');
  if(kind==='phasePortrait')for(const key of ['time','sequence'])if(v[key])increasing(v[key],key);
  if(kind==='ternary'){
    const t=o as TernarySpecOptions;for(let i=0;i<count;i++){
      const components=[v.a[i],v.b[i],v.c[i]];if(!components.every(Number.isFinite))continue;
      const sum=components[0]+components[1]+components[2];
      if(components.some(value=>value<0)||!Number.isFinite(sum)||sum<=0||!t.normalize&&Math.abs(sum-t.sum)>t.tolerance*t.sum)throw new Error('Ternary components must be nonnegative with a positive finite sum matching sum (or explicitly normalize)');
    }
  }
}

function read(store:DataStore,layer:LayerSpec):Record<string,NumericArray>{return Object.fromEntries(Object.entries(layer.data).map(([key,id])=>{const entry=store.get(id);if(!entry)throw new Error(`Missing ${key} source`);return [key,entry.values];}));}
function result(layer:LayerSpec,total:number):PreparedAdvanced{return {kind:layer.kind as AdvancedKind,layerId:layer.id,bounds:{x:[0,1],y:[0,1]},marks:[],items:[],info:{kind:layer.kind as AdvancedKind,total,visible:0,valid:0,omitted:0,rendered:0,exact:true,method:`source-aware ${layer.kind}`}};}
function finalize(p:PreparedAdvanced):PreparedAdvanced{
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const mark of p.marks){const points=mark.kind==='point'?[[mark.x,mark.y]]:mark.kind==='polygon'?mark.points:[[mark.x0,mark.y0],[mark.x1,mark.y1]];for(const [x,y]of points){if(!Number.isFinite(x)||!Number.isFinite(y))throw new RangeError('Advanced geometry exceeds finite coordinates');xmin=Math.min(xmin,x);xmax=Math.max(xmax,x);ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}}
  if(xmin!==Infinity)p.bounds={x:[xmin,xmax],y:[ymin,ymax]};p.info.visible=p.info.valid??0;p.info.rendered=p.items.length;return p;
}
function edges(values:NumericArray):Float64Array{
  const out=new Float64Array(values.length+1);if(!values.length)return out;
  if(values.length===1){out[0]=values[0]-.5;out[1]=values[0]+.5;return out;}
  for(let i=1;i<values.length;i++)out[i]=values[i-1]/2+values[i]/2;out[0]=values[0]-(out[1]-values[0]);out[values.length]=values[values.length-1]+(values[values.length-1]-out[values.length-1]);return out;
}
export function contourLevels(values:ArrayLike<number>,levels:number|number[]=10):number[]{
  if(Array.isArray(levels))return [...levels];if(!Number.isSafeInteger(levels)||levels<1||levels>1024)throw new RangeError('Contour level count must be 1–1024');
  let low=Infinity,high=-Infinity;for(let i=0;i<values.length;i++){const v=values[i];if(Number.isFinite(v)){low=Math.min(low,v);high=Math.max(high,v);}}
  if(low===Infinity){low=0;high=1;}else if(low===high){low-=.5;high+=.5;}
  return Array.from({length:levels},(_,i)=>low+(high-low)*(i+1)/(levels+1));
}
type ScalarVertex=[number,number,number];
function clipScalar(points:ScalarVertex[],bound:number,above:boolean):ScalarVertex[]{
  const out:ScalarVertex[]=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],inside=above?a[2]>=bound:a[2]<=bound,nextInside=above?b[2]>=bound:b[2]<=bound;if(inside)out.push(a);if(inside!==nextInside){const t=(bound-a[2])/(b[2]-a[2]);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1]),bound]);}}return out;
}

/** Pure preparation retains source ordinals; derived vertices never replace raw data. */
export function prepareAdvanced(layer:LayerSpec,registry:DataRegistry|DataStore):PreparedAdvanced {
  const store=registry instanceof DataRegistry?registry.store:registry,v=read(store,layer);validateAdvancedData(layer,v);
  const o=layer.options as AdvancedSpecOptions,kind=layer.kind as AdvancedKind;
  const total=kind==='ecdf'?v.samples.length:kind==='spectrogram'||kind==='contour'?v.z.length:kind==='parallelCoordinates'?v.c0.length:kind==='ternary'?v.a.length:v.x.length,p=result(layer,total);
  const item=(data:AdvancedItem)=>{p.items.push(data);return p.items.length-1;};
  const point=(x:number,y:number,index:number,role='sample',scalar?:number)=>p.marks.push({kind:'point',x,y,itemIndex:index,sourceIndex:p.items[index].sourceIndex,role,...(scalar!==undefined?{scalar}:{})});
  const segment=(x0:number,y0:number,x1:number,y1:number,index:number,role='line',pixelSize?:number,scalar?:number)=>p.marks.push({kind:'segment',x0,y0,x1,y1,itemIndex:index,sourceIndex:p.items[index].sourceIndex,role,...(pixelSize!==undefined?{pixelSize}:{}),...(scalar!==undefined?{scalar}:{})});
  if(kind==='ecdf'){
    const indices=Array.from({length:total},(_,i)=>i).filter(i=>Number.isFinite(v.samples[i])).sort((a,b)=>v.samples[a]-v.samples[b]||a-b),complementary=(o as ECDFSpecOptions).complementary,n=indices.length;
    p.info.valid=n;p.info.omitted=total-n;p.info.method=complementary?'exact empirical P(X > x), tied samples grouped':'exact empirical P(X <= x), tied samples grouped';
    let before=complementary?1:0,previous:number|undefined,previousIndex:number|undefined;
    for(let first=0;first<n;){let end=first+1;const value=v.samples[indices[first]];while(end<n&&v.samples[indices[end]]===value)end++;
      const after=complementary?(n-end)/n:end/n,index=item({index:indices[first],sourceIndex:indices[first],value,probability:after,count:end-first,cumulativeCount:end,sourceIndices:indices.slice(first,end)});
      if(previous!==undefined)segment(previous,before,value,before,previousIndex!,'step');segment(value,before,value,after,index,'step');point(value,after,index);previous=value;previousIndex=index;before=after;first=end;
    }finalize(p);p.bounds.y=[0,1];return p;
  }
  if(kind==='spectrogram'){
    const options=o as SpectrogramSpecOptions,xe=edges(v.x),ye=edges(v.y);let low=Infinity,high=-Infinity;
    for(let r=0;r<v.y.length;r++)for(let c=0;c<v.x.length;c++){
      const index=r*v.x.length+c,value=v.z[index];if(!Number.isFinite(value)){p.info.omitted!++;continue;}
      const scalar=options.valueScale==='db'?Math.max(options.dbFloor,10*(Math.log10(value)-Math.log10(options.dbReference))):value;
      p.info.valid!++;low=Math.min(low,scalar);high=Math.max(high,scalar);
    }p.colorDomain=low===Infinity?[0,1]:extent([low,high]);p.bounds={x:[xe[0],xe[xe.length-1]],y:v.y.length?[ye[0],ye[ye.length-1]]:[0,1]};p.info.visible=p.info.valid??0;p.info.rendered=p.info.valid??0;return p;
  }
  if(kind==='eventTimeline'){
    const options=o as EventTimelineSpecOptions;
    for(let k=0;k<total;k++){const i=item({index:k,sourceIndex:k,start:v.x[k],end:v.end[k],lane:options.lanes[v.y[k]],label:options.labels[k],eventId:options.eventIds[k]});
      if(v.x[k]===v.end[k])segment(v.x[k],v.y[k]-.3,v.x[k],v.y[k]+.3,i,'event');else p.marks.push({kind:'rect',x0:v.x[k],x1:v.end[k],y0:v.y[k]-.3,y1:v.y[k]+.3,itemIndex:i,sourceIndex:k,role:'event'});
    }p.info.valid=total;finalize(p);p.bounds.y=[-.5,options.lanes.length-.5];return p;
  }
  if(kind==='contour'){
    const options=o as ContourSpecOptions,levels=options.levels;p.info.exact=false;p.info.method='deterministic triangle-grid scalar interpolation; masked cells omitted';
    p.info.valid=Array.from(v.z).filter(Number.isFinite).length;p.info.omitted=total-p.info.valid;
    p.colorDomain=[levels[0],levels[levels.length-1]===levels[0]?levels[0]+1:levels[levels.length-1]];
    for(let row=0;row<v.y.length-1;row++)for(let col=0;col<v.x.length-1;col++){
      const ids=[row*v.x.length+col,row*v.x.length+col+1,(row+1)*v.x.length+col+1,(row+1)*v.x.length+col];if(ids.some(i=>!Number.isFinite(v.z[i])))continue;
      const vertices:ScalarVertex[]=ids.map((source,i)=>[v.x[col+(i===1||i===2?1:0)],v.y[row+(i>=2?1:0)],v.z[source]]);
      for(const corners of [[0,1,2],[0,2,3]]){const triangle=corners.map(i=>vertices[i]);
        if(options.filled){for(let band=0;band<=levels.length;band++){
          const lower=band?levels[band-1]:-Infinity,upper=band<levels.length?levels[band]:Infinity;let polygon=triangle;if(Number.isFinite(lower))polygon=clipScalar(polygon,lower,true);if(Number.isFinite(upper))polygon=clipScalar(polygon,upper,false);if(polygon.length<3)continue;
          const scalar=Number.isFinite(lower)&&Number.isFinite(upper)?lower/2+upper/2:Number.isFinite(lower)?lower:upper;
          const index=item({index:row*(v.x.length-1)+col,sourceIndex:ids[0],row,column:col,band,lower,upper,sourceIndices:corners.map(i=>ids[i])});p.marks.push({kind:'polygon',points:polygon.map(v=>[v[0],v[1]]),itemIndex:index,sourceIndex:ids[0],role:'isoband',scalar});
        }}else for(const level of levels){const intersections:[number,number][]=[];
          for(let edge=0;edge<3;edge++){const a=triangle[edge],b=triangle[(edge+1)%3];if((a[2]<level&&b[2]>=level)||(b[2]<level&&a[2]>=level)){const t=(level-a[2])/(b[2]-a[2]);intersections.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}
          if(intersections.length===2&&(intersections[0][0]!==intersections[1][0]||intersections[0][1]!==intersections[1][1])){const index=item({index:row*(v.x.length-1)+col,sourceIndex:ids[0],row,column:col,level,sourceIndices:corners.map(i=>ids[i])});segment(...intersections[0],...intersections[1],index,'isoline',undefined,level);}
        }
      }
    }finalize(p);p.bounds={x:[v.x[0],v.x[v.x.length-1]],y:[v.y[0],v.y[v.y.length-1]]};return p;
  }
  if(kind==='parallelCoordinates'){
    const axes=(o as ParallelSpecOptions).axes,domains=axes.map((axis,i)=>axis.domain??extent(v[`c${i}`],axis.scale)),normalizers=axes.map((axis,i)=>createNormalizer(domains[i],axis.scale));
    p.axes=axes.map((axis,i)=>({...axis,domain:domains[i]}));
    for(let row=0;row<total;row++){
      const values=axes.map((_,i)=>v[`c${i}`][row]),coordinates=values.map((value,i)=>{const y=normalizers[i](value);return axes[i].reverse?1-y:y;});
      if(!coordinates.some(Number.isFinite)){p.info.omitted!++;continue;}
      const i=item({index:row,sourceIndex:row,values,axes:axes.map(a=>a.key)});p.info.valid!++;
      for(let axis=0;axis<axes.length;axis++)if(Number.isFinite(coordinates[axis])){point(axis,coordinates[axis],i,'parallel-sample');if(axis&&Number.isFinite(coordinates[axis-1]))segment(axis-1,coordinates[axis-1],axis,coordinates[axis],i);}
    }finalize(p);p.bounds={x:[0,axes.length-1],y:[0,1]};return p;
  }
  if(kind==='ternary'){
    const options=o as TernarySpecOptions;let previous:{x:number;y:number}|undefined;
    for(let k=0;k<total;k++){
      const a=v.a[k],b=v.b[k],c=v.c[k];if(![a,b,c].every(Number.isFinite)){p.info.omitted!++;previous=undefined;continue;}
      const sum=a+b+c,x=(b+c*.5)/sum,y=c/sum*Math.sqrt(3)/2,i=item({index:k,sourceIndex:k,a,b,c,sum,normalized:[a/sum,b/sum,c/sum]});point(x,y,i,'ternary');if(options.connect&&previous)segment(previous.x,previous.y,x,y,i);previous={x,y};p.info.valid!++;
    }finalize(p);p.bounds={x:[0,1],y:[0,Math.sqrt(3)/2]};return p;
  }
  const valid=Array.from({length:total},(_,i)=>i).filter(i=>Number.isFinite(v.x[i])&&Number.isFinite(v.y[i]));p.info.valid=valid.length;p.info.omitted=total-valid.length;
  if(kind==='paretoFront'){
    const options=o as ParetoSpecOptions,sx=options.objectives[0]==='min'?1:-1,sy=options.objectives[1]==='min'?1:-1;
    const sorted=[...valid].sort((a,b)=>sx*v.x[a]-sx*v.x[b]||sy*v.y[a]-sy*v.y[b]||a-b),front=new Set<number>();let best=Infinity;
    for(let start=0;start<sorted.length;){let end=start+1;while(end<sorted.length&&v.x[sorted[end]]===v.x[sorted[start]])end++;let local=Infinity;for(let k=start;k<end;k++)local=Math.min(local,sy*v.y[sorted[k]]);if(local<best)for(let k=start;k<end;k++)if(sy*v.y[sorted[k]]===local)front.add(sorted[k]);best=Math.min(best,local);start=end;}
    let previous:number|undefined;const items=new Map<number,number>();
    for(const k of valid){const nondominated=front.has(k),i=item({index:k,sourceIndex:k,x:v.x[k],y:v.y[k],nondominated});items.set(k,i);if(options.showAll||nondominated)point(v.x[k],v.y[k],i,nondominated?'pareto-front':'dominated');}
    if(options.connect)for(const k of sorted)if(front.has(k)){if(previous!==undefined)segment(v.x[previous],v.y[previous],v.x[k],v.y[k],items.get(k)!,'front');previous=k;}
    p.info.method='exact two-objective dominance; duplicate nondominated candidates retained';return finalize(p);
  }
  if(kind==='phasePortrait'){
    const options=o as PhaseSpecOptions;let first:number|undefined,previous:number|undefined,lastItem=-1;
    for(let k=0;k<total;k++){
      if(!Number.isFinite(v.x[k])||!Number.isFinite(v.y[k])){previous=undefined;continue;}
      const i=item({index:k,sourceIndex:k,x:v.x[k],y:v.y[k],sequence:v.sequence?.[k]??k,...(v.time?{time:v.time[k]}:{})});point(v.x[k],v.y[k],i);if(first===undefined)first=k;
      if(previous!==undefined)segment(v.x[previous],v.y[previous],v.x[k],v.y[k],i,options.direction?'arrow':'line',6);previous=k;lastItem=i;
    }
    if(options.closed&&first!==undefined&&previous!==undefined&&valid.length===total&&total>2)segment(v.x[previous],v.y[previous],v.x[first],v.y[first],lastItem,options.direction?'arrow':'line',6);
    p.info.method='acquisition-order phase path; gaps retained';return finalize(p);
  }
  if(kind==='quiver'){
    const options=o as QuiverSpecOptions;for(const k of valid){const u=v.u[k],w=v.v[k];if(!Number.isFinite(u)||!Number.isFinite(w)){p.info.valid!--;p.info.omitted!++;continue;}
      const magnitude=Math.hypot(u,w),factor=options.scale*(options.normalize&&magnitude?1/magnitude:1),x1=v.x[k]+u*factor,y1=v.y[k]+w*factor;if(!Number.isFinite(x1)||!Number.isFinite(y1))throw new RangeError('Quiver endpoint exceeds finite coordinates');const i=item({index:k,sourceIndex:k,x:v.x[k],y:v.y[k],u,v:w,magnitude});segment(v.x[k],v.y[k],x1,y1,i,'arrow',options.headSize);if(!magnitude)point(v.x[k],v.y[k],i);}
    return finalize(p);
  }
  const cap=(o as ErrorbarSpecOptions).capSize;
  for(const k of valid){const required=['x','y',...['xLower','xUpper','yLower','yUpper'].filter(key=>v[key])];if(required.some(key=>!Number.isFinite(v[key][k]))){p.info.valid!--;p.info.omitted!++;continue;}
    const data=Object.fromEntries(required.map(key=>[key,v[key][k]])),i=item({index:k,sourceIndex:k,...data});point(v.x[k],v.y[k],i);
    if(v.xLower){segment(v.xLower[k],v.y[k],v.xUpper[k],v.y[k],i);segment(v.xLower[k],v.y[k],v.xLower[k],v.y[k],i,'vcap',cap);segment(v.xUpper[k],v.y[k],v.xUpper[k],v.y[k],i,'vcap',cap);}
    if(v.yLower){segment(v.x[k],v.yLower[k],v.x[k],v.yUpper[k],i);segment(v.x[k],v.yLower[k],v.x[k],v.yLower[k],i,'hcap',cap);segment(v.x[k],v.yUpper[k],v.x[k],v.yUpper[k],i,'hcap',cap);}
  }return finalize(p);
}

/** Shared triangle path for all advanced marks; texture grids can replace this on capable hosts. */
export function buildAdvancedGeometry(prepared:PreparedAdvanced,bounds:Bounds,view:ViewSpec,width:number,height:number,style:LayerStyle={}):Geometry {
  const nx=createNormalizer(bounds.x[0]===bounds.x[1]?extent(bounds.x,view.xScale):bounds.x,view.xScale),ny=createNormalizer(bounds.y[0]===bounds.y[1]?extent(bounds.y,view.yScale):bounds.y,view.yScale),base=parseColor(style.color,style.opacity??1),positions:number[]=[],colors:number[]=[],sources:number[]=[],domain=style.colorDomain??prepared.colorDomain??[0,1];
  const project=(x:number,y:number):[number,number]=>[nx(x)*2-1,ny(y)*2-1];
  const push=(p:[number,number],rgba:number[],source:number)=>{if(positions.length/3>=2_000_000)throw new RangeError('Advanced layer exceeds 2,000,000-vertex geometry budget');if(!p.every(Number.isFinite)||p.some(v=>Math.abs(v)>3.4028234663852886e38))return false;positions.push(p[0],p[1],0);colors.push(...rgba);sources.push(source);return true;};
  const triangle=(a:[number,number],b:[number,number],c:[number,number],rgba:number[],source:number)=>{if([a,b,c].some(p=>!p.every(Number.isFinite)))return;for(const p of [a,b,c])push(p,rgba,source);};
  const quad=(a:[number,number],b:[number,number],c:[number,number],d:[number,number],rgba:number[],source:number)=>{triangle(a,b,c,rgba,source);triangle(a,c,d,rgba,source);};
  for(const mark of prepared.marks){let rgba=mark.scalar!==undefined?colorMap(mark.scalar,domain,style.colormap):base;rgba=[...rgba];rgba[3]=style.opacity??1;if(mark.role==='dominated')rgba[3]*=.25;const source=mark.sourceIndex??mark.itemIndex;
    if(mark.kind==='point'){const [x,y]=project(mark.x,mark.y);if(x< -1||x>1||y< -1||y>1)continue;const rx=(style.size??5)/width,ry=(style.size??5)/height;quad([x-rx,y-ry],[x+rx,y-ry],[x+rx,y+ry],[x-rx,y+ry],rgba,source);}
    else if(mark.kind==='rect'){const a=project(mark.x0,mark.y0),b=project(mark.x1,mark.y1);if(b[0]<-1||a[0]>1||b[1]<-1||a[1]>1)continue;const x0=Math.max(-1,Math.min(1,a[0])),x1=Math.max(-1,Math.min(1,b[0])),y0=Math.max(-1,Math.min(1,a[1])),y1=Math.max(-1,Math.min(1,b[1]));quad([x0,y0],[x1,y0],[x1,y1],[x0,y1],rgba,source);}
    else if(mark.kind==='polygon'){
      let polygon=mark.points.map(p=>project(...p));for(const [axis,edge,sign]of [[0,-1,1],[0,1,-1],[1,-1,1],[1,1,-1]]){const next:[number,number][]=[];for(let k=0;k<polygon.length;k++){const a=polygon[k],b=polygon[(k+1)%polygon.length],inside=(a[axis]-edge)*sign>=0,nextInside=(b[axis]-edge)*sign>=0;if(inside)next.push(a);if(inside!==nextInside){const t=(edge-a[axis])/(b[axis]-a[axis]);next.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}polygon=next;}
      for(let i=1;i+1<polygon.length;i++)triangle(polygon[0],polygon[i],polygon[i+1],rgba,source);
    }else{
      let a=project(mark.x0,mark.y0),b=project(mark.x1,mark.y1);if(![...a,...b].every(Number.isFinite))continue;
      if(mark.role==='hcap'){a=[a[0]-(mark.pixelSize??6)/width,a[1]];b=[b[0]+(mark.pixelSize??6)/width,b[1]];}if(mark.role==='vcap'){a=[a[0],a[1]-(mark.pixelSize??6)/height];b=[b[0],b[1]+(mark.pixelSize??6)/height];}
      let low=0,high=1;const dx=b[0]-a[0],dy=b[1]-a[1];if(!Number.isFinite(dx)||!Number.isFinite(dy))continue;
      for(const [p,q]of [[-dx,a[0]+1],[dx,1-a[0]],[-dy,a[1]+1],[dy,1-a[1]]]){if(p===0){if(q<0){high=-1;break;}continue;}const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);}if(low>high)continue;
      const start:[number,number]=[a[0]+low*dx,a[1]+low*dy],end:[number,number]=[a[0]+high*dx,a[1]+high*dy],px=(end[0]-start[0])*width/2,py=(end[1]-start[1])*height/2,len=Math.hypot(px,py);if(!len)continue;
      const half=(style.width??1.5)/2,ox=-py/len*half*2/width,oy=px/len*half*2/height;quad([start[0]+ox,start[1]+oy],[start[0]-ox,start[1]-oy],[end[0]-ox,end[1]-oy],[end[0]+ox,end[1]+oy],rgba,source);
      if(mark.role==='arrow'&&high===1){const size=mark.pixelSize??6,back:[number,number]=[end[0]-px/len*size*2/width,end[1]-py/len*size*2/height],hx=-py/len*size/width,hy=px/len*size/height;triangle(end,[back[0]+hx,back[1]+hy],[back[0]-hx,back[1]-hy],rgba,source);}
    }
  }
  return {id:prepared.layerId,positions:Float32Array.from(positions),colors:Float32Array.from(colors),sourceIndices:Uint32Array.from(sources),primitive:'triangles'};
}

/** Conservative cache accounting includes nested tied IDs, per-row values and axis metadata.
 * This is a component budget estimate, not a measurement of the JavaScript VM heap. */
export function advancedBytes(prepared:PreparedAdvanced):number {
  const seen=new Set<object>(),backing=new Set<ArrayBufferLike>();
  const visit=(value:unknown):number=>{
    if(value===null||value===undefined)return 0;
    if(typeof value==='number'||typeof value==='boolean')return 8;
    if(typeof value==='string')return 16+value.length*2;
    if(typeof value!=='object')return 0;if(seen.has(value))return 0;seen.add(value);
    if(ArrayBuffer.isView(value)){let bytes=64;if(!backing.has(value.buffer)){backing.add(value.buffer);bytes+=value.buffer.byteLength;}return bytes;}
    if(value instanceof ArrayBuffer){if(backing.has(value))return 0;backing.add(value);return 32+value.byteLength;}
    if(Array.isArray(value))return 32+value.length*8+value.reduce((sum,item)=>sum+(typeof item==='object'||typeof item==='string'?visit(item):0),0);
    return 64+Object.entries(value).reduce((sum,[key,item])=>sum+24+key.length*2+visit(item),0);
  };
  return visit(prepared);
}
