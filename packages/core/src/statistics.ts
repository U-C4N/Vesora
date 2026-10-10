import {DataRegistry} from './data';
import {extent} from './scales';
import type {Bounds, DataStore, LayerSpec, NumericArray, RepresentationInfo} from './types';

export type StatisticsKind = 'hist' | 'bar' | 'boxplot';
export type StatisticsOrientation = 'vertical' | 'horizontal';
export interface HistogramSettings {bins: number | number[]; range?: [number, number]; density: boolean; cumulative: boolean}
export interface BarSettings {orientation: StatisticsOrientation; barWidth: number}
export interface BoxplotSettings {orientation: StatisticsOrientation; whis: number; showfliers: boolean; boxWidth: number}
type StatisticalLayer = LayerSpec & {options?: HistogramSettings | BarSettings | BoxplotSettings};

export interface HistogramItem {kind: 'hist'; index: number; binIndex: number; left: number; right: number; count: number; height: number}
export interface BarItem {kind: 'bar'; index: number; position: number; value: number; base: number; start: number; end: number; orientation: StatisticsOrientation}
export interface BoxplotItem {kind: 'boxplot'; index: number; groupIndex: number; position: number; count: number; q1: number; median: number; q3: number; whiskerLow: number; whiskerHigh: number; outlierCount: number}
export type StatItem = HistogramItem | BarItem | BoxplotItem;
export type StatMark =
  | {kind: 'rect'; x0: number; y0: number; x1: number; y1: number; itemIndex: number; role: 'bin' | 'bar' | 'box'}
  | {kind: 'segment'; x0: number; y0: number; x1: number; y1: number; itemIndex: number; role: 'whisker' | 'cap' | 'median'}
  | {kind: 'point'; x: number; y: number; itemIndex: number; role: 'outlier'; sourceIndex: number; value: number};
export interface PreparedStatistics {
  kind: StatisticsKind;
  layerId: string;
  bounds: Bounds;
  marks: StatMark[];
  items: StatItem[];
  info: RepresentationInfo & {valid: number; omitted: number; rangeExcluded: number};
}

const CHUNK = 65_536;
const SORT_CHUNK = 16_384;

function source(store: DataStore, layer: LayerSpec, key: string): NumericArray {
  const entry = store.get(layer.data[key]);
  if (!entry) throw new Error(`Missing ${key} source for ${layer.id}`);
  if (entry.descriptor.shape.length !== 1) throw new Error('Statistics sources must be one-dimensional');
  return entry.values;
}
function storage(registry: DataRegistry | DataStore): DataStore {return registry instanceof DataRegistry ? registry.store : registry;}
function result(layer: LayerSpec, kind: StatisticsKind, total: number): PreparedStatistics {
  return {kind, layerId: layer.id, bounds: {x: [0, 1], y: [0, 1]}, marks: [], items: [],
    info: {kind, total, valid: 0, visible: 0, rendered: 0, exact: true, method: kind === 'hist' ? 'exact histogram bins' : kind === 'boxplot' ? 'exact linear-interpolated quartiles and Tukey whiskers' : 'exact bars', omitted: 0, rangeExcluded: 0}};
}
function* finalizeBoundsSteps(prepared: PreparedStatistics): Generator<void, PreparedStatistics> {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  let count = 0;
  for (const mark of prepared.marks) {
    const xs = mark.kind === 'point' ? [mark.x] : [mark.x0, mark.x1];
    const ys = mark.kind === 'point' ? [mark.y] : [mark.y0, mark.y1];
    if (![...xs, ...ys].every(Number.isFinite)) throw new RangeError('Statistical geometry exceeds finite coordinates');
    for (const x of xs) {xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);}
    for (const y of ys) {ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);}
    if (++count % CHUNK === 0) yield;
  }
  if (xmin !== Infinity) prepared.bounds = {x: [xmin, xmax], y: [ymin, ymax]};
  prepared.info.rendered = prepared.items.length;
  return prepared;
}
function finalizeBounds(prepared: PreparedStatistics): PreparedStatistics {
  const steps = finalizeBoundsSteps(prepared);
  while (true) {const next = steps.next(); if (next.done) return next.value;}
}
function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
}
function orientation(value: string): asserts value is StatisticsOrientation {
  if (value !== 'vertical' && value !== 'horizontal') throw new Error('Invalid statistical orientation');
}
/** Cooperative finite filtering and bin counting; raw source buffers remain unchanged. */
export function* histogramSteps(layer: StatisticalLayer, registry: DataRegistry | DataStore): Generator<void, PreparedStatistics> {
  const values = source(storage(registry), layer, 'samples');
  const options = layer.options as HistogramSettings;
  if (!options || typeof options.density !== 'boolean' || typeof options.cumulative !== 'boolean') throw new TypeError('Invalid histogram options');
  const prepared = result(layer, 'hist', values.length);
  let min = Infinity, max = -Infinity;
  for (let start = 0; start < values.length; start += CHUNK) {
    for (let i = start, end = Math.min(values.length, start + CHUNK); i < end; i++) {
      const value = values[i];
      if (!Number.isFinite(value)) prepared.info.omitted++;
      else {prepared.info.valid++; min = Math.min(min, value); max = Math.max(max, value);}
    }
    yield;
  }
  let edges: number[];
  if (Array.isArray(options.bins)) {
    if (options.range !== undefined) throw new Error('Explicit histogram edges cannot be combined with range');
    edges = options.bins.slice();
  } else {
    if (!Number.isSafeInteger(options.bins) || options.bins < 1 || options.bins > 1_000_000) throw new RangeError('Histogram bins must be an integer from 1 to 1,000,000');
    const domain = options.range ?? (min === Infinity ? [0, 1] : min === max ? extent([min]) : [min, max]);
    if (domain.length !== 2 || !domain.every(Number.isFinite) || domain[0] >= domain[1]) throw new RangeError('Histogram range must be finite and increasing');
    edges = new Array(options.bins + 1);
    for (let i = 0; i <= options.bins; i++) {
      const t = i / (options.bins as number), span = domain[1] - domain[0];
      edges[i] = i === 0 ? domain[0] : i === options.bins ? domain[1] : Number.isFinite(span) ? domain[0] + span * t : domain[0] * (1 - t) + domain[1] * t;
      if (i && i % CHUNK === 0) yield;
    }
  }
  if (edges.length < 2 || edges.length - 1 > 1_000_000) throw new RangeError('Histogram edges must define between 1 and 1,000,000 bins');
  for (let i = 0; i < edges.length; i++) {
    if (!Number.isFinite(edges[i]) || i > 0 && edges[i] <= edges[i - 1]) throw new RangeError('Histogram edges must be finite and strictly increasing');
    if (i && i % CHUNK === 0) yield;
  }
  const counts = new Float64Array(edges.length - 1), low = edges[0], high = edges[edges.length - 1];
  for (let start = 0; start < values.length; start += CHUNK) {
    for (let i = start, end = Math.min(values.length, start + CHUNK); i < end; i++) {
      const value = values[i]; if (!Number.isFinite(value)) continue;
      if (value < low || value > high) {prepared.info.rangeExcluded++; continue;}
      let lo = 0, hi = edges.length - 1;
      while (lo + 1 < hi) {const mid = (lo + hi) >>> 1; if (value < edges[mid]) hi = mid; else lo = mid;}
      counts[Math.min(lo, counts.length - 1)]++; prepared.info.visible++;
    }
    yield;
  }
  let cumulative = 0;
  for (let i = 0; i < counts.length; i++) {
    cumulative += counts[i];
    let height = options.cumulative ? cumulative : counts[i];
    if (options.density && prepared.info.visible) {
      height /= prepared.info.visible;
      if (!options.cumulative) {
        const span = edges[i + 1] - edges[i];
        height = Number.isFinite(span) ? height / span : height / (edges[i + 1] / 2 - edges[i] / 2) / 2;
      }
    }
    if (!Number.isFinite(height)) throw new RangeError('Histogram density exceeds finite precision; use wider bins');
    prepared.items.push({kind: 'hist', index: i, binIndex: i, left: edges[i], right: edges[i + 1], count: counts[i], height});
    prepared.marks.push({kind: 'rect', x0: edges[i], x1: edges[i + 1], y0: 0, y1: height, itemIndex: i, role: 'bin'});
    if (i && i % CHUNK === 0) yield;
  }
  if (options.density) prepared.info.method += options.cumulative ? '; cumulative probability' : '; probability density';
  else if (options.cumulative) prepared.info.method += '; cumulative counts';
  return yield* finalizeBoundsSteps(prepared);
}

/** Sort bounded chunks, then merge cooperatively. Native sort never sees an unbounded group. */
function* finiteSorted(values: NumericArray): Generator<void, Float64Array> {
  const copy = new Float64Array(values.length); let length = 0;
  for (let start = 0; start < values.length; start += CHUNK) {
    for (let i = start, end = Math.min(values.length, start + CHUNK); i < end; i++) if (Number.isFinite(values[i])) copy[length++] = values[i];
    yield;
  }
  let from = copy.subarray(0, length);
  for (let start = 0; start < length; start += SORT_CHUNK) {from.subarray(start, Math.min(length, start + SORT_CHUNK)).sort(); yield;}
  let to = new Float64Array(length);
  for (let width = SORT_CHUNK; width < length; width *= 2) {
    let operations = 0;
    for (let start = 0; start < length; start += width * 2) {
      const middle = Math.min(length, start + width), end = Math.min(length, start + width * 2);
      let left = start, right = middle;
      for (let out = start; out < end; out++) {
        to[out] = left < middle && (right >= end || from[left] <= from[right]) ? from[left++] : from[right++];
        if (++operations % CHUNK === 0) yield;
      }
    }
    [from, to] = [to, from]; yield;
  }
  return from;
}
function quantile(sorted: Float64Array, p: number): number {
  const h = (sorted.length - 1) * p, low = Math.floor(h), fraction = h - low;
  return fraction === 0 ? sorted[low] : sorted[low] * (1 - fraction) + sorted[low + 1] * fraction;
}
export function* boxplotSteps(layer: StatisticalLayer, registry: DataRegistry | DataStore): Generator<void, PreparedStatistics> {
  const store = storage(registry), options = layer.options as BoxplotSettings;
  if (!options) throw new Error('Missing boxplot options');
  orientation(options.orientation); positive(options.boxWidth, 'boxWidth');
  if (!Number.isFinite(options.whis) || options.whis < 0 || typeof options.showfliers !== 'boolean') throw new RangeError('Invalid boxplot whisker or fliers options');
  const positions = source(store, layer, options.orientation === 'vertical' ? 'x' : 'y');
  const prepared = result(layer, 'boxplot', 0);
  const point = (p: number, value: number): [number, number] => options.orientation === 'vertical' ? [p, value] : [value, p];
  for (let group = 0; group < positions.length; group++) {
    const values = source(store, layer, `g${group}`), position = positions[group];
    prepared.info.total += values.length;
    const sorted = yield* finiteSorted(values);
    prepared.info.valid += sorted.length;
    prepared.info.omitted += values.length - sorted.length;
    if (!Number.isFinite(position)) {prepared.info.omitted += sorted.length; continue;}
    if (!sorted.length) continue;
    prepared.info.visible += sorted.length;
    const q1 = quantile(sorted, .25), median = quantile(sorted, .5), q3 = quantile(sorted, .75);
    const iqr = q3 - q1;
    const spread = options.whis === 0 ? 0 : Number.isFinite(iqr) ? iqr * options.whis : (q3 / 2 - q1 / 2) * (options.whis * 2);
    const lowFence = q1 - spread, highFence = q3 + spread;
    let first = 0, last = sorted.length - 1;
    while (first < sorted.length - 1 && sorted[first] < lowFence) {first++; if (first % CHUNK === 0) yield;}
    while (last > 0 && sorted[last] > highFence) {last--; if (last % CHUNK === 0) yield;}
    // If no observed value lies between an interpolated quartile and its
    // fence (e.g. [0, 1], whis=0), the corresponding whisker ends at Q1/Q3.
    // This explicit empty-fence fallback avoids drawing reversed whiskers.
    const whiskerLow = Math.min(q1, sorted[first]), whiskerHigh = Math.max(q3, sorted[last]);
    const itemIndex = prepared.items.length;
    const item: BoxplotItem = {kind: 'boxplot', index: group, groupIndex: group, position, count: sorted.length, q1, median, q3, whiskerLow, whiskerHigh, outlierCount: 0};
    prepared.items.push(item);
    const half = options.boxWidth / 2;
    const [x0, y0] = point(position - half, q1), [x1, y1] = point(position + half, q3);
    prepared.marks.push({kind: 'rect', x0, y0, x1, y1, itemIndex, role: 'box'});
    const segment = (p0: number, v0: number, p1: number, v1: number, role: 'whisker' | 'cap' | 'median') => {
      const [ax, ay] = point(p0, v0), [bx, by] = point(p1, v1);
      prepared.marks.push({kind: 'segment', x0: ax, y0: ay, x1: bx, y1: by, itemIndex, role});
    };
    segment(position, whiskerLow, position, q1, 'whisker');
    segment(position, q3, position, whiskerHigh, 'whisker');
    segment(position - half / 2, whiskerLow, position + half / 2, whiskerLow, 'cap');
    segment(position - half / 2, whiskerHigh, position + half / 2, whiskerHigh, 'cap');
    segment(position - half, median, position + half, median, 'median');
    for (let start = 0; start < values.length; start += CHUNK) {
      for (let i = start, end = Math.min(values.length, start + CHUNK); i < end; i++) {
        const value = values[i];
        if (Number.isFinite(value) && (value < whiskerLow || value > whiskerHigh)) {
          item.outlierCount++;
          if (options.showfliers) {const [x, y] = point(position, value); prepared.marks.push({kind: 'point', x, y, itemIndex, role: 'outlier', sourceIndex: i, value});}
        }
      }
      yield;
    }
  }
  return yield* finalizeBoundsSteps(prepared);
}
export function statisticsSteps(layer: StatisticalLayer, registry: DataRegistry | DataStore): Generator<void, PreparedStatistics> {
  if ((layer.kind as string) === 'hist') return histogramSteps(layer, registry);
  if ((layer.kind as string) === 'boxplot') return boxplotSteps(layer, registry);
  throw new Error('Only histogram and boxplot layers have asynchronous statistics');
}
export function prepareStatistics(layer: StatisticalLayer, registry: DataRegistry | DataStore): PreparedStatistics {
  const steps = statisticsSteps(layer, registry);
  while (true) {const step = steps.next(); if (step.done) return step.value;}
}

/** Panel-local layout. Hidden group members keep their slot; hidden stacks do not contribute. */
export function prepareBars(layers: LayerSpec[], registry: DataRegistry | DataStore, mode: 'group' | 'stack' | 'overlay' = 'group'): Map<string, PreparedStatistics> {
  if (!['group', 'stack', 'overlay'].includes(mode)) throw new Error('Invalid bar mode');
  const store = storage(registry), bars = layers.filter(layer => (layer.kind as string) === 'bar') as StatisticalLayer[];
  const output = new Map<string, PreparedStatistics>(), stacks = new Map<number, {positive: number; negative: number}>();
  let direction: StatisticsOrientation | undefined, width: number | undefined;
  for (const [slot, layer] of bars.entries()) {
    const options = layer.options as BarSettings;
    if (!options) throw new Error('Missing bar options');
    orientation(options.orientation); positive(options.barWidth, 'barWidth');
    if (direction !== undefined && direction !== options.orientation) throw new Error('A panel cannot mix vertical and horizontal bars');
    if (mode !== 'overlay' && width !== undefined && width !== options.barWidth) throw new Error('Grouped and stacked bars must use the same barWidth');
    direction = options.orientation; width = options.barWidth;
    const positions = source(store, layer, direction === 'vertical' ? 'x' : 'y');
    const values = source(store, layer, direction === 'vertical' ? 'y' : 'x'), bases = source(store, layer, 'base');
    if (positions.length !== values.length || positions.length !== bases.length) throw new Error('Bar coordinate and baseline lengths must match');
    const seen = new Set<number>(), prepared = result(layer, 'bar', positions.length);
    const barWidth = mode === 'group' ? options.barWidth / bars.length : options.barWidth;
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i], value = values[i], base = bases[i];
      if (Number.isFinite(position)) {if (seen.has(position)) throw new Error('A bar series cannot contain repeated positions'); seen.add(position);}
      if (mode === 'stack' && Number.isFinite(base) && base !== 0) throw new Error('Stacked bars require zero user baselines');
      if (!Number.isFinite(position) || !Number.isFinite(value) || !Number.isFinite(base)) {prepared.info.omitted++; continue;}
      prepared.info.valid++;
      if (!layer.visible) continue;
      let start = base, end = base + value;
      if (mode === 'stack') {
        const stack = stacks.get(position) ?? {positive: 0, negative: 0};
        const side = value >= 0 ? 'positive' : 'negative'; start = stack[side]; end = start + value; stack[side] = end; stacks.set(position, stack);
      }
      const center = mode === 'group' ? position + (slot + .5 - bars.length / 2) * barWidth : position;
      const itemIndex = prepared.items.length;
      prepared.items.push({kind: 'bar', index: i, position, value, base, start, end, orientation: direction});
      prepared.marks.push(direction === 'vertical'
        ? {kind: 'rect', x0: center - barWidth / 2, x1: center + barWidth / 2, y0: start, y1: end, itemIndex, role: 'bar'}
        : {kind: 'rect', y0: center - barWidth / 2, y1: center + barWidth / 2, x0: start, x1: end, itemIndex, role: 'bar'});
      prepared.info.visible++;
    }
    prepared.info.method += `; ${mode}`;
    if (layer.visible) output.set(layer.id, finalizeBounds(prepared));
  }
  return output;
}

/** Conservative heap accounting for bounded worker/fallback summary caching. */
export function statisticsBytes(prepared: PreparedStatistics): number {return 512 + prepared.items.length * 192 + prepared.marks.length * 128;}
