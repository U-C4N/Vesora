import {describe, expect, it} from 'vitest';
import {Figure, fillBetween, subplots} from '../../packages/core/src/figure';
import {planBand} from '../../packages/core/src/band';
import {QueryScheduler} from '../../packages/core/src/scheduler';
import {DataRegistry} from '../../packages/core/src/data';
import type {Query} from '../../packages/core/src/types';
import type {WorkerRequest, WorkerResponse} from '../../packages/core/src/worker';

const arr = (values: number[]) => Float64Array.from(values);
const query = (changes: Partial<Query> = {}): Query => ({bounds: {x: [0, 10], y: [0, 10]}, width: 100, height: 100, xScale: 'linear', yScale: 'linear', pointBudget: 10_000, mode: 'auto', ...changes});
const buffers = (figure: Figure) => new Map(Array.from(figure.registry.entries(), ([id, entry]) => [id, entry.values.buffer.slice(entry.values.byteOffset, entry.values.byteOffset + entry.values.byteLength) as ArrayBuffer]));

describe('paired uncertainty bands', () => {
  it('owns three typed sources, supports panel and top-level APIs and updates bounds atomically', () => {
    const figure = subplots({rows: 1, cols: 2, shareX: true});
    const band = figure.panel(0, 1).fillBetween(new Int16Array([1, 2, 3]), arr([0, NaN, 2]), new Float32Array([1, 2, 4]), {label: 'Observed interval'});
    expect(band.spec).toMatchObject({kind: 'band', panelId: 'panel-0-1', style: {opacity: .18, label: 'Observed interval'}});
    expect(figure.spec.protocolVersion).toBe(6);
    expect(figure.registry.get(band.spec.data.x).descriptor.dtype).toBe('int16');
    band.setData({lower: [0, 1, 3], upper: [1, 2, 5]});
    const before = figure.snapshot(), sources = buffers(figure);
    expect(() => band.setData({lower: [2, 1, 3], upper: [1, 2, 5]})).toThrow(/lower/);
    expect(figure.snapshot()).toEqual(before); expect(buffers(figure)).toEqual(sources);
    expect(() => band.setData({x: [1, 1, 3]})).toThrow(/increasing/);
    expect(() => band.setData({y: [1, 2, 3]})).toThrow(/Unknown/);
    expect(() => band.setStyle({width: 3})).toThrow(/band style/);
    const imported = new Figure(); imported.applySnapshot(before, sources);
    expect(imported.snapshot()).toEqual(before);
    const top = fillBetween([], [], []); expect(top).toBeInstanceOf(Figure);
    expect(top.spec.layers[0].kind).toBe('band');
    figure.close(); imported.close(); top.close();
  });

  it('rejects invalid construction and incompatible axes without committing sources or views', () => {
    const figure = new Figure(), before = figure.snapshot();
    for (const x of [[0, NaN], [2, 1], [1, 1]]) {
      expect(() => figure.fillBetween(x, [0, 0], [1, 1])).toThrow(); expect(figure.snapshot()).toEqual(before);
    }
    expect(() => figure.fillBetween([0, 1], [0], [1, 2])).toThrow(/equal/);
    expect(() => figure.fillBetween([0, 1], [0, 0], [1, 1], {values: [1, 2]} as any)).toThrow(/band style/);
    expect(figure.registry.size).toBe(0);
    figure.fillBetween([1, 2], [0, 1], [2, 3]);
    figure.setView({xScale: 'time'}); const valid = figure.snapshot();
    expect(() => figure.setView({yScale: 'time'})).toThrow(/numeric y/);
    expect(() => figure.setAxisFormat('y', {kind: 'date'})).toThrow(/numeric y/);
    expect(() => figure.plot(['one', 'two'], [1, 2])).toThrow(/categorical/i);
    expect(figure.snapshot()).toEqual(valid); figure.close();
  });

  it('gates imported bands at protocol 6 and rejects malformed snapshots atomically', () => {
    const source = fillBetween([0, 1], [0, 1], [2, 3]);
    const target = new Figure(); target.plot([0, 1], [1, 2]);
    const before = target.snapshot(), oldBuffers = buffers(target);
    const downgraded = source.snapshot(); downgraded.figure.protocolVersion = 5;
    expect(() => target.applySnapshot(downgraded, buffers(source))).toThrow(/version 6/);
    const wrong = source.snapshot(), wrongBuffers = buffers(source);
    wrongBuffers.set(wrong.figure.layers[0].data.lower, arr([4, 5]).buffer);
    expect(() => target.applySnapshot(wrong, wrongBuffers)).toThrow(/lower/);
    expect(target.snapshot()).toEqual(before); expect(buffers(target)).toEqual(oldBuffers);
    source.setTheme('dark'); source.text(0, 0, 'Uncertainty');
    expect(source.spec.protocolVersion).toBe(6); source.close(); target.close();
  });
});

describe('paired band planning', () => {
  it('preserves both-bound spikes, missing rows and crossing intervals without decimation', () => {
    const result = planBand(arr([0, .001, .002, .003, 1, 2, 3]), arr([2, 0, 2, 2, NaN, 2, 2]), arr([3, 3, 9, 3, 4, 4, 4]), query());
    expect(result.segments.map(segment => [...segment])).toEqual([[0, 1, 2, 3], [5, 6]]);
    expect(result.info).toMatchObject({exact: true, valid: 6, omitted: 1});
    const crossing = planBand(arr([-20, 20]), arr([-1, -1]), arr([11, 11]), query());
    expect(crossing.segments.map(segment => [...segment])).toEqual([[0, 1]]);
    expect(crossing.info.visible).toBe(0);
  });

  it('never bridges a log-invalid bound and reports a bounded-render error instead of sampling', () => {
    const x = arr([1, 2, 3, 4, 5]), lower = arr([1, 1, 0, 1, 1]), upper = arr([2, 2, 2, 2, 2]);
    const result = planBand(x, lower, upper, query({yScale: 'log', bounds: {x: [0, 10], y: [1, 10]}}));
    expect(result.segments.map(segment => [...segment])).toEqual([[0, 1], [3, 4]]);
    expect(() => planBand(x, lower, upper, query({pointBudget: 3}))).toThrow(/budget/);
    expect(planBand(arr([1]), arr([1]), arr([2]), query()).segments).toHaveLength(0);
    expect(planBand(arr([]), arr([]), arr([]), query()).segments).toHaveLength(0);
  });

  it('uses every bound source version for worker transport/cache and agrees with fallback', async () => {
    const sent: WorkerRequest[] = [], remote = new DataRegistry();
    const fake = {onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null, onerror: null,
      postMessage(message: WorkerRequest) {
        sent.push(message);
        if (message.type === 'register') {const {descriptor, values} = message.entry; remote.set(descriptor.id, values, descriptor.shape, descriptor.version);}
        if (message.type === 'band') {
          const result = planBand(remote.get(message.xId).values, remote.get(message.lowerId).values, remote.get(message.upperId).values, message.query);
          queueMicrotask(() => fake.onmessage?.({data: {type: 'result', requestId: message.requestId, result}} as MessageEvent<WorkerResponse>));
        }
      }, terminate() {},
    };
    const sources = new DataRegistry(), worker = new QueryScheduler({workerFactory: () => fake as unknown as Worker}), fallback = new QueryScheduler({workerFactory: null});
    sources.set('x', arr([1, 2, 3])); sources.set('low', arr([1, 1, 1])); sources.set('high', arr([3, 3, 3]));
    const first = await worker.queryBand('band', 'x', 'low', 'high', query(), sources);
    expect(first).toEqual(await fallback.queryBand('band', 'x', 'low', 'high', query(), sources));
    expect(await worker.queryBand('band', 'x', 'low', 'high', query(), sources)).toBe(first);
    sources.set('low', arr([1, NaN, 1]));
    const second = await worker.queryBand('band', 'x', 'low', 'high', query(), sources);
    expect(second.segments).toHaveLength(0);
    expect(second).toEqual(await fallback.queryBand('band', 'x', 'low', 'high', query(), sources));
    expect(sent.filter(message => message.type === 'register').map(message => message.type === 'register' && message.entry.descriptor.id)).toEqual(['x', 'low', 'high', 'low']);
    sources.set('low', arr([1, 1, 1])); sources.set('high', arr([3, NaN, 3]));
    expect((await worker.queryBand('band', 'x', 'low', 'high', query(), sources)).segments).toHaveLength(0);
    worker.dispose(); fallback.dispose();
  });

  it('cancels a stale cooperative request before publishing its result', async () => {
    const sources = new DataRegistry(), scheduler = new QueryScheduler({workerFactory: null}), size = 65_537;
    sources.set('x', Float64Array.from({length: size}, (_, i) => i)); sources.set('low', new Float64Array(size)); sources.set('high', new Float64Array(size).fill(1));
    const pending = scheduler.queryBand('band', 'x', 'low', 'high', query(), sources);
    const rejection = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    const replacement = scheduler.queryBand('band', 'x', 'low', 'high', query({bounds: {x: [20, 21], y: [0, 10]}}), sources);
    await rejection; expect((await replacement).info.exact).toBe(true); scheduler.dispose();
  });
});
