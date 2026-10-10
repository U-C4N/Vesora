// Seeded raw-source statistics benchmark. Every case receives a fresh page.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {cpus, totalmem, platform, arch} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.VESORA_BENCHMARK_PORT ?? 4186);
const software = process.env.VESORA_SOFTWARE_GPU === '1';
const server = spawn(process.execPath, ['scripts/serve.mjs'], {cwd: root, env: {...process.env, PORT: String(port)}, windowsHide: true, stdio: 'ignore'});
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {if ((await fetch(`http://127.0.0.1:${port}/tests/browser/harness.html`)).ok) break;} catch {}
    if (attempt === 99) throw new Error('Statistics benchmark server did not start');
    await new Promise(done => setTimeout(done, 100));
  }
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({executablePath: process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined),
    args: ['--enable-precise-memory-info', ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])]});
  const cases = [];
  for (const count of [100_000, 1_000_000]) for (const kind of ['hist', 'boxplot']) {
    const page = await browser.newPage({viewport: {width: 1200, height: 1000}, deviceScaleFactor: 1});
    try {
      await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);
      cases.push(await page.evaluate(async ({count, kind}) => {
        const vs = await import('/packages/core/dist/index.js');
        const chart = document.querySelector('#chart'); chart.style.width = '1000px';
        const groupCount = kind === 'boxplot' ? 8 : 1;
        function generate(seed) {
          const start = performance.now();
          const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 1) / 4294967297;
          const groups = Array.from({length: groupCount}, () => new Float64Array(count / groupCount));
          for (let group = 0; group < groups.length; group++) for (let i = 0; i < groups[group].length; i++) {
            const radius = Math.sqrt(-2 * Math.log(random())), angle = 2 * Math.PI * random();
            groups[group][i] = radius * Math.cos(angle) + group * .125 + (i % 997 === 0 ? 10 : 0);
          }
          return {groups, generationMs: performance.now() - start};
        }
        let initial = generate(42), phase = 'initial';
        const generationMs = initial.generationMs, queryRecords = [], seen = new WeakSet();
        const original = vs.QueryScheduler.prototype.queryStatistics;
        vs.QueryScheduler.prototype.queryStatistics = async function (...args) {
          const before = this.stats, started = performance.now(), requestPhase = phase;
          const result = await original.apply(this, args);
          queryRecords.push({phase: requestPhase, elapsedMs: performance.now() - started,
            cacheHit: seen.has(result), before, after: this.stats});
          seen.add(result); return result;
        };
        const started = performance.now(), fig = vs.figure({width: 1000, height: 800, title: `${kind}: ${count.toLocaleString()} raw samples`});
        const layer = kind === 'hist'
          ? fig.hist(initial.groups[0], {bins: 100, density: true})
          : fig.boxplot(initial.groups, {labels: initial.groups.map((_, i) => `Group ${i + 1}`), showfliers: true});
        fig.mount(chart); await fig.ready();
        const firstReadyMs = performance.now() - started, initialRepresentation = fig.inspect();
        const firstPreparationMs = queryRecords[0]?.elapsedMs ?? null;
        const sourceBytes = fig.snapshot().sources.reduce((sum, source) => sum + source.byteLength, 0);
        initial = null;
        async function pans(label) {
          phase = label; const samples = [];
          for (let i = 0; i < 20; i++) {
            const delta = i * .035, begin = performance.now();
            fig.setView(kind === 'hist' ? {xDomain: [-3 + delta, 3 + delta]} : {yDomain: [-3 + delta, 3 + delta]});
            await fig.ready(); samples.push(performance.now() - begin);
          }
          const sorted = [...samples].sort((a, b) => a - b);
          const requests = queryRecords.filter(record => record.phase === label);
          return {samples, median: (sorted[9] + sorted[10]) / 2, p95: sorted[18], queryCount: requests.length,
            cacheHits: requests.filter(record => record.cacheHit).length,
            cacheMisses: requests.filter(record => !record.cacheHit).length};
        }
        const panToReadyMs = await pans('pan');
        let update = generate(4242); const updateGenerationMs = update.generationMs;
        phase = 'update'; const updateStarted = performance.now();
        layer.setData(kind === 'hist' ? {samples: update.groups[0]} : {groups: update.groups});
        await fig.ready(); const dataUpdateToReadyMs = performance.now() - updateStarted;
        const dataUpdatePreparationMs = queryRecords.find(record => record.phase === 'update')?.elapsedMs ?? null;
        update = null;
        const postUpdatePanToReadyMs = await pans('post-update-pan');
        const canvas = [...chart.querySelectorAll('canvas')].find(item => item.getContext('webgl2'));
        const gl = canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
        const result = {kind, totalSourceRows: count, groups: groupCount, sourceBytes, generationMs, updateGenerationMs,
          viewport: {width: 1000, height: 800, devicePixelRatio}, options: structuredClone(layer.spec.options),
          firstPreparationMs, firstReadyMs, dataUpdatePreparationMs, dataUpdateToReadyMs,
          panToReadyMs, postUpdatePanToReadyMs, queryRecords,
          representations: {initial: initialRepresentation, final: fig.inspect()},
          memory: {jsUsedHeapBytes: performance.memory?.usedJSHeapSize ?? null, pythonBytes: null, gpuBytes: null},
          gpu: debug ? {vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)} : null,
          webglError: gl.getError()};
        fig.close(); vs.QueryScheduler.prototype.queryStatistics = original; return result;
      }, {count, kind}));
      const item = cases.at(-1);
      if (item.webglError !== 0 || item.panToReadyMs.cacheHits !== 20 || item.postUpdatePanToReadyMs.cacheHits !== 20) throw new Error('Benchmark did not complete cleanly with cached pan summaries');
      if (item.queryRecords.find(record => record.phase === 'update')?.cacheHit !== false) throw new Error('Data update unexpectedly reused the old-source summary');
      console.log(`${kind}: ${count} samples; prep ${item.firstPreparationMs.toFixed(1)} ms; first ready ${item.firstReadyMs.toFixed(1)} ms; update ${item.dataUpdateToReadyMs.toFixed(1)} ms; pan p95 ${item.panToReadyMs.p95.toFixed(1)} ms; cache ${item.panToReadyMs.cacheHits}/${item.panToReadyMs.queryCount}`);
    } finally {await page.close();}
  }
  const report = {recordedAt: new Date().toISOString(), seeds: {initial: 42, update: 4242},
    hardware: {platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, systemMemoryBytes: totalmem()},
    browser: {version: browser.version(), headless: true, softwareGpuRequested: software}, cases,
    notes: ['Each case uses a fresh page in the same browser; no warm-up cases or latency samples are discarded.',
      'Synthetic Box-Muller normal values use LCG seed 42 initially, 4242 on update; every 997th sample receives a +10 tail offset. Boxplot divides the total rows into eight equal groups with a group-specific +0.125 shift.',
      'Source generation and update-data generation are measured separately and excluded from first-ready/update-ready latency.',
      'First preparation measures the first queryStatistics promise, including worker source registration, copies, worker loading and exact computation; first-ready additionally includes figure construction, validation, mount and drawing.',
      'Each pan phase contains 20 programmatic changes through ready(); p95 uses nearest rank (19th of 20 sorted samples), median averages the middle pair.',
      'Cache hits are instrumented by returned PreparedStatistics object identity in the main-thread scheduler, not inferred from speed. Cache before/after byte and entry counts are recorded for every query.',
      'The second pan phase reuses the updated-source summary. Data updates replace every raw sample source and invalidate summary dependencies.',
      'JS heap is the main-page Chromium estimate at the end of each case, without forced GC; it excludes reliable worker, Python and GPU allocation accounting.',
      'Latencies are one observed synthetic run, not FPS, peak memory, a hardware-GPU result, or a competitor comparison.']};
  await mkdir(resolve(root, 'artifacts'), {recursive: true});
  const output = resolve(root, 'artifacts', 'benchmark-statistics.json');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(output);
} finally {await browser?.close(); server.kill();}
