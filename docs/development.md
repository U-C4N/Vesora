# Development, testing, and measurement

Use Node.js 22+ from the repository root. Python development requires Python 3.10+. WebGL2 must be available in the browser and the desktop QtWebEngine environment.

NumPy is not a required dependency of the Python API. The base installation includes `aiohttp` and `PySide6`. Install `.[notebook]` for notebook support or `.[numpy]` for optional NumPy integration. The default Python examples use `math`, `random`, and lists. Add the NumPy extra to your test environment to run the optional NumPy interoperability checks.

## Build the core

```bash
npm install
npm run check
```

The build produces the JavaScript distribution files and copies the same engine into the Python asset directory. Complete this build before packaging Python. The core, worker, standalone HTML template, and bundled Python engine assets are versioned together. Both language APIs retain protocol `1` for legacy scenes and use protocol `2` for grids or annotations; statistics/categories use protocol `3`; the reader accepts all three. Generated engine files and the standalone template are not committed.

After building the engine, create a wheel with:

```bash
python -m pip wheel --no-deps --no-build-isolation . --wheel-dir dist
```

## Run browser tests

```bash
python -m pip install -e ".[test,notebook]"
npx playwright install chromium
npm run test:browser
```

On Windows, Chrome is selected automatically when installed at the standard location. Set `VESORA_CHROME` to use another executable. CI uses Playwright Chromium. These tests use SwiftShader software WebGL, so their results are not hardware GPU performance measurements.

Browser tests read actual WebGL pixels to check layer updates, small differences between large Float64 coordinates, line gaps, adaptive representations, hover/selection, view updates, heatmaps, 3D rendering, and PNG title compositing. Panel tests add shared/independent axes, annotations, whole-layout exports, one-context rendering, and resource cleanup. Real binary snapshots produced by Python are compared with JavaScript scenes and rendered through the same engine. These tests use Python from `.venv` or the `python` command on PATH; set `PYTHON` to override it. PNG dimensions account for the device pixel ratio. Playwright traces and test results are retained on failure.

The default notebook adapter test uses real Python trait data and a mock widget model: blob ESM loading, a blob worker, binary updates, PNG export over widget messages, and cleanup. This mock test does not automate a complete Jupyter interface. The separate opt-in JupyterLab test below exercises the real host. `npm run test:parity` compares normalized Python/JavaScript scenes, including panels and annotations, without a browser.

`npm run test:examples` executes 25 JavaScript and 25 Python examples: the original 16 in `examples/web/` plus three in `examples/web/compare.html` and six in `examples/web/statistics.html`. The pages remain separate to limit concurrently mounted GPU contexts. The Python subprocess runs without site packages and with NumPy access blocked. Only window-opening and DOM-mounting calls are replaced by the test adapter; real scene creation, dimensions, and data channels are checked. Gallery browser tests also check parameter updates, PNG/HTML export and resource cleanup. The three original AI benchmark cards use synthetic data for training loss, scores, and quality/latency examples; they make no claims about measured model performance.

## Run Python tests

```bash
python -m pip install -e ".[test,notebook]"
python -m pytest tests/python
```

In a normal script, `fig.show()` opens the desktop window. Qt calls must run on the main thread. With `show(block=False)`, call `vs.process_events()` from your main loop. When embedding Vesora in another Qt application, use its existing event loop. On a headless system, QtWebEngine export requires a working graphics or virtual-display environment.

Real QtWebEngine tests are skipped by default. In a working graphics environment, set `VESORA_TEST_QT=1` and run `python -m pytest tests/python/test_desktop.py`. The tests cover line/heatmap/surface/scatter3d PNGs, a multi-panel comparison, data updates, and closing and reopening a window. A skipped test does not establish host support.

## Exercise a real JupyterLab host

Install the notebook test dependencies in the Python environment selected by the test:

```bash
python -m pip install -e ".[test,notebook]" jupyterlab ipykernel
npm run build
```

Set `VESORA_TEST_JUPYTER=1`, then run:

```bash
npx playwright test tests/browser/jupyter.spec.mjs
```

The test creates a temporary JupyterLab workspace and kernel, displays a grid using the actual widget integration, exercises interaction and data updates, exports PNGs, restores a bookmark and closes the widget. It is skipped during ordinary browser runs unless explicitly enabled. `VESORA_PYTHON` or `PYTHON` selects the Python executable; otherwise a local `.venv` is preferred. Qt and Jupyter test results depend on the available graphics environment and installed host packages; report their executed or skipped status separately from unit tests.

## Run a reproducible benchmark

```bash
npm run build
node scripts/benchmark.mjs 1000000
```

The report is saved to `artifacts/benchmark.json`. If a hardware GPU is unavailable, set `VESORA_SOFTWARE_GPU=1` to measure SwiftShader. The report records that choice and the GPU renderer reported by the driver.

The report separates:

- CPU, operating system, memory, browser version, and GPU renderer.
- Gaussian data generated with seed 42, dtype, record count, and source bytes.
- Figure dimensions, device pixel ratio, and initial/final representations.
- First-render time, `ready()` latencies for 20 view updates, and the sample distribution.
- Idle `requestAnimationFrame` intervals, which are not a rendering FPS guarantee.
- JavaScript heap usage when available; unmeasured Python/GPU memory and Python transfer counts are `null`.

This browser benchmark does not measure Python bridge latency. Compare metrics under the same hardware, data distribution, browser, and viewport conditions. First-render time excludes data generation, which is reported separately. A single measurement does not establish a universal point-count or FPS guarantee.

### Compare single-panel and four-panel performance

```bash
npm run build
npm run benchmark:panels
```

`artifacts/benchmark-panels.json` records eight cases: line and scatter data, 100,000 and 1,000,000 **total source rows per figure**, and one or four panels. Four-panel cases split the same row budget equally across the panels and share both axes. They do not draw a million rows in each panel. Lines use monotonic x signals; scatter uses deterministic Gaussian samples.

The report records hardware/browser/GPU information, source bytes, figure dimensions, data generation time, first render, 20 programmatic zoom-to-`ready()` samples, representations and available JavaScript heap size. Each case uses a fresh browser page. `VESORA_SOFTWARE_GPU=1` selects software rendering; the report records it. Python transfer and GPU allocation memory are not measured. This is a repeatable workload comparison, not a universal FPS or speedup claim.

## Validate a release package

After completing the test suite, build release assets and test them outside the checkout:

```bash
npm run build
npm run package:release
npm run test:packages
```

`package:release` derives the output directory from the package version: currently `dist/release-v0.4.0`. It writes the wheel, npm tarball, `vesora-discovery-demo.html`, `vesora-comparison-demo.html`, `vesora-statistics-demo.html`, and `SHA256SUMS.txt`. Its selected Python environment needs `setuptools>=77` and `wheel`, because packaging disables build isolation. The script verifies that Python and JavaScript package versions agree.

`test:packages` installs the wheel without dependencies in a clean temporary virtual environment and installs the tarball in a separate temporary npm project. It verifies installed-package imports, TypeScript declarations, and offline HTML rendering. Temporary environments are retained and their paths are printed for inspection. Neither packaging nor these checks publishes to GitHub, PyPI or npm; distribution remains a separate GitHub Release step.

The HTML browser tests open files directly through `file://` with networking disabled. They cover the five original plot types plus histogram, bar and boxplot, categorical axes, grids, annotations, whole-layout bookmarks and reset, precision and missing-value behavior, hostile text, fallback rendering, and mobile layout. A local HTTP server used by the other browser tests is not a dependency of the exported files.

Tag and publish only a commit whose tests pass. Build the uploaded artifacts from that exact commit, publish as a GitHub prerelease, then download the assets and compare them against `SHA256SUMS.txt`. Release-note validation claims must describe checks actually completed.

## Current limits

This version provides in-memory 2D visualization with fixed panel grids and basic single-panel 3D visualization. Linked brushing, error bars/bands, nested layouts, 3D panels, indexed file queries, tiles/streaming, `vector_field`, adaptive function sampling, advanced mesh/volume operations, and SVG/PDF export are future work. There is no alternative renderer for environments without WebGL2. 3D selection and advanced picking do not have the same support as 2D interactions.


## Validate statistics and categories

`npm run check` includes statistical algorithm, facade, categorical transaction, worker/fallback and legacy tests. `npm run test:parity` exercises v1/v2/v3 scenes; `npm run test:examples` executes all 25 snippets per language with NumPy blocked. The statistics browser suite covers real pixels, grouped/stacked/horizontal layout, category identity, typed selections, stale work, cache reuse, offline Python/JS HTML, PNG and the six-card gallery.

Real desktop and Jupyter checks include the new statistical charts; enable them using the existing opt-in environment variables above. A skipped host check is not a passing host check.

Run `npm run benchmark:statistics` after a build. The seeded 100,000/1,000,000-sample histogram and boxplot cases measure preparation, first-ready, updates, pan/cache reuse and available JS heap metrics. Set `VESORA_SOFTWARE_GPU=1` for a reproducible software-renderer run. Results record hardware/browser details and leave unmeasured Python/GPU memory null; they are not a universal FPS guarantee. See [the v0.4 measurement report](benchmarks/v0.4.0.md).

Packaging now creates three self-contained demo files, including `vesora-statistics-demo.html`. Verify clean installed wheel/npm consumers before publication. Registry or GitHub publication remains a separate action.
