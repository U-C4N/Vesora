import {DataRegistry} from './data';
import {validateQuery} from './planning';
import {normalize} from './scales';
import type {HistogramItem, PreparedStatistics} from './statistics';
import type {Bounds, DataStore, FigureSpec, LayerSpec, NumericArray, PointPlan, Query, SelectionLinkSpec} from './types';

const CHUNK = 65_536;
const PREVIEW_LIMIT = 10_000;

/** Membership is complete; preview is only a bounded event payload. */
export interface LinkedResult {
  kind: 'linked';
  mask: Uint8Array;
  total: number;
  count: number;
  preview: Uint32Array;
  truncated: boolean;
  histogram: PreparedStatistics;
}

function storage(registry: DataRegistry | DataStore): DataStore {return registry instanceof DataRegistry ? registry.store : registry;}
export function maskHas(mask: Uint8Array, index: number): boolean {return (mask[index >>> 3] & (1 << (index & 7))) !== 0;}

function validateBounds(bounds: Bounds): void {
  if (!bounds || typeof bounds !== 'object') throw new TypeError('Selection bounds must be an object');
  for (const axis of ['x', 'y'] as const) {
    const domain = bounds[axis];
    if (!Array.isArray(domain) || domain.length !== 2 || !domain.every(Number.isFinite) || domain[0] > domain[1]) {
      throw new RangeError('Selection bounds must contain finite ordered pairs');
    }
  }
}

function validateLink(link: SelectionLinkSpec): void {
  if (!link || typeof link !== 'object' || typeof link.id !== 'string' || !link.id) throw new TypeError('Selection link id must be nonempty');
  if (!Array.isArray(link.scatter) || link.scatter.length !== 2 || !link.scatter.every(id => typeof id === 'string' && id) || link.scatter[0] === link.scatter[1]) {
    throw new TypeError('A selection link requires two distinct scatter layers');
  }
  if (typeof link.histogram !== 'string' || !link.histogram || link.scatter.includes(link.histogram)) throw new TypeError('A selection link requires a distinct histogram layer');
  for (const field of ['generation', 'sequence'] as const) {
    if (!Number.isSafeInteger(link[field]) || link[field] < 0) throw new RangeError(`Selection link ${field} must be a nonnegative safe integer`);
  }
  if (link.selection !== undefined) {
    if (!link.selection || !link.scatter.includes(link.selection.originLayerId)) throw new Error('Selection origin must be a linked scatter layer');
    validateBounds(link.selection.bounds);
  }
}

function linkedLayers(link: SelectionLinkSpec, layers: LayerSpec[]): [LayerSpec, LayerSpec, LayerSpec] {
  validateLink(link);
  const ids = [...link.scatter, link.histogram];
  const members = ids.map(id => {
    const matches = layers.filter(layer => layer.id === id);
    if (matches.length !== 1) throw new Error(`Selection link references an unknown or duplicate layer: ${id}`);
    return matches[0];
  }) as [LayerSpec, LayerSpec, LayerSpec];
  if (members[0].kind !== 'scatter' || members[1].kind !== 'scatter' || members[2].kind !== 'hist') throw new Error('Selection links require two scatter layers and one histogram');
  if (members[0].categorical?.x || members[0].categorical?.y || members[1].categorical?.x || members[1].categorical?.y) throw new Error('Linked scatter coordinates must be numeric');
  if (new Set(members.map(layer => layer.panelId ?? 'main')).size !== 3) throw new Error('Selection link layers must occupy three distinct panels');
  const options = members[2].options;
  if (!options || !('density' in options) || options.density !== false || options.cumulative !== false) throw new Error('Linked histograms require density=false and cumulative=false');
  return members;
}

function source(store: DataStore, layer: LayerSpec, channel: string): NumericArray {
  const entry = store.get(layer.data[channel]);
  if (!entry) throw new Error(`Missing ${channel} source for ${layer.id}`);
  if (entry.descriptor.shape.length !== 1) throw new Error('Linked sources must be one-dimensional');
  return entry.values;
}

function linkedSources(link: SelectionLinkSpec, layers: LayerSpec[], store: DataStore): {members: [LayerSpec, LayerSpec, LayerSpec]; total: number} {
  const members = linkedLayers(link, layers);
  const total = source(store, members[2], 'samples').length;
  if (total > 0xffff_ffff) throw new RangeError('A linked group may contain at most 2^32 - 1 rows');
  for (const layer of members.slice(0, 2)) {
    if (source(store, layer, 'x').length !== total || source(store, layer, 'y').length !== total) throw new RangeError('Linked layers must have the same aligned row count');
  }
  return {members, total};
}

/** Validate a complete scene without changing its registry or derived state. */
export function validateSelectionLink(spec: FigureSpec, registry: DataRegistry | DataStore): void {
  const link = spec.selectionLink;
  if (link === undefined) return;
  if (spec.protocolVersion < 4) throw new Error('Selection links require protocol version 4');
  const {members} = linkedSources(link, spec.layers, storage(registry));
  for (const layer of members) {
    const panelId = layer.panelId ?? 'main';
    const view = panelId === 'main' ? spec.view : spec.panels?.find(panel => panel.id === panelId)?.view;
    if (!view || view.kind !== '2d') throw new Error('Selection links require 2D panels');
    if (layer.kind === 'hist' && (view.xScale !== 'linear' || view.yScale !== 'linear')) throw new Error('Linked histograms require linear axes');
  }
}

/** Exact membership and selected counts reuse the all-data histogram's edges. */
export function* linkedSteps(link: SelectionLinkSpec, layers: LayerSpec[], registry: DataRegistry | DataStore, baseline: PreparedStatistics): Generator<void, LinkedResult> {
  const store = storage(registry), {members, total} = linkedSources(link, layers, store);
  if (baseline.kind !== 'hist' || baseline.layerId !== link.histogram || baseline.items.length === 0) throw new Error('Linked computation requires its prepared all-data histogram');
  const bins = baseline.items as HistogramItem[];
  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i];
    if (bin.kind !== 'hist' || !Number.isFinite(bin.left) || !Number.isFinite(bin.right) || bin.left >= bin.right || i > 0 && bins[i - 1].right !== bin.left) throw new Error('Histogram baseline edges must be finite, increasing and contiguous');
    if (i && i % CHUNK === 0) yield;
  }
  const mask = new Uint8Array(Math.ceil(total / 8)), preview = new Uint32Array(Math.min(total, PREVIEW_LIMIT));
  const counts = new Float64Array(bins.length), low = bins[0].left, high = bins[bins.length - 1].right;
  const samples = source(store, members[2], 'samples');
  let count = 0, previewCount = 0, valid = 0, omitted = 0, rangeExcluded = 0, included = 0;
  if (link.selection) {
    const origin = members.find(layer => layer.id === link.selection!.originLayerId)!;
    const xs = source(store, origin, 'x'), ys = source(store, origin, 'y'), bounds = link.selection.bounds;
    for (let start = 0; start < total; start += CHUNK) {
      for (let i = start, end = Math.min(total, start + CHUNK); i < end; i++) {
        const x = xs[i], y = ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < bounds.x[0] || x > bounds.x[1] || y < bounds.y[0] || y > bounds.y[1]) continue;
        mask[i >>> 3] |= 1 << (i & 7); count++;
        if (previewCount < preview.length) preview[previewCount++] = i;
        const value = samples[i];
        if (!Number.isFinite(value)) {omitted++; continue;}
        valid++;
        if (value < low || value > high) {rangeExcluded++; continue;}
        let lo = 0, hi = bins.length;
        while (lo + 1 < hi) {const mid = (lo + hi) >>> 1; if (value < bins[mid].left) hi = mid; else lo = mid;}
        counts[lo]++; included++;
      }
      yield;
    }
  }
  const histogram: PreparedStatistics = {
    kind: 'hist', layerId: baseline.layerId,
    bounds: {x: [...baseline.bounds.x], y: [...baseline.bounds.y]}, items: [], marks: [],
    info: {kind: 'hist', total: count, valid, omitted, rangeExcluded, visible: included, rendered: bins.length, exact: true, method: 'exact selected counts; fixed all-data histogram edges'},
  };
  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i], height = counts[i];
    histogram.items.push({kind: 'hist', index: i, binIndex: i, left: bin.left, right: bin.right, count: height, height});
    histogram.marks.push({kind: 'rect', x0: bin.left, y0: 0, x1: bin.right, y1: height, itemIndex: i, role: 'bin'});
    if (i && i % CHUNK === 0) yield;
  }
  return {kind: 'linked', mask, total, count, preview: preview.slice(0, previewCount), truncated: count > previewCount, histogram};
}

/** Plan a full selected cohort without renumbering its original source rows. */
export function* maskedScatterSteps(x: NumericArray, y: NumericArray, mask: Uint8Array, query: Query): Generator<void, PointPlan> {
  if (x.length !== y.length) throw new RangeError('Coordinate arrays must have equal lengths');
  if (x.length > 0xffff_ffff) throw new RangeError('A chunk may contain at most 2^32 - 1 coordinates');
  if (!(mask instanceof Uint8Array) || mask.length !== Math.ceil(x.length / 8)) throw new RangeError('Selection mask length must match source row count');
  if (x.length % 8 && mask.length && (mask[mask.length - 1] >>> (x.length % 8)) !== 0) throw new RangeError('Selection mask has bits beyond the source row count');
  validateQuery(query);
  const columns = Math.max(1, Math.min(1024, Math.ceil(query.width / 4))), rows = Math.max(1, Math.min(1024, Math.ceil(query.height / 4)));
  const counts = new Uint32Array(columns * rows);
  let total = 0, count = 0, max = 0;
  for (let start = 0; start < x.length; start += CHUNK) {
    for (let i = start, end = Math.min(x.length, start + CHUNK); i < end; i++) {
      if (!maskHas(mask, i)) continue;
      total++;
      const px = normalize(x[i], query.bounds.x, query.xScale), py = normalize(y[i], query.bounds.y, query.yScale);
      if (!(px >= 0 && px <= 1 && py >= 0 && py <= 1)) continue;
      count++;
      const column = Math.min(columns - 1, Math.floor(px * columns)), row = Math.min(rows - 1, Math.floor(py * rows));
      max = Math.max(max, ++counts[row * columns + column]);
    }
    yield;
  }
  const threshold = Math.max(1, Math.min(query.pointBudget, query.width * query.height / 8));
  const density = query.mode === 'density' || query.mode === 'auto' && (count > query.pointBudget || count > threshold * (query.previous === 'density' ? .6 : 1));
  if (density) {
    let occupied = 0;
    for (const value of counts) if (value) occupied++;
    return {kind: 'density', counts, columns, rows, max, bounds: {x: [...query.bounds.x], y: [...query.bounds.y]}, info: {kind: 'density', total, visible: count, rendered: occupied, exact: true, method: 'exact selected count aggregation (screen-space cells)'}};
  }
  if (count > query.pointBudget) throw new RangeError(`Exact selected point rendering requires ${count} points, exceeding the point budget of ${query.pointBudget}. Use auto/density or raise the budget.`);
  const indices = new Uint32Array(count); let cursor = 0;
  for (let start = 0; start < x.length; start += CHUNK) {
    for (let i = start, end = Math.min(x.length, start + CHUNK); i < end; i++) {
      if (!maskHas(mask, i)) continue;
      const px = normalize(x[i], query.bounds.x, query.xScale), py = normalize(y[i], query.bounds.y, query.yScale);
      if (px >= 0 && px <= 1 && py >= 0 && py <= 1) indices[cursor++] = i;
    }
    yield;
  }
  return {kind: 'points', indices, info: {kind: 'points', total, visible: count, rendered: count, exact: true, method: 'original selected points; original source indices'}};
}
