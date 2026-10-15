# Development, testing, and measurement

Use Node.js 22.12+ from the repository root. Python development requires Python 3.10+. WebGL2 must be available in the browser and the desktop QtWebEngine environment.

NumPy is not a required dependency of the Python API. The base installation includes `aiohttp` and `PySide6`. Install `.[notebook]` for notebook support or `.[numpy]` for optional NumPy integration. The default Python examples use `math`, `random`, and lists. Add the NumPy extra to your test environment to run the optional NumPy interoperability checks.

## Build the core

```bash
npm ci --cache artifacts/npm-cache
npm run check
```

The build produces the core and React distributions and copies the same core into the Python asset directory. Complete this build before packaging Python. The core, worker, standalone HTML template, React adapter and bundled Python engine assets are versioned together. Both language APIs retain protocol `1` for legacy scenes and use protocol `2` for grids or annotations; statistics/categories use protocol `3`; linked observation selection uses protocol `4`; theme/time/format features use protocol `5`; bands, inspection and extended typography use protocol `6`. The reader accepts all six. Streaming metadata is separate runtime state. Generated distributions and Python engine files are not committed.

`npm run check` builds both packages, checks core/React/starter types, runs engine and React component tests, and production-builds the SaaS example. `npm run demo:react` starts its Vite development server. React tests verify lifecycle and props contracts; browser tests separately verify actual pixels and interactions.

After packaging, `npm run test:consumers` installs core/React archives in temporary consumers outside the checkout, builds real Vite and Next.js applications, and opens them in Chromium. It checks StrictMode mount, data-refresh layer identity, themes, PNG export and worker fallback. Framework/toolchain versions are taken from the lockfile and may be downloaded if absent from the cache; Vesora is installed from local archives. Separate standalone HTML checks disable networking. Files and screenshots are retained in the printed temporary directory.

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

`npm run test:examples` executes 26 JavaScript and 26 Python examples: the original 16 in `examples/web/`, three in `examples/web/compare.html`, six in `examples/web/statistics.html`, and one in `examples/web/linked.html`. The pages remain separate to limit concurrently mounted GPU contexts. The Python subprocess runs without site packages and with NumPy access blocked. Only window-opening and DOM-mounting calls are replaced by the test adapter; real scene creation, dimensions, and data channels are checked. Gallery browser tests also check parameter updates, PNG/HTML export and resource cleanup. The three original AI benchmark cards use synthetic data for training loss, scores, and quality/latency examples; they make no claims about measured model performance.

## Run Python tests

```bash
python -m pip install -e ".[test,notebook]"
python -m pytest tests/python
```

In a normal script, `fig.show()` opens the desktop window. Qt calls must run on the main thread. With `show(block=False)`, call `vs.process_events()` from your main loop. When embedding Vesora in another Qt application, use its existing event loop. On a headless system, QtWebEngine export requires a working graphics or virtual-display environment.

Real QtWebEngine tests are skipped by default. In a working graphics environment, set `VESORA_TEST_QT=1` and run `python -m pytest tests/python/test_desktop.py tests/python/test_linked_desktop.py tests/python/test_presentation.py tests/python/test_quality_desktop.py tests/python/test_streaming_desktop.py`. The tests cover line/heatmap/surface/scatter3d PNGs, a multi-panel comparison, data updates, closing and reopening a window, linked selection through native Qt pointer events, sized exports, streaming deltas and frozen captures. The linked check validates the returned cohort, highlights in all three panels, selected/cleared PNGs and exported source bytes. A skipped test does not establish host support.

## Exercise a real JupyterLab host

Install the notebook test dependencies in the Python environment selected by the test:

```bash
python -m pip install -e ".[test,notebook]" jupyterlab ipykernel
npm run build
```

Set `VESORA_TEST_JUPYTER=1`, then run:

```bash
npx playwright test --config playwright.jupyter.config.ts
```

This configuration uses the fixture's own Jupyter server and kernel; it does not start the separate gallery harness server.

The test creates a temporary JupyterLab workspace and kernel. Its sixteen cells cover six panel/statistics cells, three linked-workflow cells, two presentation cells, two protocol-6 chart-quality cells and three streaming cells, using actual widget integration throughout. Checks include data updates, bookmarks, native scatter brushing, exact cohort callbacks, all-panel highlights, themed PNG pixels, real date/currency labels, uncertainty bands, 800 × 500 logical-pixel PNG exports at scales 2 and 4, offline HTML, burst deltas, frozen streaming exports, widget redisplay and a 100-batch telemetry measurement. It is skipped during ordinary browser runs unless explicitly enabled. `VESORA_PYTHON` or `PYTHON` selects the Python executable; otherwise a local `.venv` is preferred. Qt and Jupyter test results depend on the available graphics environment and installed host packages; report their executed or skipped status separately from unit tests.

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

## Measure linked selection

Run `npm run benchmark:linked` after building. The 100,000/1,000,000-row deterministic model-error cases each use a fresh browser page with two scatters and one count histogram. Twenty selections alternate origin scatter and replace the cohort. The report records each select-to-`ready()` latency, p50/p95, first-ready time, source bytes, reported GPU renderer and available main-page JS heap.

Set `VESORA_SOFTWARE_GPU=1` for software rendering; `VESORA_CHROME` selects the browser executable. Source generation is included in first-ready and excluded from selection-to-ready. Main-page heap is not peak/process/worker/GPU memory. This is a synthetic workload rather than FPS or a competitor comparison. See [the v0.5 benchmark](benchmarks/v0.5.0.md). The [pilot protocol](pilot-v0.5.md) separately evaluates actual researcher/analyst workflow benefit.

## Validate a release package

After completing the test suite, build release assets and test them outside the checkout:

```bash
npm run build
npm run package:release -- --candidate
npm run test:packages
```

`package:release` derives the output directory from the package version: currently `dist/release-v0.9.0-rc.1`. It writes the wheel, core and React npm tarballs, ten standalone demos (discovery, comparison, statistics, linked, SaaS, quality, streaming, PRISM surface, PRISM telemetry and PRISM Labs), `release-manifest.json`, and `SHA256SUMS.txt`. All 14 entries listed in the checksum file are hashed. The manifest records runtime/worker/viewer/Labs hashes, ecosystem versions, commit and source-tree status. `--candidate` permits local review archives and marks them unpublishable; omitting it requires a clean commit and matching tag. The Python build environment needs `setuptools>=77` and `wheel`, because packaging disables build isolation. Canonical npm `0.9.0-rc.1` maps to Python `0.9.0rc1`. `npm run test:release` checks the exact file set and hashes, opens all ten demos offline, and exports each to PNG.

`test:packages` installs the wheel without dependencies in a clean temporary virtual environment and installs the tarball in a separate temporary npm project. It verifies installed-package imports, TypeScript declarations, and offline HTML rendering. Temporary environments are retained and their paths are printed for inspection. Neither packaging nor these checks publishes to GitHub, PyPI or npm; publication consumes the verified archives as a separate step.

The HTML browser tests open files directly through `file://` with networking disabled. They cover the five original plot types plus histogram, bar and boxplot, categorical axes, grids, annotations, whole-layout bookmarks and reset, precision and missing-value behavior, hostile text, fallback rendering, and mobile layout. A local HTTP server used by the other browser tests is not a dependency of the exported files.

Tag and publish only a commit whose tests pass. Build the uploaded artifacts from that exact commit, publish as a GitHub prerelease, then download the assets and compare them against `SHA256SUMS.txt`. Release-note validation claims must describe checks actually completed.

Release packaging uses a checkout-local npm cache at `artifacts/npm-cache`; package verification uses its retained temporary workspace's `npm-cache`. This avoids requiring writes to a shared user cache. Set `VESORA_NPM_CACHE` to choose a different cache location. These paths use the same scripts on Windows and Unix; no global npm configuration is changed.

## Current limits

This version provides in-memory 2D visualization, mixed 2D/3D grids, explicit interval bands, bounded numeric line/scatter streaming, source-aware 3D picking and exact surface row/column slices. Cross-dataset joins, linked line selection, error bars, automatic confidence intervals, nested layouts, indexed file queries, tiles, statistical streaming, `vector_field`, automatic adaptive detail, advanced mesh/volume operations, and SVG/PDF export remain outside the stable release. Bounded 3D trajectories/rolling surfaces and A/B pins are separate Labs experiments. There is no alternative renderer for environments without WebGL2. See [PRISM](prism.md) for stable/Labs scope and inspection ownership.


## Validate statistics and categories

`npm run check` includes statistical algorithm, facade, categorical transaction, worker/fallback and legacy tests. `npm run test:parity` exercises protocols 1–7; `npm run test:examples` executes all 26 gallery snippets per language with NumPy blocked. The statistics browser suite covers real pixels, grouped/stacked/horizontal layout, category identity, typed selections, stale work, cache reuse, offline Python/JS HTML, PNG and the six-card gallery.

Real desktop and Jupyter checks include the new statistical charts; enable them using the existing opt-in environment variables above. A skipped host check is not a passing host check.

Run `npm run benchmark:statistics` after a build. The seeded 100,000/1,000,000-sample histogram and boxplot cases measure preparation, first-ready, updates, pan/cache reuse and available JS heap metrics. Set `VESORA_SOFTWARE_GPU=1` for a reproducible software-renderer run. Results record hardware/browser details and leave unmeasured Python/GPU memory null; they are not a universal FPS guarantee. See [the v0.4 measurement report](benchmarks/v0.4.0.md).

Packaging creates ten self-contained demo files. Verify clean installed wheel/core/React consumers and the [release gates](releases/v0.9.0.md) before publication. The publisher consumes hash-verified archives and passed gate evidence; npm candidates use `next`, while a final release uses `latest`. Local packaging and validation do not publish anything. The current [scientific/telemetry pilot](pilot/v0.9.0/README.md) requires at least four of five users completing the approved workflow without assistance. The earlier [SaaS pilot](pilot-v0.6.md) remains historical research documentation.

## Validate v0.8 streaming and compatibility

`tests/unit/streaming.test.ts` checks transactional channels, ownership, eviction, epochs, semantic caches and source budgets. `tests/unit/runtime.test.ts` and `tests/browser/runtime.spec.mjs` cover readiness cancellation, watchdog fallback, WebGL restoration and bounded hot-stream progress. React streaming has unit and real-browser row/export checks. `tests/python/test_streaming.py` exercises Python storage and per-view transport; enable `VESORA_TEST_QT=1` for `test_streaming_desktop.py`. The real Jupyter suite includes a live stream, more than 64 queued append messages, frozen export and widget redisplay.

`tests/browser/streaming-navigation.spec.mjs` verifies that dragging, wheel zoom and keyboard inspection pause the demo before retained samples disappear, and that Resume restores automatic axes. It compares exported data and actual line pixels after pausing. It also checks visible startup failures and real back/forward cache restoration, including a paused stream and PNG export. The history test serves the unchanged demo files through a temporary cache-compatible server because the development server sends `no-store`; persisted lifecycle events and document identity distinguish restoration from a reload. BFCache is enabled only for this test file, with tracing disabled. `tests/saas/streaming.spec.mjs` exercises the matching React behavior with real browser input.

CI additionally defines Python 3.10/3.11/3.14 contracts, React 18.3/19 installed Vite/Next consumers, Firefox/WebKit smoke tests, and Qt/Jupyter using the installed release wheel. `VESORA_REACT_VERSION` selects the consumer major; `VESORA_INSTALLED_PACKAGE=1` prevents the Jupyter kernel from injecting checkout sources. A configured matrix is not evidence of an executed remote run.

For static regression measurements, extract the previous v0.7 core tarball into `artifacts/v08/baseline/` (the runtime should be `baseline/package/dist/index.js`), build the current engine, and run `node scripts/benchmark-v08.mjs regression`. Five paired repeats alternate runtime order, each with 1M density/line rows and 100 unique completed viewport updates. `npm run benchmark:streaming` measures three 100,000-row retained curves at a requested 20 batches/second of 100 rows for 60 seconds. `node scripts/benchmark-v08.mjs soak` extends the stream to 30 minutes; `VESORA_SOAK_SECONDS` overrides duration. Set `VESORA_SOFTWARE_GPU=0` to request the normal GPU path and verify the reported renderer. Run graphics benchmarks sequentially without other browser/Qt/build workloads. JSON evidence goes to `artifacts/v08/`; [the v0.8 report](benchmarks/v0.8.0.md) distinguishes measured results from unexecuted gates.
