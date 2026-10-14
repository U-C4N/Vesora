import {StrictMode, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VesoraChart} from '@vesora/react';
import type {ChartInteraction, ChartType, ChartXInteraction, ExportPNGOptions, VesoraChartHandle} from '@vesora/react';

interface Row {id: string; timestamp: number; revenue: number; expense: number | null; lower: number; upper: number}
const initial: Row[] = [
  {id: 'a', timestamp: Date.UTC(2026, 9, 1), revenue: 20, expense: 12, lower: 16, upper: 24},
  {id: 'b', timestamp: Date.UTC(2026, 9, 2), revenue: 40, expense: 25, lower: 34, upper: 46},
  {id: 'c', timestamp: Date.UTC(2026, 9, 3), revenue: 30, expense: 18, lower: 25, upper: 35},
];
const series = [{key: 'revenue' as const, label: 'Revenue', color: '#2563eb'}, {key: 'expense' as const, label: 'Expense', color: '#dc2626'}];
const quality = new URLSearchParams(window.location.search).has('quality');
const streaming = new URLSearchParams(window.location.search).has('streaming');
const initialData = quality ? initial.map(row => row.id === 'b' ? {...row, expense: null} : row) : initial;
const xAxis = {type: 'time' as const, timeZone: 'UTC', locale: 'en-US'};
const yAxis = {format: 'currency' as const, currency: 'TRY', locale: 'en-US'};

function Fixture() {
  const [data, setData] = useState(initialData);
  const [type, setType] = useState<ChartType>('line');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(true);
  const [clicked, setClicked] = useState('');
  const [selection, setSelection] = useState(0);
  const [lastError, setLastError] = useState('');
  const [band, setBand] = useState(quality);
  const [xHover, setXHover] = useState<ChartXInteraction<Row> | null>(null);
  const displayedSeries = useMemo(() => series.map(item => item.key === 'revenue' && type === 'line' && band ? {...item, band: {lowerKey: 'lower' as const, upperKey: 'upper' as const}} : item), [band, type]);
  const chart = useRef<VesoraChartHandle<Row>>(null);
  (window as unknown as {reactFixture: object}).reactFixture = {
    exportHTML: () => chart.current!.exportHTML(),
    exportPNG: async (options?: ExportPNGOptions) => (await chart.current!.exportPNG(options)).size,
    exportPNGDimensions: async (options?: ExportPNGOptions) => {
      const blob = await chart.current!.exportPNG(options), bitmap = await createImageBitmap(blob);
      const size = {width: bitmap.width, height: bitmap.height}; bitmap.close(); return size;
    },
    lastXHover: () => xHover,
    appendRows: (rows: Row[]) => chart.current!.appendRows(rows),
    reset: () => chart.current!.resetView(),
  };
  const click = (value: ChartInteraction<Row>) => setClicked(value.row?.id ?? '');
  return <>
    <div>
      <button onClick={() => setData(previous => previous.map(row => ({...row, revenue: row.revenue + 5})))}>Refresh data</button>
      <button onClick={() => setType(previous => previous === 'line' ? 'scatter' : 'line')}>Change type</button>
      <button onClick={() => setTheme(previous => previous === 'light' ? 'dark' : 'light')}>Change theme</button>
      <button onClick={() => setLoading(previous => !previous)}>Loading</button>
      <button onClick={() => setError(previous => previous ? null : 'The API is unavailable.')}>API error</button>
      <button onClick={() => setData([])}>Empty data</button>
      <button onClick={() => setData(initialData)}>Restore data</button>
      <button onClick={() => setMounted(previous => !previous)}>Toggle mount</button>
      <button onClick={() => {document.querySelector<HTMLElement>('#chart')!.style.width = '420px';}}>Resize card</button>
      {quality && <button onClick={() => setBand(previous => !previous)}>Toggle band</button>}
    </div>
    <div id="chart">{mounted && <VesoraChart ref={chart} type={type} data={data} xKey="timestamp" series={displayedSeries} title="Revenue trend" theme={theme} height={300}
      xAxis={xAxis} yAxis={yAxis} loading={loading} error={error}
      streaming={streaming ? {maxPoints: 3} : undefined}
      onClick={click} onSelection={value => setSelection(value.count)} onError={value => setLastError(value.message)}
      hoverMode={(quality || streaming) && type === 'line' ? 'x' : 'nearest'} onXHover={setXHover}
      renderXTooltip={value => <div data-testid="custom-x-tooltip">{value.items.map(item => <div key={item.series.key}>{item.series.label}: {item.row?.id ?? '—'} | {item.formattedX} | {item.formattedY}</div>)}</div>}
      renderTooltip={value => <div data-testid="custom-tooltip">{value.row?.id}: {value.formattedY}</div>} />}</div>
    <p>Clicked row: <span data-testid="clicked">{clicked}</span></p>
    <p>Selected rows: <span data-testid="selection-count">{selection}</span></p>
    <p data-testid="last-error">{lastError}</p>
    <table><thead><tr><th>ID</th><th>Revenue</th></tr></thead><tbody>{data.map(row => <tr key={row.id} data-selected={clicked === row.id}><td>{row.id}</td><td>{row.revenue}</td></tr>)}</tbody></table>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
