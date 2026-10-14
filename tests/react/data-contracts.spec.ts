import {describe, expect, it} from 'vitest';
import {figure, type Layer} from '@vesora/core';
import {updateChart} from '../../packages/react/src/chart';

describe('React data updates against the actual shared core', () => {
  it('validates a newly visible streamed line before changing its style or chart theme', async () => {
    const fig = figure(), layers = new Map<string, Layer>();
    const props = {type: 'line' as const, data: [{x: 1, value: 3}, {x: 2, value: 4}], xKey: 'x' as const,
      series: [{key: 'value' as const, visible: false}], streaming: {maxPoints: 4}, hoverMode: 'x' as const};
    try {
      updateChart(fig, layers, props);
      await layers.get('value')!.appendData({x: [0], y: [5]});
      const before = fig.snapshot();
      expect(() => updateChart(fig, layers, {...props, theme: 'dark', series: [{key: 'value', visible: true, color: '#abcdef'}]})).toThrow('increasing');
      expect(fig.snapshot()).toEqual(before);
    } finally {fig.close();}
  });

  it('keeps source versions and buffers unchanged for presentation, visibility and axis label updates', () => {
    const fig = figure(), layers = new Map<string, Layer>();
    let readsAllowed = true;
    const rows = [1, 2].map(x => ({get x() {if (!readsAllowed) throw new Error('Presentation reread source rows'); return x;}, get value() {if (!readsAllowed) throw new Error('Presentation reread source rows'); return x * 5;}}));
    const props = {type: 'line' as const, data: rows, xKey: 'x' as const, series: [{key: 'value' as const}]};
    try {
      updateChart(fig, layers, props);
      const sources = fig.snapshot().sources;
      const buffers = sources.map(source => fig.registry.get(source.id).values);
      readsAllowed = false;
      fig.setView({xDomain: [1.2, 1.8]});
      updateChart(fig, layers, {...props, title: 'Renamed', theme: 'dark', height: 450, xAxis: {label: 'Time'}, series: [{key: 'value', color: '#abcdef', label: 'Result', width: 4}]}, {value: false});
      expect(fig.snapshot().sources).toEqual(sources);
      expect(fig.snapshot().sources.map(source => fig.registry.get(source.id).values)).toEqual(buffers);
      expect(fig.spec.view).toMatchObject({xDomain: [1.2, 1.8], xLabel: 'Time'});
      expect(layers.get('value')!.spec.visible).toBe(false);
      const before = fig.snapshot();
      expect(() => updateChart(fig, layers, {...props, series: [{key: 'value', opacity: 2}]})).toThrow('opacity');
      expect(fig.snapshot()).toEqual(before);
    } finally {fig.close();}
  });

  it('keeps stable line and band identities, underlay order and visibility across band changes', () => {
    const fig = figure(), layers = new Map<string, Layer>(), bands = new Map<string, Layer>();
    const rows = [{x: 1, value: 5, lower: 3, upper: 7}, {x: 2, value: 8, lower: 6, upper: 10}];
    const base = {type: 'line' as const, data: rows, xKey: 'x' as const, series: [{key: 'value' as const}]};
    const bandSeries = [{key: 'value' as const, band: {lowerKey: 'lower' as const, upperKey: 'upper' as const}}];
    try {
      updateChart(fig, layers, base, {}, bands);
      const lineId = layers.get('value')!.id;
      fig.setView({xDomain: [1.1, 1.8]});
      updateChart(fig, layers, {...base, series: bandSeries}, {}, bands);
      const bandId = bands.get('value')!.id;
      expect(layers.get('value')!.id).toBe(lineId);
      expect(fig.spec.layers.map(layer => layer.id)).toEqual([bandId, lineId]);
      expect(bands.get('value')!.spec.style).toMatchObject({color: layers.get('value')!.spec.style.color, opacity: .18});
      expect(fig.spec.view.xDomain).toEqual([1.1, 1.8]);
      updateChart(fig, layers, {...base, series: [{...bandSeries[0], color: '#b45309'}], data: rows.map(row => ({...row, upper: row.upper + 2}))}, {value: false}, bands);
      expect(bands.get('value')!.id).toBe(bandId);
      expect(layers.get('value')!.id).toBe(lineId);
      expect(fig.spec.layers.every(layer => !layer.visible)).toBe(true);
      expect(bands.get('value')!.spec.style.color).toBe('#b45309');
      expect([...fig.registry.get(bands.get('value')!.spec.data.upper).values]).toEqual([9, 12]);
      updateChart(fig, layers, base, {}, bands);
      expect(bands.size).toBe(0);
      expect(fig.spec.layers.map(layer => layer.id)).toEqual([lineId]);
      updateChart(fig, layers, {...base, series: bandSeries}, {}, bands);
      updateChart(fig, layers, {...base, series: []}, {}, bands);
      expect(layers.size).toBe(0); expect(bands.size).toBe(0); expect(fig.spec.layers).toHaveLength(0);
    } finally {fig.close();}
  });

  it('validates every band before mutating any existing data, theme or hover settings', () => {
    const fig = figure(), layers = new Map<string, Layer>(), bands = new Map<string, Layer>();
    const rows = [{x: 1, a: 5, loA: 3, hiA: 7, b: 9, loB: 8, hiB: 10}, {x: 2, a: 6, loA: 4, hiA: 8, b: 10, loB: 9, hiB: 11}];
    const series = [{key: 'a' as const, band: {lowerKey: 'loA' as const, upperKey: 'hiA' as const}}, {key: 'b' as const, band: {lowerKey: 'loB' as const, upperKey: 'hiB' as const}}];
    const props = {type: 'line' as const, xKey: 'x' as const, data: rows, series, hoverMode: 'x' as const};
    try {
      updateChart(fig, layers, props, {}, bands);
      const before = fig.snapshot(), arrays = before.sources.map(source => [...fig.registry.get(source.id).values]);
      expect(() => updateChart(fig, layers, {...props, theme: 'dark', hoverMode: 'nearest', data: rows.map(row => ({...row, a: row.a + 2, loB: 12}))}, {}, bands)).toThrow('lower');
      expect(fig.snapshot()).toEqual(before);
      expect(before.sources.map(source => [...fig.registry.get(source.id).values])).toEqual(arrays);
      expect(() => updateChart(fig, layers, {...props, data: [rows[1], rows[0]]}, {}, bands)).toThrow();
      expect(fig.snapshot()).toEqual(before);
      expect(() => updateChart(fig, layers, {...props, series: [series[0], {...series[1], band: {...series[1].band, opacity: 2}}]}, {}, bands)).toThrow('opacity');
      expect(fig.snapshot()).toEqual(before);
    } finally {fig.close();}
  });

  it('supports time-position bands, preserves null bound gaps, and opts x hover in explicitly', () => {
    const fig = figure(), layers = new Map<string, Layer>(), bands = new Map<string, Layer>();
    const start = Date.UTC(2026, 9, 1), day = 86_400_000;
    const rows = [{date: new Date(start), value: 5, lower: 3, upper: 7}, {date: new Date(start + day), value: 8, lower: null, upper: 10}];
    const props = {type: 'line' as const, data: rows, xKey: 'date' as const, xAxis: {type: 'time' as const}, series: [{key: 'value' as const, band: {lowerKey: 'lower' as const, upperKey: 'upper' as const}}]};
    try {
      updateChart(fig, layers, props, {}, bands);
      const band = bands.get('value')!;
      expect([...fig.registry.get(band.spec.data.x).values]).toEqual([start, start + day]);
      expect(Number.isNaN(fig.registry.get(band.spec.data.lower).values[1])).toBe(true);
      updateChart(fig, layers, {...props, hoverMode: 'x'}, {}, bands);
      expect(fig.spec.hoverMode).toBe('x');
      const before = fig.snapshot();
      expect(() => updateChart(fig, layers, {...props, type: 'scatter'}, {}, bands)).toThrow('only on line');
      expect(fig.snapshot()).toEqual(before);
    } finally {fig.close();}
  });

  it('rejects invalid x-hover data before mutation while legacy lines retain their input order', () => {
    const fig = figure(), layers = new Map<string, Layer>();
    const props = {type: 'line' as const, data: [{x: 2, value: 5}, {x: 1, value: 8}], xKey: 'x' as const, series: [{key: 'value' as const}]};
    try {
      updateChart(fig, layers, props);
      const before = fig.snapshot();
      expect(() => updateChart(fig, layers, {...props, hoverMode: 'x'})).toThrow();
      expect(fig.snapshot()).toEqual(before);
      expect([...fig.registry.get(layers.get('value')!.spec.data.x).values]).toEqual([2, 1]);
    } finally {fig.close();}
  });

  it('changes large linear coordinates to valid time data without validating the old data as dates', () => {
    const fig = figure(), layers = new Map<string, Layer>();
    try {
      updateChart(fig, layers, {type: 'line', data: [{time: 9e15, value: 1}], xKey: 'time', series: [{key: 'value'}]});
      const id = layers.get('value')!.id;
      fig.setView({xDomain: [8.9e15, 9.1e15]});
      const timestamp = Date.UTC(2026, 9, 12);
      updateChart(fig, layers, {type: 'line', data: [{time: timestamp, value: 2}], xKey: 'time', series: [{key: 'value'}], xAxis: {type: 'time'}});
      expect(layers.get('value')!.id).toBe(id);
      expect(fig.spec.view.xScale).toBe('time');
      expect(fig.spec.view.xDomain).toBeUndefined();
      expect([...fig.registry.get(fig.spec.layers[0].data.x).values]).toEqual([timestamp]);
    } finally {fig.close();}
  });

  it('rejects an invalid second date series before changing either original series or scene', () => {
    const fig = figure(), layers = new Map<string, Layer>();
    try {
      updateChart(fig, layers, {type: 'line', data: [{x: 1, first: 10, second: 20}], xKey: 'x', series: [{key: 'first'}, {key: 'second'}]});
      const before = fig.snapshot();
      const values = before.sources.map(source => [...fig.registry.get(source.id).values]);
      expect(() => updateChart(fig, layers, {type: 'line', data: [{x: 1, first: Date.UTC(2026, 9, 12), second: 9e15}], xKey: 'x', series: [{key: 'first'}, {key: 'second'}], theme: 'dark', yAxis: {format: 'date'}})).toThrow('Date range');
      expect(fig.snapshot()).toEqual(before);
      expect(before.sources.map(source => [...fig.registry.get(source.id).values])).toEqual(values);
    } finally {fig.close();}
  });

  it('uses horizontal physical axes and infers visible time-bar widths, including Date inputs', () => {
    const fig = figure(), layers = new Map<string, Layer>();
    try {
      const day = 86_400_000, first = Date.UTC(2026, 9, 1);
      const props = {type: 'bar' as const, orientation: 'horizontal' as const, data: [{date: new Date(first), revenue: 10}, {date: new Date(first + day), revenue: 20}], xKey: 'date' as const, series: [{key: 'revenue' as const}], xAxis: {format: 'currency' as const, currency: 'TRY'}, yAxis: {type: 'time' as const}};
      updateChart(fig, layers, props);
      expect(fig.spec.view.xFormat).toMatchObject({kind: 'currency', currency: 'TRY'});
      expect(fig.spec.view.yScale).toBe('time');
      expect(fig.spec.view.yFormat).toMatchObject({kind: 'date', timeZone: 'UTC'});
      expect(fig.spec.layers[0].options).toMatchObject({orientation: 'horizontal', barWidth: .8 * day});
      expect([...fig.registry.get(fig.spec.layers[0].data.y).values]).toEqual([first, first + day]);
      const id = layers.get('revenue')!.id;
      updateChart(fig, layers, {...props, barWidth: day / 2});
      expect(layers.get('revenue')!.id).toBe(id);
      expect(fig.spec.layers[0].options).toMatchObject({barWidth: day / 2});
    } finally {fig.close();}
  });

  it('preserves existing category identities while rejecting duplicate bars before any changes', () => {
    const fig = figure(), layers = new Map<string, Layer>();
    try {
      const props = {type: 'bar' as const, data: [{plan: 'Starter', count: 10}, {plan: 'Pro', count: 20}], xKey: 'plan' as const, series: [{key: 'count' as const}]};
      updateChart(fig, layers, props);
      updateChart(fig, layers, {...props, data: [{plan: 'Pro', count: 30}, {plan: 'Business', count: 40}]});
      expect(fig.spec.categories?.['x:main']).toEqual(['Starter', 'Pro', 'Business']);
      expect([...fig.registry.get(fig.spec.layers[0].data.x).values]).toEqual([1, 2]);
      const before = fig.snapshot();
      expect(() => updateChart(fig, layers, {...props, data: [{plan: 'Business', count: 10}, {plan: 'Business', count: 20}]})).toThrow('unique');
      expect(fig.snapshot()).toEqual(before);
    } finally {fig.close();}
  });
});
