import {StrictMode, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VesoraChart} from '@vesora/react';
import type {ChartInteraction, ChartType, VesoraChartHandle} from '@vesora/react';

interface Row {id: string; timestamp: number; revenue: number; expense: number}
const initial: Row[] = [
  {id: 'a', timestamp: Date.UTC(2026, 9, 1), revenue: 20, expense: 12},
  {id: 'b', timestamp: Date.UTC(2026, 9, 2), revenue: 40, expense: 25},
  {id: 'c', timestamp: Date.UTC(2026, 9, 3), revenue: 30, expense: 18},
];
const series = [{key: 'revenue' as const, label: 'Revenue', color: '#2563eb'}, {key: 'expense' as const, label: 'Expense', color: '#dc2626'}];

function Fixture() {
  const [data, setData] = useState(initial);
  const [type, setType] = useState<ChartType>('line');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(true);
  const [clicked, setClicked] = useState('');
  const [selection, setSelection] = useState(0);
  const [lastError, setLastError] = useState('');
  const chart = useRef<VesoraChartHandle>(null);
  (window as unknown as {reactFixture: object}).reactFixture = {
    exportHTML: () => chart.current!.exportHTML(),
    exportPNG: async () => (await chart.current!.exportPNG()).size,
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
      <button onClick={() => setData(initial)}>Restore data</button>
      <button onClick={() => setMounted(previous => !previous)}>Toggle mount</button>
      <button onClick={() => {document.querySelector<HTMLElement>('#chart')!.style.width = '420px';}}>Resize card</button>
    </div>
    <div id="chart">{mounted && <VesoraChart ref={chart} type={type} data={data} xKey="timestamp" series={series} title="Revenue trend" theme={theme} height={300}
      xAxis={{type: 'time', timeZone: 'UTC', locale: 'en-US'}} yAxis={{format: 'currency', currency: 'TRY', locale: 'en-US'}} loading={loading} error={error}
      onClick={click} onSelection={value => setSelection(value.count)} onError={value => setLastError(value.message)}
      renderTooltip={value => <div data-testid="custom-tooltip">{value.row?.id}: {value.formattedY}</div>} />}</div>
    <p>Clicked row: <span data-testid="clicked">{clicked}</span></p>
    <p>Selected rows: <span data-testid="selection-count">{selection}</span></p>
    <p data-testid="last-error">{lastError}</p>
    <table><thead><tr><th>ID</th><th>Revenue</th></tr></thead><tbody>{data.map(row => <tr key={row.id} data-selected={clicked === row.id}><td>{row.id}</td><td>{row.revenue}</td></tr>)}</tbody></table>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
