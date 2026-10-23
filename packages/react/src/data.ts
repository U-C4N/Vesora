import {formatValue as coreFormatValue} from '@vesora/core/runtime';
import type {AxisFormat, AxisSeries} from '@vesora/core';
import type {ChartAxis, ChartSeries} from './types';

export function axisFormat(axis?: ChartAxis): AxisFormat | null {
  const requested = axis?.format;
  if (typeof requested === 'object') return requested;
  const kind = requested ?? (axis?.type === 'time' ? 'date' : undefined);
  if (!kind) return null;
  if (kind === 'date') return {kind, locale: axis?.locale, timeZone: axis?.timeZone ?? 'UTC', options: axis?.options as Intl.DateTimeFormatOptions | undefined};
  if (kind === 'currency') {
    if (!axis?.currency) throw new TypeError('A currency axis requires a currency code, for example TRY.');
    return {kind, currency: axis.currency, locale: axis.locale, options: axis.options as Intl.NumberFormatOptions | undefined};
  }
  return {kind, locale: axis?.locale, options: axis?.options as Intl.NumberFormatOptions | undefined};
}

export function formatValue(value: unknown, axis?: ChartAxis): string {
  if (typeof value === 'string') return value;
  const numeric = value instanceof Date ? value.getTime() : value;
  if (typeof numeric !== 'number' || !Number.isFinite(numeric)) return '—';
  const format = axisFormat(axis);
  return coreFormatValue(numeric, format ?? undefined);
}

export function prepareData<Row extends object>(data: readonly Row[], xKey: Extract<keyof Row, string>, series: readonly ChartSeries<Row>[], xAxis?: ChartAxis, yAxis?: ChartAxis) {
  if (!Array.isArray(data)) throw new TypeError('Chart data must be a row array.');
  const keys = new Set<string>();
  for (const item of series) {
    if (!item.key || keys.has(item.key)) throw new TypeError('Series keys must be nonempty and unique.');
    keys.add(item.key);
  }
  const dates = (axis?: ChartAxis) => axis?.type === 'time' || axis?.format === 'date' || typeof axis?.format === 'object' && axis.format.kind === 'date';
  let category = false, numeric = false;
  const x = data.map((row, index) => {
    const value = row[xKey];
    if (dates(xAxis)) {
      const timestamp = value instanceof Date ? value.getTime() : value;
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) throw new TypeError(`Row ${index}: a time axis requires epoch milliseconds in the Date range or a valid Date.`);
      numeric = true;
      return timestamp;
    }
    if (typeof value === 'string') {category = true; return value;}
    if (typeof value === 'number' && Number.isFinite(value)) {numeric = true; return value;}
    throw new TypeError(`Row ${index}: ${xKey} must be a finite number or category string.`);
  });
  if (category && numeric) throw new TypeError('The x column cannot mix numbers and category strings.');
  let hasValues = false;
  const values = new Map<string, Float64Array>();
  const bands = new Map<string, {lower: Float64Array; upper: Float64Array}>();
  const numericColumn = (key: Extract<keyof Row, string>) => Float64Array.from(data, (row, index) => {
    const value = row[key];
    if (value === null || value === undefined) return NaN;
    if (typeof value !== 'number') throw new TypeError(`Row ${index}: ${key} must be a number or null.`);
    if (dates(yAxis) && Number.isFinite(value) && Math.abs(value) > 8.64e15) throw new RangeError(`Row ${index}: ${key} exceeds the Date range.`);
    return value;
  });
  for (const item of series) {
    const y = numericColumn(item.key);
    if (y.some(Number.isFinite)) hasValues = true;
    values.set(item.key, y);
    if (item.band) {
      if (!item.band.lowerKey || !item.band.upperKey) throw new TypeError('Band lowerKey and upperKey must be nonempty column keys.');
      const lower = numericColumn(item.band.lowerKey), upper = numericColumn(item.band.upperKey);
      for (let index = 0; index < lower.length; index++) {
        if (!Number.isFinite(lower[index]) || !Number.isFinite(upper[index])) continue;
        if (lower[index] > upper[index]) throw new RangeError(`Row ${index}: band lower value must not exceed its upper value.`);
        hasValues = true;
      }
      bands.set(item.key, {lower, upper});
    }
  }
  return {x: x as AxisSeries, values, bands, empty: !data.length || !series.length || !hasValues};
}
