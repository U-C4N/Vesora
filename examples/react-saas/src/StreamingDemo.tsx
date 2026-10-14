import {useEffect, useRef, useState} from 'react';
import {VesoraChart, type VesoraChartHandle} from '@vesora/react';
import './streaming.css';

interface Sample {step: number; modelA: number; modelB: number; modelC: number}
const series = [
  {key: 'modelA' as const, label: 'Model A', color: '#3569c8'},
  {key: 'modelB' as const, label: 'Model B', color: '#137f8b'},
  {key: 'modelC' as const, label: 'Model C', color: '#d36a55'},
];
const xAxis = {label: 'Training step'}, yAxis = {label: 'Synthetic loss'};
const value = (step: number, model: number) => (model + 1) * .15 + 3 * Math.exp(-step / 2000) + .08 * Math.sin(step * .07 + model);

export function StreamingDemo() {
  const chart = useRef<VesoraChartHandle<Sample>>(null);
  const [data, setData] = useState<Sample[]>([]);
  const [paused, setPaused] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [received, setReceived] = useState(0);
  const [error, setError] = useState('');
  const nextStep = useRef(0);
  const pausedRef = useRef(paused);

  function pause() {
    pausedRef.current = true;
    setPaused(true);
  }

  function togglePlayback() {
    if (!pausedRef.current) {pause(); return;}
    chart.current?.resetView();
    pausedRef.current = false;
    setPaused(false);
  }

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        await new Promise(resolve => setTimeout(resolve, 50));
        if (cancelled) return;
        if (pausedRef.current) continue;
        const start = nextStep.current;
        const rows = Array.from({length: 100}, (_, index) => {
          const step = start + index;
          return {step, modelA: value(step, 0), modelB: value(step, 1), modelC: value(step, 2)};
        });
        nextStep.current += rows.length;
        try {
          await chart.current!.appendRows(rows);
          if (cancelled) return;
          setReceived(nextStep.current);
        } catch (caught) {
          if (cancelled) return;
          setError(caught instanceof Error ? caught.message : String(caught)); pause();
        }
      }
    };
    void run();
    return () => {cancelled = true;};
  }, [data]);

  async function download(format: 'png' | 'html') {
    try {
      const blob = format === 'png' ? await chart.current!.exportPNG({width: 1100, height: 600, scale: 2})
        : new Blob([await chart.current!.exportHTML()], {type: 'text/html'});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `telemetry-snapshot.${format}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) {setError(caught instanceof Error ? caught.message : String(caught));}
  }

  return <main className="streaming-demo" data-theme={theme}>
    <header><div><p>Vesora · React streaming</p><h1>Synthetic training telemetry</h1></div><a href="./">SaaS example →</a></header>
    <p>Three illustrative curves arrive together. Each model retains the latest 2,000 samples. Dragging, zooming or inspecting samples with the Left/Right, Home and End keys pauses updates. Resume returns to the current window and continues the stream.</p>
    <nav aria-label="Telemetry controls">
      <button onClick={togglePlayback}>{paused ? 'Resume' : 'Pause'}</button>
      <button onClick={() => chart.current?.resetView()}>Reset view</button>
      <button onClick={() => {nextStep.current = 0; setReceived(0); setError(''); setData([]);}}>Restart stream</button>
      <button onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>Switch theme</button>
      <button disabled={!received} onClick={() => void download('png')}>Export PNG</button>
      <button disabled={!received} onClick={() => void download('html')}>Export HTML</button>
    </nav>
    <p role="status">{paused ? 'Paused' : 'Live'} · {Math.min(received, 2000).toLocaleString()} retained samples per model · {received.toLocaleString()} received</p>
    {error && <p role="alert">{error}</p>}
    <div onPointerDownCapture={event => {if (event.isPrimary && event.button === 0) pause();}}
      onWheelCapture={pause}
      onKeyDownCapture={event => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) pause();}}>
      <VesoraChart ref={chart} type="line" data={data} xKey="step" series={series} streaming={{maxPoints: 2000}}
        title="Synthetic loss" height={480} theme={theme} xAxis={xAxis} yAxis={yAxis} hoverMode="x" />
    </div>
    <footer>Values are synthetic, not measured model results. HTML exports contain the retained data and a viewer; they do not resume this live producer.</footer>
  </main>;
}
