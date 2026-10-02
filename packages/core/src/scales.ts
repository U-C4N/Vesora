import type {Domain, NumericArray, ScaleKind} from './types';

export function transform(value: number, kind: ScaleKind = 'linear'): number {
  return kind === 'log' ? (value > 0 ? Math.log10(value) : NaN) : value;
}

export function validateDomain(domain: Domain, kind: ScaleKind = 'linear'): Domain {
  if (kind !== 'linear' && kind !== 'log') throw new RangeError(`Unsupported scale kind: ${kind}`);
  if (domain.length !== 2 || !domain.every(Number.isFinite) || domain[0] >= domain[1] || (kind === 'log' && domain[0] <= 0)) {
    throw new RangeError(`${kind} scale requires a finite increasing domain${kind === 'log' ? ' with positive values' : ''}.`);
  }
  return domain;
}

export function extent(values: ArrayLike<number> | NumericArray, kind: ScaleKind = 'linear'): Domain {
  let min = Infinity, max = -Infinity;
  for (let start = 0; start < values.length; start += 65_536) {
    for (let i = start, end = Math.min(start + 65_536, values.length); i < end; i++) {
      const value = values[i];
      if (!Number.isFinite(value) || (kind === 'log' && value <= 0)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (min === Infinity) return kind === 'log' ? [1, 10] : [0, 1];
  if (min === max) {
    if (kind === 'log') return [Math.max(Number.MIN_VALUE, min / 2), Math.min(Number.MAX_VALUE, max * 2)];
    const padding = Math.max(Math.abs(min) * 0.05, 1);
    return [Math.max(-Number.MAX_VALUE, min - padding), Math.min(Number.MAX_VALUE, max + padding)];
  }
  return [min, max];
}

/** Subtract in float64 before converting coordinates for the GPU. */
export function normalize(value: number, domain: Domain, kind: ScaleKind = 'linear'): number {
  if (!Number.isFinite(value) || (kind === 'log' && value <= 0)) return NaN;
  if (kind === 'log') {
    const span = Math.log(domain[1] / domain[0]);
    return Number.isFinite(span) ? Math.log(value / domain[0]) / span : (Math.log(value) - Math.log(domain[0])) / (Math.log(domain[1]) - Math.log(domain[0]));
  }
  const span = domain[1] - domain[0];
  return Number.isFinite(span) ? (value - domain[0]) / span : (value / 2 - domain[0] / 2) / (domain[1] / 2 - domain[0] / 2);
}

export function project(value: number, domain: Domain, range: Domain, kind: ScaleKind = 'linear'): number {
  return range[0] + normalize(value, domain, kind) * (range[1] - range[0]);
}

export function denormalize(t: number, domain: Domain, kind: ScaleKind = 'linear'): number {
  if (t === 0) return domain[0];
  if (t === 1) return domain[1];
  if (kind === 'log') {
    const ratio = domain[1] / domain[0];
    return Number.isFinite(ratio) ? domain[0] * Math.exp(t * Math.log(ratio)) : Math.exp((1 - t) * Math.log(domain[0]) + t * Math.log(domain[1]));
  }
  const span = domain[1] - domain[0];
  return Number.isFinite(span) ? domain[0] + t * span : (1 - t) * domain[0] + t * domain[1];
}

export function invert(pixel: number, domain: Domain, range: Domain, kind: ScaleKind = 'linear'): number {
  return denormalize((pixel - range[0]) / (range[1] - range[0]), domain, kind);
}

export function ticks(domain: Domain, kind: ScaleKind = 'linear', count = 6): number[] {
  validateDomain(domain, kind);
  count = Math.max(2, Math.min(100, Math.floor(count)));
  if (kind === 'log') {
    const first = Math.ceil(Math.log10(domain[0])), last = Math.floor(Math.log10(domain[1]));
    if (last >= first) {
      const step = Math.max(1, Math.ceil((last - first + 1) / count));
      const result: number[] = [];
      for (let power = first; power <= last; power += step) result.push(10 ** power);
      if (result.length >= 2) return result;
    }
    return Array.from({length: count}, (_, i) => denormalize(i / (count - 1), domain, kind));
  }
  const span = domain[1] - domain[0];
  if (!Number.isFinite(span)) return Array.from({length: count}, (_, i) => denormalize(i / (count - 1), domain));
  const rough = span / (count - 1), magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude, step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * magnitude;
  if (!Number.isFinite(step) || step === 0) return [domain[0], domain[1]];
  const first = Math.ceil(domain[0] / step) * step;
  const result: number[] = [];
  for (let i = 0; i < 100; i++) {
    const value = first + i * step;
    if (value > domain[1]) break;
    if (value >= domain[0] && (result.length === 0 || value !== result[result.length - 1])) result.push(Object.is(value, -0) ? 0 : value);
  }
  return result.length >= 2 ? result : [domain[0], domain[1]];
}

export function formatTick(value: number, span?: number): string {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (span !== undefined && Number.isFinite(span) && span !== 0) {
    const digits = Math.min(17, Math.max(3, Math.ceil(Math.log10(magnitude) - Math.log10(Math.abs(span))) + 3));
    return magnitude >= 1e5 || magnitude < 1e-3
      ? value.toExponential(digits - 1).replace(/\.?(0+)(e)/, '$2')
      : Number(value.toPrecision(digits)).toString();
  }
  return magnitude >= 1e5 || magnitude < 1e-3 ? value.toExponential(3).replace(/\.?(0+)(e)/, '$2') : Number(value.toPrecision(6)).toString();
}
