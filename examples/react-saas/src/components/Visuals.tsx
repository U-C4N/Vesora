import {useId} from 'react';
import type {CSSProperties} from 'react';
import type {AccountRow} from '../api';

export type IconName = 'arrow' | 'refresh' | 'moon' | 'sun' | 'search' | 'grid' | 'chart' | 'users' | 'download' | 'chevron' | 'close' | 'command' | 'filter' | 'expand' | 'pause' | 'play';

export {VesoraMark} from './VesoraMark';

const iconPaths: Record<IconName, React.ReactNode> = {
  arrow: <><path d="M6 18 18 6M6 6h12v12" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M19.5 12a7.5 7.5 0 0 0-12.8-5.3L4 9m16 6-2.7 2.3A7.5 7.5 0 0 1 4.5 12" /></>,
  moon: <path d="M20.1 14.3A8.4 8.4 0 0 1 9.7 3.9 8.4 8.4 0 1 0 20.1 14.3Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></>,
  grid: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5" /><rect x="14" y="14" width="6.5" height="6.5" rx="1.5" /></>,
  chart: <><path d="M4 3v17h17M7 14l4-5 4 3 5-7" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  command: <path d="M8 8H5.5A2.5 2.5 0 1 1 8 5.5V18.5A2.5 2.5 0 1 1 5.5 16H18.5A2.5 2.5 0 1 1 16 18.5V5.5A2.5 2.5 0 1 1 18.5 8H8Z" />,
  filter: <><path d="M4 6h16M7 12h10m-7 6h4" /><circle cx="9" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  expand: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  pause: <><path d="M8 5v14M16 5v14" strokeWidth="3" /></>,
  play: <path d="m8 4 12 8-12 8V4Z" />,
};

/** Decorative icon: put the accessible name on its containing control. */
export function Icon({name, size = 18, className, strokeWidth = 1.65}: {name: IconName; size?: number; className?: string; strokeWidth?: number}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>{iconPaths[name]}</svg>;
}

function sparklinePath(points: Array<[number, number]>): string {
  if (!points.length) return '';
  let path = `M${points[0][0]},${points[0][1]}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1], current = points[index];
    const middle = (previous[0] + current[0]) / 2;
    path += `C${middle},${previous[1]} ${middle},${current[1]} ${current[0]},${current[1]}`;
  }
  return path;
}

/** Every point comes from the supplied series; no placeholder trend is added. */
export function MetricSparkline({values, color = 'currentColor', width = 148, height = 42, className, label}: {values: number[]; color?: string; width?: number; height?: number; className?: string; label?: string}) {
  const id = useId();
  const series = values.filter(Number.isFinite);
  const minimum = Math.min(...series), maximum = Math.max(...series);
  const margin = 4, innerWidth = Math.max(0, width - margin * 2), innerHeight = Math.max(0, height - margin * 2);
  const points: Array<[number, number]> = series.map((value, index) => [
    series.length === 1 ? width / 2 : margin + index / (series.length - 1) * innerWidth,
    maximum === minimum ? height / 2 : height - margin - (value - minimum) / (maximum - minimum) * innerHeight,
  ]);
  const line = sparklinePath(points), last = points.at(-1);
  const area = points.length > 1 ? `${line}L${last![0]},${height}L${points[0][0]},${height}Z` : '';
  return <svg className={className} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? 'img' : undefined} aria-labelledby={label ? `${id}-title` : undefined} aria-hidden={label ? undefined : true} style={{overflow: 'visible', color}}>
    {label && <title id={`${id}-title`}>{label}</title>}
    <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".19" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
    {area && <path d={area} fill={`url(#${id}-fill)`} />}
    {line && <path d={line} stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
    {last && <circle cx={last[0]} cy={last[1]} r="2.7" fill="currentColor" />}
  </svg>;
}

const orbitPalette = ['#354c25', '#476c62', '#766282', '#ad7753'];
const orbitButtonStyle: CSSProperties = {appearance: 'none', border: '1px solid var(--border, rgba(155, 157, 148, .2))', borderRadius: 12, color: 'inherit', background: 'transparent', padding: '10px 12px', cursor: 'pointer', textAlign: 'left', font: 'inherit', minWidth: 0};

/** A grouping of real account rows. Dot positions are layout, not correlations. */
export function SignalOrbit({accounts, selectedPlan = null, onSelectPlan, className, compact = false}: {accounts: AccountRow[]; selectedPlan?: string | null; onSelectPlan?: (plan: string | null) => void; className?: string; compact?: boolean}) {
  const id = useId();
  const plans = Array.from(new Set(accounts.map(account => account.plan))).map(plan => {
    const rows = accounts.filter(account => account.plan === plan);
    return {plan, count: rows.length, revenue: rows.reduce((sum, account) => sum + account.revenue, 0), rows};
  });
  const width = Math.max(300, plans.length * 128), height = 174;
  return <div className={className}>
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-labelledby={`${id}-title ${id}-description`} style={{display: 'block'}}>
      <title id={`${id}-title`}>Accounts grouped by subscription plan</title>
      <desc id={`${id}-description`}>Each dot represents one account. {plans.map(group => `${group.plan}: ${group.count} accounts`).join('; ')}. Positions within each group are decorative.</desc>
      {plans.map((group, groupIndex) => {
        const centerX = width / plans.length * (groupIndex + .5), centerY = height / 2;
        const color = orbitPalette[groupIndex % orbitPalette.length], dimmed = selectedPlan !== null && selectedPlan !== group.plan;
        return <g key={group.plan} opacity={dimmed ? .25 : 1}>
          <circle cx={centerX} cy={centerY} r="54" fill="none" stroke="currentColor" opacity=".09" strokeDasharray="2 6" />
          <circle cx={centerX} cy={centerY} r="36" fill="none" stroke={color} opacity=".2" />
          <circle cx={centerX} cy={centerY} r="19" fill={color} opacity=".08" />
          {group.rows.map((account, accountIndex) => {
            const angle = accountIndex / group.rows.length * Math.PI * 2 - Math.PI / 2;
            const ring = accountIndex % 2 ? 54 : 36;
            return <circle key={account.id} cx={centerX + Math.cos(angle) * ring} cy={centerY + Math.sin(angle) * ring} r="3.3" fill={color}><title>{account.name} · {account.plan}</title></circle>;
          })}
          <text x={centerX} y={centerY + 5} textAnchor="middle" fill="currentColor" style={{fontFamily: 'inherit', fontSize: 16, fontWeight: 600}}>{group.count}</text>
        </g>;
      })}
    </svg>
    <div className={`orbit-controls${compact ? ' orbit-controls-compact' : ''}`} style={{display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, plans.length)}, minmax(0, 1fr))`, gap: 8}}>
      {plans.map((group, index) => {
        const selected = selectedPlan === group.plan;
        const contents = <><span style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 12}}><span style={{width: 5, height: 5, borderRadius: '50%', background: orbitPalette[index % orbitPalette.length]}} />{group.plan}</span>{!compact && <><strong style={{display: 'block', fontSize: 14, marginTop: 5}}>{group.revenue.toLocaleString('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0})}</strong><span style={{display: 'block', opacity: .7, fontSize: 12, marginTop: 3}}>total account revenue</span></>}</>;
        return onSelectPlan ? <button type="button" key={group.plan} aria-pressed={selected} aria-label={`${group.plan}, ${group.count} accounts. ${selected ? 'Clear plan filter' : 'Filter accounts by this plan'}`} onClick={() => onSelectPlan(selected ? null : group.plan)} style={{...orbitButtonStyle, borderColor: selected ? orbitPalette[index % orbitPalette.length] : undefined}}>{contents}</button> : <div key={group.plan} style={{...orbitButtonStyle, cursor: 'default'}}>{contents}</div>;
      })}
    </div>
  </div>;
}
