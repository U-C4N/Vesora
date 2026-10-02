import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const count = Number(process.argv[2] ?? 1_000_000);
if (!Number.isSafeInteger(count) || count < 1) throw new Error('Point count must be a positive integer.');
const port = 4183;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: root, env: { ...process.env, PORT: String(port) }, windowsHide: true, stdio: 'ignore' });
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/tests/browser/harness.html`)).ok) break; } catch {}
    if (i === 99) throw new Error('Benchmark server did not become ready.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined);
  const software = process.env.VESORA_SOFTWARE_GPU === '1';
  browser = await chromium.launch({ executablePath, args: ['--enable-precise-memory-info', ...(software ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/tests/browser/harness.html`);
  const measurements = await page.evaluate(async count => {
    const { figure } = await import('/packages/core/dist/index.js');
    document.querySelector('#chart').style.width = '1000px';
    let seed = 42;
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 1) / 4294967297;
    const dataStart = performance.now();
    const x = new Float64Array(count), y = new Float64Array(count);
    for (let i = 0; i < count; i++) { const r = Math.sqrt(-2 * Math.log(random())), a = random() * 2 * Math.PI; x[i] = r * Math.cos(a); y[i] = r * Math.sin(a); }
    const dataGenerationMs = performance.now() - dataStart;
    const started = performance.now();
    const fig = figure({ width: 1000, height: 700, title: 'Deterministic Gaussian scatter' });
    fig.scatter(x, y);
    fig.mount(document.querySelector('#chart')); await fig.ready();
    const firstRenderMs = performance.now() - started;
    const initialRepresentation = fig.inspect();
    const interactions = [];
    for (let i = 0; i < 20; i++) {
      const radius = 4 * (1 - i / 25), start = performance.now();
      fig.setView({ xDomain: [-radius, radius], yDomain: [-radius, radius] });
      await fig.ready(); interactions.push(performance.now() - start);
    }
    const frameIntervals = [];
    let previous;
    for (let i = 0; i < 61; i++) await new Promise(resolve => requestAnimationFrame(time => { if (previous !== undefined) frameIntervals.push(time - previous); previous = time; resolve(); }));
    const canvas = [...document.querySelectorAll('canvas')].find(c => c.getContext('webgl2'));
    const gl = canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? { vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) } : null;
    const summary = values => { const sorted = [...values].sort((a, b) => a - b); return { samples: values, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], max: sorted.at(-1) }; };
    const result = {
      data: { count, distribution: 'Gaussian Box–Muller, LCG seed 42', dtype: 'float64', sourceBytes: x.byteLength + y.byteLength, generationMs: dataGenerationMs },
      viewport: { width: 1000, height: 700, devicePixelRatio },
      gpu, firstRenderMs, interactionToReadyMs: summary(interactions), idleFrameIntervalMs: summary(frameIntervals),
      representations: { initial: initialRepresentation, final: fig.inspect() },
      memory: { jsUsedHeapBytes: performance.memory?.usedJSHeapSize ?? null, pythonBytes: null, gpuBytes: null },
      transfer: { engineResourceBytes: performance.getEntriesByType('resource').filter(r => r.name.includes('/dist/')).reduce((sum, r) => sum + r.transferSize, 0), pythonBridgeBytes: null },
      webglError: gl.getError(),
    };
    fig.close(); return result;
  }, count);
  const report = {
    recordedAt: new Date().toISOString(),
    hardware: { platform: platform(), architecture: arch(), cpu: cpus()[0]?.model ?? null, logicalCpuCount: cpus().length, systemMemoryBytes: totalmem() },
    browser: { version: browser.version(), headless: true, softwareGpuRequested: software },
    ...measurements,
    notes: ['A browser-only benchmark; Python bridge and GPU memory metrics are unavailable (null).', 'Frame intervals are idle display scheduling observations, not a claim about rendering FPS.', 'Interaction latency measures setView through ready() including representation work; no warm-up runs are discarded.', 'No universal performance claim follows from one device or one data distribution.'],
  };
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  const output = resolve(root, 'artifacts', 'benchmark.json');
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, count, firstRenderMs: report.firstRenderMs, interactionP95Ms: report.interactionToReadyMs.p95, representation: report.representations.initial, gpu: report.gpu }, null, 2) + '\n');
} finally {
  await browser?.close();
  server.kill();
}
