import {describe, expect, it} from 'vitest';
import {DataRegistry} from '../../packages/core/src/data';
import {defaultView} from '../../packages/core/src/figure';
import {linkedSteps, maskHas, maskedScatterSteps, validateSelectionLink} from '../../packages/core/src/linked';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import {prepareStatistics} from '../../packages/core/src/statistics';
import type {HistogramItem} from '../../packages/core/src/statistics';
import type {FigureSpec, LayerSpec, NumericArray, Query, SelectionLinkSpec} from '../../packages/core/src/types';
import type {WorkerRequest, WorkerResponse} from '../../packages/core/src/worker';

function finish<T>(steps: Generator<void, T>): T {while (true) {const next = steps.next(); if (next.done) return next.value;}}
const array = (values: number[]) => Float64Array.from(values);
const query = (changes: Partial<Query> = {}): Query => ({bounds: {x: [0, 10], y: [0, 10]}, width: 100, height: 100, xScale: 'linear', yScale: 'linear', pointBudget: 10_000, mode: 'auto', ...changes});

function fixture(samples: NumericArray, x: NumericArray = samples, y: NumericArray = new Float64Array(samples.length).fill(1)) {
  const registry = new DataRegistry();
  const layers: LayerSpec[] = [
    {id: 'a', kind: 'scatter', panelId: 'main', data: {x: 'ax', y: 'ay'}, style: {}, visible: true},
    {id: 'b', kind: 'scatter', panelId: 'b-panel', data: {x: 'bx', y: 'by'}, style: {}, visible: true},
    {id: 'h', kind: 'hist', panelId: 'h-panel', data: {samples: 'samples'}, options: {bins: [0, 1, 2, 4], density: false, cumulative: false}, style: {}, visible: true},
  ];
  registry.set('ax', x); registry.set('ay', y); registry.set('bx', x.slice() as NumericArray); registry.set('by', y.slice() as NumericArray); registry.set('samples', samples);
  const link: SelectionLinkSpec = {id: 'link', scatter: ['a', 'b'], histogram: 'h', generation: 1, sequence: 1, selection: {originLayerId: 'a', bounds: {x: [0, 10], y: [0, 10]}}};
  const spec: FigureSpec = {protocolVersion: 4, id: 'fig', title: '', width: 1200, height: 500, view: defaultView(), layers, layout: {rows: 1, cols: 3, shareX: false, shareY: false},
    panels: [{id: 'main', row: 0, col: 0, title: ''}, {id: 'b-panel', row: 0, col: 1, title: '', view: defaultView()}, {id: 'h-panel', row: 0, col: 2, title: '', view: defaultView()}], selectionLink: link};
  return {registry, layers, link, spec, baseline: prepareStatistics(layers[2], registry)};
}

describe('linked scene validation', () => {
  it('accepts only numeric 2D aligned scatter/scatter/count histogram groups', () => {
    const f = fixture(array([0, 1, 2]));
    expect(() => validateSelectionLink(f.spec, f.registry)).not.toThrow();
    const changed = (mutate: (spec: FigureSpec) => void) => {const next = structuredClone(f.spec); mutate(next); return () => validateSelectionLink(next, f.registry);};
    expect(changed(spec => {spec.protocolVersion = 3;})).toThrow(/protocol version 4/);
    expect(changed(spec => {spec.layers[1].panelId = 'main';})).toThrow(/distinct panels/);
    expect(changed(spec => {spec.layers[0].categorical = {x: true};})).toThrow(/numeric/);
    expect(changed(spec => {spec.layers[0].kind = 'line';})).toThrow(/two scatter/);
    expect(changed(spec => {(spec.layers[2].options as any).density = true;})).toThrow(/density=false/);
    expect(changed(spec => {(spec.layers[2].options as any).cumulative = true;})).toThrow(/cumulative=false/);
    expect(changed(spec => {spec.panels![1].view!.kind = '3d';})).toThrow(/2D/);
    expect(changed(spec => {spec.selectionLink!.selection!.originLayerId = 'h';})).toThrow(/origin/);
    expect(changed(spec => {spec.selectionLink!.selection!.bounds.x = [NaN, 2];})).toThrow(/finite/);
    expect(changed(spec => {spec.selectionLink!.generation = -1;})).toThrow(/generation/);
    expect(changed(spec => {spec.selectionLink!.sequence = .5;})).toThrow(/sequence/);
    f.registry.set('bx', array([0, 1]));
    expect(() => validateSelectionLink(f.spec, f.registry)).toThrow(/aligned row count/);
  });
  it('preserves a raw cohort across axis scale changes and rejects non-dimensional sources', () => {
    const f = fixture(array([0, 1, 2]), array([-1, 1, 3])); f.link.selection!.bounds.x = [-2, 2];
    const before = finish(linkedSteps(f.link, f.layers, f.registry, f.baseline));
    f.spec.view.xScale = 'log';
    expect(() => validateSelectionLink(f.spec, f.registry)).not.toThrow();
    const after = finish(linkedSteps(f.link, f.layers, f.registry, f.baseline));
    expect(after.count).toBe(2); expect(after.mask).toEqual(before.mask);
    const visible = finish(maskedScatterSteps(f.registry.get('ax').values, f.registry.get('ay').values, after.mask, query({xScale: 'log', bounds: {x: [1, 10], y: [0, 2]}})));
    expect(visible.info).toMatchObject({total: 2, visible: 1});
    f.registry.set('ax', array([-1, 1, 3]), [1, 3]);
    expect(() => validateSelectionLink(f.spec, f.registry)).toThrow(/one-dimensional/);
  });
});

describe('exact linked membership and fixed histogram edges', () => {
  it('counts boundary rows exactly and distinguishes histogram omissions/range exclusions', () => {
    const f = fixture(array([0, 1, 2, 4, NaN, 8, Infinity, -1]), array([0, 1, 2, 3, 4, 5, 6, 7]));
    f.link.selection!.bounds = {x: [0, 6], y: [1, 1]};
    const before = structuredClone(f.baseline), result = finish(linkedSteps(f.link, f.layers, f.registry, f.baseline));
    expect(result).toMatchObject({count: 7, total: 8, truncated: false});
    expect([...result.preview]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Array.from({length: 8}, (_, i) => maskHas(result.mask, i))).toEqual([true, true, true, true, true, true, true, false]);
    expect((result.histogram.items as HistogramItem[]).map(bin => bin.count)).toEqual([1, 1, 2]);
    expect(result.histogram.info).toMatchObject({total: 7, valid: 5, omitted: 2, rangeExcluded: 1, visible: 4, exact: true});
    expect(f.baseline).toEqual(before);
    expect(result.histogram.items.map(bin => [(bin as HistogramItem).left, (bin as HistogramItem).right])).toEqual([[0, 1], [1, 2], [2, 4]]);
  });
  it('excludes invalid origin coordinates and retains Float64 differences', () => {
    const offset = 1e12, f = fixture(array([0, 1, 2, 3]), array([offset, offset + .001, NaN, Infinity]));
    f.link.selection!.bounds = {x: [offset + .001, offset + .002], y: [0, 2]};
    const result = finish(linkedSteps(f.link, f.layers, f.registry, f.baseline));
    expect(result.count).toBe(1); expect([...result.preview]).toEqual([1]);
    expect((result.histogram.items as HistogramItem[]).map(bin => bin.count)).toEqual([0, 1, 0]);
  });
  it('supports clear and empty/all-invalid cohorts without changing baseline bins', () => {
    for (const samples of [array([]), array([NaN, Infinity])]) {
      const f = fixture(samples); delete f.link.selection;
      const result = finish(linkedSteps(f.link, f.layers, f.registry, f.baseline));
      expect(result.count).toBe(0); expect(result.total).toBe(samples.length);
      expect([...result.preview]).toEqual([]); expect(result.mask.every(value => value === 0)).toBe(true);
      expect(result.histogram.items.map(bin => (bin as HistogramItem).count)).toEqual([0, 0, 0]);
    }
  });
  it('preserves every selected row in a million-row cohort beyond the event preview limit', () => {
    const n = 1_000_000, x = Float64Array.from({length: n}, (_, i) => i), samples = Float64Array.from({length: n}, (_, i) => i % 4);
    const f = fixture(samples, x); f.link.selection!.bounds.x = [0, 299_999];
    const result = finish(linkedSteps(f.link, f.layers, f.registry, f.baseline));
    expect(result.count).toBe(300_000); expect(result.total).toBe(n); expect(result.mask.byteLength).toBe(125_000);
    expect(result.preview.length).toBe(10_000); expect(result.preview[9_999]).toBe(9_999); expect(result.truncated).toBe(true);
    expect(maskHas(result.mask, 299_999)).toBe(true); expect(maskHas(result.mask, 300_000)).toBe(false);
    expect((result.histogram.items as HistogramItem[]).map(bin => bin.count)).toEqual([75_000, 75_000, 150_000]);
    const dense = finish(maskedScatterSteps(x, f.registry.get('ay').values, result.mask, query({bounds: {x: [0, n], y: [0, 2]}, pointBudget: 1000})));
    expect(dense.kind).toBe('density'); expect(dense.info).toMatchObject({total: 300_000, visible: 300_000, exact: true});
    if (dense.kind === 'density') expect(dense.counts.reduce((sum, value) => sum + value, 0)).toBe(300_000);
    const sparse = finish(maskedScatterSteps(x, f.registry.get('ay').values, result.mask, query({bounds: {x: [299_990, 300_000], y: [0, 2]}})));
    expect(sparse.kind).toBe('points'); if (sparse.kind === 'points') expect([...sparse.indices]).toEqual([299990, 299991, 299992, 299993, 299994, 299995, 299996, 299997, 299998, 299999]);
  });
});

describe('masked scatter planning', () => {
  it('keeps original indices, rejects invalid log coordinates and treats forced budgets explicitly', () => {
    const x = array([-1, 0, 1, 2, 10]), y = array([1, 1, 1, NaN, 1]), mask = Uint8Array.of(0b1_1111);
    const q = query({xScale: 'log', bounds: {x: [1, 10], y: [0, 2]}}), result = finish(maskedScatterSteps(x, y, mask, q));
    expect(result.info).toMatchObject({total: 5, visible: 2});
    expect(result.kind === 'points' && [...result.indices]).toEqual([2, 4]);
    expect(() => finish(maskedScatterSteps(x, y, mask, {...q, mode: 'points', pointBudget: 1}))).toThrow(/exceeding the point budget/);
    expect(() => finish(maskedScatterSteps(x, y, new Uint8Array(2), q))).toThrow(/mask length/);
    expect(() => finish(maskedScatterSteps(x, y, Uint8Array.of(255), q))).toThrow(/bits beyond/);
  });
});

describe('linked scheduler lifecycle and worker transport', () => {
  it('reuses linked/selected caches, invalidates dependent data and bounds cache bytes', async () => {
    const f = fixture(array([0, 1, 2, 3])), scheduler = new QueryScheduler({workerFactory: null, maxCacheBytes: 4096});
    const result = await scheduler.queryLinked('link', f.link, f.layers, f.baseline, f.registry);
    expect(await scheduler.queryLinked('link', f.link, f.layers, f.baseline, f.registry)).toBe(result);
    const points = await scheduler.querySelectedScatter('selected', 'bx', 'by', result.mask, query(), f.registry);
    expect(await scheduler.querySelectedScatter('selected', 'bx', 'by', result.mask, query(), f.registry)).toBe(points);
    expect(scheduler.stats.cacheBytes).toBeLessThanOrEqual(4096);
    f.registry.set('bx', array([50, 50, 50, 50]));
    expect((await scheduler.querySelectedScatter('selected', 'bx', 'by', result.mask, query(), f.registry)).info.visible).toBe(0);
    scheduler.release('samples'); expect(scheduler.stats.cacheEntries).toBe(2);
    scheduler.release('bx'); expect(scheduler.stats.cacheEntries).toBe(0);
    scheduler.dispose(); expect(scheduler.stats).toMatchObject({pending: 0, cacheEntries: 0, cacheBytes: 0});
    await expect(scheduler.queryLinked('link', f.link, f.layers, f.baseline, f.registry)).rejects.toThrow(/disposed/);
  });
  it('cancels replaced selection and pending work on source release/disposal', async () => {
    const f = fixture(new Float64Array(150_000).fill(1)), scheduler = new QueryScheduler({workerFactory: null});
    const pending = scheduler.queryLinked('link', f.link, f.layers, f.baseline, f.registry), rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    const cleared = {...f.link, sequence: 2, selection: undefined};
    const next = scheduler.queryLinked('link', cleared, f.layers, f.baseline, f.registry);
    await rejected; expect((await next).count).toBe(0);
    const released = scheduler.queryLinked('released', f.link, f.layers, f.baseline, f.registry), rejectedRelease = expect(released).rejects.toMatchObject({name: 'AbortError'});
    scheduler.release('samples'); await rejectedRelease;
    const disposed = scheduler.queryLinked('disposed', f.link, f.layers, f.baseline, f.registry), rejectedDispose = expect(disposed).rejects.toMatchObject({name: 'AbortError'});
    scheduler.dispose(); await rejectedDispose; expect(scheduler.stats.pending).toBe(0);
  });
  it('matches fallback results and sends sources once across selected view changes', async () => {
    const f = fixture(array([0, 1, 2, 3])), sent: WorkerRequest[] = [], sources = new DataRegistry(); let terminated = false;
    const fake = {onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null, onerror: null,
      postMessage(message: WorkerRequest) {
        sent.push(message);
        if (message.type === 'register') {const {descriptor, values} = message.entry; sources.set(descriptor.id, values, descriptor.shape, descriptor.version); return;}
        const result = message.type === 'linked' ? finish(linkedSteps(message.link, message.layers, sources, message.baseline))
          : message.type === 'selected-scatter' ? finish(maskedScatterSteps(sources.get(message.xId).values, sources.get(message.yId).values, message.mask, message.query)) : undefined;
        if (result && 'requestId' in message) queueMicrotask(() => fake.onmessage?.({data: {type: 'result', requestId: message.requestId, result}} as MessageEvent<WorkerResponse>));
      }, terminate() {terminated = true;},
    };
    const scheduler = new QueryScheduler({workerFactory: () => fake as unknown as Worker});
    const result = await scheduler.queryLinked('link', f.link, f.layers, f.baseline, f.registry);
    expect(result).toEqual(finish(linkedSteps(f.link, f.layers, f.registry, f.baseline)));
    await scheduler.querySelectedScatter('selected', 'bx', 'by', result.mask, query(), f.registry);
    await scheduler.querySelectedScatter('selected', 'bx', 'by', result.mask, query({bounds: {x: [0, 1], y: [0, 2]}}), f.registry);
    expect(sent.filter(message => message.type === 'register')).toHaveLength(5);
    expect(sent.filter(message => message.type === 'selected-scatter')).toHaveLength(2);
    for (const message of sent) if (message.type === 'selected-scatter') expect(message.mask.byteLength).toBe(1);
    scheduler.dispose(); expect(terminated).toBe(true);
  });
});
