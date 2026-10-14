import type {NumericArray, ScaleKind} from './types';

export interface XInspectionIndex {x: NumericArray; valid: Uint8Array; xScale: ScaleKind}

/** Source x coordinates, rather than rendered/decimated vertices, define inspection. */
export function validateInspectionX(x: NumericArray): void {
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || i > 0 && x[i] <= x[i - 1]) throw new RangeError('X inspection requires finite, strictly increasing x coordinates');
  }
}

export function buildXInspectionIndex(x: NumericArray, channels: {y: NumericArray}, scales: {xScale: ScaleKind; yScale: ScaleKind}): XInspectionIndex {
  validateInspectionX(x);
  if (channels.y.length !== x.length) throw new RangeError('Inspection coordinates must have equal lengths');
  const valid = new Uint8Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const y = channels.y[i];
    valid[i] = Number.isFinite(y) && (scales.xScale !== 'log' || x[i] > 0) && (scales.yScale !== 'log' || y > 0)
      && (scales.xScale !== 'time' || Math.abs(x[i]) <= 8.64e15) && (scales.yScale !== 'time' || Math.abs(y) <= 8.64e15) ? 1 : 0;
  }
  return {x, valid, xScale: scales.xScale};
}

/** No extrapolation or bridging a missing/log-invalid row; ties use the smaller x. */
export function nearestWithinRun(index: XInspectionIndex, target: number): number | null {
  const {x, valid, xScale} = index;
  if (!Number.isFinite(target) || !x.length || target < x[0] || target > x[x.length - 1] || xScale === 'log' && target <= 0) return null;
  let lo = 0, hi = x.length;
  while (lo < hi) {const mid = lo + Math.floor((hi - lo) / 2); if (x[mid] < target) lo = mid + 1; else hi = mid;}
  if (lo < x.length && x[lo] === target) return valid[lo] ? lo : null;
  if (lo === 0 || lo === x.length || !valid[lo - 1] || !valid[lo]) return null;
  // Log axes compare screen-space distance. Ratio logs retain precision near a tick.
  const logDistance = (a:number,b:number) => Number.isFinite(a / b) ? Math.log(a / b) : Math.log(a) - Math.log(b);
  const difference = (a:number,b:number) => Number.isFinite(a - b) ? a - b : a / 2 - b / 2;
  let left = xScale === 'log' ? logDistance(target, x[lo - 1]) : difference(target, x[lo - 1]);
  let right = xScale === 'log' ? logDistance(x[lo], target) : difference(x[lo], target);
  // Use the same scale for both distances when one finite-domain subtraction overflows.
  if(xScale!=='log'&&(!Number.isFinite(target-x[lo-1])||!Number.isFinite(x[lo]-target))){left=target/2-x[lo-1]/2;right=x[lo]/2-target/2;}
  const tolerance = xScale === 'log' ? Number.EPSILON * 4 * Math.max(Math.abs(left), Math.abs(right)) : 0;
  return left <= right + tolerance ? lo - 1 : lo;
}
