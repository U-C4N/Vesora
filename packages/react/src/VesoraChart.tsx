import {forwardRef, useEffect, useId, useImperativeHandle, useRef, useState} from 'react';
import type {ForwardedRef, ReactElement, RefAttributes} from 'react';
import {figure, resolveTheme, toHTMLAsync} from '@vesora/core/runtime';
import type {AppendOptions, ExportHTMLOptions, ExportPNGOptions, Figure, HoverEvent, Layer, StreamState, XHoverEvent} from '@vesora/core';
import {formatValue, prepareData} from './data';
import {updateChart} from './chart';
import {RetainedRows} from './retained-rows';
import type {ChartInteraction, ChartXInteraction, ChartSeries, VesoraChartHandle, VesoraChartProps} from './types';

interface Presentation<Row extends object> {
  configuration: VesoraChartProps<Row>;
  rows: readonly Row[];
  layers: Map<string, string>;
  visibility: Record<string, boolean>;
  empty: boolean;
  rowCount: number;
}

interface Owner<Row extends object> {
  figure: Figure;
  layers: Map<string, Layer>;
  bands: Map<string, Layer>;
  visibility: Record<string, boolean>;
  disposed: boolean;
  mounted: boolean;
  revision: number;
  reportedError?: string;
  configuration?: VesoraChartProps<Row>;
  rows: readonly Row[];
  appendEpoch: number;
  pendingAppends: number;
  appendTail: Promise<void>;
  retainedRows: RetainedRows<Row>;
  empty: boolean;
  rowCount: number;
  pendingPresentation?: Presentation<Row>;
  displayedPresentation?: Presentation<Row>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notify<Value>(callback: ((value: Value) => void) | undefined, value: Value): void {
  try {callback?.(value);} catch (caught) {console.error('A Vesora React callback failed:', caught);}
}

function Chart<Row extends object>(props: VesoraChartProps<Row>, ref: ForwardedRef<VesoraChartHandle<Row>>): ReactElement {
  const {type, data, xKey, series, theme = 'light', height = 300, title = '', xAxis, yAxis, barMode = 'group', barWidth, orientation = 'vertical', loading = false, error, legend = true, tooltip = true, hoverMode = 'nearest'} = props;
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const owner = useRef<Owner<Row> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [retryKey, setRetryKey] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const [empty, setEmpty] = useState(!data.length || !series.length);
  const [rowCount, setRowCount] = useState(data.length);
  const [heldPresentation, setHeldPresentation] = useState<Presentation<Row>>();
  const [hover, setHover] = useState<ChartInteraction<Row> | null>(null);
  const [xHover, setXHover] = useState<ChartXInteraction<Row> | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({});
  const summaryId = useId();
  const tooltipId = useId();
  const displayedSeries = heldPresentation?.configuration.series ?? series;
  const displayedHoverMode = heldPresentation ? heldPresentation.configuration.hoverMode ?? 'nearest' : hoverMode;
  let palette;
  try {palette = resolveTheme(heldPresentation ? heldPresentation.configuration.theme ?? 'light' : theme);} catch {palette = resolveTheme('light');}
  const isVisible = (item: ChartSeries<Row>) => item.visible ?? (heldPresentation?.visibility ?? visibility)[item.key] ?? true;

  function capturePresentation(current: Owner<Row>): Presentation<Row> | undefined {
    if (!current.configuration) return undefined;
    // Keep metadata and static row identities with the captured frame. Streaming
    // rows are owned by the bounded ledger, not by an unbounded props array.
    return {configuration: {...current.configuration, data: [], series: current.configuration.series.map(item => ({...item}))},
      rows: current.configuration.streaming ? [] : current.rows,
      layers: new Map([...current.layers].map(([key, layer]) => [key, layer.id])), visibility: {...current.visibility},
      empty: current.empty, rowCount: current.rowCount};
  }

  function eventRow(current: Owner<Row>, index: number | undefined, event: {layerId: string; streamId?: string; sequence?: number}): Row | undefined {
    if(event.streamId!==undefined&&event.sequence!==undefined)return current.retainedRows.row(event.streamId,event.sequence);
    if (index === undefined) return undefined;
    const presentation = current.displayedPresentation;
    const stream = current.figure.getDisplayedStreamingState?.(event.layerId) ?? (!presentation && current.configuration?.streaming ? current.figure.getStreamingState(event.layerId) : undefined);
    if (!stream) return (presentation?.rows ?? current.rows)[index];
    const sequence = event.sequence ?? stream.nextSequence - stream.retained + index;
    return current.retainedRows.row(event.streamId??stream.streamId,sequence);
  }

  function streams(current:Owner<Row>):Record<string,StreamState>{return Object.fromEntries([...current.layers.values()].flatMap(layer=>{const state=current.figure.getStreamingState(layer.id);return state?[[layer.id,state]]:[];}));}

  function interaction(event: HoverEvent, current: Owner<Row>): ChartInteraction<Row> {
    const presentation = current.displayedPresentation;
    const configuration = presentation?.configuration ?? current.configuration ?? latest.current;
    const key = presentation ? [...presentation.layers].find(([, id]) => id === event.layerId)?.[0] : [...current.layers].find(([, layer]) => layer.id === event.layerId)?.[0];
    const item = configuration.series.find(value => value.key === key);
    const index = event.index ?? event.sourceIndex;
    const row = eventRow(current, index, event);
    const horizontal = configuration.type === 'bar' && configuration.orientation === 'horizontal';
    const position = row?.[configuration.xKey] ?? event.category;
    const value = item && row ? row[item.key] : event.value;
    return {
      event, row, series: item,
      formattedX: event.kind === 'density' ? 'Count per bin' : formatValue(horizontal ? value ?? event.x : position ?? event.x, configuration.xAxis),
      formattedY: event.kind === 'density' ? formatValue(event.count) : formatValue(horizontal ? position ?? event.y : value ?? event.y, configuration.yAxis),
    };
  }

  function xInteraction(event: XHoverEvent, current: Owner<Row>): ChartXInteraction<Row> {
    const presentation = current.displayedPresentation;
    const configuration = presentation?.configuration ?? current.configuration ?? latest.current;
    const hits = new Map(event.items.map(item => [item.layerId, item]));
    return {
      event, formattedCursorX: formatValue(event.cursorX, configuration.xAxis),
      items: configuration.series.filter(item => item.visible ?? (presentation?.visibility ?? current.visibility)[item.key] ?? true).map(item => {
        const layerId = presentation ? presentation.layers.get(item.key) : current.layers.get(item.key)?.id, hit = layerId ? hits.get(layerId) : undefined;
        return {
          series: item, missing: !hit,
          row: hit ? eventRow(current, hit.index, hit) : undefined,
          index: hit?.index, x: hit?.x, y: hit?.y, streamId: hit?.streamId, sequence: hit?.sequence,
          formattedX: formatValue(hit?.x, configuration.xAxis),
          formattedY: formatValue(hit?.y, configuration.yAxis),
        };
      }),
    };
  }

  // The effect owns this particular figure. StrictMode's second setup creates a
  // fresh figure; it never attempts to reopen the one its cleanup closed.
  useEffect(() => {
    const current: Owner<Row> = {figure: figure({height: 300}), layers: new Map(), bands: new Map(), visibility: {}, disposed: false, mounted: false, revision: 0,
      rows: [], appendEpoch: 0, pendingAppends: 0, appendTail: Promise.resolve(),retainedRows:new RetainedRows<Row>(), empty: true, rowCount: 0};
    owner.current = current;
    setRendering(true);
    setRenderError(null);
    setHeldPresentation(undefined);
    const unsubscribe = [
      current.figure.on('framepending',state=>{if(!current.disposed){current.retainedRows.pin('pending',state.displayedStreams);current.pendingPresentation=state.mode==='frozen'?current.displayedPresentation:capturePresentation(current);}}),
      current.figure.on('frame',state=>{if(!current.disposed){current.retainedRows.pin('displayed',state.displayedStreams);current.displayedPresentation=current.pendingPresentation??capturePresentation(current);current.pendingPresentation=undefined;setHeldPresentation(state.mode==='frozen'?current.displayedPresentation:undefined);setRendering(false);}}),
      current.figure.on('inspectionchange',state=>{if(!current.disposed){current.retainedRows.pin('displayed',state.displayedStreams);if(state.mode==='frozen'){current.pendingPresentation=undefined;current.displayedPresentation??=capturePresentation(current);setHeldPresentation(current.displayedPresentation);}}}),
      current.figure.on('hover', event => {
        if (current.disposed || owner.current !== current) return;
        try {
          const value = event ? interaction(event, current) : null;
          setHover(value);
          notify(latest.current.onHover, value);
        } catch (caught) {
          notify(latest.current.onError, {message: errorMessage(caught)});
        }
      }),
      current.figure.on('click', event => {
        if (current.disposed || owner.current !== current || !event) return;
        try {notify(latest.current.onClick, interaction(event, current));}
        catch (caught) {notify(latest.current.onError, {message: errorMessage(caught)});}
      }),
      current.figure.on('xhover', event => {
        if (current.disposed || owner.current !== current) return;
        try {
          const value = event ? xInteraction(event, current) : null;
          setXHover(value);
          notify(latest.current.onXHover, value);
        } catch (caught) {notify(latest.current.onError, {message: errorMessage(caught)});}
      }),
      current.figure.on('selection', event => {
        if (!current.disposed && owner.current === current) notify(latest.current.onSelection, event);
      }),
      current.figure.on('error', event => {
        if (current.disposed || owner.current !== current) return;
        setRenderError(event.message); setRendering(false); setHover(null); setXHover(null);
        if (current.reportedError !== event.message) {current.reportedError = event.message; notify(latest.current.onError, event);}
      }),
    ];
    try {
      current.figure.setPresentation({tooltip: false, legend: false});
      current.figure.mount(host.current!);
      current.mounted = true;
    } catch (caught) {
      const message = errorMessage(caught);
      setRenderError(message); setRendering(false);
      notify(latest.current.onError, {message});
    }
    return () => {
      current.disposed = true;
      current.appendEpoch++;
      current.rows = [];
      current.pendingPresentation = current.displayedPresentation = undefined;
      current.retainedRows.clear();
      for (const remove of unsubscribe) remove();
      current.figure.close();
      current.layers.clear();
      current.bands.clear();
      if (owner.current === current) owner.current = null;
    };
  }, [type, orientation, xKey, retryKey]);

  useEffect(() => {
    const current = owner.current;
    if (!current || current.disposed || !current.mounted) return;
    const revision = ++current.revision;
    current.reportedError = undefined;
    setHover(null); setXHover(null);
    try {
      const retained=current.configuration?.streaming?current.retainedRows.liveRows():current.rows;
      const prepared = updateChart(current.figure, current.layers, props, visibility, current.bands, retained);
      if (prepared.dataChanged || prepared.streamingChanged) {
        const rows = current.configuration?.data === data ? retained : data;
        current.appendEpoch++;
        current.rows = props.streaming ? rows.slice(-props.streaming.maxPoints) : rows.slice();
        current.retainedRows.replace(current.rows,streams(current));
        setRowCount(current.rowCount=current.rows.length);
        setEmpty(current.empty=prepared.empty);
      }
      current.configuration = props;
      current.visibility = visibility;
      setRendering(true);
      void current.figure.ready({target:'displayed'}).then(() => {
        if (current.disposed || owner.current !== current || current.revision !== revision) return;
        setRendering(false); setRenderError(null);
      }).catch(caught => {
        if (current.disposed || owner.current !== current || current.revision !== revision) return;
        const message = errorMessage(caught);
        setRenderError(message); setRendering(false);
        if (current.reportedError !== message) {current.reportedError = message; notify(latest.current.onError, {message});}
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setRenderError(message); setRendering(false); notify(latest.current.onError, {message});
    }
  }, [type, orientation, retryKey, data, xKey, series, xAxis, yAxis, theme, height, title, barMode, barWidth, visibility, hoverMode, props.streaming?.maxPoints]);

  const externalError = error ? errorMessage(error) : null;
  const message = externalError ?? renderError;
  const state = message ? 'error' : loading ? 'loading' : (heldPresentation?.empty ?? empty) ? 'empty' : 'ready';
  const blocked = state !== 'ready';
  const retry = () => setRetryKey(value => value + 1);

  useImperativeHandle(ref, () => ({
    appendRows(rows: readonly Row[], options:AppendOptions={}) {
      const current = owner.current;
      if (!current || current.disposed) return Promise.reject(new Error('The chart is not mounted.'));
      if (!current.configuration?.streaming) return Promise.reject(new Error('Enable streaming before appending rows.'));
      if (latest.current.loading || latest.current.error || renderError) return Promise.reject(new Error('Wait for a valid chart before appending rows.'));
      if (current.pendingAppends >= 64) return Promise.reject(new Error('The chart has 64 pending append requests; await an append before submitting more.'));
      if(options.waitFor!==undefined&&options.waitFor!=='accepted'&&options.waitFor!=='rendered')return Promise.reject(new TypeError('Append waitFor must be accepted or rendered.'));
      const epoch = current.appendEpoch;
      let prepared: ReturnType<typeof prepareData>;
      try {
        const configuration = current.configuration;
        prepared = prepareData(rows, configuration.xKey, configuration.series, configuration.xAxis, configuration.yAxis);
        if (prepared.x.length && typeof prepared.x[0] === 'string') throw new TypeError('Streaming requires numeric or time x values.');
      } catch (caught) {return Promise.reject(caught);}
      // Capture the batch boundary so caller changes to the array cannot alter
      // which application rows correspond to the validated numeric columns.
      const batchRows = rows.slice();
      current.pendingAppends++;
      const operation = current.appendTail.then(async () => {
        if (current.disposed || owner.current !== current || current.appendEpoch !== epoch) throw new Error('The chart data was replaced before this append completed.');
        const first = current.layers.values().next().value;
        const before = first ? current.figure.getStreamingState(first.id) : undefined;
        if (!first || !before) throw new Error('The chart has no streaming series.');
        setRendering(true); setHover(null); setXHover(null);
        try {
          const completion=current.figure.appendDataBatch([...current.layers].map(([key, layer]) => ({layer, data: {x: prepared.x, y: prepared.values.get(key)!}})),options);
          // Core acceptance is atomic and synchronous. Pin row identities now:
          // frame planning and interaction may happen before rendered readiness.
          const accepted=current.figure.getStreamingState(first.id);
          if(accepted?.streamId===before.streamId&&accepted.nextSequence!==before.nextSequence){current.retainedRows.append(batchRows,before,streams(current));setRowCount(current.rowCount=accepted.retained);setEmpty(current.empty=!current.retainedRows.someLive(row=>current.configuration!.series.some(item=>Number.isFinite(row[item.key]))));}
          await completion;
          if (current.disposed || owner.current !== current || current.appendEpoch !== epoch) throw new Error('The chart data was replaced before this append completed.');
        } finally {
          if (!current.disposed && owner.current === current && current.appendEpoch === epoch) {
            const after = current.figure.getStreamingState(first.id);
            if (after?.streamId === before.streamId && after.nextSequence !== before.nextSequence) {
              setRowCount(after.retained);
            }
            setRendering(false);
          }
        }
      }).finally(() => {current.pendingAppends--;});
      current.appendTail = operation.catch(() => {});
      return operation;
    },
    freezeInspection(){const current=owner.current;if(!current||current.disposed)throw new Error('The chart is not mounted.');return current.figure.freezeInspection();},
    resumeLive(){const current=owner.current;if(!current||current.disposed)return Promise.reject(new Error('The chart is not mounted.'));return current.figure.resumeLive();},
    getInspectionState(){const current=owner.current;if(!current||current.disposed)throw new Error('The chart is not mounted.');return current.figure.getInspectionState();},
    async exportPNG(options?: ExportPNGOptions) {
      if (latest.current.loading || latest.current.error || renderError) throw new Error('Wait for a valid chart before exporting.');
      const current = owner.current;
      if (!current || current.disposed) throw new Error('The chart is not mounted.');
      return current.figure.savefig(options);
    },
    async exportHTML(options?:ExportHTMLOptions) {
      if (latest.current.loading || latest.current.error || renderError) throw new Error('Wait for a valid chart before exporting.');
      const current = owner.current;
      if (!current || current.disposed) throw new Error('The chart is not mounted.');
      return toHTMLAsync(current.figure,options);
    },
    resetView() {
      const current = owner.current;
      if (!current || current.disposed) return;
      if(current.figure.getInspectionState?.().mode==='frozen'){current.figure.resetInspectionView('main');return;}
      current.figure.restoreView({...current.figure.spec.view, xDomain: latest.current.xAxis?.domain, yDomain: latest.current.yAxis?.domain});
    },
  }), [renderError]);

  const rect = root.current?.getBoundingClientRect();
  const activeHover = displayedHoverMode === 'x' ? xHover : hover;
  const tooltipPosition = activeHover && rect ? {
    left: Math.max(8, Math.min((activeHover.event.pointerPosition?.clientX ?? rect.left) - rect.left + 12, Math.max(8, rect.width - 220))),
    top: Math.max(8, (activeHover.event.pointerPosition?.clientY ?? rect.top) - rect.top - 52),
  } : {left: 12, top: 12};
  const overlayStyle = {position: 'absolute' as const, inset: 0, display: 'grid', placeItems: 'center', padding: 20, background: palette.background, color: palette.foreground};

  return <div ref={root} className={props.className} role="group" aria-label={props['aria-label'] ?? (title || `${type} chart`)}
    aria-describedby={summaryId} aria-busy={loading || rendering} data-vesora-chart="" data-vesora-state={state} data-vesora-rendering={String(rendering)}
    style={{position: 'relative', color: palette.foreground, background: palette.background, fontFamily: palette.fontFamily, fontSize: palette.fontSize, ...props.style}}>
    <div style={{position: 'relative', height, overflow: 'hidden'}}>
      <div ref={host} data-vesora-host="" aria-hidden={blocked} style={{height, visibility: blocked ? 'hidden' : 'visible', pointerEvents: blocked ? 'none' : 'auto'}} onPointerLeave={() => setHover(null)} />
      {state === 'loading' && <div role="status" style={overlayStyle}>{props.renderLoading?.() ?? 'Loading data…'}</div>}
      {state === 'empty' && <div role="status" style={overlayStyle}>{props.renderEmpty?.() ?? 'No data available.'}</div>}
      {state === 'error' && <div role="alert" style={overlayStyle}>{props.renderError?.(message!, retry) ?? <div><p>{message}</p><button type="button" onClick={retry}>Retry chart</button></div>}</div>}
    </div>
    {legend && displayedSeries.length > 0 && <div aria-label="Chart series" style={{display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px'}}>
      {displayedSeries.map((item, index) => <button key={item.key} type="button" aria-pressed={isVisible(item)} disabled={blocked || !!heldPresentation}
        onClick={() => {
          const visible = !isVisible(item);
          if (item.visible === undefined) setVisibility(previous => ({...previous, [item.key]: visible}));
          try {props.onSeriesVisibilityChange?.(item.key, visible);} catch (caught) {console.error('A Vesora React callback failed:', caught);}
        }}
        style={{display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 32, border: `1px solid ${palette.axis}`, borderRadius: 5, background: palette.background, color: palette.foreground, padding: '4px 9px', cursor: blocked ? 'default' : 'pointer', opacity: isVisible(item) ? 1 : 0.6}}>
        <span aria-hidden="true" style={{width: 12, height: 4, background: item.color ?? palette.palette[index % palette.palette.length]}} />
        {item.label ?? item.key}
      </button>)}
    </div>}
    {tooltip && activeHover && !blocked && <div id={tooltipId} role="tooltip" style={{position: 'absolute', ...tooltipPosition, pointerEvents: 'none', zIndex: 2, maxWidth: 220, padding: '8px 11px', borderRadius: 6, boxShadow: '0 4px 16px #0003', background: palette.tooltipBackground, color: palette.tooltipForeground}}>
      {displayedHoverMode === 'x' && xHover ? props.renderXTooltip?.(xHover) ?? <>
        {xHover.items.map(item => <div key={item.series.key}><strong>{item.series.label ?? item.series.key}</strong><div>{item.missing ? '—' : `${item.formattedX}: ${item.formattedY}`}</div></div>)}
      </> : hover && (props.renderTooltip?.(hover) ?? <><strong>{hover.series?.label ?? hover.series?.key ?? 'Value'}</strong><div>{type === 'bar' && orientation === 'horizontal' ? `${hover.formattedY}: ${hover.formattedX}` : `${hover.formattedX}: ${hover.formattedY}`}</div></>)}
    </div>}
    <span id={summaryId} style={{position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)'}}>
      {type} chart with {heldPresentation?.rowCount ?? rowCount} rows and {displayedSeries.length} series. {displayedSeries.map(item => item.label ?? item.key).join(', ')}.
    </span>
  </div>;
}

export const VesoraChart = forwardRef(Chart<Record<string, unknown>>) as unknown as <Row extends object>(props: VesoraChartProps<Row> & RefAttributes<VesoraChartHandle<Row>>) => ReactElement;
