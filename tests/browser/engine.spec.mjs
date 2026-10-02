import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

async function load(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async () => { window.vs = await import('/packages/core/dist/index.js'); });
  return errors;
}

async function pixels(page) {
  return page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(c => c.getContext('webgl2'));
    const gl = canvas.getContext('webgl2');
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let colored = 0, red = 0, blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 230) colored++;
      if (data[i] > data[i + 1] + 50 && data[i] > data[i + 2] + 50) red++;
      if (data[i + 2] > data[i] + 50 && data[i + 2] > data[i + 1] + 50) blue++;
    }
    return { colored, red, blue, error: gl.getError() };
  });
}

test('renders data, updates a live layer, and exports complete PNG', async ({ page }) => {
  const errors = await load(page);
  await page.evaluate(async () => {
    window.fig = vs.figure({ title: 'Measured signal', width: 640, height: 420 });
    fig.setView({ xDomain: [0, 4], yDomain: [0, 4], xLabel: 'Time (s)', yLabel: 'Amplitude' });
    window.layer = fig.scatter(new Float64Array([1, 2, 3]), new Float64Array([1, 3, 2]), { color: '#ff0000', size: 14, label: 'Measurements' });
    fig.mount(document.querySelector('#chart'));
    await fig.ready();
  });
  const before = await pixels(page);
  expect(before.red).toBeGreaterThan(150);
  expect(before.error).toBe(0);
  await page.evaluate(async () => { layer.setData({ y: new Float64Array([3, 2, 1]) }); layer.setStyle({ color: '#0000ff' }); await fig.ready(); });
  const after = await pixels(page);
  expect(after.blue).toBeGreaterThan(150);
  expect(after.red).toBe(0);
  expect(after.error).toBe(0);
  const output = await page.evaluate(async () => {
    const blob = await fig.savefig();
    const image = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const rows = ctx.getImageData(0, 0, canvas.width, Math.round(45 * devicePixelRatio)).data;
    let titleInk = 0;
    for (let i = 0; i < rows.length; i += 4) if (rows[i] < 180 && rows[i + 1] < 180 && rows[i + 2] < 180 && rows[i + 3] > 200) titleInk++;
    return { type: blob.type, width: image.width, height: image.height, dpr: devicePixelRatio, titleInk };
  });
  expect(output.type).toBe('image/png');
  expect(output.width).toBe(Math.round(640 * output.dpr));
  expect(output.height).toBe(Math.round(420 * output.dpr));
  expect(output.titleInk).toBeGreaterThan(30);
  await page.evaluate(() => fig.close());
  await expect(page.locator('#chart canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('line gaps remain blank and large coordinate differences remain visible', async ({ page }) => {
  const errors = await load(page);
  await page.evaluate(async () => {
    window.fig = vs.figure({ width: 640, height: 420 });
    fig.setView({ xDomain: [1e12, 1e12 + 6], yDomain: [0, 2] });
    fig.plot(new Float64Array([1e12, 1e12 + 1, 1e12 + 2, 1e12 + 3, 1e12 + 4, 1e12 + 5, 1e12 + 6]), new Float64Array([1, 1, NaN, NaN, NaN, 1, 1]), { color: '#ff0000', width: 3 });
    fig.mount(document.querySelector('#chart')); await fig.ready();
  });
  const result = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(c => c.getContext('webgl2'));
    const gl = canvas.getContext('webgl2'), p = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
    let left = 0, center = 0, right = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (p[i] > p[i + 1] + 50 && p[i] > p[i + 2] + 50) { if (x < canvas.width * .4) left++; else if (x > canvas.width * .7) right++; else center++; }
    }
    return { left, center, right, error: gl.getError() };
  });
  expect(result.left).toBeGreaterThan(40);
  expect(result.right).toBeGreaterThan(40);
  expect(result.center).toBe(0);
  expect(result.error).toBe(0);
  expect(errors).toEqual([]);
});

test('dense data uses an inspectable count representation and sparse zoom restores points', async ({ page }) => {
  const errors = await load(page);
  const info = await page.evaluate(async () => {
    const n = 200000;
    const x = Float64Array.from({ length: n }, (_, i) => i % 1000);
    const y = Float64Array.from({ length: n }, (_, i) => Math.floor(i / 1000));
    window.fig = vs.figure({ width: 640, height: 420 });
    fig.scatter(x, y, { representation: 'auto' });
    fig.mount(document.querySelector('#chart')); await fig.ready();
    return fig.inspect();
  });
  expect(info[0].kind).toBe('density');
  expect(info[0].total).toBe(200000);
  expect((await pixels(page)).colored).toBeGreaterThan(1000);
  const zoomed = await page.evaluate(async () => { fig.setView({ xDomain: [0, 5], yDomain: [0, 5] }); await fig.ready(); return fig.inspect(); });
  expect(zoomed[0].kind).toBe('points');
  expect(zoomed[0].visible).toBeLessThanOrEqual(36);
  expect(errors).toEqual([]);
});

test('hover, rectangle selection, wheel zoom, and stale views stay coherent', async ({ page }) => {
  const errors = await load(page);
  await page.evaluate(async () => {
    window.fig = vs.figure({ width: 640, height: 420 });
    fig.setView({ xDomain: [0, 10], yDomain: [0, 10] });
    fig.scatter(new Float64Array([3, 5, 7]), new Float64Array([3, 5, 7]), { size: 12 });
    window.events = { hover: [], selection: [], viewchange: [] };
    for (const name of Object.keys(events)) fig.on(name, value => events[name].push(value));
    fig.mount(document.querySelector('#chart')); await fig.ready();
  });
  // Cover the entire plotting region, independently of exact font metrics.
  await page.keyboard.down('Shift');
  await page.mouse.move(100, 45); await page.mouse.down(); await page.mouse.move(540, 330, { steps: 10 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => events.selection.length)).toBeGreaterThan(0);
  const selection = await page.evaluate(() => events.selection.at(-1));
  const items = Array.isArray(selection) ? selection : [selection];
  expect(items.some(item => item.kind === 'points' && item.count === 3)).toBe(true);
  const pointPixel = await page.evaluate(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(c => c.getContext('webgl2'));
    const gl = canvas.getContext('webgl2'), data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 150) return { x: x / devicePixelRatio, y: (canvas.height - y - 1) / devicePixelRatio };
    }
    throw new Error('No rendered point found');
  });
  await page.mouse.move(pointPixel.x, pointPixel.y);
  await expect.poll(() => page.evaluate(() => events.hover.filter(Boolean).length)).toBeGreaterThan(0);
  await page.mouse.wheel(0, -250);
  await page.evaluate(async () => { await fig.ready(); });
  await expect.poll(() => page.evaluate(() => events.viewchange.length)).toBeGreaterThan(0);
  const latest = await page.evaluate(async () => {
    for (let i = 0; i < 8; i++) fig.setView({ xDomain: [i, i + 1], yDomain: [i, i + 1] });
    await fig.ready(); return fig.inspect();
  });
  expect(latest[0].visible).toBe(1);
  expect((await pixels(page)).error).toBe(0);
  expect(errors).toEqual([]);
});

for (const kind of ['heatmap', 'surface', 'scatter3d']) test(`${kind} draws nonempty scientific geometry`, async ({ page }) => {
  const errors = await load(page);
  const info = await page.evaluate(async kind => {
    window.fig = vs.figure({ title: kind, width: 640, height: 420 });
    const axis = Float64Array.from({ length: 21 }, (_, i) => i / 5 - 2);
    if (kind === 'scatter3d') fig.scatter3d(axis, axis.map(x => Math.sin(x)), axis.map(x => Math.cos(x)), { color: '#3366ff', size: 7 });
    else {
      const z = Float64Array.from({ length: axis.length ** 2 }, (_, i) => Math.sin(axis[i % axis.length]) * Math.cos(axis[Math.floor(i / axis.length)]));
      fig[kind](axis, axis, z, { colormap: 'viridis' });
    }
    fig.mount(document.querySelector('#chart')); await fig.ready(); return fig.inspect();
  }, kind);
  expect(info).toHaveLength(1);
  const result = await pixels(page);
  expect(result.colored).toBeGreaterThan(kind === 'scatter3d' ? 80 : 1000);
  expect(result.error).toBe(0);
  if (kind !== 'heatmap') {
    await page.mouse.move(320, 200); await page.mouse.down(); await page.mouse.move(420, 250, { steps: 5 }); await page.mouse.up();
    await page.evaluate(async () => fig.ready());
    expect((await pixels(page)).error).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('the gallery renders sixteen scientific examples, toggles benchmark series, filters, resets and exports', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/examples/web/');
  const modes = ['multi-line', 'training-loss', 'benchmark-score', 'quality-latency', 'signal', 'scatter', 'density', 'heatmap', 'precision', 'spectrum', 'phase', 'surface', 'scatter3d', 'lorenz', 'interference', 'peaks'];
  const benchmarkModes = modes.slice(0, 4);
  await expect(page.locator('[data-example]')).toHaveCount(16);
  await expect.poll(() => page.evaluate(() => window.vesoraGallery?.size ?? 0), { timeout: 30_000 }).toBe(16);
  await page.evaluate(async () => { await Promise.all([...vesoraGallery.values()].map(fig => fig.ready())); });
  await expect(page.locator('[data-example][data-ready="true"]')).toHaveCount(16, { timeout: 30_000 });
  await expect(page.locator('[data-example] canvas')).toHaveCount(32);
  for (const mode of modes) {
    const card = page.locator(`[data-example="${mode}"]`);
    await expect(card.locator('.representation')).not.toHaveText(/loading|preparing|hazırlanıyor|yükleniyor/i);
    await expect(card.locator('.representation')).not.toBeEmpty();
    await expect(card.locator('.error')).toBeHidden();
    await expect(card.locator('.code-details')).toHaveCount(1);
    await expect(card.locator('code')).toContainText('import vesora as vs');
    await expect(card.locator('code')).not.toContainText(/(?:import|from)\s+numpy/);
  }
  const drawings = await page.evaluate(() => [...vesoraGallery].map(([mode, fig]) => {
    const card = document.querySelector(`[data-example="${mode}"]`);
    const canvas = [...card.querySelectorAll('canvas')].find(item => item.getContext('webgl2'));
    const gl = canvas.getContext('webgl2');
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let colored = 0, minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200 && Math.min(data[i], data[i + 1], data[i + 2]) < 200) {
      colored++; const x = (i / 4) % canvas.width; minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    }
    return { mode, dimension: fig.spec.view.kind, colored, pixelSpan: maxX - minX, width: canvas.width, error: gl.getError(), info: fig.inspect() };
  }));
  expect(drawings.map(drawing => drawing.mode).sort()).toEqual([...modes].sort());
  expect(drawings.filter(drawing => drawing.dimension === '2d')).toHaveLength(11);
  expect(drawings.filter(drawing => drawing.dimension === '3d')).toHaveLength(5);
  for (const drawing of drawings) {
    expect(drawing.colored, `${drawing.mode} must draw actual geometry`).toBeGreaterThan(100);
    expect(drawing.error, `${drawing.mode} must not produce a WebGL error`).toBe(0);
    expect(drawing.info[0].rendered).toBeGreaterThan(0);
  }
  expect(drawings.find(drawing => drawing.mode === 'density').info[0].kind).toBe('density');
  expect(drawings.find(drawing => drawing.mode === 'density').info[0].total).toBe(1_000_000);
  expect(drawings.find(drawing => drawing.mode === 'surface').info[0].kind).toBe('surface');
  const scientificAxes = await page.evaluate(() => {
    const precision = vesoraGallery.get('precision');
    const values = precision.registry.get(precision.spec.layers[0].data.x).values;
    let min = Infinity, max = -Infinity;
    for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
    const spectrum = vesoraGallery.get('spectrum');
    return { precisionMin: min, precisionSpan: max - min, precisionDtype: precision.registry.get(precision.spec.layers[0].data.x).descriptor.dtype, spectrumScales: [spectrum.spec.view.xScale, spectrum.spec.view.yScale] };
  });
  expect(scientificAxes.precisionMin).toBeGreaterThanOrEqual(1e12);
  expect(scientificAxes.precisionSpan).toBeGreaterThan(0);
  expect(scientificAxes.precisionSpan).toBeLessThan(1000);
  expect(scientificAxes.precisionDtype).toBe('float64');
  const precisionDrawing = drawings.find(drawing => drawing.mode === 'precision');
  expect(precisionDrawing.pixelSpan).toBeGreaterThan(precisionDrawing.width * .5);
  expect(scientificAxes.spectrumScales).toContain('log');

  const benchmarks = await page.evaluate(() => {
    const summary = id => {
      const fig = vesoraGallery.get(id);
      return { view: fig.spec.view, layers: fig.spec.layers.map(layer => ({ kind: layer.kind, x: Array.from(fig.registry.get(layer.data.x).values), y: Array.from(fig.registry.get(layer.data.y).values) })) };
    };
    return { training: summary('training-loss'), score: summary('benchmark-score'), latency: summary('quality-latency'), lines: summary('multi-line') };
  });
  expect(benchmarks.lines.layers.map(layer => layer.kind)).toEqual(['line', 'line', 'line']);
  expect(benchmarks.lines.view.yLabel).toContain('°C');
  expect(benchmarks.training.view.yScale).toBe('log');
  expect(benchmarks.training.view.yLabel).toMatch(/düşük/i);
  for (const layer of benchmarks.training.layers) {
    expect(layer.y.every(value => Number.isFinite(value) && value > 0)).toBe(true);
    expect(layer.y.at(-1)).toBeLessThan(layer.y[0]);
  }
  expect(benchmarks.score.view.xScale).toBe('log');
  expect(benchmarks.score.view.yDomain).toEqual([0, 100]);
  expect(benchmarks.score.layers.filter(layer => layer.kind === 'scatter')).toHaveLength(3);
  for (const layer of benchmarks.score.layers) {
    expect(layer.x).toEqual([128, 256, 512, 1024, 2048, 4096, 8192]);
    expect(layer.y.every(value => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true);
  }
  expect(benchmarks.latency.view.xLabel).toMatch(/\bms\b/);
  expect(benchmarks.latency.view.yLabel).toMatch(/kalite|puan/i);
  expect(benchmarks.latency.view.yDomain).toEqual([0, 100]);

  const geometrySignature = id => page.evaluate(id => {
    const canvas = [...document.querySelector(`[data-example="${id}"]`).querySelectorAll('canvas')].find(item => item.getContext('webgl2'));
    const gl = canvas.getContext('webgl2'), data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let hash = 2166136261, colored = 0;
    for (const value of data) hash = Math.imul(hash ^ value, 16777619);
    for (let index = 0; index < data.length; index += 4) if (data[index + 3] > 200 && Math.min(data[index], data[index + 1], data[index + 2]) < 200) colored++;
    return { hash: hash >>> 0, colored, error: gl.getError(), contextLost: gl.isContextLost() };
  }, id);
  for (const mode of benchmarkModes) {
    const card = page.locator(`[data-example="${mode}"]`);
    await expect(card.locator('.data-note')).toContainText('Temsili');
    const toggle = card.locator('.series-legend button[data-series="0"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const indices = await page.evaluate(async id => {
      const { examples } = await import('/examples/web/scenarios.js');
      return examples.find(example => example.id === id).series[0].layerIndices;
    }, mode);
    const initialVisibility = await page.evaluate(id => vesoraGallery.get(id).spec.layers.map(layer => layer.visible), mode);
    expect(initialVisibility.every(Boolean)).toBe(true);
    const before = await geometrySignature(mode);
    await toggle.click();
    await page.evaluate(async id => vesoraGallery.get(id).ready(), mode);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    const hidden = await page.evaluate(id => vesoraGallery.get(id).spec.layers.map(layer => layer.visible), mode);
    expect(hidden).toEqual(initialVisibility.map((visible, index) => indices.includes(index) ? false : visible));
    const after = await geometrySignature(mode);
    expect(after.hash, `${mode}: hiding a series must change rendered geometry`).not.toBe(before.hash);
    expect(after.error).toBe(0);
    expect(after.contextLost).toBe(false);
    await toggle.click();
    await page.evaluate(async id => vesoraGallery.get(id).ready(), mode);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(id => vesoraGallery.get(id).spec.layers.map(layer => layer.visible), mode)).toEqual(initialVisibility);
    expect((await geometrySignature(mode)).hash).toBe(before.hash);
  }
  const scoreCard = page.locator('[data-example="benchmark-score"]');
  for (const toggle of await scoreCard.locator('.series-legend button[data-series]').all()) {
    await toggle.click();
    await page.evaluate(async () => vesoraGallery.get('benchmark-score').ready());
  }
  expect(await page.evaluate(() => vesoraGallery.get('benchmark-score').spec.layers.every(layer => !layer.visible))).toBe(true);
  await expect(scoreCard.locator('.representation')).toContainText('Tüm seriler gizli');
  expect((await geometrySignature('benchmark-score')).colored).toBe(0);
  await scoreCard.locator('[data-action="reset"]').click();
  await page.evaluate(async () => vesoraGallery.get('benchmark-score').ready());
  expect(await page.evaluate(() => vesoraGallery.get('benchmark-score').spec.layers.every(layer => layer.visible))).toBe(true);
  await expect(scoreCard.locator('.series-legend button[aria-pressed="true"]')).toHaveCount(3);
  expect((await geometrySignature('benchmark-score')).colored).toBeGreaterThan(100);

  // A control must change actual source values, not merely its caption.
  const dataFingerprint = id => page.evaluate(id => {
    const fig = vesoraGallery.get(id);
    return JSON.stringify(fig.spec.layers.map(layer => Object.entries(layer.data).map(([channel, source]) => {
      const entry = fig.registry.get(source), values = entry.values;
      const indices = [...new Set([0, 1, 2, Math.floor(values.length / 4), Math.floor(values.length / 2), Math.floor(values.length * .75), values.length - 1])].filter(index => index >= 0 && index < values.length);
      return { channel, dtype: entry.descriptor.dtype, shape: entry.descriptor.shape, values: indices.map(index => values[index]) };
    })));
  }, id);
  for (const mode of ['phase', 'lorenz', 'interference']) {
    const card = page.locator(`[data-example="${mode}"]`);
    const slider = card.locator('input[type="range"][data-control]');
    await expect(slider).toHaveCount(1);
    const initialValue = await slider.inputValue();
    const before = await dataFingerprint(mode);
    await slider.evaluate(input => {
      const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 1;
      let value = min + Math.round((max - min) * .63 / step) * step;
      if (Math.abs(value - Number(input.value)) < step / 2) value = max;
      input.value = String(Math.min(max, value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(() => dataFingerprint(mode)).not.toBe(before);
    await page.evaluate(async id => vesoraGallery.get(id).ready(), mode);
    await card.locator('[data-action="reset"]').click();
    await page.evaluate(async id => vesoraGallery.get(id).ready(), mode);
    await expect(slider).toHaveValue(initialValue);
    expect(await dataFingerprint(mode)).toBe(before);
  }

  await page.locator('[data-filter="2d"]').click();
  await expect(page.locator('[data-example]:visible')).toHaveCount(11);
  await expect(page.locator('#visible-count')).toHaveAttribute('data-count', '11');
  await page.locator('[data-filter="ai"]').click();
  await expect(page.locator('[data-example]:visible')).toHaveCount(3);
  await expect(page.locator('#visible-count')).toHaveAttribute('data-count', '3');
  for (const mode of ['training-loss', 'benchmark-score', 'quality-latency']) await expect(page.locator(`[data-example="${mode}"]`)).toBeVisible();
  await page.locator('[data-filter="3d"]').click();
  await expect(page.locator('[data-example]:visible')).toHaveCount(5);
  await expect(page.locator('#visible-count')).toHaveAttribute('data-count', '5');
  await page.locator('#gallery-search').fill('lorenz');
  await expect(page.locator('[data-example]:visible')).toHaveCount(1);
  await expect(page.locator('[data-example="lorenz"]')).toBeVisible();
  await page.locator('#gallery-search').fill('no-such-vesora-example');
  await expect(page.locator('[data-example]:visible')).toHaveCount(0);
  await expect(page.locator('#visible-count')).toHaveAttribute('data-count', '0');
  await page.locator('#gallery-search').fill('');
  await page.locator('[data-filter="all"]').click();
  await expect(page.locator('[data-example]:visible')).toHaveCount(16);
  const focused = page.locator('[data-example="signal"]');
  await focused.locator('[data-action="focus"]').click();
  await expect(focused).toHaveClass(/is-focused/);
  await expect(focused.locator('[data-action="focus"]')).toHaveAttribute('aria-pressed', 'true');
  await focused.locator('[data-action="focus"]').click();
  await expect(focused).not.toHaveClass(/is-focused/);
  const codeCard = page.locator('[data-example="phase"]');
  await codeCard.locator('.code-details summary').click();
  await codeCard.locator('[data-language="javascript"]').click();
  await expect(codeCard.locator('[data-language="javascript"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(codeCard.locator('code')).toContainText('@vesora/core');
  await codeCard.locator('[data-language="python"]').click();
  await expect(codeCard.locator('code')).toContainText('import vesora as vs');
  await codeCard.locator('.code-details summary').click();
  const initial = await page.evaluate(() => ({ density: vesoraGallery.get('density').inspect()[0], camera: structuredClone(vesoraGallery.get('surface').spec.view.camera) }));
  await page.evaluate(async () => {
    const density = vesoraGallery.get('density'), surface = vesoraGallery.get('surface');
    density.setView({ xDomain: [0, .1], yDomain: [0, .1] });
    surface.setView({ camera: { ...surface.spec.view.camera, azimuth: 100 } });
    await Promise.all([density.ready(), surface.ready()]);
  });
  await page.locator('[data-example="density"] [data-action="reset"]').click();
  await page.locator('[data-example="surface"] [data-action="reset"]').click();
  await page.evaluate(async () => { await Promise.all([...vesoraGallery.values()].map(fig => fig.ready())); });
  expect(await page.evaluate(() => vesoraGallery.get('density').inspect()[0].visible)).toBe(initial.density.visible);
  expect(await page.evaluate(() => vesoraGallery.get('surface').spec.view.camera)).toEqual(initial.camera);
  // Rebuilding five scenes must release their old GPU contexts and keep the
  // original first chart alive; browsers cap concurrent WebGL contexts.
  for (let reset = 0; reset < 5; reset++) {
    await page.locator('[data-example="surface"] [data-action="reset"]').click();
    await page.evaluate(async () => vesoraGallery.get('surface').ready());
  }
  await expect(page.locator('[data-example="multi-line"] .error')).toBeHidden();
  const firstScene = await page.evaluate(() => {
    const card = document.querySelector('[data-example="multi-line"]');
    const canvas = [...card.querySelectorAll('canvas')].find(item => item.getContext('webgl2'));
    const gl = canvas.getContext('webgl2');
    const data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let colored = 0;
    for (let index = 0; index < data.length; index += 4) if (data[index + 3] > 200 && Math.min(data[index], data[index + 1], data[index + 2]) < 200) colored++;
    return { colored, contextLost: gl.isContextLost(), error: gl.getError() };
  });
  expect(firstScene.contextLost).toBe(false);
  expect(firstScene.colored).toBeGreaterThan(100);
  expect(firstScene.error).toBe(0);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/gallery-desktop.png', fullPage: true });
  const download = page.waitForEvent('download');
  await page.locator('[data-example="surface"] [data-action="export"]').click();
  expect((await download).suggestedFilename()).toBe('vesora-surface.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(async () => { await Promise.all([...vesoraGallery.values()].map(fig => fig.ready())); });
  await expect(page.locator('[data-example] canvas')).toHaveCount(32);
  // Keep captures below software GPU texture limits on this tall gallery.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'artifacts/gallery-mobile.png' });
  await page.locator('[data-example="interference"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/gallery-mobile-3d.png' });
  expect(errors).toEqual([]);
});

test('Python binary snapshots match JavaScript scenes and render through the same core', async ({ page }) => {
  const errors = await load(page);
  const localPython = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
  const python = process.env.PYTHON ?? (existsSync(localPython) ? resolve(localPython) : 'python');
  const fixtures = JSON.parse(execFileSync(python, ['tests/browser/python_scene.py'], { encoding: 'utf8', windowsHide: true }));
  const comparisons = await page.evaluate(async fixtures => {
    function normalize(snapshot) {
      const sources = new Map(snapshot.sources.map(source => [source.id, source]));
      const { id, layers, ...figure } = snapshot.figure;
      return { ...figure, layers: layers.map(layer => ({ kind: layer.kind, style: layer.style, visible: layer.visible, data: Object.fromEntries(Object.entries(layer.data).map(([channel, id]) => { const { id: ignored, ...descriptor } = sources.get(id); return [channel, descriptor]; })) })) };
    }
    const result = [];
    for (const fixture of fixtures) {
      const native = vs.figure({ title: fixture.snapshot.figure.title });
      if (fixture.kind === 'scatter') {
        native.scatter(new Float64Array([1, 2, 3]), new Float32Array([3, 1, 2]), { color: '#218061', label: 'Measurements' });
        native.setView({ xDomain: [0, 4], yDomain: [0, 4], xLabel: 'x', yLabel: 'value' });
      } else native.surface(new Float64Array([-1, 1]), new Float64Array([-1, 1]), new Float64Array([0, 1, 2, 3]), { colormap: 'magma' });
      const bridged = vs.figure();
      const buffers = new Map(fixture.buffers.map(({ id, base64 }) => [id, Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer]));
      bridged.applySnapshot(fixture.snapshot, buffers);
      bridged.mount(document.querySelector('#chart')); await bridged.ready();
      result.push({ python: normalize(bridged.snapshot()), javascript: normalize(native.snapshot()), rendered: bridged.inspect()[0].rendered });
      bridged.close(); native.close();
    }
    return result;
  }, fixtures);
  for (const comparison of comparisons) { expect(comparison.python).toEqual(comparison.javascript); expect(comparison.rendered).toBeGreaterThan(0); }
  expect(errors).toEqual([]);
});

test('notebook bundle renders binary traits, runs its blob worker, updates and exports through comms', async ({ page }) => {
  const errors = await load(page);
  const localPython = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python';
  const python = process.env.PYTHON ?? (existsSync(localPython) ? resolve(localPython) : 'python');
  const fixture = JSON.parse(execFileSync(python, ['tests/browser/python_scene.py'], { encoding: 'utf8', windowsHide: true }))[0];
  await page.evaluate(async fixture => {
    const NativeWorker = window.Worker;
    window.workerEvidence = { urls: [], replies: 0 };
    window.Worker = class extends NativeWorker {
      constructor(url, options) { super(url, options); workerEvidence.urls.push(String(url)); this.addEventListener('message', () => workerEvidence.replies++); }
    };
    // anywidget can import its ESM from a blob, without a stable relative asset base.
    const source = await (await fetch('/python/vesora/_assets/notebook.js')).text();
    window.notebookModuleURL = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const { render } = await import(notebookModuleURL);
    const state = {}, listeners = new Map();
    window.messages = [];
    function fill(data) {
      state.snapshot = data.snapshot;
      state.buffers = data.buffers.map(({ base64 }) => {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const padded = new Uint8Array(bytes.length + 16); padded.set(bytes, 8);
        return new DataView(padded.buffer, 8, bytes.length);
      });
    }
    fill(fixture);
    const model = {
      get: key => state[key],
      on: (name, callback) => { const callbacks = listeners.get(name) ?? new Set(); callbacks.add(callback); listeners.set(name, callbacks); },
      off: (name, callback) => listeners.get(name)?.delete(callback),
      send: message => messages.push(message),
    };
    window.notebookFixture = fixture;
    window.updateNotebook = () => { fill(fixture.update); for (const name of ['change:buffers', 'change:snapshot']) for (const callback of listeners.get(name) ?? []) callback(); };
    window.exportNotebook = () => { for (const callback of listeners.get('msg:custom') ?? []) callback({ type: 'export', requestId: 'png-check' }); };
    window.cleanupNotebook = () => { dispose(); URL.revokeObjectURL(notebookModuleURL); window.Worker = NativeWorker; return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); };
    const dispose = render({ model, el: document.querySelector('#chart') });
  }, fixture);
  await expect.poll(() => page.evaluate(() => messages.filter(message => message.type === 'ready').length)).toBe(1);
  const initial = await pixels(page);
  expect(initial.colored).toBeGreaterThan(10);
  expect(initial.error).toBe(0);
  const worker = await page.evaluate(() => workerEvidence);
  expect(worker.urls.some(url => url.startsWith('blob:'))).toBe(true);
  expect(worker.replies).toBeGreaterThan(0);
  await page.evaluate(() => { updateNotebook(); exportNotebook(); });
  await expect.poll(() => page.evaluate(() => messages.filter(message => message.type === 'export').length)).toBe(1);
  const updated = await pixels(page);
  expect(updated.blue).toBeGreaterThan(10);
  const exported = await page.evaluate(async () => {
    const message = messages.find(message => message.type === 'export');
    const blob = await (await fetch(message.dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 2] > data[i] + 50 && data[i + 2] > data[i + 1] + 50) blue++;
    return { type: blob.type, width: bitmap.width, height: bitmap.height, requestId: message.requestId, blue, failures: messages.filter(message => message.type === 'export-error' || message.event === 'error') };
  });
  expect(exported.type).toBe('image/png');
  expect(exported.requestId).toBe('png-check');
  expect(exported.blue).toBeGreaterThan(10);
  expect(exported.failures).toEqual([]);
  expect(await page.evaluate(() => cleanupNotebook())).toBe(0);
  await expect(page.locator('#chart canvas')).toHaveCount(0);
  expect(errors).toEqual([]);
});
