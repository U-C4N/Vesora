# Development, testing, and measurement

Use Node.js 22+ from the repository root. Python development requires Python 3.10+. WebGL2 must be available in the browser and the desktop QtWebEngine environment.

NumPy is not a required dependency of the Python API. The base installation includes `aiohttp` and `PySide6`. Install `.[notebook]` for notebook support or `.[numpy]` for optional NumPy integration. The default Python examples use `math`, `random`, and lists. Add the NumPy extra to your test environment to run the optional NumPy interoperability checks.

## Build the core

```bash
npm install
npm run check
```

The build produces the JavaScript distribution files and copies the same engine into the Python asset directory. Complete this build before packaging Python. The core, worker, and bundled Python engine assets are versioned together, with protocol version `1` on both sides.

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

Browser tests read actual WebGL pixels to check layer updates, small differences between large Float64 coordinates, line gaps, adaptive representations, hover/selection, view updates, heatmaps, 3D rendering, and PNG title compositing. Real binary snapshots produced by Python are compared with JavaScript scenes and rendered through the same engine. These tests use Python from `.venv` or the `python` command on PATH; set `PYTHON` to override it. PNG dimensions account for the device pixel ratio. Playwright traces and test results are retained on failure.

The notebook JavaScript adapter is tested in the browser with real Python trait data and a mock widget model: blob ESM loading, a blob worker, binary updates, PNG export over widget messages, and cleanup. This does not automate a complete Jupyter interface. `npm run test:parity` separately compares normalized Python/JavaScript scenes without a browser; CI runs this check too.

`npm run test:examples` executes the gallery's 16 JavaScript and 16 Python code examples. The Python subprocess runs without site packages and with NumPy access blocked. Only window-opening and DOM-mounting calls are replaced by the test adapter; real scene creation, dimensions, and data channels are checked. The gallery browser test also checks parameter updates, search/filters, PNG export, mobile overflow, and GPU resource cleanup during repeated resets. The three AI benchmark cards use synthetic data for training loss, scores, and quality/latency examples; they make no claims about measured model performance.

## Run Python tests

```bash
python -m pip install -e ".[test,notebook]"
python -m pytest tests/python
```

In a normal script, `fig.show()` opens the desktop window. Qt calls must run on the main thread. With `show(block=False)`, call `vs.process_events()` from your main loop. When embedding Vesora in another Qt application, use its existing event loop. On a headless system, QtWebEngine export requires a working graphics or virtual-display environment.

Real QtWebEngine tests are skipped by default. In a working graphics environment, set `VESORA_TEST_QT=1` and run `python -m pytest tests/python/test_desktop.py`. These tests verify line/heatmap/surface/scatter3d PNGs, data updates, and closing and reopening a window.

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

## Current limits

This version provides in-memory 2D and basic 3D visualization. Indexed file queries, tiles/streaming, multi-view layouts, `vector_field`, adaptive function sampling, advanced mesh/volume operations, and SVG/PDF export are future work. There is no alternative renderer for environments without WebGL2. 3D selection and advanced picking do not have the same support as 2D interactions.
