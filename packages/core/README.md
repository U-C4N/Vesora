# @vesora/core

A TypeScript scientific visualization engine shared by Python and JavaScript. It provides WebGL2 rendering for 2D lines, interval bands, scatter, and heatmaps; mixed 2D/3D grids; scientific text and reference lines; and 3D surfaces, lines and scatter with source-aware inspection. Sized PNG and self-contained interactive HTML export include the whole layout. TypeScript types are included.

**v0.9.0-rc.8 PRISM candidate, MIT licensed:** this checkout is not a completed public release. Existing scientific APIs remain available. Rendering requires a browser with WebGL2 support. Use the separate [`@vesora/react`](../react/README.md) package for declarative charts or an application-owned scientific viewer.

## Installation

From a repository checkout, run `npm ci`, `npm run build`, and `npm run package:release -- --candidate` after preparing the Python build dependencies described in the [development guide](../../docs/development.md#validate-a-release-package). This creates local review archives. Copy `dist/release-v0.9.0-rc.8/vesora-core-0.9.0-rc.8.tgz` into your frontend project:

```bash
npm install ./vesora-core-0.9.0-rc.8.tgz
```

Both npm packages are prepared for public registry distribution. Local package generation does not publish them; see the [PRISM release gates](../../docs/releases/v0.9.0.md) and the [development guide](../../docs/development.md) for verification and authenticated publication. A publishable build requires a clean source commit and matching release tag.

## Match your application theme and metrics

```typescript
import { figure } from '@vesora/core';

const fig = figure({ theme: 'dark' });
fig.plot([Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2)], [1200, 1500], { label: 'Revenue' });
fig.setView({ xScale: 'time' });
fig.setAxisFormat('y', { kind: 'currency', currency: 'USD' });
fig.mount(document.querySelector('#chart')!);
```

Use `setTheme` with light/dark or partial theme tokens, `setAxisFormat` for declarative number/percent/currency/date formats, and `setSize` for a runtime height change. These features use protocol 5 and remain available in matching offline HTML. Calendar ticks default to UTC. `on('hover' | 'click' | ...)` has typed event payloads; callback exceptions do not interrupt rendering. `unmount()` releases viewer resources while retaining source data for a later mount; `close()` permanently releases the figure.

## JavaScript / TypeScript usage

Add a chart container to your HTML page:

```html
<div id="chart"></div>
```

In the JavaScript or TypeScript entry point of your browser-based bundler project:

```javascript
import { figure } from '@vesora/core';

const chart = document.getElementById('chart');
if (!chart) throw new Error('The #chart element was not found');

const fig = figure({ title: 'Measurements' });
fig.plot([0, 1, 2, 3], [0, 1, 4, 9], { label: 'y = x²' });
fig.mount(chart);
```

`await fig.ready()` waits for pending rendering to finish; `await fig.savefig()` returns a PNG `Blob`. Update layers with `setData`, `setStyle`, and `setVisible`. Call `fig.close()` when removing a figure from the page.

## Draw intervals and inspect source samples

```typescript
import {figure} from '@vesora/core';

const fig = figure({title: 'Synthetic interval', theme: {tickFontSize: 14, labelFontSize: 16}});
const x = [0, 1, 2, 3];
fig.fillBetween(x, [2.8, 1.5, .8, .5], [3.6, 2.1, 1.2, .9], {color: '#3569c8'});
fig.plot(x, [3.2, 1.8, 1, .7], {color: '#3569c8', label: 'Model A'});
fig.setView({yScale: 'log'}).setHoverMode('x');
fig.on('xhover', event => console.log(event?.cursorX, event?.items));
fig.mount(document.querySelector('#chart')!);
const png = await fig.savefig({width: 1000, height: 600, scale: 2});
```

`fillBetween` accepts explicit `x`, `lower` and `upper` channels on figures and panels. Numeric x values must be finite and strictly increasing; bounds must have equal lengths and finite pairs must satisfy `lower <= upper`. Nonfinite bounds break the band. The default opacity is `0.18`; styles are limited to `color`, `opacity` and `label`. The engine does not estimate uncertainty. Band axes allow linear/log/time x and linear/log y.

`setHoverMode('x')` inspects visible numeric/time lines using original source samples. It reports the nearest sample within the cursor's valid run and includes each sample's actual x; it neither interpolates nor bridges gaps. `nearest` remains the default. `xhover` clears with `null`; Python serializes the mode without receiving per-pointer callbacks. React exposes a corresponding multi-series tooltip.

Role tokens `titleFontSize`, `labelFontSize`, `tickFontSize` and `legendFontSize` are optional, each in the 8–32 logical-pixel range. `colorbarLabel` names a scalar or density scale without changing its meaning. Explicit PNG width/height are a pair of logical safe integers at least 200 × 180; positive finite scale sets raster density. Set all three to make pixel dimensions predictable, within the 32-million-pixel and active GPU limits. No-argument export retains its existing size/DPR behavior.

## Compare two panels

```javascript
import { subplots, downloadHTML } from '@vesora/core';

const fig = subplots({rows: 2, cols: 1, shareX: true, title: 'Signal and residual', height: 800});
const top = fig.panel(0, 0), bottom = fig.panel(1, 0);
top.plot([0, 1, 2, 3], [1, 2, 4, 3], {label: 'Signal'});
bottom.plot([0, 1, 2, 3], [0.1, -0.1, 0.2, 0], {label: 'Residual'});
top.setTitle('Signal');
bottom.setTitle('Residual').setView({xLabel: 'Time (s)'});
const threshold = bottom.axhline(0, {color: '#64748b'});
const note = top.text(1, 3, 'Peak nearby', {fontSize: 14});
note.update({text: 'Inspect the peak'});
fig.bookmark('Overview');
bottom.setView({xDomain: [1, 2]});
fig.bookmark('Detail');
fig.restoreBookmark('Overview');
downloadHTML(fig, 'comparison.html');
```

`subplots` returns a `Figure`; panel indices are zero-based. `shareX` and `shareY` default to `false`; when enabled, the corresponding scale and limits are shared by all panels. Labels stay independent. The figure owns one WebGL context, data registry and worker. Mount the figure to show it in a page; HTML export does not require mounting.

Panel methods include `plot`, `fillBetween`, `scatter`, `heatmap`, `hist`, `bar`, `barh`, `boxplot`, `setTitle`, `setView`, `text`, `axhline`, and `axvline`. Annotation handles support flattened `update` options and `remove()`. Grid shape is fixed; use `kinds` to declare mixed 2D/3D panels, with `surface`, `scatter3d`, `plot3d` and exact row/column `slice` operations. Explicit linked observation selection is available for two numeric scatters and one count histogram. Existing figure plotting and axis methods address the main panel. See the [PRISM guide](../../docs/prism.md) for the optional viewer and inspection controls.

## Follow the same observations

```javascript
import { subplots, downloadHTML } from '@vesora/core';

const fig = subplots({rows: 1, cols: 3, width: 1200, title: 'Inspect model errors'});
const x = [0, 1, 2, 3], residual = [.1, .2, 3, .1], feature = [.1, .2, .9, .3];
const a = fig.panel(0, 0).scatter(x, residual);
const b = fig.panel(0, 1).scatter(feature, residual);
const h = fig.panel(0, 2).hist(residual, {bins: [0, 1, 2, 4]});
const link = fig.linkSelection({scatter: [a, b], histogram: h});
fig.mount(document.querySelector('#chart'));
// Shift + drag in either scatter; a new rectangle replaces the cohort.
// After inspecting it: downloadHTML(fig, 'model-errors.html').
// link.clear() clears the cohort. link.remove() unlocks member data/options.
```

Exactly two numeric scatter layers and one count histogram must be in three distinct 2D panels of the same figure. Arrays must have the same row count and explicit alignment: row position identifies an observation. One figure supports one link. Attaching or importing a link copies member numeric buffers so caller-owned TypedArray mutations do not change linked records. Linked sources and histogram options cannot change until unlinking; styles/views may change.

Membership uses original finite coordinates, including density views and selections larger than the 10,000-index event preview. The selected histogram overlays exact raw counts using the full-data bin edges. Linked density/CDF histograms, histogram-originated cohort selection, lines, lasso and joins are outside v0.5. Pan/zoom, Reset view and view bookmarks preserve the cohort; Clear selection is separate. HTML opens with the completed export-time cohort; PNG includes its count/percentage. See [the linked API](../../docs/api.md#follow-observations-across-views).

## Share an interactive figure

```javascript
import { figure, toHTML, downloadHTML } from '@vesora/core';

const fig = figure({ title: 'Measurements' });
fig.scatter([1, 2, 3], [2, 4, 3]);
fig.bookmark('Overview');
fig.setView({ xDomain: [1.5, 2.5], yDomain: [3.5, 4.5] });
fig.bookmark('Detail', { note: 'Inspect the highest measurement.' });
fig.restoreBookmark('Overview');
const html = toHTML(fig); // No mount or graphics context needed.
downloadHTML(fig, 'measurements.html'); // Browser download.
```

The file embeds the engine, worker, and original source data. It opens offline directly from disk and includes bookmarks, reset, PNG download, and a representation inspector. In a grid, bookmarks restore every panel view and PNG captures the whole layout. Bookmarks do not capture historical annotations, styles or data. The file does not include application callbacks or live connections. `removeBookmark(name)` removes a saved view. Reusing a bookmark name updates it in place.

The v0.9 engine accepts scene protocols 1–7. Existing single-panel scenes retain v1; grids/annotations use v2, statistics/categories v3, links v4 and base presentation extensions v5. Bands, explicit hover mode, role typography and colorbar labels use v6. Mixed scientific scenes, 3D presentation/slices and displayed inspection metadata use v7. Streaming transport versions remain separate from scene protocols. HTML embeds its matching runtime and a static snapshot of retained source values. The package continues to have no runtime npm dependencies.

## Append live measurements

```js
const fig = figure({title: 'Live signal'});
const line = fig.plot([], [], {label: 'Signal'}).enableStreaming({maxPoints: 100_000});
fig.mount(document.querySelector('#chart'));
await line.appendData({x: [0, 1, 2], y: [3, 2, 1]});
await fig.ready({timeoutMs: 10_000});
console.log(fig.getStreamingState(line.id), fig.diagnostics());
```

Numeric 2D lines/scatters retain the latest `maxPoints` rows. Append all existing channels with matching lengths/dtypes; await the returned promise to pace the producer. `fig.appendDataBatch([{layer, data}, ...])` commits several series atomically. `setData` resets the stream epoch; `disableStreaming` keeps the retained values as static data. Style/theme changes preserve source versions. Bands, categories, statistics, 3D and linked-selection streaming are unsupported.

See the [streaming guide](../../docs/streaming.md) for row identity, backpressure, runtime budgets, recovery and export contracts. [The live example](../../examples/web/streaming.html) supplies three synthetic curves and pause/reset/export controls.

## Documentation

- [API and examples](../../docs/api.md)
- [Shared core and data model](../../docs/architecture.md)
- [Python installation and source development](../../README.md)

This version works with in-memory data. Dense scatter uses count aggregation, and line reduction preserves extrema. WebGPU and SVG/PDF export are not available in this version.

## Statistics and categorical coordinates

```ts
import { subplots } from "@vesora/core";
const fig = subplots({ rows: 1, cols: 2, width: 1100 });
fig.panel(0, 0).hist([1, 2, 2, 3, 4], { bins: 4, density: true });
fig.panel(0, 1).bar(["A", "B"], [3, 5], { label: "Run 1" });
fig.panel(0, 1).bar(["A", "B"], [4, 6], { label: "Run 2", color: "#d36a55" });
fig.mount(document.querySelector("#chart")!);
```

`hist`, `bar`, `barh` and `boxplot` return mutable layer handles on both `Figure` and `Panel`. Use `setOptions` for statistical options, `setData` for source updates, `setBarMode` for panel-local grouping/stacking, and `setCategories` before plotting to seed a category order. `plot`/`scatter` also accept string coordinates. Statistics/categorical scenes use protocol 3; selection links promote them to protocol 4; legacy readers reject them instead of silently discarding features. See the repository [API reference](../../docs/api.md#analyze-distributions-and-categories).
