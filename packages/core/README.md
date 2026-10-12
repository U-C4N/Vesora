# @vesora/core

A TypeScript scientific visualization engine shared by Python and JavaScript. It provides WebGL2 rendering for 2D lines, scatter, and heatmaps; fixed 2D grids with shared axes; scientific text and reference lines; and single-panel 3D surfaces and scatter. PNG and self-contained interactive HTML export include the whole layout. TypeScript types are included.

**0.6 developer preview, MIT licensed:** the API is evolving. Existing scientific APIs remain available. Rendering requires a browser with WebGL2 support. Use the separate [`@vesora/react`](../react/README.md) package for declarative SaaS charts.

## Installation

From a repository checkout, run `npm ci`, `npm run build`, and `npm run package:release` after preparing the Python build dependencies described in the [development guide](../../docs/development.md#validate-a-release-package). Copy `dist/release-v0.6.0/vesora-core-0.6.0.tgz` into your frontend project:

```bash
npm install ./vesora-core-0.6.0.tgz
```

Both npm packages are prepared for public registry distribution. Local package generation does not publish them; see the [v0.6 overview](../../docs/releases/v0.6.0.md) and the [development guide](../../docs/development.md) for verification and authenticated publication.

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

Panel methods are `plot`, `scatter`, `heatmap`, `hist`, `bar`, `barh`, `boxplot`, `setTitle`, `setView`, `text`, `axhline`, and `axvline`. Annotation handles support flattened `update` options and `remove()`. Grid shape is fixed; 3D panels are not supported. Explicit linked observation selection is available for two numeric scatters and one count histogram. Existing figure plotting and axis methods address the main panel.

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

The v0.6 engine accepts scene protocols 1–5. Existing single-panel scenes retain v1; grids/annotations use v2, statistics/categories v3, links v4 and presentation extensions v5. HTML embeds its matching runtime. The package continues to have no runtime npm dependencies.

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
