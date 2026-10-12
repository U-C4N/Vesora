// Selection-to-ready timings for deterministic aligned observations.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {cpus, totalmem, platform, arch} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.VESORA_BENCHMARK_PORT ?? 4187);
const software = process.env.VESORA_SOFTWARE_GPU === '1';
const server = spawn(process.execPath, ['scripts/serve.mjs'], {cwd: root, env: {...process.env, PORT: String(port)}, windowsHide: true, stdio: 'ignore'});
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/tests/browser/harness.html`)).ok) break; } catch {}
    if (attempt === 99) throw new Error('Linked benchmark server did not start');
    await new Promise(done => setTimeout(done, 100));
  }
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({executablePath: process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined),
    args: ['--enable-precise-memory-info', ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])]});
  const cases = [];
  for (const count of [100_000, 1_000_000]) {
    const page = await browser.newPage({viewport: {width: 1400, height: 800}, deviceScaleFactor: 1});
    try {
      await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);
      cases.push(await page.evaluate(async count => {
        const vs = await import('/packages/core/dist/index.js');
        const {modelErrors} = await import('/examples/web/linked-scenarios.js');
        const chart = document.querySelector('#chart'); chart.style.width = '1200px';
        const started = performance.now();
        const fig = vs.subplots({rows: 1, cols: 3, width: 1200, height: 520, title: 'Linked selection benchmark'});
        const {scatter} = modelErrors(fig, count);
        let completedSelection;
        fig.on('selection', event => {if (event.kind === 'linked') completedSelection = event;});
        fig.mount(chart); await fig.ready();
        const firstReadyMs = performance.now() - started;
        if (typeof fig.selectLinked !== 'function') throw new Error('This build does not expose the linked selection path');
        const samples = [], selections = [];
        for (let i = 0; i < 20; i++) {
          const source = scatter[i % 2];
          const bounds = i % 2 === 0 ? {x: [60 + (i % 4), 80], y: [15, 28]} : {x: [.8, 1], y: [15 + (i % 3), 28]};
          const begin = performance.now(); fig.selectLinked(source.id, bounds); await fig.ready();
          samples.push(performance.now() - begin);
          if (completedSelection?.sequence !== fig.spec.selectionLink.sequence || !completedSelection.active || completedSelection.count === 0) throw new Error('Selection did not commit a current nonempty cohort');
          selections.push({origin: i % 2, bounds, sequence: fig.spec.selectionLink.sequence, selectedCount: completedSelection.count, truncatedPreview: completedSelection.truncated});
        }
        const sorted = samples.slice().sort((a, b) => a - b);
        const canvas = [...chart.querySelectorAll('canvas')].find(item => item.getContext('webgl2'));
        const gl = canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
        const result = {rows: count, viewport: {width: 1200, height: 520, devicePixelRatio}, firstReadyMs,
          sourceBytes: fig.snapshot().sources.reduce((sum, source) => sum + source.byteLength, 0),
          selectionToReadyMs: {samples, p50: (sorted[9] + sorted[10]) / 2, p95: sorted[18]}, selections,
          representations: fig.inspect(), selectionLink: structuredClone(fig.spec.selectionLink),
          derived: {membershipMaskBytes: Math.ceil(count / 8)},
          memory: {jsUsedHeapBytes: performance.memory?.usedJSHeapSize ?? null, pythonBytes: null, gpuBytes: null},
          gpu: debug ? {vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)} : null,
          webglError: gl.getError()};
        fig.close(); return result;
      }, count));
      const item = cases.at(-1);
      if (item.webglError !== 0 || item.selectionToReadyMs.samples.some(value => !Number.isFinite(value))) throw new Error('Linked benchmark failed');
      console.log(`${count} rows: selection p50 ${item.selectionToReadyMs.p50.toFixed(1)} ms, p95 ${item.selectionToReadyMs.p95.toFixed(1)} ms; first ready ${item.firstReadyMs.toFixed(1)} ms`);
    } finally { await page.close(); }
  }
  const report = {recordedAt: new Date().toISOString(),
    hardware: {platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, systemMemoryBytes: totalmem()},
    browser: {version: browser.version(), headless: true, softwareGpuRequested: software}, cases,
    notes: ['Each case uses a fresh page in the same browser; no warm-up samples are discarded.',
      'The deterministic modelErrors demo generates numeric prediction, feature and residual columns and injects a high-residual cohort.',
      'First-ready includes dataset generation, figure construction, validation, worker preparation, mount and drawing.',
      'Selection-to-ready starts before the programmatic selectLinked call and ends after ready; it excludes source generation and pointer movement.',
      'Twenty selections alternate scatter origins and replace the cohort. p50 averages the middle pair; p95 is nearest rank, sample 19 of 20.',
      'JS heap is Chromium main-page usedJSHeapSize after the final selection, without forced garbage collection; it is not peak or process-total memory. Worker, Python and GPU memory are unmeasured.',
      'The complete membership bitset requires ceil(rows/8) bytes and remains derived state in addition to source buffers, bounded previews, plans and GPU geometry; this field is not total process memory.',
      'This synthetic run is not FPS, a universal latency guarantee or a competitor comparison. Correctness is established by separate tests.']};
  await mkdir(resolve(root, 'artifacts'), {recursive: true});
  const output = resolve(root, 'artifacts', 'benchmark-linked.json');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(output);
} finally { await browser?.close(); server.kill(); }
