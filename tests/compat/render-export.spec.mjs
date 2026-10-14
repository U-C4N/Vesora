import {test, expect} from '@playwright/test';

test('WebGL2 rendering, stream retention, keyboard inspection, PNG and offline HTML', async ({page, context}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/browser/harness.html');
  const result = await page.evaluate(async () => {
    const {figure, toHTML} = await import('/packages/core/dist/index.js');
    const fig = figure({width: 640, height: 360, title: 'Browser compatibility'});
    const line = fig.plot([0, 1, 2], [1, 3, 2], {color: '#2563eb', label: 'Series'}).enableStreaming({maxPoints: 3});
    fig.setHoverMode('x'); fig.mount(document.querySelector('#chart')); await fig.ready();
    await line.appendData({x: [3, 4], y: [4, 3]});
    const gl = document.querySelector('canvas').getContext('webgl2');
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let blue = 0;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 80 && pixels[index + 1] > 40 && pixels[index + 2] > 180) blue++;
    const blob = await fig.savefig({width: 400, height: 300, scale: 1});
    const png = new Uint8Array(await blob.arrayBuffer()), header = new DataView(png.buffer);
    window.compatFigure = fig; window.compatHover = null;
    fig.on('xhover', event => {window.compatHover = event;});
    return {blue, dimensions: [header.getUint32(16), header.getUint32(20)], signature: [...png.slice(0, 8)], html: toHTML(fig), stream: fig.getStreamingState(line.id)};
  });
  expect(result.blue).toBeGreaterThan(20);
  expect(result.dimensions).toEqual([400, 300]);
  expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result.stream).toMatchObject({retained: 3, evicted: 2, nextSequence: 5});
  await page.locator('canvas').last().focus(); await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => window.compatHover?.items[0]?.sequence)).toBe(4);
  await page.evaluate(() => window.compatFigure.close());
  await context.setOffline(true);
  await page.goto(`data:text/html,${encodeURIComponent(result.html)}`);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready', 'ready');
  await expect(page.locator('#vesora-error')).toBeHidden();
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download PNG', exact: true}).click();
  expect(await (await download).failure()).toBeNull();
  expect(errors).toEqual([]);
});
