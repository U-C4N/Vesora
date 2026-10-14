# README figure provenance

The scientific PNGs in this directory are exported by Vesora itself through the Python API and its bundled TypeScript/WebGL2 engine. Signal Studio PNGs are browser screenshots of the production React starter. The SVG banner is a decorative wordmark, not a data plot.

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
