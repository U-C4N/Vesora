import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {VesoraChart} from '@vesora/react';
import type {ChartAxis, ChartInteraction, VesoraChartHandle} from '@vesora/react';
import type {ThemeInput} from '@vesora/core';
import {createDashboard, fetchDashboard} from './api';
import type {AccountRow, DashboardData} from './api';
import {Icon, MetricSparkline, SignalOrbit, VesoraMark} from './components/Visuals';
import {CommandPalette} from './components/CommandPalette';
import type {CommandAction} from './components/CommandPalette';

type Lens = 'revenue' | 'activeUsers' | 'expansion';
const lenses: Array<{key: Lens; label: string; series: string; unit: string}> = [
  {key: 'revenue', label: 'Revenue', series: 'Daily revenue', unit: 'USD'},
  {key: 'activeUsers', label: 'Adoption', series: 'Active users', unit: 'people'},
  {key: 'expansion', label: 'Expansion', series: 'Expansion revenue', unit: 'USD'},
];
const currency = new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0});
const integer = new Intl.NumberFormat('en-US');
const date = new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
const HERO_THEME: ThemeInput = {
  background: '#1b221b', foreground: '#ecf0e4', muted: '#a0a997', grid: '#333e30', axis: '#454d3c',
  tooltipBackground: '#d1f58e', tooltipForeground: '#172010', selection: '#c6ed72',
  fontFamily: 'DM Sans, Segoe UI, sans-serif', fontSize: 12, palette: ['#c6ed72', '#a9a3cb'],
};
const PAPER_THEME: ThemeInput = {background: '#fffef9', foreground: '#262b21', muted: '#66715f', grid: '#e2e4d9', axis: '#c4cbb8', tooltipBackground: '#20271c', tooltipForeground: '#faf9f4', palette: ['#698d50', '#bccfa8'], fontFamily: 'DM Sans, Segoe UI, sans-serif', fontSize: 12};
const DARK_PAPER_THEME: ThemeInput = {...PAPER_THEME, background: '#1c231b', foreground: '#e8eddf', muted: '#b0b7a5', grid: '#363f2e', axis: '#5e6854', palette: ['#c6ed72', '#899b76']};
const TIME_AXIS: ChartAxis = {type: 'time', locale: 'en-US', timeZone: 'UTC'};
const MONEY_AXIS: ChartAxis = {format: 'currency', currency: 'USD', options: {notation: 'compact', maximumFractionDigits: 1}};
const NUMBER_AXIS: ChartAxis = {format: 'number', options: {notation: 'compact', maximumFractionDigits: 1}};
const SESSION_AXIS: ChartAxis = {label: 'Sessions'};
const planSeries = [{key: 'retained' as const, label: 'Existing accounts', color: '#78965d'}, {key: 'newAccounts' as const, label: 'New accounts', color: '#bdcea9'}];
const accountSeries = [{key: 'revenue' as const, label: 'Account revenue', color: '#799460', size: 8}];
const change = (values: number[]) => values.length > 1 && values[0] !== 0 ? (values.at(-1)! / values[0] - 1) * 100 : 0;
const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const formatMetric = (key: Lens, value: number) => key === 'activeUsers' ? integer.format(value) : currency.format(value);

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [days, setDays] = useState(30);
  const [lens, setLens] = useState<Lens>('revenue');
  const [compare, setCompare] = useState(false);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<DashboardData>(() => createDashboard());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fail, setFail] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const [activeNav, setActiveNav] = useState('overview');
  const [exportMessage, setExportMessage] = useState('');
  const [hover, setHover] = useState<{day: string; value: string} | null>(null);
  const trend = useRef<VesoraChartHandle>(null);
  const spotlight = useRef<HTMLDivElement>(null);
  const selectionOrigin = useRef<HTMLElement | null>(null);
  const selectionId = useRef<string | null>(null);
  const selectAccount = useCallback((id: string | null) => {
    selectionOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selectionId.current = id;
    setSelected(id); setPage(0);
  }, []);
  const clearAccount = useCallback(() => {
    setSelected(null);
    requestAnimationFrame(() => {
      const target = selectionOrigin.current?.isConnected ? selectionOrigin.current : document.getElementById(`inspect-${selectionId.current}`);
      target?.focus({preventScroll: true});
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    void fetchDashboard(revision, controller.signal, fail).then(result => {
      if (!controller.signal.aborted) {setData(result); setLoading(false); setSelected(null);}
    }).catch(caught => {
      if (!controller.signal.aborted) {setError(caught instanceof Error ? caught.message : String(caught)); setLoading(false);}
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {event.preventDefault(); setCommandOpen(value => !value);}
      if (event.key === 'Escape' && !commandOpen) clearAccount();
      const target = event.target;
      const editing = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable);
      if (event.key === '/' && !editing && !commandOpen && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault(); document.getElementById('account-search')?.focus();
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [commandOpen, clearAccount]);
  useEffect(() => {setHover(null); trend.current?.resetView();}, [lens, days]);
  useEffect(() => {
    if (selected && spotlight.current) {spotlight.current.focus({preventScroll: true});
      if (window.innerWidth < 1150) spotlight.current.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center'});
    }
  }, [selected]);

  const filtered = useMemo(() => data.trend.slice(-days), [data.trend, days]);
  const metric = lenses.find(item => item.key === lens)!;
  const values = filtered.map(row => row[lens]);
  const latest = filtered.at(-1)!;
  const delta = change(values);
  const peak = filtered.reduce((best, row) => row[lens] > best[lens] ? row : best, filtered[0]);
  const peakGap = peak[lens] ? (1 - latest[lens] / peak[lens]) * 100 : 0;
  const previous = data.trend.slice(-days * 2, -days);
  const comparisonAvailable = previous.length === filtered.length;
  const chartData = useMemo(() => {
    const prior = data.trend.slice(-days * 2, -days);
    return filtered.map((row, index) => ({timestamp: row.timestamp, value: row[lens], previous: prior.length === filtered.length ? prior[index][lens] : null}));
  }, [data.trend, filtered, days, lens]);
  const chartSeries = useMemo(() => [
    {key: 'value' as const, label: metric.series, color: '#c6ed72', width: 3},
    ...(compare && comparisonAvailable ? [{key: 'previous' as const, label: 'Prior period · aligned', color: '#a9a3cb', width: 2}] : []),
  ], [metric.series, compare, comparisonAvailable]);
  const selectedAccount = data.accounts.find(row => row.id === selected);
  const matchingAccounts = data.accounts.filter(row => (!plan || row.plan === plan) && (!selected || row.id === selected) && `${row.name} ${row.plan}`.toLowerCase().includes(query.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(matchingAccounts.length / 6));
  const safePage = Math.min(page, pageCount - 1);
  const visibleAccounts = matchingAccounts.slice(safePage * 6, (safePage + 1) * 6);
  const planCeiling = Math.max(100, Math.ceil(Math.max(...data.plans.map(row => row.retained + row.newAccounts)) / 100) * 100);
  const paperTheme = theme === 'light' ? PAPER_THEME : DARK_PAPER_THEME;
  const choosePlan = (value: string | null) => {setPlan(value); setSelected(null); setPage(0);};
  const accountClick = (value: ChartInteraction<AccountRow>) => {selectAccount(value.row?.id ?? null); setQuery(''); setPlan(null);};
  const planAxis = useMemo<ChartAxis>(() => ({format: 'number', options: {maximumFractionDigits: 0}, domain: [0, planCeiling]}), [planCeiling]);
  const refresh = () => setRevision(value => value + 1);
  const goTo = (id: string) => {setActiveNav(id); document.getElementById(id)?.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});};

  async function exportChart(format: 'png' | 'html') {
    if (loading || error || !trend.current) {setExportMessage('Wait for the signal to finish loading before exporting.'); return;}
    try {
      setExportMessage('');
      if (format === 'png') download(await trend.current!.exportPNG(), 'vesora-signal.png');
      else download(new Blob([await trend.current!.exportHTML()], {type: 'text/html;charset=utf-8'}), 'vesora-signal.html');
      setExportMessage(`${format.toUpperCase()} downloaded.`);
    } catch (caught) {setExportMessage(caught instanceof Error ? caught.message : String(caught));}
  }
  const actions: CommandAction[] = [
    ...lenses.map(item => ({id: item.key, label: `Explore ${item.label.toLowerCase()}`, description: 'Change the signal lens', keywords: 'chart trend metric', onSelect: () => {setLens(item.key); goTo('overview');}})),
    {id: 'refresh', label: 'Refresh workspace', description: 'Load the next synthetic snapshot', shortcut: '↻', onSelect: refresh},
    {id: 'theme', label: `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`, description: 'A different light, the same data', onSelect: () => setTheme(value => value === 'light' ? 'dark' : 'light')},
    {id: 'accounts', label: 'Find an account', description: 'Open your sampled account list', keywords: 'search customers', onSelect: () => {goTo('accounts'); document.getElementById('account-search')?.focus();}},
    ...(!loading && !error ? [{id: 'png', label: 'Export chart as PNG', description: 'Download the current signal', onSelect: () => void exportChart('png')}] : []),
    {id: 'reset', label: 'Reset chart view', description: 'Return to the full visible period', onSelect: () => trend.current?.resetView()},
  ];

  return <div className="dashboard" data-theme={theme}>
    <a className="skip-link" href="#overview">Skip to workspace</a>
    <aside className="sidebar" aria-label="Studio navigation">
      <a className="brand" href="#overview" aria-label="Vesora Signal Studio" onClick={() => setActiveNav('overview')}><VesoraMark size={40} className="brand-mark" /></a>
      <div className="rail-divider" />
      <nav className="rail-nav" aria-label="Dashboard">
        {[{id: 'overview', label: 'Overview', icon: 'grid' as const}, {id: 'plans', label: 'Plans', icon: 'chart' as const}, {id: 'accounts', label: 'Accounts', icon: 'users' as const}].map(item => <a key={item.id} href={`#${item.id}`} className={activeNav === item.id ? 'active' : ''} aria-current={activeNav === item.id ? 'location' : undefined} onClick={() => setActiveNav(item.id)}><Icon name={item.icon} size={22} /><span className="nav-text">{item.label}</span></a>)}
      </nav>
      <div className="rail-bottom"><button type="button" className="rail-command" aria-label="Open quick actions" onClick={() => setCommandOpen(true)}><Icon name="command" size={22} /></button><span className="rail-version">v0.6</span><span className="avatar" title="Demo workspace owner">JD</span></div>
    </aside>
    <main id="overview" tabIndex={-1}>
      <header className="topbar">
        <div className="workspace-switcher"><span className="workspace-icon">N<span /></span><div><strong>Northstar Studio</strong><span>Workspace / <b>Overview</b></span></div></div>
        <div className="topbar-actions"><span className="live-badge"><span className="status-dot" />Synthetic workspace</span><button className="quick-action-button" type="button" onClick={() => setCommandOpen(true)}><Icon name="search" /><span>Quick actions</span><kbd>⌘ K</kbd></button><button className="theme-button" type="button" onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button></div>
      </header>
      <section className="page-heading"><div><p className="eyebrow"><span />YOUR DAILY PERSPECTIVE</p><h1>See what <span className="heading-accent">moves.</span></h1><p>Less noise. More of the story behind your growth.</p></div>
        <div className="page-actions"><label className="date-control"><Icon name="filter" /><select aria-label="Period" value={days} onChange={event => {setDays(Number(event.target.value)); setCompare(false);}}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select><Icon name="chevron" size={14} /></label><button className="primary-button" type="button" onClick={refresh} disabled={loading}><Icon name="refresh" className={loading ? 'spinning' : undefined} />{loading ? 'Refreshing…' : 'Refresh data'}</button></div>
      </section>
      <section className="metrics" aria-label="Key metrics">
        {[{key: 'revenue' as const, label: 'Daily revenue', featured: true}, {key: 'activeUsers' as const, label: 'Active users', featured: false}, {key: 'expansion' as const, label: 'Expansion revenue', featured: false}].map(item => {
          const seriesValues = filtered.map(row => row[item.key]), growth = change(seriesValues);
          return <article className={`metric ${item.featured ? 'metric-featured' : ''}`} key={item.key}><div className="metric-head"><span>{item.label}</span><Icon name="arrow" size={15} /></div><div className="metric-value">{formatMetric(item.key, latest[item.key])}</div><div className="metric-bottom"><span className={`metric-change ${growth >= 0 ? 'positive' : 'negative'}`}>{percent(growth)}<span> this period</span></span><MetricSparkline values={seriesValues} width={96} height={34} className="sparkline" /></div></article>;
        })}
        <article className="metric"><div className="metric-head"><span>Accounts in focus</span><Icon name="users" size={16} /></div><div className="metric-value">{integer.format(data.accounts.length)}<span className="metric-unit"> sampled</span></div><div className="metric-bottom"><div className="avatar-stack"><span>A</span><span>N</span><span>C</span><span>+{data.accounts.length - 3}</span></div><span className="metric-caption">Three plans. One picture.</span></div></article>
      </section>

      <div className="hero-grid">
        <section className="card trend-card" aria-labelledby="signal-heading">
          <div className="card-heading"><div><p className="section-index">01 / THE SIGNAL</p><h2 id="signal-heading">{metric.label === 'Revenue' ? 'Revenue rhythm' : `${metric.label} rhythm`}</h2></div><div className="hero-tools"><button type="button" className={`compare-button ${compare ? 'is-active' : ''}`} aria-label="Compare" aria-pressed={compare} disabled={!comparisonAvailable || loading || !!error} onClick={() => setCompare(value => !value)}><span className="compare-mark">∥</span>Compare</button><button type="button" className="icon-button" aria-label="Reset chart view" onClick={() => trend.current?.resetView()}><Icon name="expand" /></button></div></div>
          <div className="hero-summary"><div className="hero-number"><strong className="hero-value">{formatMetric(lens, latest[lens])}</strong><span className={`hero-delta ${delta >= 0 ? 'positive' : 'negative'}`}><Icon name="arrow" size={15} />{percent(delta)}<span>over {days} days</span></span></div><div className="signal-lenses" aria-label="Signal lens">{lenses.map(item => <button type="button" key={item.key} aria-pressed={lens === item.key} onClick={() => setLens(item.key)}>{item.label}</button>)}</div></div>
          <VesoraChart ref={trend} type="line" data={chartData} xKey="timestamp" series={chartSeries} theme={HERO_THEME} height={335}
            xAxis={TIME_AXIS} yAxis={lens === 'activeUsers' ? NUMBER_AXIS : MONEY_AXIS}
            loading={loading} error={error} onHover={value => setHover(value ? {day: value.formattedX, value: value.formattedY} : null)}
            aria-label="Selected signal by day" renderLoading={() => <div className="chart-loading"><span className="loading-line" /><span>Finding your signal…</span></div>} />
          <div className="coordinate-ribbon"><span className="ribbon-dot" /><span>{hover ? hover.day : `${date.format(filtered[0].timestamp)} — ${date.format(latest.timestamp)}`}</span><span className="ribbon-divider" /><strong>{hover ? hover.value : `${filtered.length} observations`}</strong><span className="ribbon-help">{hover ? metric.series : 'Hover to take a closer look'}</span></div>
          <div className="export-row"><details className="export-note"><summary><span>Made to be explored.</span><Icon name="chevron" size={12} /></summary><p>Interactive HTML includes every chart source row. Custom application callbacks are not included.</p></details><div className="export-actions"><button type="button" onClick={() => void exportChart('png')} disabled={loading || !!error}><Icon name="download" size={14} />PNG</button><button type="button" onClick={() => void exportChart('html')} disabled={loading || !!error}>Interactive HTML<Icon name="arrow" size={14} /></button></div></div>
          <p className="export-status" role="status">{exportMessage}</p>
        </section>
        <aside className="insight-card" aria-label="Signal perspective">
          {selectedAccount ? <div className="account-spotlight" ref={spotlight} tabIndex={-1} role="region" aria-labelledby="spotlight-heading"><div className="insight-eyebrow"><span>ACCOUNT SPOTLIGHT</span><button type="button" className="icon-button" aria-label="Clear account spotlight" onClick={clearAccount}><Icon name="close" /></button></div><span className="spotlight-avatar">{selectedAccount.name[0]}</span><h2 id="spotlight-heading">{selectedAccount.name}</h2><span className="plan-tag">{selectedAccount.plan} plan</span><strong className="insight-number">{currency.format(selectedAccount.revenue)}</strong><p className="insight-copy">Account revenue in this synthetic snapshot.</p><dl className="insight-breakdown"><div><dt>Sessions</dt><dd>{selectedAccount.sessions}</dd></div><div><dt>Team seats</dt><dd>{selectedAccount.seats}</dd></div></dl><div className="spotlight-decoration"><VesoraMark size={104} /></div><button className="insight-footer" type="button" onClick={() => goTo('accounts')}>Open account details<Icon name="arrow" /></button></div>
            : <><div className="insight-eyebrow"><span>02 / A LITTLE PERSPECTIVE</span><VesoraMark size={24} /></div><h2>A high point.<br />A clearer path.</h2><strong className="insight-number">{peakGap.toFixed(1)}%</strong><p className="insight-caption">{peakGap < 0.05 ? 'at the period high' : 'below the period high'}</p><p className="insight-copy">{metric.series} peaked at <strong>{formatMetric(lens, peak[lens])}</strong>. Your latest value is <strong>{formatMetric(lens, latest[lens])}</strong>.</p><dl className="insight-breakdown"><div><dt>Peak day</dt><dd>{date.format(peak.timestamp)}</dd></div><div><dt>Since day one</dt><dd>{percent(delta)}</dd></div></dl><div className="orbit-wrap"><div className="orbit-heading"><span>YOUR ACCOUNT CONSTELLATION</span><span>{data.accounts.length} sampled</span></div><SignalOrbit compact accounts={data.accounts} selectedPlan={plan} onSelectPlan={choosePlan} /></div><button className="insight-footer" type="button" onClick={() => goTo('accounts')}>Meet the accounts behind it<Icon name="arrow" /></button></>}
        </aside>
      </div>

      <div className="chart-grid">
        <section className="card plan-card" id="plans"><div className="card-heading"><div><p className="section-index">03 / THE MIX</p><h2>A plan for every stage.</h2><p>Existing and newly added subscriptions</p></div><span className="chart-badge">Full sample</span></div><VesoraChart type="bar" data={data.plans} xKey="plan" series={planSeries} barMode="stack" theme={paperTheme} height={245} loading={loading} error={error} yAxis={planAxis} aria-label="Existing and new accounts by subscription plan" /></section>
        <section className="card activity-card"><div className="card-heading"><div><p className="section-index">04 / THE PEOPLE</p><h2>Every dot has a story.</h2><p>Click an account to put it in focus</p></div><button type="button" className="text-button" onClick={clearAccount} disabled={!selected}>Clear detail<Icon name="close" size={12} /></button></div><VesoraChart type="scatter" data={data.accounts} xKey="sessions" series={accountSeries} theme={paperTheme} height={245} loading={loading} error={error} xAxis={SESSION_AXIS} yAxis={MONEY_AXIS} onClick={accountClick} renderTooltip={value => <><strong>{value.row?.name}</strong><div>{value.row?.plan} · {value.formattedY}</div><div>{value.formattedX} sessions</div></>} aria-label="Account sessions and revenue" /></section>
      </div>

      <section className="card accounts-card" id="accounts"><div className="card-heading"><div><p className="section-index">05 / A CLOSER LOOK</p><h2>The names behind the numbers.</h2><p>{selected ? 'One account. A little more context.' : '24 sampled accounts, ready to explore.'}</p></div><span className="chart-badge">{matchingAccounts.length} in view</span></div>
        <div className="table-toolbar"><div className="plan-filters" aria-label="Filter accounts by plan">{[null, 'Starter', 'Pro', 'Business'].map(value => <button type="button" key={value ?? 'all'} aria-pressed={plan === value} onClick={() => choosePlan(value)}>{value ?? 'All accounts'}</button>)}</div><label className="search-input"><Icon name="search" size={16} /><input id="account-search" aria-label="Search accounts" placeholder="Find an account…" value={query} onChange={event => {setQuery(event.target.value); setPage(0); setSelected(null);}} /><kbd>/</kbd></label></div>
        <div className="table-scroll"><table><thead><tr><th>Account</th><th>Plan</th><th>Team</th><th>Sessions</th><th className="numeric">Revenue</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{visibleAccounts.map(row => <tr key={row.id} data-selected={selected === row.id}><td><button className="account-name" type="button" onClick={() => selectAccount(row.id)}><span className={`account-avatar avatar-${row.plan.toLowerCase()}`}>{row.name[0]}</span><span><strong>{row.name}</strong><span>Workspace {row.id.split('-')[1].padStart(2, '0')}</span></span></button></td><td><span className={`plan-tag plan-${row.plan.toLowerCase()}`}>{row.plan}</span></td><td>{row.seats}<span className="cell-muted"> seats</span></td><td>{integer.format(row.sessions)}</td><td className="numeric">{currency.format(row.revenue)}</td><td><button className="row-action" id={`inspect-${row.id}`} type="button" aria-label={`Inspect ${row.name}`} onClick={() => selectAccount(row.id)}><Icon name="arrow" size={16} /></button></td></tr>)}</tbody></table>{!matchingAccounts.length && <div className="table-empty"><Icon name="search" size={26} /><strong>No accounts in this view.</strong><button type="button" onClick={() => {setQuery(''); choosePlan(null);}}>Clear filters</button></div>}</div>
        <div className="table-pagination"><span>{matchingAccounts.length ? `${safePage * 6 + 1}–${Math.min((safePage + 1) * 6, matchingAccounts.length)}` : '0'} <span className="cell-muted">of {matchingAccounts.length} accounts</span></span><div><button type="button" aria-label="Previous account page" disabled={safePage === 0} onClick={() => setPage(value => Math.max(0, value - 1))}><Icon name="chevron" className="rotate-right" size={14} /></button><span>{safePage + 1} / {pageCount}</span><button type="button" aria-label="Next account page" disabled={safePage + 1 >= pageCount} onClick={() => setPage(value => value + 1)}><Icon name="chevron" className="rotate-left" size={14} /></button></div></div>
      </section>
      <footer><div className="footer-brand"><VesoraMark size={20} /><span>vesora <b>Signal Studio</b></span></div><span className="demo-notice">Synthetic demo data<span className="status-dot" />Updated snapshot #{data.revision}</span><details className="demo-controls"><summary>Demo controls<Icon name="chevron" size={12} /></summary><label><input type="checkbox" checked={fail} onChange={event => setFail(event.target.checked)} />Simulate API failure on next refresh</label><span>Local preview · v0.6 · MIT</span></details></footer>
    </main>
    <CommandPalette open={commandOpen} onClose={() => setCommandOpen(false)} actions={actions} />
  </div>;
}
