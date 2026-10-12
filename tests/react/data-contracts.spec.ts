import {describe, expect, it} from 'vitest';
import {figure, type Layer} from '@vesora/core';
import {updateChart} from '../../packages/react/src/chart';

describe('React data updates against the actual shared core', () => {
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
