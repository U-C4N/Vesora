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
    setData = vi.fn(); setStyle = vi.fn(); setOptions = vi.fn(); setVisible = vi.fn(); remove = vi.fn();
    constructor(public x: unknown, public y: unknown, public style: unknown) {}
  }
  class FakeFigure {
    spec: any = {view: {kind: '2d', xScale: 'linear', yScale: 'linear', xLabel: '', yLabel: '', camera: {azimuth: 0, elevation: 0, distance: 3}}};
    layers: FakeLayer[] = []; listeners = new Map<string, (event: unknown) => void>(); element?: HTMLElement;
    waiters: Array<{resolve: () => void; reject: (error: Error) => void}> = [];
    closed = false;
    setTheme = vi.fn(); setSize = vi.fn(); setTitle = vi.fn(); setAxisFormat = vi.fn(); setBarMode = vi.fn(); setPresentation = vi.fn();
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
    close = vi.fn(() => {this.closed = true; this.element?.remove();});
    plot(x: unknown, y: unknown, style: unknown) {if (Array.isArray(x) && typeof x[0] === 'string') this.setCategories('x', x); const layer = new FakeLayer(x, y, style); this.layers.push(layer); return layer;}
    scatter(x: unknown, y: unknown, style: unknown) {return this.plot(x, y, style);}
    bar(x: unknown, y: unknown, style: unknown) {return this.plot(x, y, style);}
    barh(x: unknown, y: unknown, style: unknown) {if (Array.isArray(x) && typeof x[0] === 'string') this.setCategories('y', x); const layer = new FakeLayer(x, y, style); this.layers.push(layer); return layer;}
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

  it('waits for the current render before exporting and rejects export after unmount', async () => {
    const reference = createRef<VesoraChartHandle>();
    await render(<VesoraChart {...base} ref={reference} />);
    expect(await reference.current!.exportHTML()).toContain('chart source rows');
    expect((await reference.current!.exportPNG()).type).toBe('image/png');
    const handle = reference.current!;
    await render(null);
    await expect(handle.exportHTML()).rejects.toThrow('not mounted');
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
});
