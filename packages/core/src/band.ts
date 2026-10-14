import type {BandResult, FillBetweenOptions, NumericArray, Query} from './types';
import {normalize} from './scales';
import {validateQuery} from './planning';
import {validateInspectionX} from './inspection';

export function validateBandStyle(style: FillBetweenOptions): void {
  for (const key of Object.keys(style)) if (!['color', 'opacity', 'label'].includes(key)) throw new TypeError(`Unsupported band style ${key}`);
}

export function validateBandData(values: Record<string, NumericArray>): void {
  const {x, lower, upper} = values;
  if (Object.keys(values).length !== 3 || !x || !lower || !upper) throw new TypeError('Band data requires exactly x, lower and upper');
  if (x.length !== lower.length || x.length !== upper.length) throw new RangeError('Band arrays must have equal lengths');
  validateInspectionX(x);
  for (let i = 0; i < x.length; i++) if (Number.isFinite(lower[i]) && Number.isFinite(upper[i]) && lower[i] > upper[i]) throw new RangeError('Band lower must not exceed upper');
}

/** Preserve paired bounds and source order; only whole offscreen intervals are omitted. */
export function* bandSteps(x: NumericArray, lower: NumericArray, upper: NumericArray, query: Query): Generator<void, BandResult> {
  validateQuery(query);
  if (x.length !== lower.length || x.length !== upper.length || x.length > 0xffff_ffff) throw new RangeError('Band arrays must have equal supported lengths');
  const segments: Uint32Array[] = [];
  let segment: number[] = [], valid = 0, visible = 0, rendered = 0;
  let previous = -1, previousX = NaN, previousLow = NaN, previousHigh = NaN;
  const flush = () => {if (segment.length > 1) {segments.push(Uint32Array.from(segment)); rendered += segment.length;} segment = [];};
  for (let start = 0; start < x.length; start += 65_536) {
    for (let i = start, end = Math.min(start + 65_536, x.length); i < end; i++) {
      if (!Number.isFinite(x[i]) || i > 0 && x[i] <= x[i - 1]) throw new RangeError('Band x coordinates must be finite and strictly increasing');
      if (Number.isFinite(lower[i]) && Number.isFinite(upper[i]) && lower[i] > upper[i]) throw new RangeError('Band lower must not exceed upper');
      const px = normalize(x[i], query.bounds.x, query.xScale), low = normalize(lower[i], query.bounds.y, query.yScale), high = normalize(upper[i], query.bounds.y, query.yScale);
      if (![px, low, high].every(Number.isFinite)) {flush(); previous = -1; continue;}
      valid++;
      if (px >= 0 && px <= 1 && high >= 0 && low <= 1) visible++;
      if (previous >= 0 && px >= 0 && previousX <= 1 && Math.max(previousHigh, high) >= 0 && Math.min(previousLow, low) <= 1) {
        if (!segment.length) segment.push(previous);
        segment.push(i);
        if (rendered + segment.length > query.pointBudget) throw new RangeError('Exact band exceeds the vertex budget. Increase pointBudget or query a smaller viewport.');
      } else flush();
      previous = i; previousX = px; previousLow = low; previousHigh = high;
    }
    yield;
  }
  flush();
  return {kind: 'band', segments, info: {kind: 'band', total: x.length, visible, rendered, valid, omitted: x.length - valid, exact: true, method: 'paired source bounds; gaps and crossing intervals preserved'}};
}

export function planBand(x: NumericArray, lower: NumericArray, upper: NumericArray, query: Query): BandResult {
  const steps = bandSteps(x, lower, upper, query);
  while (true) {const next = steps.next(); if (next.done) return next.value;}
}
