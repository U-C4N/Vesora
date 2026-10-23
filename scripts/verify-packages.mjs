import {releaseIdentity} from './release-identity.mjs';
import {loadRelease,validateRuntimeHashes} from './release-validation.mjs';
// Validate release archives as installed consumers, outside the checkout.
// Usage: node scripts/verify-packages.mjs [release-directory]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const packageVersion = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')).version;
const archiveDirectory = resolve(process.argv[2] ?? join(checkout, 'dist', `release-v${packageVersion}`));
const release = await loadRelease(archiveDirectory,{packagesOnly:true});
const environment = { ...process.env };
for (const name of ['PYTHONPATH', 'PYTHONHOME', 'NODE_PATH', 'NODE_OPTIONS']) delete environment[name];
let workspace;

function run(command, args, cwd, label) {
  console.log(label);
  execFileSync(command, args, {
    cwd, env: environment, stdio: 'inherit', windowsHide: true, timeout: 120_000,
  });
}

function isWithin(parent, target) {
  const path = relative(parent, target);
  return path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}

function npmCLI() {
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    process.env.APPDATA && join(process.env.APPDATA, 'npm/node_modules/npm/bin/npm-cli.js'),
  ];
  const path = candidates.find(candidate => candidate && /\.(?:c?js|mjs)$/i.test(candidate) && existsSync(candidate));
  if (!path) throw new Error('Could not locate npm-cli.js. Run this verifier through an npm script or install npm beside Node.js.');
  return resolve(path);
}

async function verifyHTML(browser, name, htmlPath, outputDirectory) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, offline: true, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (/^https?:/i.test(request.url())) network.push(request.url()); });
  try {
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]', { timeout: 45_000 });
    assert.equal(await page.locator('#vesora-error').isVisible(), false, `${name}: viewer reported an error`);
    const payload = JSON.parse(await page.locator('#vesora-payload').textContent());
    assert.equal(payload.snapshot.figure.protocolVersion, 3, `${name}: statistics need protocol 3`);
    assert.deepEqual(payload.snapshot.figure.categories['x:panel-0-2'], ['B', 'A']);
    assert.deepEqual(new Set(payload.snapshot.figure.layers.map(layer => layer.kind)), new Set(['scatter', 'line', 'hist', 'bar', 'boxplot']));
    assert.equal(await page.locator('#vesora-layer option').count(), 8, `${name}: all old and statistical layers must render`);
    const histogramOption = page.locator('#vesora-layer option').filter({ hasText: 'Distribution' });
    await page.locator('#vesora-layer').selectOption(await histogramOption.getAttribute('value'));
    assert.match(await page.locator('#vesora-representation').innerText(), /histogram/i);
    const bookmark = page.getByRole('button', { name: 'Focus', exact: true });
    assert.equal(await bookmark.count(), 1, `${name}: installed package did not preserve bookmarks`);
    await bookmark.click();
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]');
    assert.equal(await bookmark.getAttribute('aria-pressed'), 'true', `${name}: bookmark was not applied`);
    assert.match(await page.locator('#vesora-status').innerText(), /Viewing Focus/);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
    const download = await downloadPromise;
    const pngPath = join(outputDirectory, `${name}.png`);
    await download.saveAs(pngPath);
    assert.equal(await download.failure(), null, `${name}: PNG download failed`);
    const png = await readFile(pngPath);
    assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${name}: invalid PNG signature`);
    assert.ok(png.readUInt32BE(16) > 0 && png.readUInt32BE(20) > 0, `${name}: empty PNG dimensions`);
    await page.getByRole('button', { name: 'Reset view', exact: true }).click();
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]');
    assert.equal(await page.locator('#vesora-bookmarks button[aria-pressed="true"]').count(), 0, `${name}: reset retained an active bookmark`);
    await page.screenshot({ path: join(outputDirectory, `${name}-viewer.png`), fullPage: true });
    assert.deepEqual(network, [], `${name}: standalone HTML attempted external HTTP requests`);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    console.log(`${name}: offline file opened, bookmark restored, and PNG exported.`);
    return { html: htmlPath, png: pngPath };
  } finally {
    await context.close();
  }
}

async function verifyLinkedHTML(browser, name, htmlPath, outputDirectory) {
  const context=await browser.newContext({viewport:{width:1500,height:900},offline:true,acceptDownloads:true});
  const page=await context.newPage(),errors=[],network=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/i.test(request.url()))network.push(request.url());});
  try {
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]',{timeout:45_000});
    const payload=JSON.parse(await page.locator('#vesora-payload').textContent());
    assert.equal(payload.snapshot.figure.protocolVersion,4);
    assert.equal(payload.snapshot.figure.selectionLink.scatter.length,2);
    const summary=page.locator('#vesora-selection-summary'),clear=page.locator('#vesora-clear-selection');
    assert.equal(await clear.isDisabled(),true);
    const canvas=await page.locator('#vesora-chart canvas').last().boundingBox();
    assert.ok(canvas,'Linked canvas is missing');
    await page.keyboard.down('Shift');
    await page.mouse.move(canvas.x+90,canvas.y+115);await page.mouse.down();
    await page.mouse.move(canvas.x+305,canvas.y+405,{steps:12});await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.waitForFunction(()=>document.querySelector('#vesora-selection-summary')?.textContent?.includes('Selected'));
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]');
    assert.equal(await clear.isDisabled(),false);
    const selected=await summary.textContent();
    await page.getByRole('button',{name:'Reset view',exact:true}).click();
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]');
    assert.equal(await summary.textContent(),selected,'Reset view must preserve the cohort');
    const downloadPromise=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download PNG',exact:true}).click();
    const download=await downloadPromise,png=join(outputDirectory,`${name}-linked.png`);await download.saveAs(png);
    assert.equal(await download.failure(),null);
    await clear.click();await page.waitForSelector('#vesora-viewer[data-ready="ready"]');
    await page.waitForFunction(()=>document.querySelector('#vesora-clear-selection')?.disabled===true);
    await page.screenshot({path:join(outputDirectory,`${name}-linked-viewer.png`),fullPage:true});
    assert.deepEqual(network,[]);assert.deepEqual(errors,[]);
    console.log(`${name}: installed linked API, offline selection, reset preservation, clear and PNG passed.`);
    return {html:htmlPath,png};
  } finally {await context.close();}
}

async function verifyPresentationHTML(browser, name, path, outputDirectory) {
  const context = await browser.newContext({offline: true, acceptDownloads: true});
  const page = await context.newPage(), errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/^https?:/i.test(request.url())) network.push(request.url());});
  try {
    await page.goto(pathToFileURL(path).href);
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]');
    const payload = JSON.parse(await page.locator('#vesora-payload').textContent());
    assert.equal(payload.snapshot.figure.protocolVersion, 5);
    assert.equal(payload.snapshot.figure.view.xScale, 'time');
    assert.equal(payload.snapshot.figure.view.yFormat.kind, 'currency');
    assert.equal(payload.snapshot.figure.theme.background, '#0f172a');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Download PNG', exact: true}).click();
    const download = await downloadPromise;
    const png = join(outputDirectory, `${name}-presentation.png`);
    await download.saveAs(png);
    assert.equal(await download.failure(), null);
    assert.ok((await readFile(png)).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.deepEqual(errors, []);assert.deepEqual(network, []);
    console.log(`${name}: installed protocol 5, offline theme/time/currency and PNG passed.`);
    return {html: path, png};
  } finally {await context.close();}
}

async function verifyQualityHTML(browser, name, path, outputDirectory) {
  const context = await browser.newContext({offline: true, acceptDownloads: true, viewport: {width: 1100, height: 800}});
  const page = await context.newPage(), errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/^https?:/i.test(request.url())) network.push(request.url());});
  try {
    await page.goto(pathToFileURL(path).href);
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]', {timeout: 45_000});
    const payload = JSON.parse(await page.locator('#vesora-payload').textContent());
    const scene = payload.snapshot.figure;
    assert.equal(scene.protocolVersion, 6);
    assert.equal(scene.hoverMode, 'x');
    assert.equal(scene.theme.tickFontSize, 14);
    assert.equal(scene.theme.labelFontSize, 16);
    const band = scene.layers.find(layer => layer.kind === 'band');
    assert.deepEqual(Object.keys(band.data).sort(), ['lower', 'upper', 'x']);
    assert.equal(band.style.opacity, .18);
    assert.equal(scene.layers.find(layer => layer.kind === 'heatmap').style.colorbarLabel, 'Amplitude');
    assert.equal(await page.locator('#vesora-layer option').count(), 3);
    await page.locator('#vesora-layer').selectOption(band.id);
    assert.match(await page.locator('#vesora-representation').innerText(), /band|interval/i);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Download PNG', exact: true}).click();
    const download = await downloadPromise, png = join(outputDirectory, `${name}-quality.png`);
    await download.saveAs(png);
    assert.equal(await download.failure(), null);
    const bytes = await readFile(png);
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
    await page.screenshot({path: join(outputDirectory, `${name}-quality-viewer.png`), fullPage: true});
    assert.deepEqual(errors, []);assert.deepEqual(network, []);
    console.log(`${name}: installed protocol 6, offline bands, typography, colorbar label and PNG passed.`);
    return {html: path, png};
  } finally {await context.close();}
}

async function verifyScienceHTML(browser, name, path, outputDirectory, {source = 'accepted', sliceIndex = 1} = {}) {
  const context = await browser.newContext({offline: true, acceptDownloads: true, viewport: {width: 1400, height: 850}});
  const page = await context.newPage(), errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/^https?:/i.test(request.url())) network.push(request.url());});
  try {
    await page.goto(pathToFileURL(path).href);
    await page.waitForSelector('#vesora-viewer[data-ready="ready"]', {timeout: 45_000});
    const payload = JSON.parse(await page.locator('#vesora-payload').textContent()), scene = payload.snapshot.figure;
    assert.equal(scene.protocolVersion, 7);
    assert.equal(payload.capture.source, source);
    assert.ok(Number.isFinite(Date.parse(payload.capture.capturedAt)), 'Missing capture timestamp');
    assert.equal(scene.view.kind, '3d');assert.equal(scene.view.equalAspect, true);
    assert.equal(scene.panels[1].view.kind, '2d');assert.equal(scene.panels[2].view.kind, '2d');
    assert.equal(scene.slices[0].index, sliceIndex);
    const surface = scene.layers.find(layer => layer.kind === 'surface');
    assert.equal(surface.style.shading, 'smooth');assert.equal(surface.style.wireframe, true);
    assert.deepEqual(payload.snapshot.sources.find(item => item.id === surface.data.color).shape, [2, 2]);
    assert.ok(scene.layers.some(layer => layer.kind === 'line3d'));
    assert.equal(await page.locator('[data-vesora-viewer]').count(), 1);
    assert.equal(await page.locator('.vv-slices input').inputValue(), String(sliceIndex));
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', {name: 'Download PNG', exact: true}).click(),
    ]);
    const png = join(outputDirectory, `${name}-science.png`);
    await download.saveAs(png);assert.equal(await download.failure(), null);
    assert.ok((await readFile(png)).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    await page.screenshot({path: join(outputDirectory, `${name}-science-viewer.png`), fullPage: true});
    assert.deepEqual(errors, []);assert.deepEqual(network, []);
    console.log(`${name}: installed protocol 7, mixed panels/scalar surface/slice, shared viewer and offline PNG passed.`);
    return {html: path, png, capture: payload.capture};
  } finally {await context.close();}
}

// Serve only the installed package's manifest-bound browser modules. No checkout source or
// dependency fallback can accidentally satisfy this consumer's imports.
async function verifyFrozenConsumer(browser, npmDirectory, outputDirectory) {
  const assets = new Map([['/', Buffer.from('<!doctype html><html><body><div id="chart" style="width:1300px"></div></body></html>')]]);
  for(const name of validateRuntimeHashes(release.manifest.runtime)){
    const bytes=await readFile(join(npmDirectory,'node_modules/@vesora/core/dist',`${name}.js`));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),release.manifest.runtime[name],`${name}: installed runtime differs from its release manifest`);
    assets.set(`/${name}.js`,bytes);
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname, body = assets.get(path);
    response.writeHead(body ? 200 : 404, {
      'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
      // Keep this isolated consumer restricted to its installed modules even on
      // hosts whose HTTP scanners inject third-party scripts into local HTML.
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'",
    });
    response.end(body ?? 'Not found');
  });
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve);});
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext({viewport: {width: 1400, height: 850}});
  // Deliver the empty fixture document verbatim. Local HTTP scanners can rewrite
  // HTML (including its CSP) before Chromium sees it; that is not package code.
  // Runtime/worker modules still come from the installed-package HTTP server.
  await context.route(origin + '/', route => route.fulfill({status: 200,
    contentType: 'text/html; charset=utf-8', body: assets.get('/'),
    headers: {'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'"},
  }));
  const page = await context.newPage(), errors = [], externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/^https?:/i.test(request.url()) && !request.url().startsWith(origin + '/')) externalRequests.push(request.url());});
  try {
    await page.goto(origin);
    const result = await page.evaluate(async () => {
      const core = await import('/index.js'), {mountViewer} = await import('/viewer.js'), {createABPins} = await import('/labs.js');
      const fig = core.subplots({rows: 1, cols: 3, kinds: [['3d', '2d', '2d']], width: 1100, height: 500, title: 'Installed frozen scientific consumer'});
      const surface = fig.panel(0, 0).surface([0, 1], [0, 1], [[1, 2], [3, 4]], {values: [[10, 20], [30, 40]], shading: 'smooth', wireframe: true});
      fig.panel(0, 0).plot3d([0, 1], [0, 1], [1, 4]);fig.panel(0, 0).setEqualAspect();
      const slice = fig.panel(0, 1).slice(surface, {axis: 'x', index: 1});
      const a = fig.panel(0, 2).plot([0, 1], [10, 11]).enableStreaming({maxPoints: 3});
      const b = fig.panel(0, 2).plot([0, 1], [20, 21]).enableStreaming({maxPoints: 3});
      const viewer = mountViewer(fig, document.querySelector('#chart'), {preserveTheme: true}), pins = createABPins(fig);
      try {
        await fig.ready();const frozen = fig.freezeInspection();pins.pin('A');
        await fig.appendDataBatch([{layer: a, data: {x: [2, 3, 4], y: [12, 13, 14]}}, {layer: b, data: {x: [2, 3, 4], y: [22, 23, 24]}}], {waitFor: 'accepted'});
        fig.setInspectionSlice(slice.id, 0);await fig.ready({target: 'displayed'});pins.pin('B');
        const lease = fig.captureExport('displayed');
        const shown = Array.from(lease.registry.get(a.spec.data.x).values);lease.release();
        const canonicalIndex = fig.snapshot().figure.slices[0].index, held = fig.getInspectionState();
        const html = core.toHTML(fig, {source: 'displayed'}), pendingPNG = fig.savefig({source: 'displayed', width: 1100, height: 500, scale: 1});
        const pinIndices = [pins.get('A').snapshot.figure.slices[0].index, pins.get('B').snapshot.figure.slices[0].index];
        await fig.resumeLive();const png = Array.from(new Uint8Array(await (await pendingPNG).arrayBuffer()));pins.close();
        const resumed = fig.getInspectionState(), retained = Array.from(fig.registry.get(a.spec.data.x).values);
        viewer.dispose();const preserved = fig.snapshot().figure.layers.length > 0;
        return {html, png, frozen, held, resumed, shown, retained, canonicalIndex, pinIndices, preserved};
      } finally {pins.close();viewer.dispose();fig.close();}
    });
    assert.deepEqual(result.shown, [0, 1]);assert.deepEqual(result.retained, [2, 3, 4]);
    assert.equal(result.canonicalIndex, 1);assert.deepEqual(result.pinIndices, [1, 0]);
    assert.equal(result.held.snapshotId, result.frozen.snapshotId);
    assert.ok(result.held.acceptedRevision > result.held.displayedRevision);
    assert.equal(result.resumed.mode, 'live');assert.equal(result.resumed.snapshotBytes, 0);
    assert.equal(result.resumed.acceptedRevision, result.resumed.displayedRevision);assert.equal(result.preserved, true);
    const html = join(outputDirectory, 'javascript-frozen-science.html'), png = join(outputDirectory, 'javascript-frozen-at-invocation.png');
    await writeFile(html, result.html);await writeFile(png, Buffer.from(result.png));
    assert.ok(Buffer.from(result.png).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.deepEqual(errors, []);assert.deepEqual(externalRequests, []);
    const reopened = await verifyScienceHTML(browser, 'javascript-frozen', html, outputDirectory, {source: 'displayed', sliceIndex: 0});
    console.log('Installed frozen consumer: atomic ingestion, private slice, A/B pins, export across resume and borrowed figure cleanup passed.');
    return {...reopened, invocationPNG: png, frozen: result.frozen, resumed: result.resumed};
  } finally {await context.close();await new Promise(resolve => server.close(resolve));}
}

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/verify-packages.mjs [release-directory]');
  const files = await readdir(archiveDirectory);
  const wheels = files.filter(name => /^vesora-.*\.whl$/i.test(name));
  const tarballs = files.filter(name => /^vesora-core-.*\.tgz$/i.test(name));
  assert.equal(wheels.length, 1, `Expected one Vesora wheel in ${archiveDirectory}; found ${wheels.length}`);
  assert.equal(tarballs.length, 1, `Expected one @vesora/core tarball in ${archiveDirectory}; found ${tarballs.length}`);
  const expectedVersion = release.identity.canonical;
  const wheel = join(archiveDirectory, wheels[0]), tarball = join(archiveDirectory, tarballs[0]);
  workspace = await mkdtemp(join(tmpdir(), 'vesora-packages-'));
  environment.npm_config_cache = process.env.VESORA_NPM_CACHE ?? join(workspace, 'npm-cache');
  assert.ok(!isWithin(checkout, workspace), 'Package verification must run outside the checkout.');
  const pythonDirectory = join(workspace, 'python-consumer'), npmDirectory = join(workspace, 'npm-consumer'), outputDirectory = join(workspace, 'outputs');
  await Promise.all([pythonDirectory, npmDirectory, outputDirectory].map(path => mkdir(path)));
  console.log(`Release archives: ${archiveDirectory}`);
  console.log(`Isolated verification workspace: ${workspace}`);

  const localPython = join(checkout, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const python = process.env.VESORA_PYTHON ?? process.env.PYTHON ?? (existsSync(localPython) ? localPython : 'python');
  const venv = join(pythonDirectory, 'venv');
  run(python, ['-I', '-m', 'venv', venv], pythonDirectory, 'Creating a clean Python environment…');
  const isolatedPython = join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  run(isolatedPython, ['-I', '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check', '--no-deps', '--no-index', wheel], pythonDirectory, 'Installing the wheel without dependencies or network access…');
  const pythonHTML = join(outputDirectory, 'python-figure.html');
  const pythonLinkedHTML = join(outputDirectory, 'python-linked.html');
  const pythonPresentationHTML = join(outputDirectory, 'python-presentation.html');
  const pythonQualityHTML = join(outputDirectory, 'python-quality.html');
  const pythonScienceHTML = join(outputDirectory, 'python-science.html');
  const pythonScript = join(pythonDirectory, 'verify.py');
  await writeFile(pythonScript, `import json
import sys
from pathlib import Path
import vesora as vs

module = Path(vs.__file__).resolve()
checkout = Path(sys.argv[1]).resolve()
assert module.is_relative_to(Path(sys.prefix).resolve()), f"Vesora was not imported from the isolated environment: {module}"
assert not module.is_relative_to(checkout), f"Vesora leaked from the checkout: {module}"
assert vs.__version__ == sys.argv[3], (vs.__version__, sys.argv[3])
legacy = vs.Figure()
legacy.plot([1, 2])
assert legacy.snapshot()['figure']['protocolVersion'] == 1
legacy.close()
fig = vs.subplots(2, 3, title="Installed Python package", width=1100, height=720)
fig.scatter([0, 1, 2, 3], [1, 3, 2, 4], label="Measurements")
fig.panel(1, 0).plot([0, 1, 2, 3], [0, 1, -1, 0], label="Residual")
fig.panel(1, 0).axhline(0, color="#64748b")
fig.panel(0, 0).text(1, 4, "Installed annotation")
assert fig.snapshot()['figure']['protocolVersion'] == 2
hist = fig.panel(0, 1).hist([1, 2, 2, float('nan'), 3], bins=[0, 2, 4], density=True, cumulative=True, label="Distribution")
hist.set_data(samples=[1, 1, 2, float('nan'), 3])
bars = fig.panel(0, 2).set_categories('x', ['B', 'A'])
bars.bar(['A', 'B'], [2, -1], label="Category A")
bars.bar(['B', 'A'], [3, 1], label="Category B")
box = fig.panel(1, 1).boxplot([[4, 1, 2], [1, 2, 3, 40]], labels=['Short', 'Outlier'], label="Groups")
box.set_options(whis=1.5, showfliers=True)
horizontal = fig.panel(1, 2).set_bar_mode('stack')
horizontal.barh(['A', 'B'], [2, -3], label="Stack one")
horizontal.barh(['B', 'A'], [-2, 4], label="Stack two")
fig.text(1, 4, 'Protocol 3 stays promoted')
assert fig.snapshot()['figure']['protocolVersion'] == 3
fig.set_axes(xlabel="Time", ylabel="Value", xlim=(-1, 4), ylim=(0, 5))
fig.bookmark("Overview", note="All four measurements.")
fig.set_axes(xlim=(0.5, 2.5), ylim=(1.5, 3.5))
fig.bookmark("Focus", note="A saved view from the installed wheel.")
fig.restore_bookmark("Overview")
fig.save_html(sys.argv[2])
for dependency in ("PySide6", "aiohttp", "numpy", "anywidget"):
    assert not any(name == dependency or name.startswith(dependency + ".") for name in sys.modules), f"HTML export unexpectedly imported {dependency}"
fig.close()
assert Path(sys.argv[2]).is_file()
linked = vs.subplots(1, 3, title="Installed Python linked observations", width=1200, height=520)
a = linked.panel(0, 0).scatter([0, 1, 2, 3], [.1, .2, 3, .1])
b = linked.panel(0, 1).scatter([.1, .2, .9, .3], [.1, .2, 3, .1])
h = linked.panel(0, 2).hist([.1, .2, 3, .1], bins=[0, 1, 2, 4])
link = linked.link_selection(scatter=[a, b], histogram=h)
assert linked.snapshot()['figure']['protocolVersion'] == 4
linked.save_html(sys.argv[4])
link.remove()
a.set_data(y=[.2, .3, 4, .2])
linked.close()
presentation = vs.figure(theme='dark', title='Installed Python presentation', width=900, height=420)
presentation.plot([0., 86400000.], [1200., 1500.], label='Revenue')
presentation.set_axes(xscale='time')
presentation.set_axis_format('y', {'kind': 'currency', 'currency': 'USD'})
presentation.save_html(sys.argv[5])
presentation.close()
quality = vs.subplots(1, 2, title='Installed Python quality', width=1000, height=500,
                      theme={'titleFontSize': 20, 'labelFontSize': 16, 'tickFontSize': 14, 'legendFontSize': 14})
quality.fill_between([0, 1, 2, 3], [.8, 1.8, float('nan'), 3.8], [1.2, 2.2, float('nan'), 4.2], label='Interval')
quality.plot([0, 1, 2, 3], [1, 2, 3, 4], label='Samples')
quality.panel(0, 1).heatmap([0, 1], [0, 1], [[1, 2], [3, 4]], colorbar_label='Amplitude')
quality.set_hover_mode('x')
assert quality.snapshot()['figure']['protocolVersion'] == 6
quality.save_html(sys.argv[6])
quality.close()
science = vs.subplots(1, 3, kinds=[['3d', '2d', '2d']], title='Installed Python science', width=1100, height=500)
surface = science.panel(0, 0).surface([0., 1.], [0., 1.], [[1., 2.], [3., 4.]], values=[[10., 20.], [30., 40.]], shading='smooth', wireframe=True)
science.panel(0, 0).plot3d([0., 1.], [0., 1.], [1., 4.])
science.panel(0, 0).set_equal_aspect().focus_selection({'x': [0., 1.], 'y': [0., 1.], 'z': [1., 4.]}).fit_to_data()
section = science.panel(0, 1).slice(surface, axis='x', index=0)
assert isinstance(section, vs.SurfaceSlice)
section.set_index(1)
a = science.panel(0, 2).plot([0.], [1.]).enable_streaming(max_points=2)
b = science.panel(0, 2).plot([0.], [2.]).enable_streaming(max_points=2)
science.append_data_batch([(a, {'x': [1., 2.], 'y': [3., 4.]}), (b, {'x': [1., 2.], 'y': [5., 6.]})])
assert science.snapshot()['figure']['protocolVersion'] == 7
science.save_html(sys.argv[7])
science.close()
for dependency in ('PySide6', 'aiohttp', 'numpy', 'anywidget'):
    assert not any(name == dependency or name.startswith(dependency + '.') for name in sys.modules), f'Science HTML unexpectedly imported {dependency}'
print(json.dumps({"version": vs.__version__, "module": str(module), "html": sys.argv[2]}))
`, 'utf8');
  run(isolatedPython, ['-I', pythonScript, checkout, pythonHTML, releaseIdentity(expectedVersion).python, pythonLinkedHTML, pythonPresentationHTML, pythonQualityHTML, pythonScienceHTML], pythonDirectory, 'Verifying isolated Python import and HTML export before show()…');

  await writeFile(join(npmDirectory, 'package.json'), JSON.stringify({ name: 'vesora-release-consumer', version: '1.0.0', private: true, type: 'module' }, null, 2), 'utf8');
  run(process.execPath, [npmCLI(), 'install', '--global=false', '--prefix', npmDirectory, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', tarball], npmDirectory, 'Installing the npm tarball in a clean offline consumer…');
  const javascriptHTML = join(outputDirectory, 'javascript-figure.html');
  const javascriptLinkedHTML = join(outputDirectory, 'javascript-linked.html');
  const javascriptPresentationHTML = join(outputDirectory, 'javascript-presentation.html');
  const javascriptQualityHTML = join(outputDirectory, 'javascript-quality.html');
  const javascriptScienceHTML = join(outputDirectory, 'javascript-science.html');
  const javascriptScript = join(npmDirectory, 'verify.mjs');
  await writeFile(javascriptScript, `import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figure, subplots, toHTML } from '@vesora/core';
import { mountViewer } from '@vesora/core/viewer';
import { createTrajectory, createRollingSurface, createABPins, sampleSurfaceGrid } from '@vesora/core/labs';
for (const fn of [mountViewer, createTrajectory, createRollingSurface, createABPins, sampleSurfaceGrid]) assert.equal(typeof fn, 'function');
const directory = ${JSON.stringify(npmDirectory)};
const modulePath = await realpath(fileURLToPath(import.meta.resolve('@vesora/core')));
const packageDirectory = await realpath(join(directory, 'node_modules/@vesora/core'));
const location = relative(packageDirectory, modulePath);
assert.ok(!location.startsWith('..') && !isAbsolute(location), 'Vesora was not imported from the installed npm package');
const packageJSON = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
assert.equal(packageJSON.version, ${JSON.stringify(expectedVersion)});
const legacy = figure();legacy.plot([0, 1], [1, 2]);assert.equal(legacy.snapshot().figure.protocolVersion, 1);legacy.close();
const fig = subplots({ rows: 2, cols: 3, title: 'Installed JavaScript package', width: 1100, height: 720 });
fig.scatter([0, 1, 2, 3], [1, 3, 2, 4], { label: 'Measurements' });
fig.panel(1, 0).plot([0, 1, 2, 3], [0, 1, -1, 0], { label: 'Residual' });
fig.panel(1, 0).axhline(0, { color: '#64748b' });
fig.panel(0, 0).text(1, 4, 'Installed annotation');
assert.equal(fig.snapshot().figure.protocolVersion, 2);
const histogram = fig.panel(0, 1).hist([1, 2, 2, NaN, 3], {bins: [0, 2, 4], density: true, cumulative: true, label: 'Distribution'});
histogram.setData({samples: [1, 1, 2, NaN, 3]});
const bars = fig.panel(0, 2).setCategories('x', ['B', 'A']);
bars.bar(['A', 'B'], [2, -1], {label: 'Category A'});
bars.bar(['B', 'A'], [3, 1], {label: 'Category B'});
const boxes = fig.panel(1, 1).boxplot([[4, 1, 2], [1, 2, 3, 40]], {labels: ['Short', 'Outlier'], label: 'Groups'});
boxes.setOptions({whis: 1.5, showfliers: true});
const horizontal = fig.panel(1, 2).setBarMode('stack');
horizontal.barh(['A', 'B'], [2, -3], {label: 'Stack one'});
horizontal.barh(['B', 'A'], [-2, 4], {label: 'Stack two'});
fig.text(1, 4, 'Protocol 3 stays promoted');
assert.equal(fig.snapshot().figure.protocolVersion, 3);
fig.setView({ xLabel: 'Time', yLabel: 'Value', xDomain: [-1, 4], yDomain: [0, 5] });
fig.bookmark('Overview', { note: 'All four measurements.' });
fig.setView({ xDomain: [0.5, 2.5], yDomain: [1.5, 3.5] });
fig.bookmark('Focus', { note: 'A saved view from the installed tarball.' });
fig.restoreBookmark('Overview');
await writeFile(${JSON.stringify(javascriptHTML)}, toHTML(fig), 'utf8');
fig.close();
const linked = subplots({rows: 1, cols: 3, title: 'Installed JavaScript linked observations', width: 1200, height: 520});
const a = linked.panel(0, 0).scatter([0, 1, 2, 3], [.1, .2, 3, .1]);
const b = linked.panel(0, 1).scatter([.1, .2, .9, .3], [.1, .2, 3, .1]);
const h = linked.panel(0, 2).hist([.1, .2, 3, .1], {bins: [0, 1, 2, 4]});
const link = linked.linkSelection({scatter: [a, b], histogram: h});
assert.equal(linked.snapshot().figure.protocolVersion, 4);
await writeFile(${JSON.stringify(javascriptLinkedHTML)}, toHTML(linked), 'utf8');
link.remove();a.setData({y: [.2, .3, 4, .2]});linked.close();
const presentation = figure({theme: 'dark', title: 'Installed JavaScript presentation', width: 900, height: 420});
presentation.plot([0, 86400000], [1200, 1500], {label: 'Revenue'});
presentation.setView({xScale: 'time'});
presentation.setAxisFormat('y', {kind: 'currency', currency: 'USD'});
await writeFile(${JSON.stringify(javascriptPresentationHTML)}, toHTML(presentation), 'utf8');
presentation.close();
const quality = subplots({rows: 1, cols: 2, title: 'Installed JavaScript quality', width: 1000, height: 500,
  theme: {titleFontSize: 20, labelFontSize: 16, tickFontSize: 14, legendFontSize: 14}});
quality.fillBetween([0, 1, 2, 3], [.8, 1.8, NaN, 3.8], [1.2, 2.2, NaN, 4.2], {label: 'Interval'});
quality.plot([0, 1, 2, 3], [1, 2, 3, 4], {label: 'Samples'});
quality.panel(0, 1).heatmap([0, 1], [0, 1], [[1, 2], [3, 4]], {colorbarLabel: 'Amplitude'});
quality.setHoverMode('x');
assert.equal(quality.snapshot().figure.protocolVersion, 6);
await writeFile(${JSON.stringify(javascriptQualityHTML)}, toHTML(quality), 'utf8');
quality.close();
const science = subplots({rows: 1, cols: 3, kinds: [['3d', '2d', '2d']], title: 'Installed JavaScript science', width: 1100, height: 500});
const surface = science.panel(0, 0).surface([0, 1], [0, 1], [[1, 2], [3, 4]], {values: [[10, 20], [30, 40]], shading: 'smooth', wireframe: true});
science.panel(0, 0).plot3d([0, 1], [0, 1], [1, 4]);
science.panel(0, 0).setEqualAspect().focusSelection({x: [0, 1], y: [0, 1], z: [1, 4]}).fitToData();
science.panel(0, 1).slice(surface, {axis: 'x', index: 0}).setIndex(1);
const liveA = science.panel(0, 2).plot([0], [1]).enableStreaming({maxPoints: 2});
const liveB = science.panel(0, 2).plot([0], [2]).enableStreaming({maxPoints: 2});
await science.appendDataBatch([{layer: liveA, data: {x: [1, 2], y: [3, 4]}}, {layer: liveB, data: {x: [1, 2], y: [5, 6]}}], {waitFor: 'accepted'});
assert.equal(science.snapshot().figure.protocolVersion, 7);
await writeFile(${JSON.stringify(javascriptScienceHTML)}, toHTML(science), 'utf8');science.close();
const trajectoryFigure = subplots({rows: 1, cols: 1, kinds: [['3d']]});
const trajectory = createTrajectory(trajectoryFigure.panel(0, 0), {maxPoints: 2});
await trajectory.append({x: [0, 1, 2], y: [1, 2, 3], z: [2, 3, 4]}, {waitFor: 'accepted'});
assert.equal(trajectory.getState().retained, 2);assert.equal(trajectory.sequenceAt(0), 1);trajectory.close();trajectoryFigure.close();
const rolling = createRollingSurface({x: [0, 1], y: [0, 1], z: [[1, 2], [3, 4]], maxRows: 2});
await rolling.appendRows({y: [2], z: [[5, 6]]}, {waitFor: 'accepted'});assert.equal(rolling.getState().evictedRows, 1);rolling.close();
assert.equal(sampleSurfaceGrid([0, 1], [0, 1], [[1, 2], [3, 4]], {maxVertices: 4}).info.exact, true);
console.log(JSON.stringify({ version: packageJSON.version, module: modulePath, html: ${JSON.stringify(javascriptHTML)} }));
`, 'utf8');
  run(process.execPath, [javascriptScript], npmDirectory, 'Verifying installed ESM import and HTML export without a DOM…');

  const typeScript = join(npmDirectory, 'verify-types.ts');
  await writeFile(typeScript, `import { figure, subplots, toHTML, downloadHTML, type Figure, type Panel, type Annotation, type ViewSpec, type ViewBookmark, type FillBetweenOptions, type ExportPNGOptions, type XHoverEvent } from '@vesora/core';
import {mountViewer, type ViewerHandle} from '@vesora/core/viewer';
import {createTrajectory, createRollingSurface, createABPins, sampleSurfaceGrid, type PinnedSnapshot} from '@vesora/core/labs';
const chart: Figure = figure({ title: 'Typed consumer' });
chart.scatter(new Float64Array([1, 2]), new Float64Array([3, 4]));
const view: ViewSpec = chart.snapshot().figure.view;
chart.bookmark('Overview', { note: 'Typed bookmark' }).restoreBookmark('Overview');
const bookmark: ViewBookmark = { name: 'Example', view };
const html: string = toHTML(chart);
const download: (figure: Figure, filename?: string) => void = downloadHTML;
chart.restoreView(bookmark.view).removeBookmark('Overview');
void html; void download;
const grid: Figure = subplots({rows: 2, cols: 2, shareX: true});
const panel: Panel = grid.panel(1, 1);
panel.plot([1, 2], [3, 4]).setData({y: [5, 6]});
const annotation: Annotation = panel.text(1, 3, 'Peak', {fontSize: 12});
annotation.update({text: 'Updated', color: '#3366ff'}).remove();
grid.restoreViews(grid.captureViews()).close();
const stats: Figure = subplots({rows: 2, cols: 2});
stats.hist(new Float32Array([1, 2, NaN]), {bins: [0, 2, 4], density: true, cumulative: true}).setData({samples: [2, 3]}).setOptions({bins: 4});
const categories: Panel = stats.panel(0, 1).setCategories('x', ['A', 'B']).setBarMode('group');
categories.bar(['A', 'B'], [2, -1], {barWidth: .8, bottom: 0}).setData({y: [3, -2], bottom: 0});
categories.plot(['A', 'B'], [1, 2]).setData({y: [2, 3]});
stats.panel(1, 0).barh(['A', 'B'], [2, -1], {left: [1, 2]});
stats.panel(1, 1).boxplot([new Float64Array([1, 2]), [2, 3, 40]], {labels: ['A', 'B'], whis: 1.5, showfliers: true, boxWidth: .6}).setData({groups: [[1], [3, 5]], labels: ['B', 'C']}).setOptions({showfliers: false});
stats.setBarMode('overlay');
toHTML(stats);stats.close();
const linked: Figure = subplots({rows: 1, cols: 3});
const a = linked.panel(0, 0).scatter([0, 1], [1, 2]);
const b = linked.panel(0, 1).scatter([2, 3], [1, 2]);
const h = linked.panel(0, 2).hist([1, 2]);
const link = linked.linkSelection({scatter: [a, b], histogram: h});
link.clear();link.remove();linked.close();
const quality: Figure = figure({theme: {titleFontSize: 20, labelFontSize: 16, tickFontSize: 14, legendFontSize: 14}});
const bandStyle: FillBetweenOptions = {color: '#3569c8', opacity: .18};
quality.fillBetween([0, 1], [1, 2], [2, 3], bandStyle).setData({lower: [.5, 1.5]});
quality.plot([0, 1], [1.5, 2.5]);quality.setHoverMode('x');
quality.on('xhover', (event: XHoverEvent | null) => {if (event) console.log(event.cursorX, event.items[0]?.index);});
const exportOptions: ExportPNGOptions = {width: 1000, height: 600, scale: 2};
const savePNG: (options?: ExportPNGOptions) => Promise<Blob> = options => quality.savefig(options);
void savePNG;void exportOptions;quality.close();
const science = subplots({rows: 1, cols: 2, kinds: [['3d', '2d']]});
const surface = science.panel(0, 0).surface([0, 1], [0, 1], [[1, 2], [3, 4]], {values: [[10, 20], [30, 40]], shading: 'smooth', wireframe: true});
science.panel(0, 0).plot3d([0, 1], [0, 1], [1, 4]);
science.panel(0, 0).setEqualAspect().focusSelection({x: [0, 1], y: [0, 1], z: [1, 4]}).fitToData();
science.panel(0, 1).slice(surface, {axis: 'x', index: 0}).setIndex(1);
const viewer: ViewerHandle = mountViewer(science, document.body, {preserveTheme: true, live: true});
science.freezeInspection();science.getInspectionState();science.ready({target: 'displayed'});
toHTML(science, {source: 'displayed'});science.savefig({source: 'displayed'});
const pins = createABPins(science), pin: PinnedSnapshot = pins.pin('A');pin.toHTML();pins.close();
science.resumeLive();viewer.dispose();science.close();
const live = figure().plot([0], [1]).enableStreaming({maxPoints: 2});
live.figure.appendDataBatch([{layer: live, data: {x: [1], y: [2]}}], {waitFor: 'accepted'});
const trajectory = createTrajectory(subplots({rows: 1, cols: 1, kinds: [['3d']]}).panel(0, 0), {maxPoints: 2});
trajectory.append({x: [0], y: [1], z: [2]}, {waitFor: 'accepted'});trajectory.close();
const rolling = createRollingSurface({x: [0, 1], y: [0, 1], z: [[1, 2], [3, 4]], maxRows: 2});
rolling.appendRows({y: [2], z: [[5, 6]]}, {waitFor: 'accepted'});rolling.close();
sampleSurfaceGrid([0, 1], [0, 1], [[1, 2], [3, 4]], {maxVertices: 4});
`, 'utf8');
  run(process.execPath, [join(checkout, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', typeScript], npmDirectory, 'Type-checking installed declarations with NodeNext resolution…');

  // New contracts are selected from this archive's manifest, never the checkout
  // version, so historical protocol-7/monolithic RC packages remain verifiable.
  const features={observation:release.manifest.protocolVersions.includes(8),runtime:Object.hasOwn(release.manifest.runtime,'runtime'),balance:Object.hasOwn(release.manifest.runtime,'balance')};
  const productContracts={features,scope:'Exact installed wheel/tarball; CPU import, owned export and declaration contracts',checks:[]};
  const pythonObservationHTML=join(outputDirectory,'python-observation.html');
  if(features.observation){
    const observationScript=join(pythonDirectory,'verify-observation.py');
    await writeFile(observationScript,String.raw`import json, re, sys, base64, struct
from array import array
import vesora as vs
fig=vs.figure(title='Installed accepted observation')
layer=fig.plot(array('d',[0.,1.]),array('d',[273.,274.]))
declaration={'x':{'unit':'s'},'y':{'quantity':'temperature','unit':'K'}}
layer.set_semantics(declaration)
declaration['y']['unit']='changed caller object'
assert layer.get_semantics()['y']['unit']=='K'
html=fig.to_html(observation=True)
payload=json.loads(re.search(r'<script id="vesora-payload"[^>]*>(.*?)</script>',html,re.S).group(1))
snapshot=payload['snapshot'];record=snapshot['figure']['observation']
assert snapshot['figure']['protocolVersion']==8
assert record['source']=='accepted' and record['representation']=={'status':'not-evaluated'}
assert record['sourceVersions']==[{'id':source['id'],'version':source['version']} for source in snapshot['sources']]
y_id=snapshot['figure']['layers'][0]['data']['y']
encoded=next(value['base64'] for value in payload['buffers'] if value['id']==y_id)
assert struct.unpack('<2d',base64.b64decode(encoded))==(273.,274.)
layer.set_data([9.],[99.]);layer.set_semantics({'y':{'unit':'mm'}})
assert snapshot['figure']['semantics']['sources'][y_id]['unit']=='K'
assert fig.get_observation() is None
with open(sys.argv[1],'w',encoding='utf-8') as file:file.write(html)
fig.close()
print('Installed Python protocol-8 semantics, defensive metadata and accepted HTML bytes passed.')
`,'utf8');
    run(isolatedPython,['-I',observationScript,pythonObservationHTML],pythonDirectory,'Verifying installed Python observation contracts…');
    productContracts.checks.push('python-observation');
  }
  if(features.observation||features.runtime||features.balance){
    const productScript=join(npmDirectory,'verify-product.mjs');
    await writeFile(productScript,`import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import * as core from '@vesora/core';
const features=${JSON.stringify(features)};
const runtime=features.runtime?await import('@vesora/core/runtime'):core;
const payload=html=>JSON.parse(html.match(/<script id="vesora-payload"[^>]*>([\\s\\S]*?)<\\/script>/)[1]);
if(features.runtime){
  for(const name of ['Figure','Layer','Panel','DataRegistry','figure','subplots'])assert.equal(runtime[name],core[name],name+' must keep shared identity');
  assert.equal(typeof runtime.downloadHTMLAsync,'function');
}
if(features.observation){
  const fig=runtime.figure({title:'Captured before lazy import'}),line=fig.plot(new Float64Array([0,1]),new Float64Array([273,274]));
  line.setSemantics({x:{unit:'s'},y:{quantity:'temperature',unit:'K'}});
  const options={source:'accepted',observation:true};
  const pending=features.runtime?runtime.toHTMLAsync(fig,options):Promise.resolve(core.toHTML(fig,options));
  line.setData({x:[9],y:[99]});line.setSemantics({y:{unit:'mm'}});fig.spec.title='After capture';options.observation=false;
  const html=await pending,value=payload(html),snapshot=value.snapshot,record=snapshot.figure.observation;
  assert.equal(snapshot.figure.title,'Captured before lazy import');assert.equal(snapshot.figure.protocolVersion,8);
  assert.equal(record.source,'accepted');assert.deepEqual(record.representation,{status:'not-evaluated'});
  assert.deepEqual(record.sourceVersions,snapshot.sources.map(({id,version})=>({id,version})));
  const yId=snapshot.figure.layers[0].data.y,bytes=Buffer.from(value.buffers.find(item=>item.id===yId).base64,'base64');
  assert.deepEqual([bytes.readDoubleLE(0),bytes.readDoubleLE(8)],[273,274]);
  assert.equal(snapshot.figure.semantics.sources[yId].unit,'K');assert.equal(fig.diagnostics().snapshotBytes,0);
  await writeFile(${JSON.stringify(join(outputDirectory,'javascript-observation.html'))},html,'utf8');fig.close();
  const fromPython=payload(await readFile(${JSON.stringify(pythonObservationHTML)},'utf8')),copy=runtime.figure();
  const buffers=new Map(fromPython.buffers.map(({id,base64})=>{const bytes=Buffer.from(base64,'base64');return [id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)];}));
  copy.applySnapshot(fromPython.snapshot,buffers);
  assert.deepEqual(copy.getObservation(),fromPython.snapshot.figure.observation);
  const observation=copy.getObservation();observation.sourceVersions.length=0;
  assert.ok(copy.getObservation().sourceVersions.length>0);copy.close();
}
if(features.balance){
  const {createBalance,stepBalance,transferBalance,inspectBalance}=await import('@vesora/core/balance');
  const state=createBalance([{id:'a',label:'A',volume:70},{id:'b',label:'B',volume:20},{id:'c',label:'C',volume:10}]);
  const passive=stepBalance(state,{from:'a',to:'b'},.5),manual=transferBalance(passive.state,'b','c',5);
  for(const value of [passive.state,manual.state]){assert.equal(value.total,100);assert.ok(Math.abs(value.categories.reduce((sum,row)=>sum+row.volume,0)-100)<1e-10);assert.ok(value.categories.every(row=>row.volume>=0));}
  assert.ok(passive.transferred>0);assert.ok(passive.state.energy<=state.energy+1e-12);
  assert.equal(inspectBalance(state).length,3);assert.equal(state.categories[0].volume,70);
}
console.log('Installed product contracts passed: '+Object.entries(features).filter(([,enabled])=>enabled).map(([name])=>name).join(', '));
`,'utf8');
    run(process.execPath,[productScript],npmDirectory,'Verifying new installed runtime contracts…');
    productContracts.checks.push(...Object.entries(features).filter(([,enabled])=>enabled).map(([name])=>`javascript-${name}`));
    const productTypes=join(npmDirectory,'verify-product-types.ts');
    await writeFile(productTypes,[features.runtime?`import {figure,toHTMLAsync,downloadHTMLAsync,type Figure} from '@vesora/core/runtime';
const fig:Figure=figure();const html:Promise<string>=toHTMLAsync(fig,{observation:true});const download:Promise<void>=downloadHTMLAsync(fig,'capture.html',{source:'accepted'});void html;void download;`:'',features.observation?`import {figure as observedFigure,type ObservationRecord,type SourceSemantics} from '@vesora/core';
const observed=observedFigure();const semantics:SourceSemantics={unit:'K'};observed.plot([0],[273]).setSemantics({y:semantics});const record:ObservationRecord|undefined=observed.getObservation();void record;`:'',features.balance?`import {createBalance,stepBalance,transferBalance,inspectBalance,type BalanceState,type BalanceTransition,type BalanceReading} from '@vesora/core/balance';
const state:BalanceState=createBalance([{id:'a',label:'A',volume:1},{id:'b',label:'B',volume:2},{id:'c',label:'C',volume:3}]);const transition:BalanceTransition=stepBalance(state,{from:'a',to:'b'},1);const readings:BalanceReading[]=inspectBalance(transition.state);transferBalance(state,'b','c',1);void readings;`:''].join('\n'),'utf8');
    run(process.execPath,[join(checkout,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','--lib','ES2022,DOM',productTypes],npmDirectory,'Type-checking new installed runtime declarations with NodeNext…');
    productContracts.checks.push('new-entry-NodeNext-types');
  }

  const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.VESORA_CHROME ?? (existsSync(installedChrome) ? installedChrome : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let outputs;
  try {
    outputs = {
      python: await verifyHTML(browser, 'python', pythonHTML, outputDirectory),
      javascript: await verifyHTML(browser, 'javascript', javascriptHTML, outputDirectory),
      pythonLinked: await verifyLinkedHTML(browser, 'python', pythonLinkedHTML, outputDirectory),
      javascriptLinked: await verifyLinkedHTML(browser, 'javascript', javascriptLinkedHTML, outputDirectory),
      pythonPresentation: await verifyPresentationHTML(browser, 'python', pythonPresentationHTML, outputDirectory),
      javascriptPresentation: await verifyPresentationHTML(browser, 'javascript', javascriptPresentationHTML, outputDirectory),
      pythonQuality: await verifyQualityHTML(browser, 'python', pythonQualityHTML, outputDirectory),
      javascriptQuality: await verifyQualityHTML(browser, 'javascript', javascriptQualityHTML, outputDirectory),
      pythonScience: await verifyScienceHTML(browser, 'python', pythonScienceHTML, outputDirectory),
      javascriptScience: await verifyScienceHTML(browser, 'javascript', javascriptScienceHTML, outputDirectory),
      javascriptFrozenScience: await verifyFrozenConsumer(browser, npmDirectory, outputDirectory),
    };
  } finally {
    await browser.close();
  }
  const archiveHashes = Object.fromEntries(await Promise.all([wheel, tarball].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
  const result = { version: expectedVersion, commit:release.manifest.commit, manifestSha256:release.manifestSha256, wheel, tarball, archiveHashes, recordedAt: new Date().toISOString(), workspace, productContracts, outputs };
  await writeFile(join(workspace, 'verification.json'), JSON.stringify(result, null, 2), 'utf8');
  await mkdir(join(checkout, 'artifacts', 'consumers'), { recursive: true });
  await writeFile(join(checkout, 'artifacts', 'consumers', 'packages.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('Release package verification passed.');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (workspace) console.log(`Verification files retained at: ${workspace}`);
});
