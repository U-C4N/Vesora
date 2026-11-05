# README figure provenance

The scientific PNGs in this directory are exported by Vesora itself through the Python API and its bundled TypeScript/WebGL2 engine. Signal Studio PNGs are browser screenshots of the production React starter. The SVG banner is a decorative wordmark, not a data plot.

## PRISM workspace

`prism-workspace.png` is a real 1440 × 1100 screenshot of the `0.9.0-rc.6` Obsidian viewer. It shows the synthetic 65 × 49 surface, independent scalar field and two exact row/column profiles. The camera was set to isometric and the displayed frame frozen through the viewer controls. The four panels and their source data were not altered for the screenshot.

The capture loaded verified core, worker, viewer and Labs modules from the fixed RC6 tarball in a separate headless browser. Page errors were empty. The screenshot is not a performance measurement, human pilot result or proof of two-hour endurance.

Image SHA-256: `3c8d6799f45b3bba48bef73d4cb6435ec77daa998bab481f5b949f5ed14ff394`. The capture script and provenance are retained at `artifacts/v09/capture-prism-readme-20261015.mjs` and `artifacts/v09/prism-readme-capture-20261015.json`; the latter has SHA-256 `1ae086a2222844f052df28a38bef2d9af89f52a2d2538201cf3a512b4cbabd3e`.

## Signal Studio screenshots

From the repository root:

```bash
npm ci
npm run build
npx playwright install chromium
npm run capture:readme
```

The capture command builds the Vite application, waits for all three charts to finish rendering, and saves light/dark desktop views at 1440 CSS pixels and a full mobile view at 390 CSS pixels. Desktop frames include the trend, subscription bars and account scatter. The same browser run checks API refresh, keyboard legend, PNG export, API-error recovery and mobile overflow. Installed Chrome is used when available; otherwise Playwright Chromium is used.

| File | View |
| --- | --- |
| `signal-studio-light.png` | Light workspace with the dark trend canvas, period-peak insight and subscription/activity charts. |
| `signal-studio-dark.png` | The same initial 30-day snapshot in dark mode. |
| `signal-studio-mobile.png` | The initial light workspace at 390 px, including the application-owned account table. |
| `signal-studio-mobile-preview.png` | A 390 × 940 px viewport centered on the revenue chart, used as a readable README thumbnail linking to the full mobile view. |

All data is deterministic and synthetic. The account sample contains 24 rows; the subscription bars use a separate aggregate sample. Orbit dots group accounts by plan; their positions are decorative. These screenshots demonstrate the working interface and do not represent customer results or performance measurements. The capture code is in [`starter.spec.mjs`](../../tests/saas/starter.spec.mjs).

## Scientific figures

From the repository root, with a working QtWebEngine graphics environment:

```bash
npm ci
npm run build
python -m pip install -e .
python scripts/render_readme.py
```

The generator uses Python's standard library; NumPy is not required. Each scientific figure uses 760 × 500 logical pixels and an explicit export scale of 2, producing a 1520 × 1000 PNG independently of host DPR. Font sizes are set for preview readability: base/ticks/legend 24, labels 26 and title 28 logical pixels. These images illustrate behavior, not benchmark timing or performance guarantees.

| File | Data and rendering |
| --- | --- |
| `training-loss.png` | Three synthetic exponential-decay curves, 201 samples each, on a log loss axis. Model A has an illustrative ±12% band. The bounds are not an estimated confidence interval; the curves are not measured model results. Shared-x mode is enabled in the source figure and is not visible in the static PNG. |
| `density.png` | 1,000,000 generated samples in three Gaussian clusters, Python random seed 42, displayed with count aggregation. The colorbar reports count per bin. |
| `surface.png` | A sampled interference function on a 140 × 140 regular grid, colored by amplitude. |
| `lorenz.png` | Explicit Euler integration of the Lorenz equations, dt = 0.006, sigma = 10, rho = 28, beta = 8/3. Of 20,000 steps, the initial 1,000 are discarded; the remaining 19,000 are drawn as 3D points colored by z. This is an illustrative numerical trajectory. |

The formulas and export settings are in [`scripts/render_readme.py`](../../scripts/render_readme.py).


## Denge Membrane candidate

`denge-membrane.png` is an actual 1440 px browser capture of the RC7 React example, cropped to its 2D component. The deterministic synthetic pair starts at 56/6 litres; the capture follows a 0.5-second step, selection of East and saving the current baseline. The pair therefore reads approximately 52.1/9.9 litres, with 21.1 litres remaining to its 31/31 equilibrium. It is an interface example, not an experiment with real fluid.

Reproduce with `npm run build:example` and `npm run test:saas -- tests/saas/balance.spec.mjs`; the browser test writes `denge-2d-desktop.png` in its output directory. The source of the mark is the existing three-path `VesoraMark`, also present in `vesora-banner.svg`; this release does not introduce a replacement logo.

## Version 1.0 analysis figures

The ten figures under [`v1/`](v1/manifest.json) are actual **JavaScript API exports from the Vesora WebGL2 engine**, using the deterministic synthetic scenarios shared with the guided tour. They were captured on 5 November 2026 with Chrome 156.0.8078.80, ANGLE SwiftShader, a light figure theme and device scale factor 1.

Each individual PNG uses `Figure.savefig({width: 1200, height: 700, scale: 1, source: 'displayed'})`. The source values, axes, labels and analysis options are produced by [`v1-tour-scenarios.js`](../../examples/web/v1-tour-scenarios.js). The figures are illustrative inputs, not customer data, measured model results or physical experiment records.

| File | Supplied synthetic example |
| --- | --- |
| [ecdf.png](v1/ecdf.png) | 1,200 request latencies; observed nearest-rank p99 and a 200 ms exceedance query. The image displays the ECDF with percentile guides. |
| [spectrogram.png](v1/spectrogram.png) | 96 time rows × 64 frequencies, an analytic drifting power band and transient, and an explicit missing row at 5.25 s. No recording or FFT is performed. |
| [timeline.png](v1/timeline.png) | Nine rollout/recovery intervals and checkpoints across five named lanes and 68 minutes. |
| [errorbar.png](v1/errorbar.png) | Eleven calibration points with supplied asymmetric x/y bounds and an ideal 1:1 reference. |
| [contour.png](v1/contour.png) | A 61 × 41 board-temperature grid, two analytic hot regions, and filled bands at 5 °C intervals. |
| [quiver.png](v1/quiver.png) | 143 analytic velocity vectors; normalization is off and the arrow displacement scale is 0.55 s. |
| [parallel.png](v1/parallel.png) | 32 model configurations across five axes, with explicit log/reversed axes and an initial loss/latency selection. |
| [pareto.png](v1/pareto.png) | 27 inference configurations with explicit minimum-cost and maximum-quality objectives. |
| [hysteresis.png](v1/hysteresis.png) | 49 acquisition-ordered I–V samples over a 2.4 s synthetic cycle, with a supplied phase lag and zero-lag reference. |
| [ternary.png](v1/ternary.png) | 38 resin/hardener/filler formulations whose source fractions sum to one; colors identify filler groups. |

[`hero.png`](v1/hero.png) is a **1600 × 1120 browser screenshot of a DOM contact sheet** containing six of these exported PNGs: ECDF, spectrogram, contour, parallel coordinates, Pareto and ternary. Its captions and layout frame the real plots; the plots are not redrawn or synthesized for the hero.

Reproduce from the repository root with installed Node dependencies and Chrome or Playwright Chromium:

```sh
npm ci
npm run build
node scripts/capture-v1-readme.mjs
```

The [capture script](../../scripts/capture-v1-readme.mjs) uses its own temporary local server and closes its browser and figures after export. [`manifest.json`](v1/manifest.json) records PNG dimensions and SHA-256 hashes, fixture/script/runtime hashes, source descriptors and source-buffer hashes, representation methods, captions and the browser environment. The recorded capture has no page errors. This image provenance is separate from performance, publication and long-duration verification evidence.
