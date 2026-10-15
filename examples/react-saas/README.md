# Vesora Signal Studio

**See what moves.** A working Vite + React + TypeScript SaaS dashboard built with `@vesora/react`: a time-series signal, stacked subscription bars, and a scatter plot connected to a searchable account table. It combines a dark chart stage, light/dark interface themes, responsive layouts and keyboard controls.

[![Signal Studio dashboard in light mode](../../docs/assets/signal-studio-light.png)](../../docs/assets/signal-studio-light.png)

## Run the dashboard

From the repository root, using Node.js 22.12+:

```bash
npm ci
npm run build
npm run demo:react
```

Open the URL Vite prints. To build the standalone application:

```bash
npm run build:example
```

The output is `examples/react-saas/dist`. Charts require WebGL2. This is a source-checkout example for the `0.9.0-rc.4` candidate; npm registry publication is a separate step.

For the PRISM viewer, open the Vite URL with `?demo=workbench`. Three bounded signals keep arriving while **Freeze view** holds the displayed snapshot. **Return to live** catches up; the viewer's PNG/HTML buttons export the displayed frame. The application owns the figure. See the [PRISM guide](../../docs/prism.md).

## Run live training telemetry

Open the same Vite URL with `?demo=streaming`. The [streaming example](src/StreamingDemo.tsx) produces three synthetic loss curves in batches of 100 rows, keeping the latest 2,000 rows per model. Each batch awaits `appendRows` before producing the next batch. Starting a drag, zoom or sample inspection pauses the producer so the inspected rows remain available. Resume restores the current data window and continues updates; Restart stream replaces `data` and starts a new sequence.

The chart uses `useRef<VesoraChartHandle<Sample>>(null)`, `streaming={{maxPoints: 2000}}` and `await chart.current.appendRows(rows)`. Keep the `data` array reference stable during appends: a new reference replaces the retained dataset. Theme changes and legend controls preserve the retained rows. Streaming supports numeric/time line and scatter charts without bands. The source contains the complete typed row definition and producer lifecycle, including StrictMode cleanup.

The `VesoraChart` export methods default to accepted data; pass `{source: 'displayed'}` to capture its inspection frame. The PRISM workbench viewer's buttons explicitly use displayed data. HTML embeds the retained window and matching viewer; it does not restart the live producer. These curves are illustrative synthetic values, not measured model results or a throughput benchmark.

## Explore the signals

| Control | What it does |
| --- | --- |
| Revenue / Adoption / Expansion | Changes the signal, chart units and computed period insights. Revenue and expansion are daily amounts, not MRR. |
| Last 7 / 30 / 90 days | Filters the trend by UTC date and resets the chart view. |
| Compare | Overlays the immediately preceding, equally sized period on the current dates. Available for 7/30 days; the 90-day fixture has no preceding 90-day window. |
| Account scatter or Inspect button | Focuses the selected account, shows its actual values and narrows the table. Escape or Clear detail clears the selection and restores focus. |
| Account constellation / plan filters | Filters the sampled account workspace by subscription plan. |
| Search and pagination | Finds account names/plans and shows up to six matching rows per page. Press `/` outside an input to focus search. |
| Quick actions | Opens with Ctrl/Cmd + K. Search commands, use the arrow keys and Enter, or close with Escape. |
| Refresh data | Fetches a new deterministic synthetic snapshot; loading and API error states are visible in the charts. |
| Theme switch | Applies matching light/dark colors to the dashboard and chart surfaces. |
| PNG / Interactive HTML | Exports the selected signal chart. |

The **Demo controls** disclosure in the footer contains a failure switch. Enable it and refresh to exercise the API error state; disable it and refresh to recover.

All data is synthetic. There are **24 sampled account rows**, while the subscription bars represent a separate, larger synthetic plan summary. The account constellation uses decorative dot positions; each dot represents one sampled account and the group counts come from those rows. “Since day one” compares the first and last values in the selected window; “below the period high” compares the latest value with that window's peak.

View the [dark desktop screenshot](../../docs/assets/signal-studio-dark.png) or [390 px mobile screenshot](../../docs/assets/signal-studio-mobile.png) at full resolution.

## Connect your own API

Replace [`src/api.ts`](src/api.ts) with your API adapter; keep immutable row arrays and stable series keys. The simulated request is cancellable, so React StrictMode and unmount do not apply an older response. Dates use epoch milliseconds and UTC formatting.

[`src/App.tsx`](src/App.tsx) owns the layout, state, table and chart callbacks. [`src/style.css`](src/style.css) owns the visual system and responsive layout. Reuse the [React component API](../../packages/react/README.md) to build independent chart cards in your application.

Interactive HTML contains all source values supplied to the exported chart, including hidden series, and its matching engine. It excludes React callbacks, API requests and the application table. Choose PNG when you only need an image.

## Check the starter

After building, run from the repository root:

```bash
npm run test:saas
```

The browser checks cover responsive layouts, chart interaction, filters, command actions, focus behavior, refresh/error recovery and export.
