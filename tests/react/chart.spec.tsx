// @vitest-environment jsdom
import {act, createRef, StrictMode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {VesoraChart} from '../../packages/react/src/index';
import type {VesoraChartHandle} from '../../packages/react/src/index';

const state = vi.hoisted(() => ({figures: [] as any[], serial: 0, failMount: false, delayed: false}));
vi.mock('@vesora/core', () => {
  const palette = {background: '#ffffff', foreground: '#334155', muted: '#475569', grid: '#eee', axis: '#ccc', tooltipBackground: '#111', tooltipForeground: '#fff', selection: '#f80', error: '#b00', fontFamily: 'system-ui', fontSize: 12, palette: ['#2563eb', '#dc2626']};
  class FakeLayer {
    id = `layer-${++state.serial}`;
    spec = {id: this.id};
    stream?: {streamId: string; maxPoints: number; nextSequence: number; retained: number; revision: number; evicted: number};
    setData = vi.fn((data: any) => {this.x = data.x; this.y = data.y; if (this.stream) this.enableStreaming({maxPoints: this.stream.maxPoints}); return this;});
    setStyle = vi.fn(); setOptions = vi.fn(); setVisible = vi.fn(() => this); remove = vi.fn();
    enableStreaming = vi.fn(({maxPoints}: {maxPoints: number}) => {
      const count = (this.x as number[]).length;
      this.stream = {streamId: `stream-${++state.serial}`, maxPoints, nextSequence: count, retained: Math.min(count, maxPoints), revision: 0, evicted: Math.max(0, count - maxPoints)};
      this.x = Array.from(this.x as number[]).slice(-maxPoints); this.y = Array.from(this.y as number[]).slice(-maxPoints); return this;
    });
    disableStreaming = vi.fn(() => {this.stream = undefined; return this;});
    constructor(public x: unknown, public y: unknown, public style: unknown) {}
  }
  class FakeFigure {
    spec: any = {layers: [], view: {kind: '2d', xScale: 'linear', yScale: 'linear', xLabel: '', yLabel: '', camera: {azimuth: 0, elevation: 0, distance: 3}}};
    layers: FakeLayer[] = []; listeners = new Map<string, (event: unknown) => void>(); element?: HTMLElement;
    waiters: Array<{resolve: () => void; reject: (error: Error) => void}> = [];
    closed = false;
    setTheme = vi.fn(); setSize = vi.fn(); setTitle = vi.fn(); setAxisFormat = vi.fn(); setBarMode = vi.fn(); setPresentation = vi.fn(); setHoverMode = vi.fn();
    setCategories = vi.fn((axis: string, names: string[]) => {(this.spec.categories ??= {})[`${axis}:main`] = [...names];});
    setView = vi.fn((view: object) => {Object.assign(this.spec.view, view);});
    restoreView = vi.fn((view: object) => {this.spec.view = {...this.spec.view, ...view};});
    constructor() {state.figures.push(this);}
    on(event: string, handler: (event: unknown) => void) {this.listeners.set(event, handler); return () => this.listeners.delete(event);}
    emit(event: string, payload: unknown) {this.listeners.get(event)?.(payload);}
    mount = vi.fn((host: HTMLElement) => {
      if (state.failMount) throw new Error('WebGL is unavailable.');
      this.element = document.createElement('div'); this.element.className = 'vesora-figure';
      this.element.append(document.createElement('canvas')); host.append(this.element);
    });
    ready = vi.fn(() => state.delayed ? new Promise<void>((resolve, reject) => this.waiters.push({resolve, reject})) : Promise.resolve());
    getStreamingState(id: string) {const value = this.layers.find(layer => layer.id === id)?.stream; return value && {...value};}
    appendDataBatch = vi.fn(async (updates: {layer: FakeLayer; data: {x: number[]; y: Float64Array}}[], options?: {waitFor?: 'accepted'|'rendered'}) => {
      for (const {layer, data} of updates) if (data.x.some((x, index) => x <= (index ? data.x[index - 1] : (layer.x as number[]).at(-1) ?? -Infinity))) throw new Error('Streaming x values must be increasing.');
      for (const {layer, data} of updates) {
        const stream = layer.stream!;
        layer.x = [...layer.x as number[], ...data.x].slice(-stream.maxPoints);
        layer.y = [...layer.y as number[], ...data.y].slice(-stream.maxPoints);
        stream.nextSequence += data.x.length; stream.retained = (layer.x as number[]).length; stream.evicted = stream.nextSequence - stream.retained; stream.revision++;
      }
      if(options?.waitFor!=='accepted')await this.ready();
    });
    close = vi.fn(() => {this.closed = true; this.element?.remove();});
    plot(x: unknown, y: unknown, style: unknown) {if (Array.isArray(x) && typeof x[0] === 'string') this.setCategories('x', x); const layer = new FakeLayer(x, y, style); this.layers.push(layer); this.spec.layers.push(layer.spec); return layer;}
    fillBetween(x: unknown, lower: unknown, upper: unknown, style: unknown) {return this.plot(x, {lower, upper}, style);}
    scatter(x: unknown, y: unknown, style: unknown) {return this.plot(x, y, style);}
    bar(x: unknown, y: unknown, style: unknown) {return this.plot(x, y, style);}
    barh(x: unknown, y: unknown, style: unknown) {if (Array.isArray(x) && typeof x[0] === 'string') this.setCategories('y', x); const layer = new FakeLayer(x, y, style); this.layers.push(layer); this.spec.layers.push(layer.spec); return layer;}
    savefig = vi.fn(async () => new Blob(['png'], {type: 'image/png'}));
  }
  return {
    figure: () => new FakeFigure(),
    resolveTheme: (theme: unknown) => ({...palette, ...(theme === 'dark' ? {background: '#0f172a'} : typeof theme === 'object' ? theme : {})}),
    validateAxisFormat: (format: {kind: string; currency?: string}) => {if (format.kind === 'currency' && !/^[a-z]{3}$/i.test(format.currency ?? '')) throw new Error('Currency must be a three-letter code'); return format;},
    formatValue: (value: number, format?: {kind: string; locale?: string; currency?: string; timeZone?: string}) => format?.kind === 'date'
      ? new Intl.DateTimeFormat(format.locale ?? 'en-US', {timeZone: format.timeZone ?? 'UTC'}).format(value)
      : new Intl.NumberFormat(format?.locale ?? 'en-US', {style: format?.kind === 'currency' ? 'currency' : format?.kind === 'percent' ? 'percent' : 'decimal', currency: format?.currency}).format(value),
    toHTML: () => '<html>chart source rows</html>',
  };
});

interface Row {id: string; time: number; revenue: number | null; expense: number}
const rows: Row[] = [{id: 'one', time: 1, revenue: 10, expense: 3}, {id: 'two', time: 2, revenue: 20, expense: 8}];
const series = [{key: 'revenue' as const, label: 'Revenue'}, {key: 'expense' as const, label: 'Expense'}];
const base = {type: 'line' as const, data: rows, xKey: 'time' as const, series};
let container: HTMLDivElement, root: Root;
async function render(node: React.ReactNode) {await act(async () => {root.render(node);});}
const mounted = () => state.figures.filter(figure => figure.element);
const current = () => mounted().at(-1)!;

beforeEach(() => {
  Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
  state.figures.length = 0; state.serial = 0; state.failMount = false; state.delayed = false;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {await act(async () => {root.unmount();}); container.remove();});

describe('declarative React chart integration', () => {
  it('owns a fresh figure for each StrictMode setup and releases the previous figure', async () => {
    await render(<StrictMode><VesoraChart {...base} /></StrictMode>);
    expect(mounted()).toHaveLength(2);
    expect(mounted()[0].close).toHaveBeenCalledOnce();
    expect(mounted()[1].closed).toBe(false);
    expect(container.querySelectorAll('canvas')).toHaveLength(1);
    await render(null);
    expect(mounted()[1].close).toHaveBeenCalledOnce();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('retains keyed layers and the viewport while replacing API data and style', async () => {
    await render(<VesoraChart {...base} />);
    const fig = current(), original = fig.layers[0];
    fig.setView({xDomain: [1.2, 1.6]});
    const refreshed = rows.map(row => ({...row, revenue: row.revenue! + 5}));
    await render(<VesoraChart {...base} data={refreshed} series={[{key: 'revenue', label: 'MRR', color: '#f59e0b'}, series[1]]} theme="dark" />);
    expect(current()).toBe(fig); expect(fig.layers).toHaveLength(2);
    expect(original.setData).toHaveBeenCalledWith({x: [1, 2], y: new Float64Array([15, 25])});
    expect(original.setStyle).toHaveBeenLastCalledWith(expect.objectContaining({label: 'MRR', color: '#f59e0b'}));
    expect(fig.spec.view.xDomain).toEqual([1.2, 1.6]);
    expect(fig.setTheme).toHaveBeenLastCalledWith('dark');
  });

  it('validates the complete dataset before mutating layers and recovers on valid props', async () => {
    await render(<VesoraChart {...base} />);
    const fig = current();
    const invalid = [{...rows[0], expense: 'invalid'}] as unknown as Row[];
    await render(<VesoraChart {...base} data={invalid} />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('expense must be a number');
    expect(fig.layers[0].setData).not.toHaveBeenCalled();
    await render(<VesoraChart {...base} />);
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
  });

  it('contains throwing error callbacks and leaves a valid figure intact for invalid formats', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await render(<VesoraChart {...base} />);
      const fig = current(), themeCalls = fig.setTheme.mock.calls.length;
      await render(<VesoraChart {...base} yAxis={{format: 'currency', currency: 'INVALID'}} onError={() => {throw new Error('application callback');}} />);
      expect(container.querySelector('[role=alert]')?.textContent).toContain('three-letter code');
      expect(fig.setTheme.mock.calls).toHaveLength(themeCalls);
      expect(log).toHaveBeenCalledWith('A Vesora React callback failed:', expect.any(Error));
      await render(<VesoraChart {...base} />);
      expect(container.querySelector('[role=alert]')).toBeNull();
    } finally {log.mockRestore();}
  });

  it('preserves missing values as gaps and exposes loading, empty and API failure states', async () => {
    await render(<VesoraChart {...base} data={[{...rows[0], revenue: null}]} loading />);
    expect(Number.isNaN(current().layers[0].y[0])).toBe(true);
    expect(container.querySelector('[role=status]')?.textContent).toBe('Loading data…');
    await render(<VesoraChart {...base} data={[]} />);
    expect(container.querySelector('[role=status]')?.textContent).toBe('No data available.');
    await render(<VesoraChart {...base} error="API request failed." />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('API request failed.');
  });

  it('keeps hidden series in an accessible legend and applies their visibility', async () => {
    const changed = vi.fn();
    await render(<VesoraChart {...base} onSeriesVisibilityChange={changed} />);
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === 'Revenue')!;
    await act(async () => {button.click();});
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(current().layers[0].setVisible).toHaveBeenLastCalledWith(false);
    expect(changed).toHaveBeenCalledWith('revenue', false);
    expect([...container.querySelectorAll('button')].map(item => item.textContent)).toContain('Revenue');
  });

  it('maps hover and click to current application rows and hides the React tooltip on clear', async () => {
    const clicked = vi.fn(), hovered = vi.fn();
    await render(<VesoraChart {...base} onClick={clicked} onHover={hovered} yAxis={{format: 'currency', currency: 'TRY'}} renderTooltip={value => <b>{value.row?.id}: {value.formattedY}</b>} />);
    const fig = current();
    const hit = {kind: 'point', layerId: fig.layers[0].id, index: 1, x: 2, y: 20, pointerPosition: {x: 100, y: 100, clientX: 100, clientY: 100}};
    await act(async () => {fig.emit('hover', hit); fig.emit('click', hit);});
    expect(container.querySelector('[role=tooltip]')?.textContent).toContain('two: TRY');
    expect(clicked).toHaveBeenCalledWith(expect.objectContaining({row: rows[1], series: series[0]}));
    await act(async () => {fig.emit('hover', null);});
    expect(container.querySelector('[role=tooltip]')).toBeNull(); expect(hovered).toHaveBeenLastCalledWith(null);
  });

  it('rejects invalid time data and missing currency configuration before displaying it', async () => {
    await render(<VesoraChart {...base} xAxis={{type: 'time'}} yAxis={{format: 'currency'}} />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('requires a currency code');
    await render(<VesoraChart {...base} data={[{...rows[0], time: '2026-10-01'}] as unknown as Row[]} xAxis={{type: 'time'}} />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('epoch milliseconds');
    await render(<VesoraChart {...base} data={[{...rows[0], time: 9e15}]} xAxis={{type: 'time'}} />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('Date range');
  });

  it('reconstructs after chart type changes and updates horizontal bar channels correctly', async () => {
    await render(<VesoraChart {...base} />);
    const previous = current();
    const categories = [{category: 'Pro', value: 10}, {category: 'Team', value: 20}];
    const clicked = vi.fn();
    await render(<VesoraChart type="bar" orientation="horizontal" barMode="stack" data={categories} xKey="category" series={[{key: 'value'}]} xAxis={{format: 'currency', currency: 'TRY'}} onClick={clicked} />);
    expect(previous.close).toHaveBeenCalledOnce();
    expect(current().setBarMode).toHaveBeenCalledWith('stack');
    const bars = current();
    await render(<VesoraChart type="bar" orientation="horizontal" data={categories.map(row => ({...row, value: row.value + 1}))} xKey="category" series={[{key: 'value'}]} xAxis={{format: 'currency', currency: 'TRY'}} onClick={clicked} />);
    expect(bars.layers[0].setData).toHaveBeenCalledWith({y: ['Pro', 'Team'], x: new Float64Array([11, 21]), left: 0});
    await act(async () => {bars.emit('click', {kind: 'bar', layerId: bars.layers[0].id, index: 0, category: 'Pro', value: 11, pointerPosition: {x: 20, y: 20, clientX: 20, clientY: 20}});});
    expect(clicked.mock.calls[0][0].formattedX).toContain('TRY');
    expect(clicked.mock.calls[0][0].formattedY).toBe('Pro');
  });

  it('shows mount failures instead of silently resolving a blank chart and retries with a new owner', async () => {
    state.failMount = true;
    await render(<VesoraChart {...base} />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('WebGL is unavailable.');
    state.failMount = false;
    await act(async () => {container.querySelector<HTMLButtonElement>('button')!.click();});
    expect(state.figures[0].close).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
  });

  it('preserves accepted export defaults, accepts displayed sources and rejects after unmount', async () => {
    const reference = createRef<VesoraChartHandle>();
    await render(<VesoraChart {...base} ref={reference} />);
    expect(await reference.current!.exportHTML()).toContain('chart source rows');
    expect((await reference.current!.exportPNG()).type).toBe('image/png');
    const options = {width: 800, height: 400, scale: 2};
    await reference.current!.exportPNG(options);
    expect(current().savefig).toHaveBeenLastCalledWith(options);
    await reference.current!.exportPNG({source:'displayed',...options});expect(current().savefig).toHaveBeenLastCalledWith({source:'displayed',...options});
    const handle = reference.current!;
    await render(null);
    await expect(handle.exportHTML()).rejects.toThrow('not mounted');
  });

  it('keeps a band owned by its line through updates, legend toggles and cleanup', async () => {
    const bandRows = rows.map(row => ({...row, lower: row.revenue! - 2, upper: row.revenue! + 2}));
    const bandSeries = [{key: 'revenue' as const, label: 'Revenue', band: {lowerKey: 'lower' as const, upperKey: 'upper' as const}}];
    await render(<StrictMode><VesoraChart type="line" data={bandRows} xKey="time" series={bandSeries} /></StrictMode>);
    const fig = current(), band = fig.layers[0], line = fig.layers[1];
    expect(fig.layers).toHaveLength(2);
    expect(band.style).toEqual({color: '#2563eb', opacity: .18});
    expect([...container.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Revenue']);
    await act(async () => {container.querySelector<HTMLButtonElement>('button')!.click();});
    expect(band.setVisible).toHaveBeenLastCalledWith(false);
    expect(line.setVisible).toHaveBeenLastCalledWith(false);
    await render(<StrictMode><VesoraChart type="line" data={bandRows.map(row => ({...row, upper: row.upper + 1}))} xKey="time" series={[{...bandSeries[0], color: '#abc123'}]} /></StrictMode>);
    expect(current()).toBe(fig); expect(fig.layers).toHaveLength(2);
    expect(band.setStyle).toHaveBeenLastCalledWith({color: '#abc123', opacity: .18});
    expect(band.setData).toHaveBeenLastCalledWith({x: [1, 2], lower: new Float64Array([8, 18]), upper: new Float64Array([13, 23])});
    await render(null);
    expect(fig.close).toHaveBeenCalledOnce();
    expect(fig.listeners.size).toBe(0);
  });

  it('maps unified hover to each original sample and includes missing visible series without changing legacy callbacks', async () => {
    const hovered = vi.fn(), xHovered = vi.fn(), rendered = vi.fn();
    await render(<VesoraChart {...base} hoverMode="x" onHover={hovered} onXHover={xHovered} renderXTooltip={value => {rendered(value); return <b>{value.items.map(item => `${item.series.label}: ${item.formattedX} / ${item.formattedY}`).join(' | ')}</b>;}} />);
    const fig = current();
    expect(fig.setHoverMode).toHaveBeenLastCalledWith('x');
    const event = {cursorX: 1.7, pointerPosition: {x: 100, y: 100, clientX: 100, clientY: 100}, items: [{layerId: fig.layers[0].id, index: 1, x: 2, y: 20}]};
    await act(async () => {fig.emit('xhover', event);});
    expect(hovered).not.toHaveBeenCalled();
    expect(xHovered).toHaveBeenLastCalledWith(expect.objectContaining({event, items: [
      expect.objectContaining({row: rows[1], series: series[0], index: 1, x: 2, y: 20, missing: false}),
      expect.objectContaining({row: undefined, index: undefined, series: series[1], formattedX: '—', formattedY: '—', missing: true}),
    ]}));
    expect(rendered).toHaveBeenCalled();
    expect(container.querySelector('[role=tooltip]')?.textContent).toContain('Revenue: 2 / 20');
    expect(container.querySelector('[role=tooltip]')?.textContent).toContain('Expense: — / —');
    // A pinned core inspection survives pointer leave. Only the core's explicit
    // xhover:null event (Escape, unpinned leave, update) ends its React tooltip.
    await act(async () => {container.querySelector('[data-vesora-host]')!.dispatchEvent(new MouseEvent('pointerout', {bubbles: true, relatedTarget: document.body}));});
    expect(container.querySelector('[role=tooltip]')).not.toBeNull();
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === 'Expense')!;
    await act(async () => {button.click();});
    await act(async () => {fig.emit('xhover', event);});
    expect(xHovered.mock.lastCall![0].items).toHaveLength(1);
    await act(async () => {fig.emit('xhover', null);});
    expect(container.querySelector('[role=tooltip]')).toBeNull();
    expect(xHovered).toHaveBeenLastCalledWith(null);
  });

  it('shows original x values in the default unified tooltip and clears it on data updates', async () => {
    const xHovered = vi.fn();
    await render(<VesoraChart {...base} hoverMode="x" onXHover={xHovered} />);
    const fig = current();
    const event = {cursorX: 1.5, pointerPosition: {x: 100, y: 100, clientX: 100, clientY: 100}, items: [
      {layerId: fig.layers[0].id, index: 0, x: 1, y: 10}, {layerId: fig.layers[1].id, index: 1, x: 2, y: 8},
    ]};
    await act(async () => {fig.emit('xhover', event);});
    expect(container.querySelector('[role=tooltip]')?.textContent).toBe('Revenue1: 10Expense2: 8');
    const next = rows.map(row => ({...row, revenue: row.revenue! + 5}));
    await render(<VesoraChart {...base} data={next} hoverMode="x" onXHover={xHovered} />);
    expect(container.querySelector('[role=tooltip]')).toBeNull();
    await act(async () => {fig.emit('xhover', {...event, items: [{...event.items[0], y: 15}]});});
    expect(xHovered.mock.lastCall![0].items[0].row).toBe(next[0]);
    expect(container.querySelector('[role=tooltip]')?.textContent).toBe('Revenue1: 15Expense—');
  });

  it('ignores stale render failures after type replacement', async () => {
    const failed = vi.fn(); state.delayed = true;
    await render(<VesoraChart {...base} onError={failed} />);
    const previous = current(); state.delayed = false;
    await render(<VesoraChart {...base} type="scatter" onError={failed} />);
    await act(async () => {for (const waiter of previous.waiters) waiter.reject(new Error('stale failure'));});
    expect(failed).not.toHaveBeenCalled();
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
  });

  it('appends aligned series atomically, retains source rows after eviction and preserves them across styling', async () => {
    const reference = createRef<VesoraChartHandle<Row>>(), hovered = vi.fn(), clicked = vi.fn();
    await render(<VesoraChart {...base} ref={reference} streaming={{maxPoints: 3}} onXHover={hovered} onClick={clicked} hoverMode="x" />);
    const fig = current(), next = [{id: 'three', time: 3, revenue: 30, expense: 9}, {id: 'four', time: 4, revenue: 40, expense: 12}];
    await act(async () => {await reference.current!.appendRows(next);});
    expect(fig.appendDataBatch).toHaveBeenCalledOnce();
    expect(fig.layers[0].x).toEqual([2, 3, 4]);
    expect(fig.layers[1].y).toEqual([8, 9, 12]);
    expect(container.textContent).toContain('3 rows and 2 series');
    const version = fig.layers[0].stream.streamId;
    await render(<VesoraChart {...base} ref={reference} streaming={{maxPoints: 3}} onXHover={hovered} onClick={clicked} hoverMode="x" theme="dark" title="Live" series={series.map(item => ({...item, color: '#ff8800'}))} />);
    expect(fig.layers[0].setData).not.toHaveBeenCalled();
    expect(fig.layers[0].stream.streamId).toBe(version);
    const items = fig.layers.map((layer: any) => ({layerId: layer.id, index: 2, sequence: 3, streamId: layer.stream.streamId, x: 4, y: 40}));
    await act(async () => {fig.emit('xhover', {cursorX: 4, items}); fig.emit('click', {...items[1], kind: 'point'});});
    expect(hovered.mock.lastCall![0].items.map((item: any) => item.row)).toEqual([next[1], next[1]]);
    expect(clicked.mock.lastCall![0].row).toBe(next[1]);
    await act(async () => {await reference.current!.appendRows([{id: 'bad', time: 5, revenue: 50, expense: 'invalid'}] as unknown as Row[]).catch(() => {});});
    expect(fig.appendDataBatch).toHaveBeenCalledOnce();
    expect(fig.layers[0].x).toEqual([2, 3, 4]);
  });

  it('keeps frozen callbacks bound to displayed rows while accepted appends advance',async()=>{
    const reference=createRef<VesoraChartHandle<Row>>(),clicked=vi.fn();
    await render(<VesoraChart {...base} ref={reference} streaming={{maxPoints:2}} onClick={clicked}/>);
    const fig=current();
    const displayedStreams=Object.fromEntries(fig.layers.map((layer:any)=>[layer.id,{...layer.stream}]));
    let mode='live';
    fig.getInspectionState=()=>({mode,displayedStreams});
    fig.freezeInspection=()=>{mode='frozen';const state=fig.getInspectionState();fig.emit('inspectionchange',state);return state;};
    fig.getDisplayedStreamingState=(layerId:string)=>displayedStreams[layerId];
    fig.resetInspectionView=vi.fn();
    await act(async()=>{fig.emit('frame',{displayedStreams});reference.current!.freezeInspection();});
    const append=[{id:'three',time:3,revenue:30,expense:9},{id:'four',time:4,revenue:40,expense:12}];
    state.delayed=true;
    await act(async()=>{await reference.current!.appendRows(append,{waitFor:'accepted'});});
    expect(fig.appendDataBatch).toHaveBeenLastCalledWith(expect.any(Array),{waitFor:'accepted'});
    expect(fig.layers[0].x).toEqual([3,4]);
    await act(async()=>{fig.emit('click',{kind:'point',layerId:fig.layers[0].id,index:0,streamId:fig.layers[0].stream.streamId,sequence:0,x:1,y:10});});
    expect(clicked.mock.lastCall![0].row).toBe(rows[0]);
    reference.current!.resetView();expect(fig.resetInspectionView).toHaveBeenCalledWith('main');
    state.delayed=false;
    await render(<VesoraChart {...base} ref={reference} streaming={{maxPoints:2}} onClick={clicked} title="New title"/>);
    expect(fig.ready).toHaveBeenLastCalledWith({target:'displayed'});
    await act(async()=>{fig.emit('frame',{displayedStreams:Object.fromEntries(fig.layers.map((layer:any)=>[layer.id,{...layer.stream}]))});fig.emit('click',{kind:'point',layerId:fig.layers[0].id,index:0,streamId:fig.layers[0].stream.streamId,sequence:0,x:1,y:10});});
    expect(clicked.mock.lastCall![0].row).toBeUndefined();
  });

  it('resets the streaming epoch on an explicit data replacement and rejects stale rows in callbacks', async () => {
    const reference = createRef<VesoraChartHandle<Row>>(), clicked = vi.fn();
    await render(<VesoraChart {...base} ref={reference} streaming={{maxPoints: 2}} onClick={clicked} />);
    const fig = current(), streamId = fig.layers[0].stream.streamId;
    await act(async () => {await reference.current!.appendRows([{id: 'three', time: 3, revenue: 30, expense: 9}]);});
    const replacement = [{id: 'new', time: 100, revenue: 1, expense: 2}];
    await render(<VesoraChart {...base} data={replacement} ref={reference} streaming={{maxPoints: 2}} onClick={clicked} />);
    expect(fig.layers[0].x).toEqual([100]);
    expect(fig.layers[0].stream.streamId).not.toBe(streamId);
    await act(async () => {fig.emit('click', {kind: 'point', layerId: fig.layers[0].id, index: 0, sequence: 0, streamId, x: 1, y: 10});});
    expect(clicked.mock.lastCall![0].row).toBeUndefined();
    await act(async () => {fig.emit('click', {kind: 'point', layerId: fig.layers[0].id, index: 0, sequence: 0, streamId: fig.layers[0].stream.streamId, x: 100, y: 1});});
    expect(clicked.mock.lastCall![0].row).toBe(replacement[0]);
    await render(<VesoraChart {...base} data={[]} ref={reference} streaming={{maxPoints: 2}} />);
    expect(fig.layers[0].x).toEqual([]);
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('empty');
    await act(async () => {await reference.current!.appendRows(replacement);});
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
  });

  it('owns static rows, removed series and formats with the displayed frozen frame', async () => {
    const reference=createRef<VesoraChartHandle<Row>>(),clicked=vi.fn(),xHovered=vi.fn();
    await render(<VesoraChart {...base} ref={reference} onClick={clicked} onXHover={xHovered} hoverMode="x" yAxis={{format:'currency',currency:'USD',locale:'en-US'}}/>);
    const fig=current(),originalLayer=fig.layers[0].id;
    let mode='live';
    const inspection=()=>({mode,displayedStreams:{}});
    const frame=()=>{fig.emit('framepending',inspection());fig.emit('frame',inspection());};
    fig.getInspectionState=inspection;
    fig.freezeInspection=()=>{mode='frozen';fig.emit('inspectionchange',inspection());return inspection();};
    fig.resumeLive=async()=>{mode='live';fig.emit('inspectionchange',inspection());};
    await act(async()=>{frame();reference.current!.freezeInspection();});
    const replacement=[{id:'new',time:100,revenue:999,expense:.25}];
    await render(<VesoraChart {...base} data={replacement} series={[{key:'expense',label:'New expense'}]} ref={reference} onClick={clicked} onXHover={xHovered} hoverMode="x" yAxis={{format:'percent'}}/>);
    await act(async()=>{frame();fig.emit('click',{kind:'point',layerId:originalLayer,index:0,x:1,y:10});fig.emit('xhover',{cursorX:1,items:[{layerId:originalLayer,index:0,x:1,y:10}]});});
    expect(clicked.mock.lastCall![0]).toMatchObject({row:rows[0],series:{key:'revenue',label:'Revenue'},formattedX:'1',formattedY:'$10.00'});
    expect(clicked.mock.lastCall![0].row).toBe(rows[0]);
    expect(xHovered.mock.lastCall![0].items[0]).toMatchObject({row:rows[0],series:{key:'revenue'},formattedY:'$10.00'});
    expect(container.textContent).toContain('2 rows and 2 series');
    expect([...container.querySelectorAll('button')].map(button=>[button.textContent,button.disabled])).toEqual([['Revenue',true],['Expense',true]]);
    await act(async()=>{await reference.current!.resumeLive();frame();fig.emit('click',{kind:'point',layerId:fig.layers[1].id,index:0,x:100,y:.25});});
    expect(clicked.mock.lastCall![0]).toMatchObject({row:replacement[0],series:{key:'expense',label:'New expense'},formattedY:'25%'});
  });

  it.each([{replacement:[]},{replacement:[{id:'invalid',time:3,revenue:null,expense:NaN}]}])('keeps a frozen static frame visible when accepted data becomes empty: $replacement',async({replacement})=>{
    const reference=createRef<VesoraChartHandle<Row>>();
    await render(<VesoraChart {...base} ref={reference}/>);
    const fig=current();let mode='live';
    const inspection=()=>({mode,displayedStreams:{}}),frame=()=>{fig.emit('framepending',inspection());fig.emit('frame',inspection());};
    fig.getInspectionState=inspection;fig.freezeInspection=()=>{mode='frozen';fig.emit('inspectionchange',inspection());return inspection();};
    fig.resumeLive=async()=>{mode='live';fig.emit('inspectionchange',inspection());};
    await act(async()=>{frame();reference.current!.freezeInspection();});
    await render(<VesoraChart {...base} data={replacement as Row[]} ref={reference}/>);
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
    expect((container.querySelector('[data-vesora-host]') as HTMLElement).style.visibility).toBe('visible');
    expect(container.textContent).toContain('2 rows and 2 series');
    await act(async()=>{await reference.current!.resumeLive();});
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
    await act(async()=>{frame();});
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('empty');
  });

  it('keeps a frozen streaming frame visible when accepted NaNs evict every finite row',async()=>{
    const reference=createRef<VesoraChartHandle<Row>>();
    await render(<VesoraChart {...base} ref={reference} streaming={{maxPoints:2}}/>);
    const fig=current();let mode='live';
    let displayedStreams=Object.fromEntries(fig.layers.map((layer:any)=>[layer.id,{...layer.stream}]));
    const inspection=()=>({mode,displayedStreams});
    fig.getInspectionState=inspection;fig.freezeInspection=()=>{mode='frozen';fig.emit('inspectionchange',inspection());return inspection();};
    fig.resumeLive=async()=>{mode='live';fig.emit('inspectionchange',inspection());};
    await act(async()=>{fig.emit('framepending',inspection());fig.emit('frame',inspection());reference.current!.freezeInspection();});
    await act(async()=>{await reference.current!.appendRows([{id:'three',time:3,revenue:null,expense:NaN},{id:'four',time:4,revenue:null,expense:NaN}],{waitFor:'accepted'});});
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
    expect((container.querySelector('[data-vesora-host]') as HTMLElement).style.visibility).toBe('visible');
    await act(async()=>{await reference.current!.resumeLive();});
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('ready');
    await act(async()=>{displayedStreams=Object.fromEntries(fig.layers.map((layer:any)=>[layer.id,{...layer.stream}]));fig.emit('framepending',inspection());fig.emit('frame',inspection());});
    expect(container.querySelector('[data-vesora-chart]')?.getAttribute('data-vesora-state')).toBe('empty');
  });

  it('keeps callbacks bound to committed rows when a declarative replacement fails validation', async () => {
    const clicked = vi.fn();
    await render(<VesoraChart {...base} onClick={clicked} />);
    const fig = current();
    await render(<VesoraChart {...base} data={[{...rows[0], id: 'uncommitted', expense: 'invalid'}] as unknown as Row[]} onClick={clicked} />);
    await act(async () => {fig.emit('click', {kind: 'point', layerId: fig.layers[0].id, index: 0, x: 1, y: 10});});
    expect(clicked.mock.lastCall![0].row).toBe(rows[0]);
  });

  it('cancels queued appends after data replacement and rejects calls through an unmounted handle', async () => {
    const reference = createRef<VesoraChartHandle<Row>>();
    await render(<VesoraChart {...base} ref={reference} streaming={{maxPoints: 3}} />);
    const fig = current(), handle = reference.current!;
    state.delayed = true;
    let first!: Promise<void | string>, second!: Promise<void | string>;
    await act(async () => {
      first = handle.appendRows([{id: 'three', time: 3, revenue: 30, expense: 9}]).catch(error => error.message);
      second = handle.appendRows([{id: 'four', time: 4, revenue: 40, expense: 12}]).catch(error => error.message);
      await Promise.resolve();
    });
    state.delayed = false;
    await render(<VesoraChart {...base} data={[{id: 'reset', time: 100, revenue: 1, expense: 2}]} ref={reference} streaming={{maxPoints: 3}} />);
    await act(async () => {for (const waiter of fig.waiters) waiter.resolve(); await first;});
    expect(await first).toContain('replaced');
    expect(await second).toContain('replaced');
    expect(fig.layers[0].x).toEqual([100]);
    await render(null);
    await expect(handle.appendRows(rows)).rejects.toThrow('not mounted');
  });

  it('rejects unsupported streaming schemas before modifying the live chart', async () => {
    await render(<VesoraChart {...base} />);
    const fig = current();
    await render(<VesoraChart {...base} streaming={{maxPoints: 0}} />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('positive safe integer');
    expect(fig.layers[0].setData).not.toHaveBeenCalled();
    await render(<VesoraChart {...base} streaming={{maxPoints: 2}} series={[{key: 'revenue', band: {lowerKey: 'expense', upperKey: 'revenue'}}]} />);
    expect(container.querySelector('[role=alert]')?.textContent).toContain('without bands');
    expect(fig.layers[0].setData).not.toHaveBeenCalled();
  });
});
