import {figure as createFigure, resolveTheme, validateAxisFormat} from '@vesora/core';
import type {AxisFormat, Figure, Layer, LayerStyle, ViewSpec} from '@vesora/core';
import {axisFormat, prepareData} from './data';
import type {VesoraChartProps} from './types';

/** Validate the whole incoming chart offscreen before changing any live layer. */
export function updateChart<Row extends object>(figure: Figure, layers: Map<string, Layer>, props: VesoraChartProps<Row>, visibility: Record<string, boolean> = {}) {
  const {type, data, xKey, series, theme = 'light', height = 300, title = '', xAxis, yAxis, barMode = 'group', orientation = 'vertical'} = props;
  const horizontal = type === 'bar' && orientation === 'horizontal';
  const positionAxis = horizontal ? yAxis : xAxis;
  const prepared = prepareData(data, xKey, series, positionAxis, horizontal ? xAxis : yAxis);
  const requestedX = axisFormat(xAxis), requestedY = axisFormat(yAxis);
  const xFormat = requestedX ? validateAxisFormat(requestedX) : null;
  const yFormat = requestedY ? validateAxisFormat(requestedY) : null;
  const tokens = resolveTheme(theme);
  if (!Number.isFinite(height) || height < 180) throw new RangeError('Chart height must be at least 180 CSS pixels.');
  const styles: LayerStyle[] = series.map((item, index) => {
    const style = {label: item.label ?? item.key, color: item.color ?? tokens.palette[index % tokens.palette.length], width: item.width ?? 2, size: item.size ?? 5, opacity: item.opacity ?? 1};
    resolveTheme({palette: [style.color]});
    if (![style.width, style.size].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1) throw new RangeError('Series width/size must be positive; opacity must be between zero and one.');
    return style;
  });
  let barWidth = props.barWidth ?? .8;
  if (type === 'bar' && props.barWidth === undefined && positionAxis?.type === 'time') {
    const positions = [...new Set(Array.from(prepared.x as ArrayLike<number>))].sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < positions.length; i++) gap = Math.min(gap, positions[i] - positions[i - 1]);
    barWidth = .8 * (Number.isFinite(gap) ? gap : 86_400_000);
  }
  if (!Number.isFinite(barWidth) || barWidth <= 0) throw new RangeError('Bar width must be finite and positive.');

  const add = (target: Figure, index: number): Layer => {
    const item = series[index], values = prepared.values.get(item.key)!, style = styles[index];
    return type === 'line' ? target.plot(prepared.x, values, style)
      : type === 'scatter' ? target.scatter(prepared.x, values, style)
      : horizontal ? target.barh(prepared.x, values, {...style, left: 0, barWidth})
      : target.bar(prepared.x, values, {...style, bottom: 0, barWidth});
  };
  const setAxes = (target: Figure, view?: ViewSpec) => {
    const sameDateSemantics = (axis: 'x' | 'y', format: AxisFormat | null, scale: string) => {
      const prior = view?.[`${axis}Scale`] === 'time' || view?.[`${axis}Format`]?.kind === 'date';
      return prior === (scale === 'time' || format?.kind === 'date');
    };
    const xScale = xAxis?.type ?? 'linear', yScale = yAxis?.type ?? 'linear';
    target.restoreView({...target.spec.view,
      xScale, yScale, xLabel: xAxis?.label ?? '', yLabel: yAxis?.label ?? '', xFormat: undefined, yFormat: undefined,
      xDomain: xAxis?.domain ?? (view?.xScale === xScale && sameDateSemantics('x', xFormat, xScale) ? view.xDomain : undefined),
      yDomain: yAxis?.domain ?? (view?.yScale === yScale && sameDateSemantics('y', yFormat, yScale) ? view.yDomain : undefined),
    });
    target.setAxisFormat('x', xFormat); target.setAxisFormat('y', yFormat);
  };

  const candidate = createFigure({height});
  try {
    for (const axis of ['x', 'y'] as const) {
      const categories = figure.spec.categories?.[`${axis}:main`];
      if (categories) candidate.setCategories(axis, categories);
    }
    candidate.setTheme(theme); candidate.setTitle(title);
    // Validate the final axis/data combination, including bar duplicates and
    // Date limits in every series, without starting a renderer or worker.
    setAxes(candidate);
    if (type === 'bar') candidate.setBarMode(barMode);
    for (let index = 0; index < series.length; index++) add(candidate, index).setVisible(series[index].visible ?? visibility[series[index].key] ?? true);
  } finally {candidate.close();}

  const axisName = horizontal ? 'y' : 'x';
  const previousCategories = figure.spec.categories?.[`${axisName}:main`];
  if (layers.size && prepared.x.length && (previousCategories !== undefined) !== (typeof prepared.x[0] === 'string')) throw new TypeError('Keep the x column numeric/category semantics consistent between updates; change xKey or remount to change its schema.');
  const view = structuredClone(figure.spec.view);
  // The old data may not be valid under the incoming format/scale. Remove
  // those constraints first, replace all data, then restore the final axes.
  figure.setAxisFormat('x', null); figure.setAxisFormat('y', null);
  figure.restoreView({...view, xScale: 'linear', yScale: 'linear', xDomain: undefined, yDomain: undefined, xFormat: undefined, yFormat: undefined});
  const keys = new Set(series.map(item => item.key));
  for (const [key, layer] of layers) if (!keys.has(key as Extract<keyof Row, string>)) {layer.remove(); layers.delete(key);}
  for (const [index, item] of series.entries()) {
    let layer = layers.get(item.key);
    if (layer) {
      const values = prepared.values.get(item.key)!;
      if (horizontal) layer.setData({y: prepared.x, x: values, left: 0});
      else layer.setData({x: prepared.x, y: values, ...(type === 'bar' ? {bottom: 0} : {})});
      if (type === 'bar') layer.setOptions({barWidth});
      layer.setStyle(styles[index]);
    } else {layer = add(figure, index); layers.set(item.key, layer);}
    layer.setVisible(item.visible ?? visibility[item.key] ?? true);
  }
  figure.setTheme(theme); figure.setSize({height}); figure.setTitle(title);
  if (type === 'bar') figure.setBarMode(barMode);
  setAxes(figure, view);
  return {empty: prepared.empty};
}
