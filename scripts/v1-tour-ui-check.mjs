// Focused chart-tour behavior check. Owns only ephemeral servers, never port 5173.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {chromium, expect} from '@playwright/test';
import {chartStories} from '../examples/web/v1-tour-scenarios.js';
import {killTree} from './v1-runner.mjs';

const root = resolve('.'), output = process.env.VESORA_V1_OUTPUT ?? resolve('artifacts/chart-tour-ui');
await mkdir(output, {recursive: true});
const began = performance.now(), results = [], servers = [];
async function freePort() {const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done)); const port = server.address().port; await new Promise(done => server.close(done)); return port;}
function start(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, {cwd, env: {...process.env, ...env, FORCE_COLOR: '0'}, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
  let log = ''; const append = value => {log = (log + value).slice(-20000);}; child.stdout.on('data', append); child.stderr.on('data', append); child.on('error', append); servers.push({child, log: () => log});
}
const staticPort = await freePort(), productionPort = await freePort(), devPort = await freePort();
start([resolve(root, 'scripts/serve.mjs')], root, {PORT: String(staticPort)});
start([resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(productionPort), '--strictPort'], resolve(root, 'examples/react-saas'));
start([resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(devPort), '--strictPort'], resolve(root, 'examples/react-saas'));
let browser;
try {
  for (const url of [`http://127.0.0.1:${staticPort}/examples/web/v1-tour.html`, `http://127.0.0.1:${productionPort}/`, `http://127.0.0.1:${devPort}/`]) await expect.poll(async () => {try {return (await fetch(url)).ok;} catch {return false;}}, {timeout: 20000}).toBe(true);
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({executablePath: process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const expectedKind = {ecdf: 'ecdf', spectrogram: 'spectrogram', timeline: 'eventTimeline', errorbar: 'errorbar', contour: 'contour', quiver: 'quiver', parallel: 'parallelCoordinates', pareto: 'paretoFront', hysteresis: 'phasePortrait', ternary: 'ternary'};
  for (const [host, url] of [['standalone', `http://127.0.0.1:${staticPort}/examples/web/v1-tour.html?chart=ecdf`], ['production', `http://127.0.0.1:${productionPort}/?demo=tour&chart=ecdf`], ['dev-strictmode', `http://127.0.0.1:${devPort}/?demo=tour&chart=ecdf`]]) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    const families = [];
    try {
      await page.goto(url);
      if (host === 'dev-strictmode') await expect(page.locator('script[src="/@vite/client"]')).toHaveCount(1);
      const ready = async story => {
        await expect(page.locator('[data-chart-story]')).toHaveAttribute('data-chart-story', story.slug);
        await expect(page.locator('.tour-state[role="status"]')).toContainText(`${story.titleTr} hazır`, {timeout: 20000});
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.locator('[data-vesora-viewer]')).toHaveCount(1);
        await expect(page.getByRole('button', {name: /PNG indir/})).toBeEnabled();
        await expect(page.locator('.tour-synthetic')).toHaveText('Sentetik örnek veri');
        assert.equal(new URL(page.url()).searchParams.get('chart'), story.slug);
      };
      const nav = page.getByRole('navigation', {name: 'Grafik ailesi'});
      await expect(nav.getByRole('button')).toHaveCount(10);
      for (const [index, story] of chartStories.entries()) {
        if (index) await nav.getByRole('button').nth(index).click();
        await ready(story);
        await expect(page.locator('.tour-reading li')).toHaveCount(story.readingTr.length);
        await expect(page.locator('.tour-metrics strong')).toHaveCount(3);
        const pending = page.waitForEvent('download');
        await page.getByRole('button', {name: /HTML paylaş/}).click();
        const download = await pending, path = resolve(output, `${host}-${story.slug}.html`); await download.saveAs(path);
        const source = await readFile(path, 'utf8');
        const payload = await page.evaluate(html => JSON.parse(new DOMParser().parseFromString(html, 'text/html').querySelector('#vesora-payload').textContent), source);
        assert.equal(payload.snapshot.figure.protocolVersion, 9);
        assert.ok(payload.snapshot.figure.layers.some(layer => layer.kind === expectedKind[story.slug]), `${host}/${story.slug} did not export its actual analysis layer`);
        assert.equal(payload.capture.source, 'displayed');
        if (index === 0) {
          const pngReady = page.waitForEvent('download'); await page.getByRole('button', {name: /PNG indir/}).click();
          const png = await pngReady, pngPath = resolve(output, `${host}-ecdf-export.png`); await png.saveAs(pngPath);
          const bytes = await readFile(pngPath);
          assert.ok(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
          assert.equal(bytes.readUInt32BE(16), 1200); assert.equal(bytes.readUInt32BE(20), 640);
        }
        families.push(story.slug);
      }
      await page.getByRole('button', {name: 'Koyu temaya geç'}).click();
      await ready(chartStories[9]);
      await page.screenshot({path: resolve(output, `${host}-1440-dark.png`), fullPage: true, animations: 'disabled'});
      await page.getByRole('button', {name: 'Açık temaya geç'}).click();
      await ready(chartStories[9]);
      const api = page.locator('.tour-api'); await api.locator('summary').click();
      await api.getByRole('button', {name: 'Python', exact: true}).click();
      await expect(api.locator('code')).toHaveText(chartStories[9].apiPython);
      await api.locator('summary').click();
      for (const width of [390, 320]) {
        await page.setViewportSize({width, height: 1000});
        await page.getByLabel('Grafik seç', {exact: true}).selectOption('ecdf');
        await ready(chartStories[0]);
        const layout = await page.evaluate(() => ({viewport: innerWidth, scroll: document.documentElement.scrollWidth, canvas: document.querySelector('.tour-canvas').getBoundingClientRect().width, prose: Number.parseFloat(getComputedStyle(document.querySelector('.tour-explanation')).fontSize)}));
        assert.ok(layout.scroll <= width + 1, `${host} overflows at ${width}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.canvas >= 200, `${host} chart falls below core minimum width`);
        assert.ok(layout.prose >= 12, `${host} essential reading text is too small`);
        await page.screenshot({path: resolve(output, `${host}-${width}.png`), fullPage: true, animations: 'disabled'});
        await page.getByLabel('Grafik seç', {exact: true}).selectOption('ternary'); await ready(chartStories[9]);
      }
      await page.setViewportSize({width: 1440, height: 1100});
      await nav.getByRole('button').nth(9).focus(); await page.keyboard.press('Home'); await ready(chartStories[0]);
      await nav.getByRole('button').first().focus(); await page.keyboard.press('ArrowRight'); await ready(chartStories[1]);
      await page.reload(); await ready(chartStories[1]);
      await expect(page.getByRole('alert')).toHaveCount(0); assert.deepEqual(errors, []);
      results.push({host, families, displayExport: true, pngDimensions: [1200,640], darkTheme: true, codeLanguages: true, mobileWidths: [390, 320], keyboard: true, deepLinkReload: true, errors});
      console.log(`${host}: all ten real chart stories, exports, mobile layouts, keyboard and deep-link reload passed`);
    } catch (error) {await page.screenshot({path: resolve(output, `${host}-failure.png`), fullPage: true}).catch(() => {}); throw error;}
    finally {await context.close();}
  }
} catch (error) {throw new Error(`${error.message}\n${servers.map(server => server.log()).join('\n')}`);}
finally {
  await browser?.close(); await Promise.all(servers.map(server => killTree(server.child)));
  await writeFile(resolve(output, 'tour-ui.json'), JSON.stringify({status: results.length === 3 ? 'passed' : 'failed', durationMs: Math.round(performance.now() - began), results}, null, 2) + '\n');
}
