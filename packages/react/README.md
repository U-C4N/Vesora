# @vesora/react

Declarative React + TypeScript charts for SaaS dashboards. `VesoraChart` supports line, bar and scatter charts, independent responsive cards, light/dark themes, date/currency/percent formatting, custom React tooltips, an accessible interactive legend, and loading/empty/error states.

**v0.6 preview:** build from the Vesora checkout. Creating packages does not publish them to npm. With the generated release tarballs available locally:

```bash
npm install react react-dom ./vesora-core-0.6.0.tgz ./vesora-react-0.6.0.tgz
```

After registry publication, the ordinary installation is `npm install @vesora/react react react-dom`. React 18.3 and React 19 are supported peer ranges; React is not bundled into this package. Rendering requires browser APIs and WebGL2. For Next.js, use the component inside a client boundary (`'use client'`).

```tsx
import {VesoraChart} from '@vesora/react';

const rows = [
  {timestamp: Date.UTC(2026, 9, 1), revenue: 12500},
  {timestamp: Date.UTC(2026, 9, 2), revenue: 13200},
];

export function RevenueCard() {
  return <VesoraChart
    type="line"
    data={rows}
    xKey="timestamp"
    series={[{key: 'revenue', label: 'Revenue', color: '#5273df'}]}
    title="Daily revenue"
    height={300}
    theme="dark"
    xAxis={{type: 'time', timeZone: 'UTC'}}
    yAxis={{format: 'currency', currency: 'TRY', locale: 'tr-TR'}}
  />;
}
```

Each component owns a single figure. Place independent components in your application's CSS Grid/Flex layout; fixed scientific `subplots` grids are not required. Heights must be at least 180 CSS pixels. Width follows the card, with a 200-pixel core minimum. The effect creates and closes its own figure, including React StrictMode's extra setup/cleanup cycle.

## Data and updates

Supply immutable row arrays and stable, unique `series.key` values. Updating `data`, labels, colors, formats or theme reuses layers and preserves the current viewport. Changing chart `type`, `xKey` or bar `orientation` creates a fresh figure. Adding/removing series adds/removes the corresponding layer. Keep the x column's numeric/category semantics consistent between updates.

Numeric or string x columns are supported. `xAxis.type='time'` accepts finite epoch milliseconds or valid `Date` values; it deliberately does not parse date strings. Numeric series may use `null`/`undefined`/non-finite numbers for missing samples: they become gaps or omitted marks, never zero. Other series values and mixed numeric/string x columns are rejected through the error state.

For bars, use `barMode="group"` or `barMode="stack"`, and optionally `orientation="horizontal"`. In horizontal bars, `xKey` remains the position/category column while physical `xAxis` settings format the values and `yAxis` settings format the positions. Time-position bars infer width as 80% of the smallest timestamp gap (one day for a single position); `barWidth` overrides that width in position-axis units, therefore milliseconds for time axes. Ordinary numeric/category bars default to `0.8`. Percent inputs are fractions (`0.25` displays as `25%`). Date formatting defaults to UTC, making exported views consistent across recipients.

## Interactions and states

```tsx
<VesoraChart
  type="scatter" data={accounts} xKey="sessions"
  series={[{key: 'revenue', label: 'Revenue'}]}
  loading={isFetching} error={requestError}
  onClick={({row}) => row && setSelectedAccount(row.id)}
  renderTooltip={({row, formattedY}) => <strong>{row?.name}: {formattedY}</strong>}
/>
```

`onHover` receives a `ChartInteraction<Row>` or `null` when the pointer leaves. `onClick` receives the interaction, with its raw core event, matching series and original row when the mark identifies one. `formattedX`/`formattedY` follow the physical axes, including horizontal bars. Aggregated density bins report count-per-bin and do not pretend to identify a single row. `onSelection` forwards the typed core event; its indices are a bounded preview (at most 10,000), not a complete cohort. `onError` receives `{message}`. Exceptions in event callbacks are logged without breaking rendering.

`loading`, `error`, an empty dataset and render failures have separate states. Optional `renderLoading`, `renderEmpty` and `renderError(message, retry)` slots customize their content. Default states use `role="status"` or `role="alert"`; the chart exposes `aria-busy` and a short accessible summary. This does not provide full keyboard navigation through Canvas data points.

The legend uses buttons with `aria-pressed`, supports keyboard activation, and retains hidden series. Omit `series.visible` for local legend state. Supply `visible` plus `onSeriesVisibilityChange(key, visible)` to control visibility from your application. Set `legend={false}` or `tooltip={false}` to hide their UI. React tooltip content and callbacks are runtime presentation only.

## Explicit exports

```tsx
import {useRef} from 'react';
import {VesoraChart, type VesoraChartHandle} from '@vesora/react';

function ExportableCard() {
  const chart = useRef<VesoraChartHandle>(null);
  async function exportView() {
    const html: string = await chart.current!.exportHTML();
    // Deliver this string using your application's explicit download action.
    console.log(html.length);
  }
  return <>
    <VesoraChart ref={chart} type="line" data={rows} xKey="timestamp"
      series={[{key: 'revenue'}]} xAxis={{type: 'time'}} />
    <button onClick={() => void exportView()}>Export HTML — includes chart source data</button>
    <button onClick={() => chart.current!.resetView()}>Reset view</button>
  </>;
}
```

Exports wait for rendering. HTML contains every chart source value, including hidden series, and the matching Vesora runtime. It preserves declarative themes/formats and the current view, but does not include React tooltip content, event callbacks, API connections or the surrounding application. Label this clearly when providing an export action to users. PNG is available when only an image is needed. Exports are rejected while loading or in an error state.

For integration checks, the root exposes `data-vesora-state="ready|loading|empty|error"` and `data-vesora-rendering="true|false"`. Wait for `ready` and rendering `false` before inspecting pixels.

See the working [React SaaS starter](../../examples/react-saas/) and the [core API reference](../../docs/api.md) for the engine's capabilities and limits.
