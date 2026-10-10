import {describe, expect, it} from 'vitest';
import {DataRegistry} from '../../packages/core/src/data';
import {defaultView} from '../../packages/core/src/figure';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import {boxplotSteps, prepareBars, prepareStatistics, statisticsBytes} from '../../packages/core/src/statistics';
import {buildStatisticsGeometry} from '../../packages/core/src/statistics-geometry';
import type {BarItem, BoxplotItem, HistogramItem} from '../../packages/core/src/statistics';
import type {BarSpecOptions, BoxplotSpecOptions, HistogramSpecOptions, LayerSpec} from '../../packages/core/src/types';
import type {WorkerRequest, WorkerResponse} from '../../packages/core/src/worker';

function fixture(kind: 'hist' | 'bar' | 'boxplot', values: Record<string, number[]>, options: HistogramSpecOptions | BarSpecOptions | BoxplotSpecOptions, id = 'a', registry = new DataRegistry()): {layer: LayerSpec; registry: DataRegistry} {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {data[key] = `${id}-${key}`; registry.set(data[key], Float64Array.from(value));}
  return {layer: {id, kind, data, style: {}, visible: true, options}, registry};
}
const hist = (values: number[], options: Partial<HistogramSpecOptions> = {}) => fixture('hist', {samples: values}, {bins: 10, density: false, cumulative: false, ...options});
const box = (groups: number[][], options: Partial<BoxplotSpecOptions> = {}) => {
  const orientation = options.orientation ?? 'vertical';
  return fixture('boxplot', {[orientation === 'vertical' ? 'x' : 'y']: groups.map((_, i) => i), ...Object.fromEntries(groups.map((values, i) => [`g${i}`, values]))}, {orientation, whis: 1.5, showfliers: true, boxWidth: .5, ...options});
};

describe('exact histogram summaries', () => {
  it('includes the final right edge, excludes outside values and counts omissions separately', () => {
    const {layer, registry} = hist([-1, 0, 1, 2, 3, NaN, Infinity], {bins: [0, 1, 2]});
    const p = prepareStatistics(layer, registry), bins = p.items as HistogramItem[];
    expect(bins.map(bin => bin.count)).toEqual([1, 2]);
    expect(p.info).toMatchObject({total: 7, valid: 5, visible: 3, omitted: 2, rangeExcluded: 2, exact: true});
    expect(p.bounds).toEqual({x: [0, 2], y: [0, 2]});
  });
  it('normalizes unequal-width bins to unit area, not unit height', () => {
    const {layer, registry} = hist([.5, 1, 2, 3], {bins: [0, 1, 3], density: true});
    const bins = prepareStatistics(layer, registry).items as HistogramItem[];
    expect(bins.map(bin => bin.height)).toEqual([.25, .375]);
    expect(bins.reduce((sum, bin) => sum + bin.height * (bin.right - bin.left), 0)).toBe(1);
  });
  it('cumulative density is a probability CDF; cumulative raw histogram retains counts', () => {
    for (const density of [false, true]) {
      const {layer, registry} = hist([.5, 1, 2, 3], {bins: [0, 1, 3], density, cumulative: true});
      expect((prepareStatistics(layer, registry).items as HistogramItem[]).map(bin => bin.height)).toEqual(density ? [.25, 1] : [1, 4]);
    }
  });
  it('density normalizes included samples only and empty data uses [0,1]', () => {
    const ranged = hist([-20, 0, 1, 20], {bins: 2, range: [0, 2], density: true});
    expect(prepareStatistics(ranged.layer, ranged.registry).items.map(item => (item as HistogramItem).height)).toEqual([.5, .5]);
    const empty = hist([NaN, Infinity], {bins: 2, density: true});
    const p = prepareStatistics(empty.layer, empty.registry);
    expect(p.bounds.x).toEqual([0, 1]);
    expect(p.items.map(item => (item as HistogramItem).height)).toEqual([0, 0]);
  });
  it('expands constant data and preserves extreme finite density without denominator overflow', () => {
    const constant = hist([7, 7, 7], {bins: 2});
    const cp = prepareStatistics(constant.layer, constant.registry);
    expect(cp.bounds.x[0]).toBeLessThan(7); expect(cp.bounds.x[1]).toBeGreaterThan(7);
    expect(cp.info.visible).toBe(3);
    const large = hist([-1e308, 1e308], {bins: [-1e308, 1e308], density: true});
    expect((prepareStatistics(large.layer, large.registry).items[0] as HistogramItem).height).toBeGreaterThan(0);
  });
  it('rejects malformed edges/options and never changes source buffers', () => {
    for (const bins of [[0, 0, 1], [0, NaN, 1], [2, 1], []]) {
      const f = hist([.5], {bins}); expect(() => prepareStatistics(f.layer, f.registry)).toThrow();
    }
    const f = hist([3, 2, 1], {bins: 2}); prepareStatistics(f.layer, f.registry);
    expect([...f.registry.get(f.layer.data.samples).values]).toEqual([3, 2, 1]);
  });
  it('reports unrepresentable density rather than publishing Infinity', () => {
    const f = hist([0], {bins: [0, Number.MIN_VALUE], density: true});
    expect(() => prepareStatistics(f.layer, f.registry)).toThrow(/density exceeds finite precision/);
  });
});

describe('exact boxplot summaries', () => {
  it('uses (n-1)p interpolation and observed Tukey whiskers with original outlier indices', () => {
    const {layer, registry} = box([[100, 4, 1, NaN, 3, 2, Infinity]]);
    const p = prepareStatistics(layer, registry), item = p.items[0] as BoxplotItem;
    expect(item).toMatchObject({q1: 2, median: 3, q3: 4, whiskerLow: 1, whiskerHigh: 4, count: 5, outlierCount: 1});
    expect(p.marks.find(mark => mark.kind === 'point')).toMatchObject({sourceIndex: 0, value: 100, itemIndex: 0});
    expect(p.info).toMatchObject({total: 7, omitted: 2, visible: 5});
    expect([...registry.get(layer.data.g0).values]).toEqual([100, 4, 1, NaN, 3, 2, Infinity]);
  });
  it('handles empty, singleton and two-value groups without compacting source identity', () => {
    const {layer, registry} = box([[], [7], [0, 10]]);
    const p = prepareStatistics(layer, registry), items = p.items as BoxplotItem[];
    expect(items.map(item => item.groupIndex)).toEqual([1, 2]);
    expect(items[0]).toMatchObject({q1: 7, median: 7, q3: 7, whiskerLow: 7, whiskerHigh: 7});
    expect(items[1]).toMatchObject({q1: 2.5, median: 5, q3: 7.5});
    expect(p.marks[0].itemIndex).toBe(0);
  });
  it('hidden fliers remain counted but do not expand rendered extents', () => {
    const f = box([[1, 2, 3, 4, 100]], {showfliers: false});
    const p = prepareStatistics(f.layer, f.registry);
    expect((p.items[0] as BoxplotItem).outlierCount).toBe(1);
    expect(p.marks.some(mark => mark.kind === 'point')).toBe(false);
    expect(p.bounds.y).toEqual([1, 4]);
  });
  it('swaps geometry axes for horizontal boxes', () => {
    const f = box([[1, 2, 3]], {orientation: 'horizontal'}), p = prepareStatistics(f.layer, f.registry);
    expect(p.bounds).toEqual({x: [1, 3], y: [-.25, .25]});
    expect(p.marks[0]).toMatchObject({kind: 'rect', x0: 1.5, x1: 2.5, y0: -.25, y1: .25});
  });
  it('defines an empty-fence fallback at Q1/Q3 for whis=0 without reversed whiskers', () => {
    const f = box([[0, 1]], {whis: 0}), p = prepareStatistics(f.layer, f.registry);
    expect(p.items[0]).toMatchObject({q1: .25, q3: .75, whiskerLow: .25, whiskerHigh: .75, outlierCount: 2});
  });
  it('keeps interpolated quartiles finite across extreme signed coordinates', () => {
    const f = box([[-1e308, -1e308, 1e308, 1e308]], {whis: .1}), p = prepareStatistics(f.layer, f.registry);
    expect(p.items[0]).toMatchObject({q1: -1e308, median: 0, q3: 1e308, whiskerLow: -1e308, whiskerHigh: 1e308});
    expect(p.marks.every(mark => mark.kind === 'point' ? Number.isFinite(mark.value) : [mark.x0, mark.x1, mark.y0, mark.y1].every(Number.isFinite))).toBe(true);
  });
  it('sorts and merges bounded chunks cooperatively for a large exact group', () => {
    const values = Array.from({length: 40_000}, (_, i) => 40_000 - i), f = box([values]);
    const steps = boxplotSteps(f.layer, f.registry); let yields = 0;
    while (true) {const next = steps.next(); if (next.done) {expect((next.value.items[0] as BoxplotItem).median).toBe(20_000.5); break;} yields++;}
    expect(yields).toBeGreaterThan(4);
  });
});

describe('panel-local bar layouts', () => {
  function bars() {
    const a = fixture('bar', {x: [0, 1], y: [5, -3], base: [0, 0]}, {orientation: 'vertical', barWidth: .8}, 'a');
    const b = fixture('bar', {x: [0, 1, 2], y: [2, -4, 9], base: [0, 0, 0]}, {orientation: 'vertical', barWidth: .8}, 'b', a.registry);
    return {registry: a.registry, layers: [a.layer, b.layer]};
  }
  it('reserves series slots for missing categories and hidden layers', () => {
    const f = bars(); let p = prepareBars(f.layers, f.registry, 'group');
    const missing = p.get('b')!.marks[2];
    expect(missing.kind === 'rect' && missing.x0).toBe(2);
    expect(missing.kind === 'rect' ? missing.x1 : NaN).toBeCloseTo(2.4);
    const before = p.get('b')!.marks;
    f.layers[0].visible = false; p = prepareBars(f.layers, f.registry, 'group');
    expect(p.has('a')).toBe(false); expect(p.get('b')!.marks).toEqual(before);
  });
  it('accumulates positive and negative values independently and removes hidden contributions', () => {
    const f = bars(); let p = prepareBars(f.layers, f.registry, 'stack');
    expect(p.get('b')!.items.map(item => [(item as BarItem).start, (item as BarItem).end])).toEqual([[5, 7], [-3, -7], [0, 9]]);
    f.layers[0].visible = false; p = prepareBars(f.layers, f.registry, 'stack');
    expect(p.get('b')!.items.map(item => (item as BarItem).start)).toEqual([0, 0, 0]);
  });
  it('places overlay bars on original coordinates and respects nonzero baselines', () => {
    const f = bars(); f.registry.set('a-base', Float64Array.from([10, 10]));
    const p = prepareBars(f.layers, f.registry, 'overlay').get('a')!;
    expect(p.marks[0]).toMatchObject({x0: -.4, x1: .4, y0: 10, y1: 15});
    expect(p.marks[1]).toMatchObject({y0: 10, y1: 7});
    expect(() => prepareBars(f.layers, f.registry, 'stack')).toThrow(/zero user baselines/);
  });
  it('handles horizontal negative bars and omits nonfinite rows', () => {
    const f = fixture('bar', {y: [0, 1, 2], x: [-4, NaN, 5], base: [2, 0, 0]}, {orientation: 'horizontal', barWidth: .8});
    const p = prepareBars([f.layer], f.registry).get('a')!;
    expect(p.marks[0]).toMatchObject({x0: 2, x1: -2, y0: -.4, y1: .4});
    expect(p.info.omitted).toBe(1); expect(p.items.map(item => item.index)).toEqual([0, 2]);
  });
  it('rejects duplicate positions, mismatched widths and mixed orientations', () => {
    const f = bars(); f.registry.set('a-x', Float64Array.from([-0, 0]));
    expect(() => prepareBars(f.layers, f.registry)).toThrow(/repeated/);
    const w = bars(); (w.layers[1].options as BarSpecOptions).barWidth = .5;
    expect(() => prepareBars(w.layers, w.registry)).toThrow(/same barWidth/);
    expect(() => prepareBars(w.layers, w.registry, 'overlay')).not.toThrow();
    const o = bars(); (o.layers[1].options as BarSpecOptions).orientation = 'horizontal';
    expect(() => prepareBars(o.layers, o.registry)).toThrow(/mix vertical/);
  });
});

describe('statistics geometry', () => {
  it('clips filled rectangles in float64 and emits only existing triangle primitives', () => {
    const f = hist([0, 1, 2, 3], {bins: [0, 1, 3]}), p = prepareStatistics(f.layer, f.registry);
    const g = buildStatisticsGeometry(p, {x: [.5, 2], y: [0, 4]}, defaultView(), 600, 400, {});
    expect(g.id).toBe(f.layer.id); expect(g.primitive).toBe('triangles'); expect(g.positions.length).toBe(36);
    expect([...g.positions].every(Number.isFinite)).toBe(true);
    expect(Math.min(...g.positions)).toBeGreaterThanOrEqual(-1); expect(Math.max(...g.positions)).toBeLessThanOrEqual(1);
  });
  it('draws degenerate single-value boxes as visible median/cap segments', () => {
    const f = box([[7]]), p = prepareStatistics(f.layer, f.registry);
    const g = buildStatisticsGeometry(p, {x: [-1, 1], y: [6, 8]}, defaultView(), 600, 400, {});
    expect(g.positions.length).toBeGreaterThan(0); expect([...g.positions].every(Number.isFinite)).toBe(true);
  });
  it('fails explicitly above the exact vertex limit but clips offscreen marks without sampling', () => {
    const f = hist([.5], {bins: [0, 1]}), p = prepareStatistics(f.layer, f.registry);
    p.marks = new Array(333_334).fill(p.marks[0]);
    expect(() => buildStatisticsGeometry(p, {x: [0, 1], y: [0, 2]}, defaultView(), 600, 400, {})).toThrow(/2,000,000 vertices/);
    expect(buildStatisticsGeometry(p, {x: [2, 3], y: [0, 2]}, defaultView(), 600, 400, {}).positions.length).toBe(0);
  });
});

describe('statistics scheduler, worker dependencies and cancellation', () => {
  it('does not leak pending state when an unsupported query kind fails before yielding', async () => {
    const f = fixture('bar', {x: [0], y: [2], base: [0]}, {orientation: 'vertical', barWidth: .8});
    const scheduler = new QueryScheduler({workerFactory: null});
    await expect(scheduler.queryStatistics('a', f.layer, f.registry)).rejects.toThrow(/Only histogram/);
    expect(scheduler.stats.pending).toBe(0); scheduler.dispose();
  });
  it('reuses summaries independent of viewport and invalidates any group source version', async () => {
    const f = box([[1, 2], [3, 4]]), scheduler = new QueryScheduler({workerFactory: null});
    const a = await scheduler.queryStatistics('a', f.layer, f.registry);
    expect(await scheduler.queryStatistics('a', f.layer, f.registry)).toBe(a);
    f.registry.set(f.layer.data.g1, Float64Array.from([30, 40]));
    const b = await scheduler.queryStatistics('a', f.layer, f.registry);
    expect((b.items[1] as BoxplotItem).median).toBe(35); expect(b).not.toBe(a);
    scheduler.release(f.layer.data.g0); expect(scheduler.stats.cacheBytes).toBe(0); scheduler.dispose();
  });
  it('obeys bounded cache size and option-specific identity', async () => {
    const f = hist([0, 1, 2, 3], {bins: 2}), expected = prepareStatistics(f.layer, f.registry);
    const scheduler = new QueryScheduler({workerFactory: null, maxCacheBytes: statisticsBytes(expected)});
    const first = await scheduler.queryStatistics('a', f.layer, f.registry);
    (f.layer.options as HistogramSpecOptions).cumulative = true;
    const next = await scheduler.queryStatistics('a', f.layer, f.registry);
    expect(next).not.toBe(first); expect(scheduler.stats.cacheEntries).toBe(1);
    expect(scheduler.stats.cacheBytes).toBeLessThanOrEqual(statisticsBytes(expected)); scheduler.dispose();
  });
  it('does not retain summaries larger than the configured cache budget', async () => {
    const f = hist([0, 1]), scheduler = new QueryScheduler({workerFactory: null, maxCacheBytes: 0});
    const a = await scheduler.queryStatistics('a', f.layer, f.registry), b = await scheduler.queryStatistics('a', f.layer, f.registry);
    expect(a).toEqual(b); expect(a).not.toBe(b); expect(scheduler.stats.cacheEntries).toBe(0); expect(scheduler.stats.cacheBytes).toBe(0); scheduler.dispose();
  });
  it('cancels pending work when any raw group source is released', async () => {
    const f = box([Array.from({length: 100_000}, (_, i) => i), [5]]), scheduler = new QueryScheduler({workerFactory: null});
    const pending = scheduler.queryStatistics('a', f.layer, f.registry), rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    scheduler.release(f.layer.data.g1); await rejected; expect(scheduler.stats.pending).toBe(0); scheduler.dispose();
  });
  it('captures all group source versions before cooperative work starts', async () => {
    const f = box([Array.from({length: 100_000}, (_, i) => i), [5]]), scheduler = new QueryScheduler({workerFactory: null});
    const old = scheduler.queryStatistics('a', f.layer, f.registry);
    f.registry.set(f.layer.data.g1, Float64Array.from([99]));
    expect(((await old).items[1] as BoxplotItem).median).toBe(5);
    expect(((await scheduler.queryStatistics('a', f.layer, f.registry)).items[1] as BoxplotItem).median).toBe(99);
    scheduler.dispose();
  });
  it('supersedes obsolete raw summaries without publishing their result', async () => {
    const f = hist(Array.from({length: 150_000}, (_, i) => i % 10), {bins: 2}), scheduler = new QueryScheduler({workerFactory: null});
    const old = scheduler.queryStatistics('a', f.layer, f.registry), rejected = expect(old).rejects.toMatchObject({name: 'AbortError'});
    f.registry.set(f.layer.data.samples, Float64Array.from([9]));
    const current = scheduler.queryStatistics('a', f.layer, f.registry); await rejected;
    expect((await current).info.total).toBe(1); expect(scheduler.stats.pending).toBe(0); scheduler.dispose();
  });
  it('registers every raw group once per version and matches fallback results', async () => {
    const sent: WorkerRequest[] = [], sources = new DataRegistry();
    const fake = {onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null, onerror: null,
      postMessage(message: WorkerRequest) {
        sent.push(message);
        if (message.type === 'register') {const e = message.entry; sources.set(e.descriptor.id, e.values, e.descriptor.shape, e.descriptor.version);}
        else if (message.type === 'statistics') {const result = prepareStatistics(message.layer, sources); queueMicrotask(() => fake.onmessage?.({data: {type: 'result', requestId: message.requestId, result}} as MessageEvent<WorkerResponse>));}
      }, terminate() {}};
    const f = box([[1, 2], [3, 4]]), scheduler = new QueryScheduler({workerFactory: () => fake as unknown as Worker});
    expect(await scheduler.queryStatistics('a', f.layer, f.registry)).toEqual(prepareStatistics(f.layer, f.registry));
    expect(sent.filter(m => m.type === 'register')).toHaveLength(3);
    await scheduler.queryStatistics('a', f.layer, f.registry); expect(sent.filter(m => m.type === 'statistics')).toHaveLength(1);
    f.registry.set(f.layer.data.g1, Float64Array.from([10]));
    expect((await scheduler.queryStatistics('a', f.layer, f.registry)).info.total).toBe(3);
    expect(sent.filter(m => m.type === 'register')).toHaveLength(4); scheduler.dispose();
  });
  it('recovers worker-load failure through cancellable fallback', async () => {
    const fake = {onmessage: null, onerror: null as (() => void) | null, postMessage() {}, terminate() {}};
    const f = hist([0, 1, 2]), scheduler = new QueryScheduler({workerFactory: () => fake as unknown as Worker});
    const pending = scheduler.queryStatistics('a', f.layer, f.registry); fake.onerror?.();
    expect(await pending).toEqual(prepareStatistics(f.layer, f.registry)); scheduler.dispose();
  });
});
