<p align="center">
  <img src="docs/assets/vesora-banner.svg" alt="Vesora — scientific visualization for Python, JavaScript and React" width="100%">
</p>

<p align="center">
  <strong>Explore scientific data. Inspect live signals. Share the exact view.</strong><br>
  Python · JavaScript / TypeScript · React · WebGL2 · PNG &amp; offline HTML
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#what-prism-adds">PRISM features</a> ·
  <a href="#inspect-a-surface">3D example</a> ·
  <a href="#inspect-data-while-it-keeps-arriving">Live data</a> ·
  <a href="docs/prism.md">Guide</a> ·
  <a href="docs/releases/v0.9.0.md">Release status</a>
</p>

> **v0.9.0-rc.6 — PRISM release candidate.** The features below are implemented and available in local packages. Seven automated release gates have passed. The two-hour endurance run was interrupted by Windows standby; real-user and screen-reader checks remain pending. **A completed v0.9.0 release is not yet published.** See the [release checklist](docs/releases/v0.9.0.md) and [measured results](docs/benchmarks/v0.9.0.md).

Vesora brings scientific plots and bounded telemetry into one shared rendering engine. Create a figure in Python, use the engine directly in a browser, or embed it in React. Inspect regular-grid surfaces alongside exact 2D profiles, keep an observation fixed while new data arrives, and share a self-contained snapshot of what you saw.

<p align="center">
  <a href="docs/assets/prism-workspace.png"><img src="docs/assets/prism-workspace.png" alt="Vesora PRISM Obsidian workspace: a scientific surface with independent scalar colors, a heatmap, two exact profiles and shared inspection controls" width="100%"></a>
</p>

The working Obsidian viewer, captured from the RC6 package with synthetic data. Surface height and color represent different fields; the lower panels follow actual rows and columns of the source grid.

## What PRISM adds

| Workflow | Available in the stable feature set |
| --- | --- |
| Inspect scientific 3D | Orthographic XY/XZ/YZ/isometric cameras, equal axes, fit data, selection focus and depth-aware source inspection |
| Understand a surface | Independent height and scalar color, labeled color ranges, indexed geometry, optional smooth shading and wireframe |
| Compare views | Mixed 2D/3D panels in one figure and one WebGL context; exact grid-row and grid-column profiles |
| Follow a trajectory | Continuous `plot3d` lines with pixel-based thickness, scalar color and gaps at missing coordinates |
| Investigate live data | Bounded line/scatter storage; freeze the displayed frame while accepted data continues arriving |
| Share an observation | Displayed-frame PNG and offline HTML with camera, panels, slices and selected observation |
| Integrate with an app | Scoped dark/light viewer, application-owned figures, React wrappers and Python desktop/notebook hosts |

Existing line, interval-band, scatter, heatmap, histogram, bar and boxplot APIs remain available. Existing `VesoraChart` defaults stay unchanged. Scene protocols **1–6 remain readable**; new scientific scene features use protocol **7**. Python transport v3 separates data acknowledgement from frame presentation, with transport v2 compatibility.

## Get started

Requirements: **Node.js 22.12+** for development, **Python 3.10+** for Python use, and a **WebGL2-capable browser** for rendering. Python desktop windows use QtWebEngine. The core has no runtime npm dependencies; NumPy is optional.

### Run the demos from this checkout

```bash
npm ci
npm run build
npm run demo
```

Open [the three PRISM demos](http://127.0.0.1:4173/examples/web/v09.html):

- **Surface inspection:** independent scalar color, a heatmap and two exact profiles.
- **Live measurements:** three signals, continuing ingestion and frozen-frame exports.
- **Labs:** explicitly experimental bounded 3D trajectories and rolling surfaces.

For the React workbench, run `npm run demo:react` and append `?demo=workbench` to the URL printed by Vite. The same app includes [Signal Studio](examples/react-saas/README.md), a complete dashboard starter.

### Build local packages

RC6 is not yet a completed registry release. Build review packages from this checkout:

```bash
python -m pip install "setuptools>=77" wheel
npm run package:release -- --candidate
```

Run this after `npm run build`. Output goes to `dist/release-v0.9.0-rc.6/`: a Python wheel, core and React tarballs, ten standalone HTML demos, a provenance manifest and checksums. These commands **do not publish** packages. Preserve existing validated release directories; create review packages in a separate checkout if that directory already contains fixed archives.

Install the wheel into your Python environment:

```bash
python -m pip install ./dist/release-v0.9.0-rc.6/vesora-0.9.0rc6-py3-none-any.whl
```

For a frontend application, copy the two tarballs into that project and run:

```bash
npm install ./vesora-core-0.9.0-rc.6.tgz ./vesora-react-0.9.0-rc.6.tgz
```

React 18.3 and 19 are supported peer ranges. Only install the core tarball if you do not use React. For notebook support, add the `notebook` extra to the wheel installation; see the [Python host guide](docs/api.md#display-python-figures-on-desktop-or-in-a-notebook).

## Inspect a surface

### JavaScript / TypeScript

Create a browser element with `<div id="chart"></div>`, then use this in your frontend entry point:

```typescript
import { subplots } from '@vesora/core';
import { mountViewer } from '@vesora/core/viewer';

const element = document.querySelector<HTMLElement>('#chart');
if (!element) throw new Error('Missing #chart');

const fig = subplots({
  rows: 1,
  cols: 2,
  kinds: [['3d', '2d']],
  title: 'Height, temperature and an exact profile',
  height: 460,
});

const surface = fig.panel(0, 0).surface(
  [0, 1, 2],
  [0, 1, 2],
  [[0, 1, 0], [1, 2, 1], [0, 1, 0]],
  {
    values: [[280, 282, 284], [286, 288, 290], [292, 294, 296]],
    colorDomain: [280, 300],
    colorbarLabel: 'Temperature / K',
    shading: 'unlit',
  },
);

fig.panel(0, 1).slice(surface, { axis: 'y', index: 1, label: 'Middle row' });
fig.setCameraPreset('isometric');
const viewer = mountViewer(fig, element, { theme: 'dark' });
await fig.ready();

// When the application removes this figure:
// viewer.dispose(); // release the view
// fig.close();      // release the application-owned figure
```

`axis: 'y'` fixes a row and produces an x–z profile; `axis: 'x'` fixes a column and produces a y–z profile. Updating the surface with the same grid shape updates its linked profiles atomically. Slices do not invent interpolated rows or arbitrary clipping planes.

### Python

```python
import vesora as vs

fig = vs.subplots(1, 2, kinds=[["3d", "2d"]], title="Surface and exact profile")
surface = fig.panel(0, 0).surface(
    [0, 1, 2], [0, 1, 2],
    [[0, 1, 0], [1, 2, 1], [0, 1, 0]],
    values=[[280, 282, 284], [286, 288, 290], [292, 294, 296]],
    colorbar_label="Temperature / K",
)
fig.panel(0, 1).slice(surface, axis="y", index=1)
fig.show()
```

`show()` opens a desktop window from a normal script and selects the widget host inside a supported notebook. Lists and supported numeric buffers work without NumPy. See [Python and JavaScript APIs](docs/api.md) for host selection, data updates and export.

### React

Use `VesoraViewer` to display a scientific figure owned by your application:

```tsx
import type { Figure } from '@vesora/core';
import { VesoraViewer } from '@vesora/react/viewer';

export function ScientificPanel({ figure }: { figure: Figure }) {
  return <VesoraViewer figure={figure} theme="dark" height={460} />;
}
```

Keep the figure reference stable. Unmounting the component releases the viewer without closing application data; the application owns producer and figure cleanup. Mount one viewer per figure. For declarative dashboard charts, use [`VesoraChart`](packages/react/README.md). Next.js integrations need a client boundary.

## Inspect data while it keeps arriving

This browser example uses the same `#chart` container in a separate page:

```typescript
import { figure, toHTML } from '@vesora/core';
import { mountViewer } from '@vesora/core/viewer';

const element = document.querySelector<HTMLElement>('#chart');
if (!element) throw new Error('Missing #chart');

const fig = figure({ title: 'Live signal' });
const signal = fig.plot([0, 1, 2], [3, 2, 1], { label: 'Signal' })
  .enableStreaming({ maxPoints: 100_000 });
const viewer = mountViewer(fig, element, { theme: 'dark' });
await fig.ready();

fig.freezeInspection();
await signal.appendData({ x: [3, 4], y: [0.9, 0.8] }, { waitFor: 'accepted' });
const snapshotHTML = toHTML(fig, { source: 'displayed' });
await fig.resumeLive();

// Use snapshotHTML as your saved HTML document.
// On teardown, stop your producer, then viewer.dispose() and fig.close().
```

The shared viewer's **Freeze view** holds the completed frame while the bounded source continues receiving data. Its PNG/HTML buttons capture that displayed view. A snapshot retains its own sample identities even after those samples leave the live buffer.

- `waitFor: 'accepted'` resolves after an atomic data commit. Use it for producers that continue during inspection.
- The default `waitFor: 'rendered'` waits for presentation and rejects before changing data when inspection is already frozen.
- Programmatic exports retain their accepted-data default. Request `source: 'displayed'` explicitly for the inspected frame.
- Offline HTML includes the captured retained window, scene and runtime. It opens without a live connection and does not recover evicted history or application callbacks.

Python producers can commit several streaming layers together with `fig.append_data_batch(...)`. Connected Python viewers provide frozen inspection and displayed exports; Python's own export methods continue using accepted state. See the [PRISM contracts](docs/prism.md) and [streaming guide](docs/streaming.md).

## Stable features and Labs

The core and viewer entries expose the stable feature set. Experiments load separately from `@vesora/core/labs` and may change:

| Labs experiment | Boundary |
| --- | --- |
| Live 3D trajectory | Bounded x/y/z samples, identified by acquisition sequence |
| Rolling surface | Fixed columns, bounded rows and a linked heatmap; no filling missing rows |
| A/B snapshots | Two pinned views sharing the configured snapshot budget |
| Manual surface sampling | Explicit sampling controls; not automatic adaptive detail |

**Automatic 3D level of detail is not shipped.** General mesh/volume rendering, arbitrary plane cuts, WebGPU, continuous disk recording and SVG/PDF export remain outside this release. Stable `plot3d` draws supplied trajectories; live 3D ingestion belongs to Labs.

## Validation and performance

The fixed RC6 archives passed **320 core tests, 40 React tests, 18 release-contract tests, type checking, protocol parity and 52 examples**. Each tested Python environment—3.10, 3.11 and 3.14—passed 393 headless tests; real hosts ran separately. Chromium passed 189 tests, with eight additional Firefox/WebKit smoke checks. Two separate-host Chromium cases are intentionally excluded from that suite.

Measured on the recorded Windows machine and renderer:

| Check | RC6 result |
| --- | --- |
| 1M-point line first-ready | 166.9 ms; 11.9% lower than the paired v0.8 baseline |
| 1M-point line interaction p95 | 177.0 ms; 16.3% lower than the paired baseline |
| 60-second, three-series browser stream | 1,197 batches accounted for; presentation p95 125.2 ms |
| Installed Qt / Jupyter presentation p95 | 48.7 ms / 189.6 ms |
| Scientific 3D matrix | 18 cases passed geometry reuse, picking and cleanup checks |

These are scoped measurements, **not universal FPS or speedup guarantees**. Software-rendered browser results and native-host measurements have different environments. The [full report](docs/benchmarks/v0.9.0.md) records workload, renderer, versions, hashes and previous failures.

The two-hour run was interrupted by Windows standby and did not pass. Real screen-reader and five-person pilot results remain outstanding. Windows Chromium, QtWebEngine and JupyterLab are the release targets under validation; Firefox/WebKit smoke does not establish Safari/iOS or untested desktop support.

## More examples

<p align="center">
  <a href="docs/assets/signal-studio-light.png"><img src="docs/assets/signal-studio-light.png" alt="Signal Studio React dashboard with a trend chart, subscription bars and account scatter" width="100%"></a>
</p>

[Signal Studio](examples/react-saas/README.md) combines declarative charts with an ordinary React application: themes, metric filters, date/currency formats, custom tooltips, loading/error states and application-owned account tables. Its data is synthetic.

The [scientific gallery](examples/web/), [panel comparisons](examples/web/compare.html), [statistics](examples/web/statistics.html) and [linked selections](examples/web/linked.html) include runnable Python/JavaScript examples, PNG export and offline HTML. The [figure provenance](docs/assets/README.md) explains the datasets and screenshots.

## Develop and contribute

```bash
npm ci
npm run check
npm run test:parity
npm run test:examples
npx playwright install chromium
npm run test:browser
python -m pip install -e ".[test,notebook]"
python -m pytest tests/python
```

Real Qt/Jupyter host tests, installed consumers and endurance runs have additional environment requirements. Follow the [development guide](docs/development.md) and [release checklist](docs/releases/v0.9.0.md); an ordinary unit-test run does not replace those checks.

| Documentation | Contents |
| --- | --- |
| [PRISM guide](docs/prism.md) | Viewer ownership, 3D, snapshots, accepted/displayed data and migration |
| [API reference](docs/api.md) | Plot types, Python hosts, updates, events and exports |
| [React API](packages/react/README.md) / [core API](packages/core/README.md) | Framework integration and package usage |
| [Architecture](docs/architecture.md) | Shared engine, source identity, workers and rendering |
| [Streaming](docs/streaming.md) | Bounded buffers, batch updates and recovery |
| [Release checklist](docs/releases/v0.9.0.md) / [v1 readiness](docs/releases/v1-readiness.md) | Remaining gates, distribution and future scope |

Found a reproducible issue? [Open an issue](https://github.com/U-C4N/Vesora/issues) with a small dataset, expected behavior and environment. Vesora is [MIT licensed](LICENSE).
