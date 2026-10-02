import {describe, expect, it} from 'vitest';
import {DataRegistry, decodeData, describeData, toNumericArray} from '../../packages/core/src/data';
import {denormalize, extent, formatTick, invert, normalize, project, ticks} from '../../packages/core/src/scales';
import {planLine, planScatter} from '../../packages/core/src/planning';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import type {Query} from '../../packages/core/src/types';
import type {WorkerRequest, WorkerResponse} from '../../packages/core/src/worker';

const query = (changes: Partial<Query> = {}): Query => ({bounds: {x: [0, 10], y: [0, 10]}, width: 100, height: 100, xScale: 'linear', yScale: 'linear', pointBudget: 10_000, mode: 'auto', ...changes});
const array = (values: number[]) => Float64Array.from(values);

describe('numeric storage and wire descriptors', () => {
  it('preserves source dtype and high precision', () => {
    const input = array([1e12, 1e12 + 0.001]);
    expect(toNumericArray(input)).toBe(input);
    expect(describeData('x', input)).toEqual({id: 'x', dtype: 'float64', shape: [2], version: 0, byteLength: 16});
    expect(toNumericArray([1, 2])).toBeInstanceOf(Float64Array);
    expect(() => toNumericArray(['1'] as unknown as number[])).toThrow(/Non-numeric/);
  });
  it('decodes little-endian transport and validates shape', () => {
    const buffer = new ArrayBuffer(8), view = new DataView(buffer);
    view.setInt32(0, -123456, true); view.setInt32(4, 98765, true);
    const descriptor = {id: 'x', dtype: 'int32' as const, shape: [1, 2], version: 1, byteLength: 8};
    expect([...decodeData(descriptor, buffer)]).toEqual([-123456, 98765]);
    expect(() => decodeData({...descriptor, shape: [3]}, buffer)).toThrow(/Byte length/);
    expect(() => decodeData(descriptor, new ArrayBuffer(4))).toThrow(/wrong byte length/);
  });
  it('tracks updates monotonically and releases sources', () => {
    const store = new DataRegistry();
    store.set('x', array([1])); store.set('x', array([2]));
    expect(store.get('x').descriptor.version).toBe(1);
    expect(() => store.set('x', array([3]), [1], 1)).toThrow(/increase/);
    store.release('x'); expect(() => store.get('x')).toThrow(/Unknown/);
  });
});

describe('scientific scales', () => {
  it('preserves small differences around large coordinates', () => {
    const lo = 1e12, hi = 1e12 + 0.01, value = lo + 0.005;
    expect(normalize(value, [lo, hi])).toBe((value - lo) / (hi - lo));
    expect(invert(project(value, [lo, hi], [0, 800]), [lo, hi], [0, 800])).toBe(value);
    const labels = ticks([lo, hi]).map(tick => formatTick(tick, hi - lo));
    expect(new Set(labels).size).toBe(labels.length);
    expect(formatTick(lo, hi - lo)).not.toBe(formatTick(hi, hi - lo));
  });
  it('handles finite extremes without domain subtraction overflow', () => {
    expect(normalize(0, [-1e308, 1e308])).toBe(0.5);
    expect(denormalize(0.5, [-1e308, 1e308])).toBe(0);
    expect(normalize(1, [1e-300, 1e300], 'log')).toBeCloseTo(0.5);
  });
  it('omits nonfinite and invalid logarithmic data', () => {
    expect(extent(array([NaN, -5, 0, 1, 100, Infinity]), 'log')).toEqual([1, 100]);
    expect(Number.isNaN(normalize(0, [1, 10], 'log'))).toBe(true);
    expect(ticks([1, 1000], 'log')).toEqual([1, 10, 100, 1000]);
    expect(extent(array([NaN]))).toEqual([0, 1]);
  });
});

describe('adaptive scatter planning', () => {
  it('counts all finite viewport samples, including maximum boundaries', () => {
    const result = planScatter(array([0, 5, 5, 10, 11, NaN]), array([0, 5, 5, 10, 0, 2]), query({mode: 'density', width: 8, height: 8}));
    expect(result.kind).toBe('density');
    if (result.kind !== 'density') return;
    expect([...result.counts]).toEqual([1, 0, 0, 3]);
    expect(result.info.visible).toBe(4); expect(result.max).toBe(3);
    expect([...result.counts].reduce((a, b) => a + b, 0)).toBe(4);
  });
  it('uses hysteresis but never exceeds the explicit point budget', () => {
    const x = new Float64Array(10).fill(5), y = new Float64Array(10).fill(5);
    expect(planScatter(x, y, query({width: 10, height: 10})).kind).toBe('points');
    expect(planScatter(x, y, query({width: 10, height: 10, previous: 'density'})).kind).toBe('density');
    expect(planScatter(x, y, query({pointBudget: 3})).kind).toBe('density');
    expect(() => planScatter(x, y, query({pointBudget: 3, mode: 'points'}))).toThrow(/exceeding the point budget/);
  });
  it('does not draw invalid log values', () => {
    const result = planScatter(array([-1, 0, 1, 10]), array([1, 1, 1, 1]), query({xScale: 'log', bounds: {x: [1, 10], y: [0, 10]}}));
    expect(result.kind === 'points' && [...result.indices]).toEqual([2, 3]);
  });
});

describe('ordered line reduction', () => {
  it('retains a narrow positive and negative spike in source order', () => {
    const x = array([1, 1.001, 1.002, 1.003, 1.004, 1.005, 1.006]);
    const y = array([5, 5, 9, 5, 1, 5, 5]);
    const result = planLine(x, y, query());
    expect([...result.segments[0]]).toEqual([0, 2, 4, 6]);
    expect(result.info.exact).toBe(false);
  });
  it('never bridges NaNs or invalid log values', () => {
    const result = planLine(array([1, 2, 3, 4, 5]), array([1, 2, NaN, 4, 5]), query());
    expect(result.segments.map(segment => [...segment])).toEqual([[0, 1], [3, 4]]);
    const log = planLine(array([1, 2, 0, 4, 5]), array([1, 2, 3, 4, 5]), query({xScale: 'log', bounds: {x: [1, 10], y: [0, 10]}}));
    expect(log.segments.map(segment => [...segment])).toEqual([[0, 1], [3, 4]]);
  });
  it('includes viewport-crossing segments even with both endpoints outside', () => {
    const result = planLine(array([-5, 15]), array([5, 5]), query());
    expect([...result.segments[0]]).toEqual([0, 1]); expect(result.info.visible).toBe(0);
    expect(planLine(array([-5, 15]), array([20, 20]), query()).segments).toHaveLength(0);
  });
  it('keeps disjoint visible runs separate after a trip outside the viewport', () => {
    const result = planLine(array([5, 15, 20, 15, 5]), array([5, 5, 20, 5, 5]), query());
    expect(result.segments.map(segment => [...segment])).toEqual([[0, 1], [3, 4]]);
  });
});

describe('cooperative scheduler lifetime and bounded cache', () => {
  it('recovers an asynchronous worker-load failure without losing the query', async () => {
    const fake={onmessage:null,onerror:null as (()=>void)|null,postMessage:()=>{},terminate:()=>{}};
    const registry=new DataRegistry(),scheduler=new QueryScheduler({workerFactory:()=>fake as unknown as Worker});
    registry.set('x',array([1,2]));registry.set('y',array([1,2]));
    const pending=scheduler.query('layer','scatter','x','y',query(),registry);
    fake.onerror?.();
    expect((await pending).info.visible).toBe(2);
    expect(scheduler.stats.worker).toBe(false);scheduler.dispose();
  });
  it('sends source arrays to a worker once per version, not on each pan', async () => {
    const sent: WorkerRequest[] = [], sources = new DataRegistry();
    let terminated = false;
    const fake = {
      onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null,
      onerror: null,
      postMessage(message: WorkerRequest) {
        sent.push(message);
        if (message.type === 'register') {
          const {descriptor, values} = message.entry;
          sources.set(descriptor.id, values, descriptor.shape, descriptor.version);
        } else if (message.type === 'query') {
          const result = planScatter(sources.get(message.xId).values, sources.get(message.yId).values, message.query);
          queueMicrotask(() => fake.onmessage?.({data: {type: 'result', requestId: message.requestId, result}} as MessageEvent<WorkerResponse>));
        }
      },
      terminate() {terminated = true;},
    };
    const registry = new DataRegistry(), scheduler = new QueryScheduler({workerFactory: () => fake as unknown as Worker});
    registry.set('x', array([1, 2])); registry.set('y', array([1, 2]));
    await scheduler.query('layer', 'scatter', 'x', 'y', query(), registry);
    await scheduler.query('layer', 'scatter', 'x', 'y', query({bounds: {x: [1, 2], y: [1, 2]}}), registry);
    expect(sent.filter(message => message.type === 'register')).toHaveLength(2);
    registry.set('x', array([9, 9]));
    expect((await scheduler.query('layer', 'scatter', 'x', 'y', query({bounds: {x: [1, 2], y: [1, 2]}}), registry)).info.visible).toBe(0);
    expect(sent.filter(message => message.type === 'register')).toHaveLength(3);
    scheduler.dispose(); expect(terminated).toBe(true);
  });
  it('accounts correctly when concurrent layer queries share one cache entry', async () => {
    const registry = new DataRegistry(), scheduler = new QueryScheduler({workerFactory: null});
    registry.set('x', array([1, 2])); registry.set('y', array([1, 2]));
    await Promise.all(['a', 'b'].map(key => scheduler.query(key, 'scatter', 'x', 'y', query(), registry)));
    expect(scheduler.stats.cacheEntries).toBe(1);
    expect(scheduler.stats.cacheBytes).toBe(264);
    scheduler.release('x'); expect(scheduler.stats.cacheBytes).toBe(0); scheduler.dispose();
  });
  it('rejects obsolete work and returns only the latest query', async () => {
    const registry = new DataRegistry(), scheduler = new QueryScheduler({workerFactory: null});
    registry.set('x', new Float64Array(150_000).fill(5)); registry.set('y', new Float64Array(150_000).fill(5));
    const old = scheduler.query('layer', 'scatter', 'x', 'y', query(), registry);
    const rejected = expect(old).rejects.toMatchObject({name: 'AbortError'});
    const current = scheduler.query('layer', 'scatter', 'x', 'y', query({bounds: {x: [6, 7], y: [6, 7]}}), registry);
    await rejected;
    expect((await current).info.visible).toBe(0);
    expect(scheduler.stats.pending).toBe(0); scheduler.dispose();
  });
  it('evicts cache entries and never reuses stale versions', async () => {
    const registry = new DataRegistry(), scheduler = new QueryScheduler({workerFactory: null, maxCacheBytes: 300});
    registry.set('x', array([1, 2])); registry.set('y', array([1, 2]));
    expect((await scheduler.query('layer', 'scatter', 'x', 'y', query(), registry)).info.visible).toBe(2);
    registry.set('x', array([50, 60]));
    expect((await scheduler.query('layer', 'scatter', 'x', 'y', query(), registry)).info.visible).toBe(0);
    expect(scheduler.stats.cacheBytes).toBeLessThanOrEqual(300);
    expect(scheduler.stats.cacheEntries).toBe(1);
    scheduler.release('x'); expect(scheduler.stats.cacheEntries).toBe(0);
    scheduler.dispose(); await expect(scheduler.query('layer', 'scatter', 'x', 'y', query(), registry)).rejects.toThrow(/disposed/);
  });
  it('cancels pending queries on source release', async () => {
    const registry = new DataRegistry(), scheduler = new QueryScheduler({workerFactory: null});
    registry.set('x', new Float64Array(100_000)); registry.set('y', new Float64Array(100_000));
    const pending = scheduler.query('layer', 'scatter', 'x', 'y', query(), registry);
    const rejected = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    scheduler.release('x'); await rejected;
    scheduler.dispose(); expect(scheduler.stats.cacheBytes).toBe(0);
  });
});
