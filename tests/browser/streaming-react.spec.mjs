import {test, expect} from '@playwright/test';

async function ready(page) {
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-state', 'ready');
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-rendering', 'false');
}

async function scene(page) {
  return page.evaluate(async () => {
    const html = await window.reactFixture.exportHTML();
    const payload = JSON.parse(new DOMParser().parseFromString(html, 'text/html').querySelector('#vesora-payload').textContent);
    return {figure: payload.snapshot.figure, sources: payload.snapshot.sources, buffers: payload.buffers};
  });
}

test('React streaming evicts aligned rows, keeps style updates source-stable, and exports the retained window', async ({page}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/react/harness.html?streaming=1'); await ready(page);
  const initial = await scene(page);
  await page.evaluate(() => window.reactFixture.appendRows([
    {id: 'd', timestamp: Date.UTC(2026, 9, 4), revenue: 50, expense: 20, lower: 45, upper: 55},
    {id: 'e', timestamp: Date.UTC(2026, 9, 5), revenue: 60, expense: 22, lower: 55, upper: 65},
  ]));
  await ready(page);
  const retained = await scene(page);
  expect(retained.figure.layers.map(layer => layer.id)).toEqual(initial.figure.layers.map(layer => layer.id));
  expect(retained.sources.every(source => source.shape[0] === 3)).toBe(true);
  const values = await page.evaluate(payload => payload.figure.layers.map(layer => {
    const source = payload.buffers.find(buffer => buffer.id === layer.data.y);
    return Array.from(new Float64Array(Uint8Array.from(atob(source.base64), character => character.charCodeAt(0)).buffer));
  }), retained);
  expect(values).toEqual([[30, 50, 60], [18, 20, 22]]);
  await page.getByRole('button', {name: 'Change theme', exact: true}).click(); await ready(page);
  await page.getByRole('button', {name: 'Expense', exact: true}).click(); await ready(page);
  const styled = await scene(page);
  expect(styled.sources).toEqual(retained.sources);
  expect(styled.buffers).toEqual(retained.buffers);
  await page.locator('.vesora-figure canvas').last().focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('custom-x-tooltip')).toContainText('Revenue: e');
  const inspection = await page.evaluate(() => window.reactFixture.lastXHover());
  expect(inspection.items[0]).toMatchObject({sequence: 4, row: {id: 'e'}, x: Date.UTC(2026, 9, 5), y: 60});
  expect(typeof inspection.items[0].streamId).toBe('string');
  const invalid = await page.evaluate(async () => {
    try {await window.reactFixture.appendRows([{id: 'bad', timestamp: Date.UTC(2026, 9, 6), revenue: 70, expense: 'invalid'}]); return '';} catch (error) {return error.message;}
  });
  expect(invalid).toContain('expense must be a number');
  expect((await scene(page)).buffers).toEqual(styled.buffers);
  await page.getByRole('button', {name: 'Refresh data', exact: true}).click(); await ready(page);
  await page.locator('.vesora-figure canvas').last().focus(); await page.keyboard.press('End');
  await expect(page.getByTestId('custom-x-tooltip')).toContainText('Revenue: c');
  expect(await page.evaluate(() => window.reactFixture.exportPNGDimensions({width: 500, height: 300, scale: 2}))).toEqual({width: 1000, height: 600});
  expect(errors).toEqual([]);
});
