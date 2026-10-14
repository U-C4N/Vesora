import {test as base, expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import configuration from '../../playwright.config.ts';

const test = base.extend({
  demoURL: async ({}, use) => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const files = new Set(['/tests/browser/harness.html', '/examples/web/streaming.html', '/examples/web/streaming.js', '/packages/core/dist/index.js', '/packages/core/dist/worker.js']);
    // The development server deliberately sends no-store, which excludes this
    // page from Chrome's BFCache. Serve the identical shipped files using normal
    // HTTP caching rules to cover deployment hosts that permit BFCache.
    const server = createServer(async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
      if (!files.has(pathname)) {response.writeHead(404).end(); return;}
      try {
        const bytes = await readFile(join(root, pathname.slice(1)));
        response.writeHead(200, {'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Content-Length': bytes.length});
        response.end(bytes);
      } catch {response.writeHead(500).end();}
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {await use(`http://127.0.0.1:${server.address().port}`);}
    finally {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}
  },
});

// Playwright disables BFCache by default. Limit this override to this file.
test.use({
  launchOptions: {...configuration.use.launchOptions, ignoreDefaultArgs: ['--disable-back-forward-cache']},
  trace: 'off',
});

test('drag, wheel and keyboard inspection pause telemetry; Resume follows the current window', async ({page, demoURL}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${demoURL}/examples/web/streaming.html`);
  const status = page.locator('#status');
  const received = async () => Number((await status.innerText()).match(/([\d.,]+) received/)?.[1].replace(/[.,]/g, '') ?? NaN);
  await expect.poll(received).toBeGreaterThanOrEqual(2000);
  const canvas = page.locator('#chart canvas').last();

  async function exportedScene() {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Save HTML snapshot', exact: true}).click();
    const download = await pending;
    expect(await download.failure()).toBeNull();
    const html = await readFile(await download.path(), 'utf8');
    return page.evaluate(source => {
      const payload = JSON.parse(new DOMParser().parseFromString(source, 'text/html').querySelector('#vesora-payload').textContent);
      return {view: payload.snapshot.figure.view, buffers: payload.buffers};
    }, html);
  }
  async function coloredPixels() {
    return page.locator('#chart canvas').first().evaluate(canvas => {
      const gl = canvas.getContext('webgl2'), values = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, values);
      let count = 0;
      for (let index = 0; index < values.length; index += 4)
        if (values[index + 2] > 100 && values[index + 2] > values[index] * 1.3) count++;
      return count;
    });
  }
  for (const gesture of ['drag', 'wheel', 'keyboard']) {
    await test.step(gesture, async () => {
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      if (gesture === 'drag') {
        await page.mouse.down();
        // The producer must stop at gesture start, before a long drag can evict.
        await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeVisible();
        await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, {steps: 12});
        await page.mouse.up();
      } else if (gesture === 'wheel') await page.mouse.wheel(0, -250);
      else {await canvas.focus(); await page.keyboard.press('End');}

      await expect(status).toContainText('Paused');
      await expect(page.getByRole('button', {name: 'Resume', exact: true})).toBeVisible();
      await page.waitForTimeout(200);
      const frozen = await exportedScene();
      if (gesture !== 'keyboard') expect(frozen.view.xDomain).toHaveLength(2);
      const paused = await status.innerText();
      // Longer than the nominal 2,000-row window turnover at 100 rows/50ms.
      await page.waitForTimeout(1500);
      expect(await status.innerText()).toBe(paused);
      await expect(canvas).toBeVisible();
      expect(await coloredPixels()).toBeGreaterThan(20);
      expect((await exportedScene()).buffers).toEqual(frozen.buffers);

      const count = await received();
      await page.getByRole('button', {name: 'Resume', exact: true}).click();
      await expect.poll(received).toBeGreaterThan(count);
      await expect(status).toContainText('Live');
      const {view} = await exportedScene();
      expect(view.xDomain).toBeUndefined();
      expect(view.yDomain).toBeUndefined();
      expect(await coloredPixels()).toBeGreaterThan(20);
    });
  }
  expect(errors).toEqual([]);
});

test('a failed telemetry module load displays an alert and keeps controls disabled', async ({page, demoURL}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/examples/web/streaming.js', route => route.abort('failed'));
  await page.goto(`${demoURL}/examples/web/streaming.html`);
  await expect(page.getByRole('alert')).toContainText('Could not load the chart:');
  await expect(page.getByRole('alert')).toContainText('Reload the page to retry.');
  expect(await page.locator('nav button').count()).toBe(4);
  for (const button of await page.locator('nav button').all()) await expect(button).toBeDisabled();
  expect(await page.locator('#chart canvas').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('live telemetry survives real back and forward cache restores, including a paused stream', async ({page, context, browser, demoURL}, testInfo) => {
  // Playwright's goBack/goForward lifecycle tracking does not support BFCache.
  // CDP drives the browser's actual history and reads its current document;
  // persisted pageshow events and document identity rule out a fresh reload.
  // https://playwright.dev/docs/navigations#backforward-cache-bfcache
  const cdp = await context.newCDPSession(page);
  const browserCDP = await browser.newBrowserCDPSession();
  const notRestored = [], errors = [], downloads = new Map();
  cdp.on('Page.backForwardCacheNotUsed', event => notRestored.push(event));
  cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text));
  browserCDP.on('Browser.downloadWillBegin', event => downloads.set(event.guid, {...event, state: 'inProgress'}));
  browserCDP.on('Browser.downloadProgress', event => {
    const download = downloads.get(event.guid);
    if (download) download.state = event.state;
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: `
    window.navigationProbe = {id: crypto.randomUUID(), events: []};
    for (const type of ['pageshow', 'pagehide']) addEventListener(type, event => {
      window.navigationProbe.events.push({type, persisted: event.persisted});
    });
  `});
  const downloadDirectory = testInfo.outputPath('downloads');
  await mkdir(downloadDirectory, {recursive: true});
  const {targetInfo} = await cdp.send('Target.getTargetInfo');
  await browserCDP.send('Browser.setDownloadBehavior', {
    behavior: 'allowAndName', downloadPath: downloadDirectory,
    browserContextId: targetInfo.browserContextId, eventsEnabled: true,
  });

  async function evaluate(expression) {
    const result = await cdp.send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, userGesture: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  async function state() {
    // A context can disappear between a history navigation and its next poll.
    try {
      return await evaluate(`({url: location.href, ready: document.readyState, probe: window.navigationProbe,
        status: document.querySelector('#status')?.textContent ?? '',
        pause: document.querySelector('#pause')?.textContent,
        figures: document.querySelectorAll('#chart .vesora-figure').length,
        canvases: document.querySelectorAll('#chart canvas').length})`);
    } catch {return null;}
  }
  async function navigate(url) {
    await cdp.send('Page.navigate', {url});
    await expect.poll(async () => (await state())?.url).toBe(url);
    await expect.poll(async () => (await state())?.ready).toBe('complete');
  }
  async function history(delta, expectedURL) {
    const {entries, currentIndex} = await cdp.send('Page.getNavigationHistory');
    const destination = entries[currentIndex + delta];
    expect(destination?.url).toBe(expectedURL);
    await cdp.send('Page.navigateToHistoryEntry', {entryId: destination.id});
    await expect.poll(async () => (await state())?.url).toBe(expectedURL);
  }
  const received = current => Number(current.status.match(/([\d.,]+) received/)?.[1].replace(/[.,]/g, '') ?? NaN);
  async function rendered() {
    expect(await state()).toMatchObject({figures: 1, canvases: 2});
    const pixels = await evaluate(`(() => {
      const canvas = document.querySelector('#chart canvas');
      const gl = canvas?.getContext('webgl2');
      if (!gl || gl.isContextLost()) return 0;
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let colored = 0;
      for (let index = 0; index < pixels.length; index += 4)
        if (pixels[index + 2] > 100 && pixels[index + 2] > pixels[index] * 1.3) colored++;
      return colored;
    })()`);
    expect(pixels).toBeGreaterThan(20);
  }
  async function restored(documentId, count) {
    await expect.poll(async () => (await state())?.probe?.events.filter(event => event.type === 'pageshow' && event.persisted).length,
      {message: 'History must restore the real BFCache document; a normal reload does not cover this regression.'}).toBe(count);
    expect((await state()).probe.id).toBe(documentId);
    expect((await state()).probe.events.filter(event => event.type === 'pagehide' && event.persisted)).toHaveLength(count);
  }

  const before = new URL('/tests/browser/harness.html?before-stream', demoURL).href;
  const demo = new URL('/examples/web/streaming.html', demoURL).href;
  const after = new URL('/tests/browser/harness.html?after-stream', demoURL).href;
  let finalState;
  try {
    await navigate(before);
    await navigate(demo);
    await expect.poll(async () => received(await state())).toBeGreaterThanOrEqual(2000);
    const original = await state();
    await rendered();

    await navigate(after);
    await history(-1, demo);
    await restored(original.probe.id, 1);
    await rendered();
    await expect.poll(async () => received(await state())).toBeGreaterThan(received(original));
    expect((await state()).pause).toBe('Pause');

    await evaluate("document.querySelector('#pause').click()");
    await expect.poll(async () => (await state())?.pause).toBe('Resume');
    // Let a batch already accepted when Pause was clicked finish first.
    await new Promise(resolve => setTimeout(resolve, 200));
    const paused = await state();
    expect(paused.status).toMatch(/^Paused/);
    await history(-1, before);
    await history(1, demo);
    await restored(original.probe.id, 2);
    expect((await state()).pause).toBe('Resume');
    await new Promise(resolve => setTimeout(resolve, 250));
    expect((await state()).status).toBe(paused.status);
    await rendered();

    await evaluate("document.querySelector('#png').click()");
    await expect.poll(() => [...downloads.values()].filter(download => download.state === 'completed').length).toBe(1);
    const download = [...downloads.values()][0];
    expect(download.suggestedFilename).toBe('telemetry.png');
    const png = await readFile(join(downloadDirectory, download.guid));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2200, 1200]);
    await testInfo.attach('restored-telemetry.png', {body: png, contentType: 'image/png'});

    await evaluate("document.querySelector('#pause').click()");
    await expect.poll(async () => received(await state())).toBeGreaterThan(received(paused));
    finalState = await state();
    expect(finalState.pause).toBe('Pause');
    expect(errors).toEqual([]);
  } finally {
    const evidence = testInfo.outputPath('navigation-evidence.json');
    await writeFile(evidence, JSON.stringify({browser: browser.version(), finalState: finalState ?? await state(), notRestored, errors}, null, 2));
    await testInfo.attach('navigation-evidence.json', {path: evidence, contentType: 'application/json'});
    await browserCDP.detach();
    await cdp.detach();
  }
});
