# README figure provenance

The four PNGs in this directory are exported by Vesora itself through the Python API and its bundled TypeScript/WebGL2 engine. The SVG banner is a decorative wordmark, not a data plot.

From the repository root, with a working QtWebEngine graphics environment:

```bash
npm ci
npm run build
python -m pip install -e .
python scripts/render_readme.py
```

The generator uses Python's standard library; NumPy is not required. PNG pixel dimensions depend on the host's device pixel ratio. These images illustrate behavior, not benchmark timing or performance guarantees.

| File | Data and rendering |
| --- | --- |
| `training-loss.png` | Three synthetic exponential-decay curves, 201 samples each, on a log loss axis. They are not measured model results. |
| `density.png` | 1,000,000 generated samples in three Gaussian clusters, Python random seed 42, displayed with count aggregation. The colorbar reports count per bin. |
| `surface.png` | A sampled interference function on a 140 × 140 regular grid, colored by amplitude. |
| `lorenz.png` | Explicit Euler integration of the Lorenz equations, dt = 0.006, sigma = 10, rho = 28, beta = 8/3. Of 20,000 steps, the initial 1,000 are discarded; the remaining 19,000 are drawn as 3D points colored by z. This is an illustrative numerical trajectory. |

The formulas and export settings are in [`scripts/render_readme.py`](../../scripts/render_readme.py).
