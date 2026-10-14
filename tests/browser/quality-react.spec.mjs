import {test, expect} from '@playwright/test';

async function ready(page) {
  const chart = page.locator('[data-vesora-chart]');
  await expect(chart).toHaveAttribute('data-vesora-state', 'ready');
  await expect(chart).toHaveAttribute('data-vesora-rendering', 'false');
}

async function payload(page) {
  return page.evaluate(async () => {
    const html = await window.reactFixture.exportHTML();
    return JSON.parse(new DOMParser().parseFromString(html, 'text/html').querySelector('#vesora-payload').textContent);
  });
}

async function middleSample(page) {
  return page.locator('.vesora-figure canvas').first().evaluate(canvas => {
    const gl = canvas.getContext('webgl2'), pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = Infinity, max = -Infinity;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] < 80 && pixels[i + 1] < 150 && pixels[i + 2] > 180) {min = Math.min(min, x); max = Math.max(max, x);}
    }
    if (!Number.isFinite(min)) throw new Error('The primary line has no rendered data pixels.');
    const rect = canvas.getBoundingClientRect();
    return {x: rect.left + (min + max) / 2 / canvas.width * rect.width, y: rect.top + rect.height * .45};
  });
}

test('React bands keep line identity and export at explicit dimensions without changing the live card', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/react/harness.html?quality=1'); await ready(page);
  const initial = await payload(page), layers = initial.snapshot.figure.layers;
  expect(layers.map(layer => layer.kind)).toEqual(['band', 'line', 'line']);
  expect(initial.snapshot.figure.hoverMode).toBe('x');
  const revenue = page.getByRole('button', {name: 'Revenue', exact: true});
  await revenue.click(); await ready(page);
  const hidden = (await payload(page)).snapshot.figure.layers;
  expect(hidden.map(layer => layer.visible)).toEqual([false, false, true]);
  await revenue.click(); await ready(page);
  await page.getByRole('button', {name: 'Toggle band'}).click(); await ready(page);
  expect((await payload(page)).snapshot.figure.layers.map(layer => layer.id)).toEqual(layers.slice(1).map(layer => layer.id));
  await page.getByRole('button', {name: 'Toggle band'}).click(); await ready(page);
  const restored = await payload(page);
  expect(restored.snapshot.figure.layers.map(layer => layer.kind)).toEqual(['band', 'line', 'line']);
  expect(restored.snapshot.figure.layers.slice(1).map(layer => layer.id)).toEqual(layers.slice(1).map(layer => layer.id));
  const before = await page.locator('.vesora-figure').boundingBox();
  expect(await page.evaluate(() => window.reactFixture.exportPNGDimensions({width: 420, height: 240, scale: 2}))).toEqual({width: 840, height: 480});
  expect(await page.locator('.vesora-figure').boundingBox()).toEqual(before);
  expect((await payload(page)).snapshot.figure).toEqual(restored.snapshot.figure);
  await expect(page.locator('.vesora-figure')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('React custom x tooltip reports an original source row and a missing series across a data gap', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/react/harness.html?quality=1'); await ready(page);
  const target = await middleSample(page);
  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId('custom-x-tooltip')).toContainText('Revenue: b');
  await expect(page.getByTestId('custom-x-tooltip')).toContainText('Expense: — | — | —');
  const hover = await page.evaluate(() => window.reactFixture.lastXHover());
  expect(hover.items[0]).toMatchObject({index: 1, x: Date.UTC(2026, 9, 2), y: 40, row: {id: 'b'}, missing: false});
  expect(hover.items[1]).toMatchObject({missing: true, formattedX: '—', formattedY: '—'});
  await expect(page.getByTestId('custom-tooltip')).toHaveCount(0);
  await page.getByRole('button', {name: 'Refresh data'}).click(); await ready(page);
  const refreshedTarget = await middleSample(page);
  await page.mouse.move(10, 10);
  await page.mouse.move(refreshedTarget.x, refreshedTarget.y);
  await expect.poll(() => page.evaluate(() => window.reactFixture.lastXHover()?.items[0]?.y)).toBe(45);
  await page.mouse.move(10, 10);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('React keeps a touch-pinned x tooltip until the core clears it', async ({browser}) => {
  const context = await browser.newContext({hasTouch: true, viewport: {width: 760, height: 700}});
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:4173/tests/fixtures/react/harness.html?quality=1'); await ready(page);
    const target = await middleSample(page);
    await page.touchscreen.tap(target.x, target.y);
    await expect(page.getByTestId('custom-x-tooltip')).toContainText('Revenue: b');
    await page.mouse.move(10, 10);
    await expect(page.getByTestId('custom-x-tooltip')).toContainText('Revenue: b');
    await page.locator('.vesora-figure canvas').last().focus();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    expect(await page.evaluate(() => window.reactFixture.lastXHover())).toBeNull();
  } finally {await context.close();}
});
