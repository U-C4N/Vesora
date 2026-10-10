import {parseColor} from './color';
import {normalize} from './scales';
import type {Geometry} from './renderer';
import type {Bounds, LayerStyle, ViewSpec} from './types';
import type {PreparedStatistics} from './statistics';

/** Triangle-only statistics rendering reuses the existing renderer and PNG path. */
export function buildStatisticsGeometry(prepared: PreparedStatistics, bounds: Bounds, view: ViewSpec, width: number, height: number, style: LayerStyle): Geometry {
  if (view.xScale !== 'linear' || view.yScale !== 'linear') throw new Error('Statistical layers require linear value axes');
  const budget = 2_000_000;
  let count = 0, capacity = 1024, positions = new Float32Array(capacity * 3), colors = new Float32Array(capacity * 4);
  const fill = parseColor(style.color, style.opacity ?? 1);
  const outline = fill.map((component, i) => i === 3 ? component : component * .55);
  const push = (x: number, y: number, color: number[]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Statistical projection exceeds finite coordinates');
    if (count >= budget) throw new RangeError('Layer exceeds the renderer geometry budget of 2,000,000 vertices; narrow the viewport or disable boxplot fliers');
    if (count === capacity) {
      capacity = Math.min(budget, capacity * 2);
      const p = new Float32Array(capacity * 3), c = new Float32Array(capacity * 4); p.set(positions); c.set(colors); positions = p; colors = c;
    }
    positions[count * 3] = x; positions[count * 3 + 1] = y; positions[count * 3 + 2] = 0;
    colors.set(color, count * 4); count++;
  };
  const quad = (x0: number, y0: number, x1: number, y1: number, color: number[]) => {
    push(x0, y0, color); push(x1, y0, color); push(x1, y1, color);
    push(x0, y0, color); push(x1, y1, color); push(x0, y1, color);
  };
  const nx = (x: number) => normalize(x, bounds.x, 'linear') * 2 - 1;
  const ny = (y: number) => normalize(y, bounds.y, 'linear') * 2 - 1;
  const segment = (x0: number, y0: number, x1: number, y1: number, color: number[]) => {
    // Whiskers, caps, medians and box outlines are axis-aligned: clipping the
    // varying axis in float64 avoids huge offscreen normalized coordinates.
    if (x0 === x1) {
      if (x0 < bounds.x[0] || x0 > bounds.x[1]) return;
      const lo = Math.max(Math.min(y0, y1), bounds.y[0]), hi = Math.min(Math.max(y0, y1), bounds.y[1]);
      if (lo > hi) return;
      const x = nx(x0), half = (style.width ?? 1.5) / width;
      quad(x - half, ny(lo), x + half, ny(hi), color);
    } else if (y0 === y1) {
      if (y0 < bounds.y[0] || y0 > bounds.y[1]) return;
      const lo = Math.max(Math.min(x0, x1), bounds.x[0]), hi = Math.min(Math.max(x0, x1), bounds.x[1]);
      if (lo > hi) return;
      const y = ny(y0), half = (style.width ?? 1.5) / height;
      quad(nx(lo), y - half, nx(hi), y + half, color);
    } else throw new Error('Statistical segments must be axis-aligned');
  };
  for (const mark of prepared.marks) {
    if (mark.kind === 'rect') {
      const left = Math.max(Math.min(mark.x0, mark.x1), bounds.x[0]), right = Math.min(Math.max(mark.x0, mark.x1), bounds.x[1]);
      const bottom = Math.max(Math.min(mark.y0, mark.y1), bounds.y[0]), top = Math.min(Math.max(mark.y0, mark.y1), bounds.y[1]);
      if (left > right || bottom > top) continue;
      if (left < right && bottom < top) quad(nx(left), ny(bottom), nx(right), ny(top), fill);
      if (mark.role === 'box') {
        segment(mark.x0, mark.y0, mark.x1, mark.y0, outline);
        segment(mark.x1, mark.y0, mark.x1, mark.y1, outline);
        segment(mark.x1, mark.y1, mark.x0, mark.y1, outline);
        segment(mark.x0, mark.y1, mark.x0, mark.y0, outline);
      }
    } else if (mark.kind === 'segment') segment(mark.x0, mark.y0, mark.x1, mark.y1, outline);
    else {
      if (mark.x < bounds.x[0] || mark.x > bounds.x[1] || mark.y < bounds.y[0] || mark.y > bounds.y[1]) continue;
      const x = nx(mark.x), y = ny(mark.y), rx = (style.size ?? 5) / width, ry = (style.size ?? 5) / height;
      push(x - rx, y, outline); push(x, y - ry, outline); push(x + rx, y, outline);
      push(x - rx, y, outline); push(x + rx, y, outline); push(x, y + ry, outline);
    }
  }
  return {id: prepared.layerId, primitive: 'triangles', positions: positions.subarray(0, count * 3), colors: colors.subarray(0, count * 4)};
}
