import {test, expect} from '@playwright/test';

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/react/harness.html');
  await ready(page);
  return errors;
}
async function ready(page) {
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-state', 'ready');
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-rendering', 'false');
}
async function payload(page) {
  return page.evaluate(async () => {
    const html = await window.reactFixture.exportHTML();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return JSON.parse(parsed.querySelector('#vesora-payload').textContent);
  });
}

test('StrictMode keeps one mounted figure; refresh retains source layers and the canvas', async ({page}) => {
  const errors = await open(page);
  await expect(page.locator('.vesora-figure')).toHaveCount(1);
  const before = await payload(page);
  await page.evaluate(() => {window.originalCanvas = document.querySelector('.vesora-figure canvas');});
  await page.getByRole('button', {name: 'Refresh data'}).click();
  await ready(page);
  const after = await payload(page);
  expect(after.snapshot.figure.layers.map(layer => layer.id)).toEqual(before.snapshot.figure.layers.map(layer => layer.id));
  expect(await page.evaluate(() => window.originalCanvas === document.querySelector('.vesora-figure canvas'))).toBe(true);
  expect(await page.evaluate(() => window.reactFixture.exportPNG())).toBeGreaterThan(1000);
  await page.getByRole('button', {name: 'Toggle mount'}).click();
  await expect(page.locator('.vesora-figure')).toHaveCount(0);
  await page.getByRole('button', {name: 'Toggle mount'}).click();
  await ready(page);
  await expect(page.locator('.vesora-figure')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('theme, accessible legend, resize and API states compose with existing charts', async ({page}) => {
  const errors = await open(page);
  const revenue = page.getByRole('button', {name: 'Revenue', exact: true});
  await revenue.focus();
  await page.keyboard.press('Space');
  await expect(revenue).toHaveAttribute('aria-pressed', 'false');
  await revenue.press('Enter');
  await expect(revenue).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Change theme'}).click();
  await ready(page);
  const dark = await payload(page);
  expect(dark.snapshot.figure.theme.background).not.toBe('#ffffff');
  expect(dark.snapshot.figure.view.xScale).toBe('time');
  expect(dark.snapshot.figure.view.yFormat.kind).toBe('currency');
  await page.getByRole('button', {name: 'Resize card'}).click();
  await expect.poll(() => page.locator('.vesora-figure canvas').first().evaluate(canvas => canvas.clientWidth)).toBe(420);
  await page.getByRole('button', {name: 'Loading', exact: true}).click();
  await expect(page.getByRole('status')).toHaveText('Loading data…');
  await page.getByRole('button', {name: 'Loading', exact: true}).click();
  await page.getByRole('button', {name: 'API error'}).click();
  await expect(page.getByRole('alert')).toContainText('The API is unavailable.');
  await page.getByRole('button', {name: 'API error'}).click();
  await page.getByRole('button', {name: 'Empty data'}).click();
  await expect(page.getByRole('status')).toHaveText('No data available.');
  await page.getByRole('button', {name: 'Restore data'}).click();
  await ready(page);
  expect(errors).toEqual([]);
});

test('real scatter hover supplies a React tooltip and click maps back to an application row', async ({page}) => {
  const errors = await open(page);
  await page.getByRole('button', {name: 'Change type'}).click();
  await ready(page);
  const target = await page.locator('.vesora-figure canvas').first().evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rect = canvas.getBoundingClientRect();
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] < 80 && pixels[i + 1] < 150 && pixels[i + 2] > 180) return {x: rect.left + x / canvas.width * rect.width, y: rect.top + (canvas.height - y - 1) / canvas.height * rect.height};
    }
    throw new Error('No scatter data pixels were rendered.');
  });
  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId('custom-tooltip')).toBeVisible();
  await expect(page.getByTestId('custom-tooltip')).toContainText('TRY');
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId('clicked')).toHaveText(/^[abc]$/);
  await page.mouse.move(10, 10);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(errors).toEqual([]);
});
