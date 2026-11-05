import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {killTree} from './v1-runner.mjs';

const root = resolve('.'), output = process.env.VESORA_V1_OUTPUT ?? resolve('artifacts/v1-verification/manual-ui');
await mkdir(output, {recursive: true});
async function freePort() {
  const server = createServer(); await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const port = server.address().port; await new Promise(resolveClosed => server.close(resolveClosed)); return port;
}
const staticPort = await freePort(), reactPort = await freePort(), reactDevPort = await freePort(), servers = [], results = [];
function start(args, cwd, env = {}) {
  const processHandle = spawn(process.execPath, args, {cwd, env: {...process.env, ...env, FORCE_COLOR: '0'}, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
  let log = ''; const append = chunk => {log = (log + chunk).slice(-20000);};
  processHandle.stdout.on('data', append); processHandle.stderr.on('data', append);
  processHandle.on('error', append); servers.push({processHandle, log: () => log});
  return processHandle;
}
start([resolve(root, 'scripts/serve.mjs')], root, {PORT: String(staticPort)});
start([resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(reactPort), '--strictPort'], resolve(root, 'examples/react-saas'));
// The development route exercises React StrictMode's setup → cleanup → setup
// cycle. A production build alone cannot detect stale ready-promise failures.
start([resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(reactDevPort), '--strictPort'], resolve(root, 'examples/react-saas'));
let browser;
try {
  for (const url of [`http://127.0.0.1:${staticPort}/examples/web/v1.html`, `http://127.0.0.1:${reactPort}/`, `http://127.0.0.1:${reactDevPort}/`]) {
    await expect.poll(async () => {try {return (await fetch(url)).ok;} catch {return false;}}, {timeout: 20000}).toBe(true);
  }
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({executablePath: process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  for (const [host, url] of [['browser', `http://127.0.0.1:${staticPort}/examples/web/v1.html`], ['react', `http://127.0.0.1:${reactPort}/?demo=v1`], ['react-dev', `http://127.0.0.1:${reactDevPort}/?demo=v1`]]) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(url);
      if (host === 'react-dev') await expect(page.locator('script[src="/@vite/client"]')).toHaveCount(1);
      const toolbar = page.locator('[aria-label="Workspace controls"]');
      const workspace = host === 'browser' ? page.locator('#workspace') : toolbar.getByLabel('Workspace');
      const dataset = host === 'browser' ? page.locator('#dataset') : toolbar.getByLabel('Dataset');
      const button = name => toolbar.getByRole('button', {name, exact: true});
      const ready = (kind, data = 'sensor') => expect(page.getByText(`Ready · ${kind} · synthetic ${data} data`, {exact: true})).toBeVisible({timeout: 20000});
      const noAlerts = () => expect(page.getByRole('alert')).toHaveCount(0);
      let downloadIndex = 0;
      async function exported() {
        const pending = page.waitForEvent('download', {timeout: 15000});
        await button('Export displayed HTML').click();
        const download = await pending, path = resolve(output, `${host}-observation-${downloadIndex++}.html`);
        await download.saveAs(path); const html = await readFile(path, 'utf8');
        return page.evaluate(source => JSON.parse(new DOMParser().parseFromString(source, 'text/html').querySelector('#vesora-payload').textContent), html);
      }
      await ready('gallery'); await noAlerts();
      // A remounted live viewer must own the completed frame; an abandoned
      // viewer's rejected ready promise must not leave an alert or dead controls.
      await expect(button('Freeze view')).toBeEnabled();
      await expect(button('Export displayed HTML')).toBeEnabled();
      await workspace.selectOption('signal'); await ready('signal');
      await button('Freeze view').click();
      await expect(button('Resume live view')).toBeEnabled();
      const before = await exported();
      await button('Append 8 samples').click();
      await expect(page.getByText(/Accepted through 39 s · 32\/32 retained rows/)).toBeVisible();
      const after = await exported();
      assert.deepEqual(after.buffers, before.buffers, `${host}: frozen export changed source bytes while acquisition advanced`);
      assert.equal(after.capture.frameId, before.capture.frameId, `${host}: frozen export changed displayed frame`);
      await button('Use light theme').click();
      await button('Resume live view').click();
      await expect(button('Freeze view')).toBeEnabled();
      const resumed = await exported();
      assert.notDeepEqual(resumed.buffers, before.buffers, `${host}: resume did not reveal the newly accepted rows`);
      const line = resumed.snapshot.figure.layers.find(layer => layer.kind === 'line');
      assert.equal(resumed.snapshot.sources.find(source => source.id === line.data.x).shape[0], 32);
      const spectrum = resumed.snapshot.figure.layers.find(layer => layer.kind === 'spectrogram');
      assert.equal(resumed.snapshot.sources.find(source => source.id === spectrum.data.y).shape[0], 32);
      await page.screenshot({path: resolve(output, `${host}-signal.png`), fullPage: true});

      await workspace.selectOption('comparison'); await ready('comparison');
      const compared = await exported(), delta = compared.snapshot.figure.layers.find(layer => layer.style?.label === 'Delta');
      assert.ok(delta, `${host}: comparison delta panel missing`);
      const raw = Buffer.from(compared.buffers.find(buffer => buffer.id === delta.data.y).base64, 'base64');
      assert.ok(raw.readDoubleLE(0) > 0 && raw.readDoubleLE(raw.length - 8) > raw.readDoubleLE(0), `${host}: delta did not preserve the known event-aligned synthetic change`);
      await page.screenshot({path: resolve(output, `${host}-comparison.png`), fullPage: true});

      await workspace.selectOption('cohort'); await ready('cohort');
      const section = page.getByRole('region', {name: 'Selected cohort'}), body = section.locator('tbody');
      await expect(body.locator('tr')).toHaveCount(12);
      const firstId = await body.locator('tr').first().locator('td').first().innerText();
      await section.getByRole('button', {name: 'Next page', exact: true}).click();
      await expect(body.locator('tr').first().locator('td').first()).not.toHaveText(firstId);
      await section.getByRole('button', {name: 'Select latency ≥75', exact: true}).click();
      const selected = await exported(), group = selected.snapshot.figure.observationGroups[0];
      assert.ok(group.selectedIds.length > 0 && group.selectedIds.length < 64);
      assert.ok(group.selectedIds.every(id => group.rowIds.includes(id)));
      await section.getByRole('button', {name: 'Clear selection', exact: true}).click();
      await expect(section.locator('output')).toContainText('64');
      await dataset.selectOption('service'); await ready('cohort', 'service');
      await page.screenshot({path: resolve(output, `${host}-cohort.png`), fullPage: true});
      await workspace.selectOption('gallery'); await ready('gallery', 'service');
      await noAlerts(); assert.deepEqual(errors, [], `${host}: browser errors during workspace lifecycle`);
      results.push({host, status: 'passed', developmentStrictMode: host === 'react-dev', gallery: true, frozenAcceptedAppend: true, retainedRows: 32, comparisonDelta: true, stableCohort: true, pagination: true, datasetReplacement: true, theme: true});
      console.log(`${host}: real workspaces, frozen append, comparison delta, cohort paging and lifecycle passed`);
    } finally {await context.close();}
  }
} catch (error) {throw new Error(`${error.message}\n${servers.map(server => server.log()).join('\n')}`);}
finally {
  await browser?.close(); await Promise.all(servers.map(server => killTree(server.processHandle)));
  await writeFile(resolve(output, 'ui.json'), JSON.stringify({results}, null, 2) + '\n');
}
