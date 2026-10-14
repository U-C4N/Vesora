import {describe, expect, it} from 'vitest';
import {Figure, defaultView, subplots} from '../../packages/core/src/figure';
import {FigureView} from '../../packages/core/src/view';
import {buildGeometry} from '../../packages/core/src/geometry';
import {planBand} from '../../packages/core/src/band';
import type {Bounds, Query, ViewSpec} from '../../packages/core/src/types';

function geometry(x: number[], lower: number[], upper: number[], bounds: Bounds = {x: [-1, 1], y: [-1, 1]}, view: ViewSpec = defaultView()) {
  const figure = new Figure(), layer = figure.fillBetween(x, lower, upper, {color: '#3366ff'});
  const query: Query = {bounds, width: 400, height: 300, xScale: view.xScale, yScale: view.yScale, pointBudget: 10000, mode: 'auto'};
  const values = (channel: string) => figure.registry.get(layer.spec.data[channel]).values;
  const plan = planBand(values('x'), values('lower'), values('upper'), query);
  const result = buildGeometry(layer.spec, figure.registry, bounds, [0, 1], view, 400, 300, plan);
  figure.close(); return result;
}
function area(positions: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) sum += Math.abs((positions[i + 3] - positions[i]) * (positions[i + 7] - positions[i + 1]) - (positions[i + 6] - positions[i]) * (positions[i + 4] - positions[i + 1])) / 2;
  return sum;
}
// Exercise the real domain implementation without initializing DOM or a GPU.
function domainReader(figure: Figure): any {
  const view = Object.create(FigureView.prototype); view.figure = figure; view.extents = new Map(); return view;
}

describe('paired band geometry', () => {
  it('clips crossing envelopes to the viewport while retaining the correct filled area', () => {
    const rectangle = geometry([-2, 2], [-.5, -.5], [.5, .5]);
    expect(rectangle.primitive).toBe('triangles'); expect(area(rectangle.positions)).toBeCloseTo(2, 6);
    expect([...rectangle.positions].every(value => Number.isFinite(value) && value >= -1 && value <= 1)).toBe(true);
    expect(rectangle.colors[3]).toBeCloseTo(.18, 6);
    const diagonal = geometry([-1, 1], [-2, 0], [0, 2]); expect(area(diagonal.positions)).toBeCloseTo(3, 6);
  });

  it('does not join triangles across missing rows or logarithmically invalid intervals', () => {
    const broken = geometry([0, 1, 2, 3, 4], [0, 0, NaN, 0, 0], [1, 1, 1, 1, 1], {x: [0, 4], y: [0, 1]});
    expect(area(broken.positions)).toBeCloseTo(2, 6);
    for (let i = 0; i < broken.positions.length; i += 9) {
      const xs = [broken.positions[i], broken.positions[i + 3], broken.positions[i + 6]];
      expect(Math.max(...xs) <= -.5 || Math.min(...xs) >= .5).toBe(true);
    }
    const logView = {...defaultView(), xScale: 'log' as const, yScale: 'log' as const};
    const valid = geometry([1, 10], [1, 10], [10, 100], {x: [1, 10], y: [1, 100]}, logView);
    expect(area(valid.positions)).toBeCloseTo(2, 6);
    const invalid = geometry([1, 10], [0, 10], [10, 100], {x: [1, 10], y: [1, 100]}, logView);
    expect(invalid.positions).toHaveLength(0);
  });

  it('preserves high-offset coordinate differences before conversion to float32', () => {
    const x = [1e12, 1e12 + .01], shape = geometry(x, [0, 0], [1, 1], {x: [x[0], x[1]], y: [0, 1]});
    expect(area(shape.positions)).toBeCloseTo(4, 6);
    expect(new Set(Array.from(shape.positions).filter((_, i) => i % 3 === 0))).toEqual(new Set([-1, 1]));
  });

  it('retains the sloped boundary when enormous offscreen endpoints cross a tiny viewport', () => {
    const shape = geometry([-1e20, 1e20], [-1e20, 1e20], [-1e20 + 1e10, 1e20 + 1e10]);
    const pairs = Array.from({length: shape.positions.length / 3}, (_, i) => [shape.positions[i * 3], shape.positions[i * 3 + 1]]);
    expect(pairs).toContainEqual([-1, -1]); expect(pairs).toContainEqual([1, 1]);
    expect(area(shape.positions)).toBeCloseTo(2, 6);
  });
});

describe('band-aware automatic and shared domains', () => {
  it('includes both bounds, excludes invalid pairs and responds to updates and visibility', () => {
    const figure = new Figure(), band = figure.fillBetween([0, 1, 2], [-10, NaN, -20], [30, 1000, 40]);
    const reader = domainReader(figure);
    expect(reader.sourceExtent(band.spec, 'y', 'linear')).toEqual([-20, 40]);
    const domain = reader.domain('y', 'main', figure.spec.view, new Map());
    expect(domain[0]).toBeLessThan(-20); expect(domain[1]).toBeGreaterThan(40);
    band.setData({upper: [50, 1000, 60]}); expect(reader.sourceExtent(band.spec, 'y', 'linear')).toEqual([-20, 60]);
    band.setVisible(false); expect(reader.domain('y', 'main', figure.spec.view, new Map())).toEqual([0, 1]); figure.close();
  });

  it('unions shared y bounds once and omits entire log-invalid rows', () => {
    const figure = subplots({rows: 1, cols: 2, shareY: true});
    const first = figure.fillBetween([1, 2, 3], [1, 0, 2], [4, 10000, 5]);
    figure.panel(0, 1).fillBetween([1, 2], [3, 4], [8, 9]); figure.setView({yScale: 'log'});
    const reader = domainReader(figure);
    expect(reader.sourceExtent(first.spec, 'y', 'log')).toEqual([1, 5]);
    const main = reader.domain('y', 'main', figure.spec.view, new Map());
    expect(main).toEqual(reader.domain('y', 'panel-0-1', figure.panel(0, 1).view, new Map()));
    expect(main[0]).toBeGreaterThan(0); expect(main[0]).toBeLessThan(1); expect(main[1]).toBeGreaterThan(9); expect(main[1]).toBeLessThan(10);
    figure.close();
  });
});
