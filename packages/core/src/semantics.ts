import {toNumericArray} from './data';
import {validateDomain} from './scales';
import type {BarSpecOptions, BoxplotSpecOptions, FigureSpec, HistogramSpecOptions, LayerKind, LayerSpec, NumericArray, StatisticalOptions, ViewSpec} from './types';

export type AxisSeries = ArrayLike<number> | readonly string[];
export function categoryKey(spec: FigureSpec, panelId: string, axis: 'x'|'y'): string {
  return `${axis}:${spec.layout?.[axis === 'x' ? 'shareX' : 'shareY'] ? 'shared' : panelId}`;
}
export function axisCategories(spec: FigureSpec, panelId: string, axis: 'x'|'y'): string[] | undefined {
  return spec.categories?.[categoryKey(spec, panelId, axis)];
}
export function isStatistical(kind: LayerKind): boolean {return kind === 'hist' || kind === 'bar' || kind === 'boxplot';}
export function labels(input: unknown): string[] {
  if (!Array.isArray(input) || input.some(value => typeof value !== 'string')) throw new TypeError('Category labels must be strings');
  if (new Set(input).size !== input.length) throw new Error('Category labels must be unique');
  return [...input];
}

/** Work only against a draft scene: invalid updates must not allocate category slots. */
export function encodeAxis(spec: FigureSpec, layer: LayerSpec, axis: 'x'|'y', input: AxisSeries): NumericArray {
  const key = categoryKey(spec, layer.panelId ?? 'main', axis), known = spec.categories?.[key];
  const strings = Array.isArray(input) && (input.length > 0 ? input.some(value => typeof value === 'string') : known !== undefined);
  if (strings) {
    if (input.some(value => typeof value !== 'string')) throw new TypeError('An axis must contain only numbers or only strings');
    if (!['line','scatter','bar','boxplot'].includes(layer.kind)) throw new TypeError('This layer requires numeric coordinates');
    const values = known ? [...known] : [], codes = new Map(values.map((value,index) => [value,index]));
    const result = new Float64Array(input.length);
    for (let i=0; i<input.length; i++) {
      const value = input[i] as string;
      if (!codes.has(value)) {codes.set(value,values.length); values.push(value);}
      result[i] = codes.get(value)!;
    }
    (spec.categories ??= {})[key] = values;
    (layer.categorical ??= {})[axis] = true;
    return result;
  }
  if (known !== undefined || layer.categorical?.[axis]) throw new TypeError('Cannot mix numeric and categorical coordinates on one axis');
  return toNumericArray(input as ArrayLike<number>);
}

export function statisticalOptions(kind: LayerKind, input: unknown = {}): StatisticalOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Statistical options must be an object');
  const raw = {...input as Record<string, unknown>};
  const allowed = kind === 'hist' ? ['bins','range','density','cumulative'] : kind === 'bar' ? ['orientation','barWidth'] : kind === 'boxplot' ? ['orientation','whis','showfliers','boxWidth'] : [];
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new TypeError(`Unknown ${kind} option ${key}`);
  if (!isStatistical(kind)) throw new TypeError('This layer has no statistical options');
  if (kind === 'hist') {
    const result: HistogramSpecOptions = {bins:10,density:false,cumulative:false,...raw as Partial<HistogramSpecOptions>};
    if (typeof result.bins === 'number') {
      if (!Number.isSafeInteger(result.bins) || result.bins < 1 || result.bins > 1_000_000) throw new RangeError('bins must be a positive integer no greater than 1,000,000');
    } else {
      if (!Array.isArray(result.bins) || result.bins.length < 2 || result.bins.length > 1_000_001 || result.bins.some((value,index) => typeof value !== 'number' || !Number.isFinite(value) || (index > 0 && value <= (result.bins as number[])[index-1]))) throw new RangeError('Bin edges must be finite and strictly increasing (at most 1,000,000 bins)');
      result.bins = [...result.bins];
    }
    if (typeof result.density !== 'boolean' || typeof result.cumulative !== 'boolean') throw new TypeError('density and cumulative must be booleans');
    if (result.range == null) delete result.range;
    if (result.range !== undefined) {
      if (Array.isArray(result.bins)) throw new Error('Explicit bin edges cannot be combined with range');
      result.range = [...validateDomain(result.range)];
    }
    return result;
  }
  const result = kind === 'bar'
    ? {orientation:'vertical',barWidth:0.8,...raw} as BarSpecOptions
    : {orientation:'vertical',whis:1.5,showfliers:true,boxWidth:0.6,...raw} as BoxplotSpecOptions;
  if (!['vertical','horizontal'].includes(result.orientation)) throw new TypeError('Invalid orientation');
  const width = kind === 'bar' ? (result as BarSpecOptions).barWidth : (result as BoxplotSpecOptions).boxWidth;
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) throw new RangeError('Statistical width must be finite and positive');
  if (kind === 'boxplot') {
    const box = result as BoxplotSpecOptions;
    if (typeof box.whis !== 'number' || !Number.isFinite(box.whis) || box.whis < 0) throw new RangeError('whis must be finite and nonnegative');
    if (typeof box.showfliers !== 'boolean') throw new TypeError('showfliers must be boolean');
  }
  return result;
}

export function validateStatisticalData(layer: LayerSpec, values: Record<string, NumericArray>): void {
  if(!layer.options)throw new Error('Statistical layer options are required');
  const options = statisticalOptions(layer.kind, layer.options);
  for(const key of Object.keys(options))if(!Object.hasOwn(layer.options,key))throw new Error(`Missing statistical option ${key}`);
  let channels: string[];
  if (layer.kind === 'hist') channels = ['samples'];
  else if (layer.kind === 'bar') channels = ['x','y','base'];
  else {
    const axis = (options as BoxplotSpecOptions).orientation === 'vertical' ? 'x' : 'y';
    if (!values[axis]) throw new Error('Boxplot positions are required');
    channels = [axis,...Array.from({length:values[axis].length},(_,i)=>`g${i}`)];
    if (!layer.categorical?.[axis]) throw new Error('Boxplot positions must be categorical');
    if (new Set(values[axis]).size !== values[axis].length) throw new Error('Boxplot group labels must be unique');
  }
  if (Object.keys(values).length !== channels.length || channels.some(key => !values[key])) throw new Error(`Invalid ${layer.kind} data channels`);
  if (layer.kind === 'bar') {
    const valueAxis=(options as BarSpecOptions).orientation === 'vertical' ? 'y' : 'x';
    if(layer.categorical?.[valueAxis])throw new Error('Bar values must be numeric');
    const position = (options as BarSpecOptions).orientation === 'vertical' ? values.x : values.y;
    const data = (options as BarSpecOptions).orientation === 'vertical' ? values.y : values.x;
    if (position.length !== data.length || data.length !== values.base.length) throw new Error('Bar coordinates and baseline must have equal lengths');
    if (position.some(value => !Number.isFinite(value)) || new Set(position).size !== position.length) throw new Error('Bar positions must be finite and unique');
    if (values.base.some(value => !Number.isFinite(value))) throw new Error('Bar baseline must be finite');
    for (let i=0; i<data.length; i++) if (Number.isFinite(data[i]) && !Number.isFinite(data[i]+values.base[i])) throw new RangeError('Bar endpoint exceeds Float64 range');
  }
}

/** Validate axis identity and cross-layer layout against a fully staged update. */
export function validateSemantics(spec: FigureSpec, read: (layer:LayerSpec)=>Record<string,NumericArray>): void {
  const panels = spec.panels?.map(panel=>({id:panel.id,view:panel.id === 'main' ? spec.view : panel.view!})) ?? [{id:'main',view:spec.view}];
  const keys = new Set(panels.flatMap(panel=>(['x','y'] as const).map(axis=>categoryKey(spec,panel.id,axis))));
  if (spec.categories !== undefined) {
    if (!spec.categories || typeof spec.categories !== 'object' || Array.isArray(spec.categories)) throw new TypeError('Invalid category maps');
    for (const [key,values] of Object.entries(spec.categories)) {if (!keys.has(key)) throw new Error('Unknown category axis'); labels(values);}
  }
  if (spec.barModes !== undefined) {
    if (!spec.barModes || typeof spec.barModes !== 'object' || Array.isArray(spec.barModes)) throw new TypeError('Invalid bar modes');
    for (const [panel,mode] of Object.entries(spec.barModes)) if (!panels.some(item=>item.id===panel) || !['group','stack','overlay'].includes(mode)) throw new Error('Invalid panel bar mode');
  }
  for (const panel of panels) {
    if (spec.barModes?.[panel.id] !== undefined && panel.view.kind !== '2d') throw new Error('Bar modes require a 2D panel');
    for (const axis of ['x','y'] as const) if (axisCategories(spec,panel.id,axis) && (panel.view.kind !== '2d' || panel.view[`${axis}Scale`] !== 'linear')) throw new Error('Categorical axes require a linear 2D view');
    const layers = spec.layers.filter(layer=>(layer.panelId ?? 'main') === panel.id);
    const bars = layers.filter(layer=>layer.kind==='bar'), mode = spec.barModes?.[panel.id] ?? 'group';
    for (const layer of layers) {
      const values=read(layer);
      if (layer.categorical !== undefined) {
        if (!layer.categorical || typeof layer.categorical !== 'object' || Array.isArray(layer.categorical) || Object.entries(layer.categorical).some(([axis,value])=>!['x','y'].includes(axis)||value!==true)) throw new Error('Invalid categorical channel metadata');
      }
      if (isStatistical(layer.kind)) {
        if (panel.view.kind !== '2d' || panel.view.xScale !== 'linear' || panel.view.yScale !== 'linear') throw new Error('Statistical layers require linear 2D axes');
        validateStatisticalData(layer,values);
      } else if (layer.options !== undefined) throw new Error('Unexpected statistical options');
      for (const axis of ['x','y'] as const) {
        const categories=axisCategories(spec,panel.id,axis), categorical=layer.categorical?.[axis] === true;
        if (categorical) {
          if (!['line','scatter','bar','boxplot'].includes(layer.kind) || categories === undefined || !values[axis]) throw new Error('Invalid categorical coordinate');
          if (values[axis].some(code=>!Number.isInteger(code)||code<0||code>=categories.length)) throw new Error('Category code is outside the axis map');
        } else if (categories !== undefined) throw new Error('Cannot mix numeric and categorical coordinates on one axis');
      }
    }
    if (bars.length) {
      const first=bars[0].options as BarSpecOptions;
      for (const layer of bars) {
        const options=layer.options as BarSpecOptions;
        if (options.orientation !== first.orientation) throw new Error('A panel cannot mix bar and barh orientations');
        if (mode !== 'overlay' && options.barWidth !== first.barWidth) throw new Error('Grouped and stacked bars require matching barWidth');
        if (mode === 'stack' && read(layer).base.some(value=>value!==0)) throw new Error('Stacked bars require zero baseline');
      }
    }
  }
}
