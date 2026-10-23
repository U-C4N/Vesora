import {figure as createFigure, resolveTheme, validateAxisFormat} from '@vesora/core/runtime';
import type {AxisFormat, Figure, Layer, LayerStyle, ViewSpec} from '@vesora/core';
import {axisFormat, prepareData} from './data';
import type {VesoraChartProps} from './types';

type Prepared = ReturnType<typeof prepareData>;
const updates = new WeakMap<Figure, {data: readonly object[]; schema: string; axes: string; visibility: string; prepared: Prepared; maxPoints?: number}>();

/** Read retained buffers only when new axis constraints need data validation. */
function retainedData(figure: Figure, layers: Map<string, Layer>, bands: Map<string, Layer>, previous: Prepared, horizontal: boolean): Prepared {
  const first = layers.values().next().value;
  if (!first || !figure.registry) return previous;
  const position = horizontal ? 'y' : 'x', value = horizontal ? 'x' : 'y';
  const coordinates = figure.registry.get(first.spec.data[position]).values;
  const categories = figure.spec.categories?.[`${position}:main`];
  const x = categories ? Array.from(coordinates, index => categories[index]) : coordinates;
  const values = new Map([...layers].map(([key, layer]) => [key, figure.registry.get(layer.spec.data[value]).values as Float64Array]));
  const bounds = new Map([...bands].map(([key, layer]) => [key, {lower: figure.registry.get(layer.spec.data.lower).values as Float64Array, upper: figure.registry.get(layer.spec.data.upper).values as Float64Array}]));
  const hasValues = [...values.values()].some(column => column.some(Number.isFinite))
    || [...bounds.values()].some(band => band.lower.some((lower, index) => Number.isFinite(lower) && Number.isFinite(band.upper[index])));
  return {x, values, bands: bounds, empty: !x.length || !values.size || !hasValues};
}

/** Validate the whole incoming chart offscreen before changing any live layer. */
export function updateChart<Row extends object>(figure: Figure, layers: Map<string, Layer>, props: VesoraChartProps<Row>, visibility: Record<string, boolean> = {}, bands: Map<string, Layer> = new Map(), retainedRows?: readonly Row[]) {
  const {type, data, xKey, series, theme = 'light', height = 300, title = '', xAxis, yAxis, barMode = 'group', orientation = 'vertical', hoverMode = 'nearest'} = props;
  if (type !== 'line' && series.some(item => item.band)) throw new TypeError('Bands are supported only on line charts.');
  if (type !== 'line' && hoverMode === 'x') throw new TypeError('X hover is supported only on line charts.');
  const horizontal = type === 'bar' && orientation === 'horizontal';
  const positionAxis = horizontal ? yAxis : xAxis;
  const previous = updates.get(figure);
  const schema = JSON.stringify([type, orientation, xKey, series.map(item => [item.key, item.band?.lowerKey, item.band?.upperKey]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  const dataChanged = !previous || previous.data !== data || previous.schema !== schema;
  const maxPoints = props.streaming?.maxPoints;
  const streamingChanged = previous?.maxPoints !== maxPoints;
  const visibilityKey = JSON.stringify(series.map(item => [item.key, item.visible ?? visibility[item.key] ?? true]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const visibilityChanged = previous?.visibility !== visibilityKey;
  const axes = JSON.stringify([xAxis?.type, yAxis?.type, axisFormat(xAxis), axisFormat(yAxis), xAxis?.domain, yAxis?.domain, hoverMode, barMode, props.barWidth]);
  const axesChanged = previous?.axes !== axes;
  const prepared = dataChanged ? prepareData(previous?.data === data ? retainedRows ?? data : data, xKey, series, positionAxis, horizontal ? xAxis : yAxis)
    : axesChanged || streamingChanged || visibilityChanged ? retainedData(figure, layers, bands, previous.prepared, horizontal) : previous.prepared;
  if (props.streaming) {
    if (!Number.isSafeInteger(maxPoints) || maxPoints! < 1) throw new RangeError('Streaming maxPoints must be a positive safe integer.');
    if (type === 'bar' || series.some(item => item.band)) throw new TypeError('Streaming supports numeric line/scatter charts without bands.');
    if (prepared.x.length && typeof prepared.x[0] === 'string') throw new TypeError('Streaming requires numeric or time x values.');
  }
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
  const bandStyles = series.map((item, index) => {
    if (!item.band) return undefined;
    const style = {color: item.band.color ?? styles[index].color, opacity: item.band.opacity ?? .18};
    resolveTheme({palette: [style.color!]});
    if (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1) throw new RangeError('Band opacity must be between zero and one.');
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
  const addBand = (target: Figure, index: number): Layer => {
    const values = prepared.bands.get(series[index].key)!;
    return target.fillBetween(prepared.x as ArrayLike<number>, values.lower, values.upper, bandStyles[index]);
  };
  const visible = (index: number) => series[index].visible ?? visibility[series[index].key] ?? true;
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

  if (dataChanged || axesChanged || streamingChanged || visibilityChanged) {
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
      for (let index = 0; index < series.length; index++) if (series[index].band) addBand(candidate, index).setVisible(visible(index));
      for (let index = 0; index < series.length; index++) {
        const layer = add(candidate, index).setVisible(visible(index));
        if (maxPoints !== undefined) layer.enableStreaming({maxPoints});
      }
      if (hoverMode !== 'nearest') candidate.setHoverMode(hoverMode);
    } finally {candidate.close();}
  }

  const axisName = horizontal ? 'y' : 'x';
  const previousCategories = figure.spec.categories?.[`${axisName}:main`];
  if (layers.size && prepared.x.length && (previousCategories !== undefined) !== (typeof prepared.x[0] === 'string')) throw new TypeError('Keep the x column numeric/category semantics consistent between updates; change xKey or remount to change its schema.');
  const view = structuredClone(figure.spec.view);
  if (streamingChanged && previous?.maxPoints !== undefined) for (const layer of layers.values()) layer.disableStreaming();
  // The old data may not be valid under the incoming format/scale. Remove
  // those constraints first, replace all data, then restore the final axes.
  if (dataChanged) {
    if (figure.spec.hoverMode === 'x') figure.setHoverMode('nearest');
    figure.setAxisFormat('x', null); figure.setAxisFormat('y', null);
    figure.restoreView({...view, xScale: 'linear', yScale: 'linear', xDomain: undefined, yDomain: undefined, xFormat: undefined, yFormat: undefined});
  }
  const keys = new Set(series.map(item => item.key));
  for (const [key, layer] of layers) if (!keys.has(key as Extract<keyof Row, string>)) {layer.remove(); layers.delete(key);}
  for (const [key, layer] of bands) if (!prepared.bands.has(key)) {layer.remove(); bands.delete(key);}
  for (const [index, item] of series.entries()) {
    if (!item.band) continue;
    let band = bands.get(item.key);
    if (band) {
      const values = prepared.bands.get(item.key)!;
      if (dataChanged) band.setData({x: prepared.x as ArrayLike<number>, lower: values.lower, upper: values.upper});
      band.setStyle(bandStyles[index]!);
    } else {band = addBand(figure, index); bands.set(item.key, band);}
    band.setVisible(visible(index));
  }
  for (const [index, item] of series.entries()) {
    let layer = layers.get(item.key);
    if (layer) {
      const values = prepared.values.get(item.key)!;
      if (dataChanged) {
        if (horizontal) layer.setData({y: prepared.x, x: values, left: 0});
        else layer.setData({x: prepared.x, y: values, ...(type === 'bar' ? {bottom: 0} : {})});
      }
      if (type === 'bar') layer.setOptions({barWidth});
      layer.setStyle(styles[index]);
    } else {layer = add(figure, index); layers.set(item.key, layer);}
    layer.setVisible(visible(index));
    if (maxPoints !== undefined && (dataChanged || previous?.maxPoints !== maxPoints)) layer.enableStreaming({maxPoints});
  }
  // This private figure is owned by the adapter. Keep all bands under its
  // lines, including a band added later, without replacing stable layer IDs.
  const orderedIds = [...series.flatMap(item => bands.has(item.key) ? [bands.get(item.key)!.id] : []), ...series.map(item => layers.get(item.key)!.id)];
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  figure.spec.layers.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  figure.setTheme(theme); figure.setSize({height}); figure.setTitle(title);
  if (type === 'bar') figure.setBarMode(barMode);
  if (dataChanged || axesChanged) {
    setAxes(figure, view);
    if (hoverMode !== 'nearest' || figure.spec.hoverMode !== undefined) figure.setHoverMode(hoverMode);
  } else {
    // Labels are presentation only; preserve the current interactive domains.
    figure.restoreView({...figure.spec.view, xLabel: xAxis?.label ?? '', yLabel: yAxis?.label ?? ''});
  }
  const committed = maxPoints !== undefined && (dataChanged || axesChanged || streamingChanged) ? retainedData(figure, layers, bands, prepared, horizontal) : prepared;
  updates.set(figure, {data, schema, axes, visibility: visibilityKey, prepared: committed, maxPoints});
  return {empty: committed.empty, dataChanged, streamingChanged};
}
