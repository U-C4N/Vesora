import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function exportHTML(page, testInfo, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export HTML', exact: true}).click();
  const download = await pending, path = testInfo.outputPath(`${name}.html`);
  await download.saveAs(path);
  return page.evaluate(html => JSON.parse(new DOMParser().parseFromString(html, 'text/html').querySelector('#vesora-payload').textContent), await readFile(path, 'utf8'));
}

async function received(page) {
  const status = await page.getByRole('status').first().textContent();
  return Number(status.match(/([\d,]+) received/)[1].replaceAll(',', ''));
}

async function linePixels(page) {
  return page.locator('.vesora-figure canvas').first().evaluate(canvas => {
    const gl = canvas.getContext('webgl2'), pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const colors = [[53, 105, 200], [19, 127, 139], [211, 106, 85]];
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 100 && colors.some(color => color.every((value, channel) => Math.abs(pixels[index + channel] - value) < 20))) count++;
    }
    return count;
  });
}

test('inspecting the live chart pauses retention and Resume restores the current window', async ({page}, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?demo=streaming');
  await expect(page.getByRole('status').first()).toContainText('2,000 retained', {timeout: 30_000});
  const canvas = page.locator('.vesora-figure canvas').last();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5);
  await page.evaluate(() => document.addEventListener('pointerdown', () => {
    const status = document.querySelector('[role="status"]').textContent;
    window.__receivedAtInspection = Number(status.match(/([\d,]+) received/)[1].replaceAll(',', ''));
  }, {capture: true, once: true}));
  await page.mouse.down();
  await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeVisible({timeout: 1500});
  await page.mouse.move(box.x + box.width * .72, box.y + box.height * .5, {steps: 8});
  await page.mouse.up();
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-rendering', 'false');
  const panned = await exportHTML(page, testInfo, 'inspection-panned');
  expect(panned.snapshot.figure.view.xDomain).toHaveLength(2);
  const settled = await received(page);
  expect(settled - await page.evaluate(() => window.__receivedAtInspection)).toBeLessThanOrEqual(100); // One already submitted batch may finish.
  expect(await linePixels(page)).toBeGreaterThan(50);
  // More than a full 2,000-row retention window would elapse at the live rate.
  await page.waitForTimeout(1800);
  expect(await received(page)).toBe(settled);
  const inspected = await exportHTML(page, testInfo, 'inspection-retained');
  expect(inspected.buffers).toEqual(panned.buffers);
  expect(await linePixels(page)).toBeGreaterThan(50);

  async function resume() {
    const count = await received(page);
    await page.getByRole('button', {name: 'Resume', exact: true}).click();
    await expect(page.getByRole('status').first()).toContainText('Live');
    await expect.poll(() => received(page)).toBeGreaterThan(count);
  }
  await resume();
  const resumed = await exportHTML(page, testInfo, 'inspection-resumed');
  expect(resumed.snapshot.figure.view).not.toHaveProperty('xDomain');
  expect(resumed.snapshot.figure.view).not.toHaveProperty('yDomain');
  expect(await linePixels(page)).toBeGreaterThan(50);

  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5);
  await page.mouse.wheel(0, -300);
  await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeVisible();
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-rendering', 'false');
  const zoomed = await exportHTML(page, testInfo, 'inspection-zoomed');
  expect(zoomed.snapshot.figure.view.xDomain[1] - zoomed.snapshot.figure.view.xDomain[0]).toBeLessThan(1900);
  const zoomedCount = await received(page);
  await page.waitForTimeout(200);
  expect(await received(page)).toBe(zoomedCount);
  await resume();
  const unzoomed = await exportHTML(page, testInfo, 'inspection-unzoomed');
  expect(unzoomed.snapshot.figure.view).not.toHaveProperty('xDomain');
  expect(unzoomed.snapshot.figure.view).not.toHaveProperty('yDomain');

  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    await canvas.focus();
    await page.keyboard.press(key);
    await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeVisible();
    await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-rendering', 'false');
    const count = await received(page);
    await page.waitForTimeout(150);
    expect(await received(page)).toBe(count);
    // The one in-flight append may replace the first inspected frame. Once it
    // settles, keyboard inspection must still reach the chart normally.
    await page.keyboard.press(key);
    await expect(page.getByRole('tooltip')).toContainText('Model A');
    await resume();
  }
  expect(errors).toEqual([]);
});

test('streaming example bounds three curves, pauses, preserves data on theme changes and exports', async ({page}, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?demo=streaming');
  await expect(page.getByRole('heading', {name: 'Synthetic training telemetry'})).toBeVisible();
  await expect(page.getByRole('status').first()).toContainText('2,000 retained', {timeout: 30_000});
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await expect(page.getByRole('status').first()).toContainText('Paused');
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-rendering', 'false');
  const before = await exportHTML(page, testInfo, 'before-theme');
  expect(before.snapshot.figure.layers).toHaveLength(3);
  expect(before.snapshot.sources.every(source => source.shape[0] === 2000)).toBe(true);
  await page.getByRole('button', {name: 'Switch theme', exact: true}).click();
  const after = await exportHTML(page, testInfo, 'after-theme');
  expect(after.snapshot.sources).toEqual(before.snapshot.sources);
  expect(after.buffers).toEqual(before.buffers);
  await page.locator('.vesora-figure canvas').last().focus(); await page.keyboard.press('End');
  await expect(page.getByRole('tooltip')).toContainText('Model A');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export PNG', exact: true}).click();
  const png = await pending, path = testInfo.outputPath('telemetry.png'); await png.saveAs(path);
  const bytes = await readFile(path);
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([2200, 1200]);
  await page.getByRole('button', {name: 'Restart stream', exact: true}).click();
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-state', 'empty');
  await page.getByRole('button', {name: 'Resume', exact: true}).click();
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-state', 'ready');
  expect(errors).toEqual([]);
});
