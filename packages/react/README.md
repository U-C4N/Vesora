# @vesora/react

Declarative React + TypeScript charts for SaaS dashboards. `VesoraChart` supports line, bar and scatter charts, independent responsive cards, light/dark themes, date/currency/percent formatting, custom React tooltips, an accessible interactive legend, and loading/empty/error states.

**v0.9.0-rc.2 candidate:** build from the Vesora checkout. Creating packages does not publish them to npm. With the generated release tarballs available locally:

```bash
npm install react react-dom ./vesora-core-0.9.0-rc.2.tgz ./vesora-react-0.9.0-rc.2.tgz
```

After registry publication, the ordinary installation is `npm install @vesora/react react react-dom`. React 18.3 and React 19 are supported peer ranges; React is not bundled into this package. Rendering requires browser APIs and WebGL2. For Next.js, use the component inside a client boundary (`'use client'`).

For scientific panels, import `VesoraViewer` from `@vesora/react/viewer` and pass an application-owned `Figure`. It borrows the figure, supplies Obsidian controls and unmounts without closing application data. See the [PRISM ownership and inspection guide](../../docs/prism.md). `VesoraChart` remains the simple chart entry point. Its `exportPNG` and `exportHTML` default to accepted data; `{source:'displayed'}` captures the inspected frame.

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

With the same `data` reference and data-column schema, presentation updates do not rebuild source arrays or advance source versions. Invalid replacements validate the whole chart before changing live data; callbacks continue to resolve against the last committed rows.

Numeric or string x columns are supported. `xAxis.type='time'` accepts finite epoch milliseconds or valid `Date` values; it deliberately does not parse date strings. Numeric series may use `null`/`undefined`/non-finite numbers for missing samples: they become gaps or omitted marks, never zero. Other series values and mixed numeric/string x columns are rejected through the error state.

For bars, use `barMode="group"` or `barMode="stack"`, and optionally `orientation="horizontal"`. In horizontal bars, `xKey` remains the position/category column while physical `xAxis` settings format the values and `yAxis` settings format the positions. Time-position bars infer width as 80% of the smallest timestamp gap (one day for a single position); `barWidth` overrides that width in position-axis units, therefore milliseconds for time axes. Ordinary numeric/category bars default to `0.8`. Percent inputs are fractions (`0.25` displays as `25%`). Date formatting defaults to UTC, making exported views consistent across recipients.

## Show bands and compare series

```tsx
import {VesoraChart} from '@vesora/react';

const measurements = [
  {step: 0, loss: 3.2, lower: 2.8, upper: 3.6},
  {step: 1, loss: 1.8, lower: 1.5, upper: 2.1},
  {step: 2, loss: 1.0, lower: .8, upper: 1.2},
];

export function LearningCurve() {
  return <VesoraChart type="line" data={measurements} xKey="step"
    title="Synthetic illustrative interval" hoverMode="x"
    series={[{key: 'loss', label: 'Model A', color: '#3569c8',
      band: {lowerKey: 'lower', upperKey: 'upper', opacity: .18}}]}
    theme={{tickFontSize: 14, labelFontSize: 16}}
    xAxis={{label: 'Training step'}} yAxis={{type: 'log', label: 'Loss'}} />;
}
```

`series.band` is available for line charts and takes `lowerKey`, `upperKey`, optional `color` and optional `opacity` (default `0.18`). These are explicit source columns; Vesora does not compute a confidence interval. The band inherits its line's color when none is specified, and the legend toggles them together. Bounds must be numeric; null/undefined/nonfinite bounds create gaps, and finite lower values cannot exceed upper values. Bands require strictly increasing finite numeric/time x positions and linear/log y axes. Updates validate the complete chart before committing.

`hoverMode="x"` enables a shared cursor guide for numeric/time lines with strictly increasing x values. Each visible series reports its nearest original sample within the same valid run, with the sample's actual x rather than an interpolated value. Gaps are not bridged. `onXHover` and `renderXTooltip` receive `ChartXInteraction<Row>` with `formattedCursorX` and an `items` entry for every visible series. Each item includes its `series`, optional `row`/`index`/`x`/`y`, `formattedX`, `formattedY` and a `missing` flag. `onXHover(null)` clears inspection. These callbacks are independent of the existing nearest-point `onHover`/`renderTooltip` API.

## Append bounded live data

Use `streaming={{maxPoints}}` and a typed `VesoraChartHandle<Row>` for numeric/time line or scatter charts. Bars, categorical x columns and bands are excluded. `maxPoints` is an integer from 1 through 2³² − 1; the chart retains the newest rows up to that limit, including any rows initially supplied in `data`.

```tsx
import {useRef} from 'react';
import {VesoraChart, type VesoraChartHandle} from '@vesora/react';

interface Sample {step: number; loss: number}
const initial: Sample[] = [];
const series = [{key: 'loss' as const, label: 'Synthetic loss'}];

export function LiveSignal() {
  const chart = useRef<VesoraChartHandle<Sample>>(null);
  const step = useRef(0);
  async function appendSample() {
    const x = step.current++;
    await chart.current!.appendRows([{step: x, loss: Math.exp(-x / 100)}]);
  }
  return <>
    <VesoraChart ref={chart} type="line" data={initial} xKey="step"
      series={series} streaming={{maxPoints: 2000}} hoverMode="x" />
    <button onClick={() => void appendSample().catch(console.error)}>Append sample</button>
  </>;
}
```

Your application owns the producer and its cleanup. Await each `appendRows(rows)` before submitting the next batch. The adapter queues at most 64 outstanding calls; additional calls reject. Every series in a batch validates and commits together. Invalid columns leave all series unchanged. The promise waits for the accepted update to render; a rendering failure can reject after data was accepted.

Keep `data` and its row objects immutable. A new `data` array reference explicitly replaces the retained dataset and starts a new stream epoch, even for an empty array. Changing `maxPoints` starts a new epoch using the currently retained rows. Removing `streaming` keeps the retained window as ordinary chart data. Theme, title, legend and other presentation changes preserve accumulated rows. Replacing the data, changing chart ownership or unmounting rejects obsolete pending calls.

Hover/click callbacks resolve `row` against the committed retained window. Raw point events expose `streamId` and `sequence`; shared-x items expose those fields directly as well. `index` is the current window index and can change after eviction; `sequence` is stable within one stream epoch. Events from an obsolete epoch do not resolve to rows in a new dataset. Selection events retain the core's bounded preview semantics.

Exports capture the retained rows. An HTML export embeds the viewer and its source data, without a live producer or connection. Run the complete three-curve [React streaming example](../../examples/react-saas/README.md#run-live-training-telemetry) for pause/resume, restart, theme switching, PNG/HTML and StrictMode cleanup.

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

Exports wait for rendering. `await chart.current!.exportPNG({width: 1000, height: 600, scale: 2})` returns a 2000 × 1200 PNG. Width/height are a pair of logical safe integers at least 200 × 180; scale is positive and finite. Omitted dimensions use the mounted size, and omitted scale uses its effective DPR. The 32-million-pixel and GPU limits apply. Export reflows at the requested size without changing the live chart and excludes transient tooltip/crosshair state.

HTML contains every chart source value, including hidden series and band bounds, and the matching Vesora runtime. It preserves declarative themes/formats, hover mode and the current view, but does not include React tooltip content, event callbacks, API connections or the surrounding application. Label this clearly when providing an export action to users. PNG is available when only an image is needed. Exports are rejected while loading or in an error state.

For integration checks, the root exposes `data-vesora-state="ready|loading|empty|error"` and `data-vesora-rendering="true|false"`. Wait for `ready` and rendering `false` before inspecting pixels.

See the working [React SaaS starter](../../examples/react-saas/) and the [core API reference](../../docs/api.md) for the engine's capabilities and limits.
