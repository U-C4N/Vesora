import {useEffect, useRef, useState} from 'react';
import * as core from '@vesora/core/runtime';
import {VesoraViewer} from '@vesora/react/viewer';
import {createWorkspace, type Workspace, type CohortRow} from '../../web/v1-scenarios.js';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function V1Demo() {
  const [kind, setKind] = useState('gallery'), [dataset, setDataset] = useState('sensor');
  const [workspace, setWorkspace] = useState<Workspace>(), [theme, setTheme] = useState<'light'|'dark'>('dark');
  const active = useRef<Workspace | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [frozen, setFrozen] = useState(false);
  const [end, setEnd] = useState(31), [maxTime, setMaxTime] = useState(31), [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<CohortRow[]>([]), [total, setTotal] = useState(0), [nextOffset, setNextOffset] = useState<number|null>(null);
  const [status, setStatus] = useState('Opening synthetic workspace…');
  useEffect(() => {
    let current: Workspace | undefined;
    setError(''); setFrozen(false); setOffset(0); setReady(false);
    try {
      current = createWorkspace(core, kind, dataset);
      active.current = current;
      current.figure.setTheme(theme);
      setWorkspace(current); setEnd(current.timeMax); setMaxTime(current.timeMax);
      setStatus(`Opening · ${kind} · synthetic ${dataset} data`);
    } catch (caught) {setWorkspace(undefined); setError(caught instanceof Error ? caught.message : String(caught));}
    return () => {if (active.current === current) active.current = undefined; current?.dispose();};
    // Theme changes update the mounted figure separately.
  }, [kind, dataset]);
  useEffect(() => {workspace?.figure.setTheme(theme);}, [workspace, theme]);
  function refresh(current = workspace, pageOffset = offset) {
    const page = current?.queryRows?.(pageOffset);
    setRows(page?.rows ?? []); setTotal(page?.total ?? 0); setNextOffset(page?.nextOffset ?? null);
  }
  useEffect(() => {
    refresh(workspace, offset);
    return workspace?.figure.on('selection', () => {setOffset(0); refresh(workspace, 0);});
  }, [workspace, offset]);
  async function action(task: () => Promise<void> | void) {
    if (busy || !workspace) return;
    setBusy(true); setError('');
    try {await task();} catch (caught) {setError(caught instanceof Error ? caught.message : String(caught));}
    finally {setBusy(false);}
  }
  const button = {padding: '9px 12px', borderRadius: 6, border: '1px solid #718295', background: theme === 'dark' ? '#17212b' : '#fff', color: 'inherit', font: 'inherit', cursor: 'pointer'};
  return <main style={{minHeight: '100vh', padding: '28px clamp(12px,3vw,40px)', background: theme === 'dark' ? '#10151b' : '#edf3f6', color: theme === 'dark' ? '#e6edf5' : '#182b3a', fontFamily: 'system-ui,sans-serif'}}>
    <header style={{display: 'flex', justifyContent: 'space-between', gap: 20}}><a href="./" style={{color: '#168f7d'}}>vesora.</a><span>1.0 · SYNTHETIC ANALYSIS LAB</span></header>
    <h1 style={{fontSize: 'clamp(30px,4vw,52px)', letterSpacing: -1.5}}>Find the event. Follow the observations.</h1>
    <p>Ten chart families and three working analysis flows. Every value is synthetic.</p>
    <div aria-label="Workspace controls" style={{display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', margin: '20px 0'}}>
      <label>Workspace <select aria-label="Workspace" value={kind} disabled={busy} onChange={event => setKind(event.target.value)} style={button}><option value="gallery">Ten-chart gallery</option><option value="signal">Signal inspection</option><option value="comparison">Run comparison</option><option value="cohort">Cohort explorer</option></select></label>
      <label>Dataset <select aria-label="Dataset" value={dataset} disabled={busy} onChange={event => setDataset(event.target.value)} style={button}><option value="sensor">Synthetic sensor</option><option value="service">Synthetic service</option></select></label>
      <button style={button} onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>Use {theme === 'dark' ? 'light' : 'dark'} theme</button>
      <button style={button} disabled={busy || !ready} onClick={() => void action(async () => {if (workspace!.figure.getInspectionState().mode === 'frozen') {await workspace!.figure.resumeLive(); setFrozen(false); setStatus('Live displayed view resumed.');} else {workspace!.figure.freezeInspection(); setFrozen(true); setStatus('Displayed observation frozen; appends may continue.');}})}>{frozen ? 'Resume live view' : 'Freeze view'}</button>
      <button style={button} disabled={busy || !ready || !workspace?.append} onClick={() => void action(async () => {const result = await workspace!.append!(); setMaxTime(result.timeMax); setEnd(result.timeMax); setStatus(`Accepted through ${result.timeMax} s · ${result.retained}/32 retained rows${frozen ? ' · displayed observation remains frozen' : ''}`);})}>Append 8 samples</button>
      <button style={button} disabled={busy || !ready} onClick={() => void action(async () => download(await workspace!.figure.savefig({source: 'displayed'}), 'vesora-observation.png'))}>Export PNG</button>
      <button style={button} disabled={busy || !ready} onClick={() => void action(async () => download(new Blob([await core.toHTMLAsync(workspace!.figure, {source: 'displayed', observation: true})], {type: 'text/html'}), 'vesora-observation.html'))}>Export displayed HTML</button>
    </div>
    <p>{workspace?.summary}</p>
    {workspace?.setWindow && <label>Shared time-window end <input aria-label="Shared time-window end" type="range" min={kind === 'comparison' ? -20 : 0} max={maxTime} value={end} onChange={event => {const value = Number(event.target.value); setEnd(value); workspace.setWindow!(value);}} /><output>{end} s</output></label>}
    {error ? <p role="alert">{error}</p> : <p role="status">{status}</p>}
    {workspace && <VesoraViewer figure={workspace.figure} mode="embed" theme={theme} observation exportSource="displayed" onReady={viewer => {void viewer.figure.ready().then(() => {if (active.current?.figure === viewer.figure && viewer.element.isConnected) {setError(''); setReady(true); setStatus(`Ready · ${workspace.kind} · synthetic ${workspace.dataset} data`);}}).catch(caught => {if (active.current?.figure === viewer.figure && viewer.element.isConnected) setError(caught.message);});}} onError={caught => {if (active.current === workspace) setError(caught.message);}} />}
    {workspace?.queryRows && <section aria-label="Selected cohort" style={{marginTop: 24}}>
      <div style={{display: 'flex', gap: 12, alignItems: 'center'}}><button style={button} disabled={busy} onClick={() => void action(() => {workspace.selectHigh!(); setOffset(0); refresh(workspace, 0);})}>Select latency ≥75</button><button style={button} disabled={busy} onClick={() => void action(() => {workspace.clear!(); setOffset(0); refresh(workspace, 0);})}>Clear selection</button><button style={button} disabled={nextOffset === null} onClick={() => setOffset(nextOffset!)}>Next page</button><output>{total} observations · page {Math.floor(offset / 12) + 1}</output></div>
      <div style={{overflowX: 'auto'}}><table style={{width: '100%', borderCollapse: 'collapse', marginTop: 12}}><thead><tr>{['Stable ID', 'Group', 'Latency', 'Cost', 'Quality'].map(label => <th key={label} style={{textAlign: 'left', padding: 8}}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{[row.id, row.group, row.latency, row.cost, row.quality.toFixed(2)].map((value, index) => <td key={index} style={{padding: 8, borderTop: '1px solid #718295'}}>{value}</td>)}</tr>)}</tbody></table></div>
    </section>}
    <p style={{fontSize: 12, marginTop: 24}}>HTML preserves a retained observation; it does not reconnect a producer. Spectral values and events are illustrative. Signal history is limited to 32 time rows.</p>
  </main>;
}
