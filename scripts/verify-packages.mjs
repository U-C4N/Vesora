// Validate release archives as installed consumers, outside the checkout.
// Usage: node scripts/verify-packages.mjs [release-directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const packageVersion = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')).version;
const archiveDirectory = resolve(process.argv[2] ?? join(checkout, 'dist', `release-v${packageVersion}`));
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

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/verify-packages.mjs [release-directory]');
  const files = await readdir(archiveDirectory);
  const wheels = files.filter(name => /^vesora-.*\.whl$/i.test(name));
  const tarballs = files.filter(name => /^vesora-core-.*\.tgz$/i.test(name));
  assert.equal(wheels.length, 1, `Expected one Vesora wheel in ${archiveDirectory}; found ${wheels.length}`);
  assert.equal(tarballs.length, 1, `Expected one @vesora/core tarball in ${archiveDirectory}; found ${tarballs.length}`);
  const expectedVersion = JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')).version;
  const wheel = join(archiveDirectory, wheels[0]), tarball = join(archiveDirectory, tarballs[0]);
  workspace = await mkdtemp(join(tmpdir(), 'vesora-packages-'));
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
print(json.dumps({"version": vs.__version__, "module": str(module), "html": sys.argv[2]}))
`, 'utf8');
  run(isolatedPython, ['-I', pythonScript, checkout, pythonHTML, expectedVersion], pythonDirectory, 'Verifying isolated Python import and HTML export before show()…');

  await writeFile(join(npmDirectory, 'package.json'), JSON.stringify({ name: 'vesora-release-consumer', version: '1.0.0', private: true, type: 'module' }, null, 2), 'utf8');
  run(process.execPath, [npmCLI(), 'install', '--global=false', '--prefix', npmDirectory, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', tarball], npmDirectory, 'Installing the npm tarball in a clean offline consumer…');
  const javascriptHTML = join(outputDirectory, 'javascript-figure.html');
  const javascriptScript = join(npmDirectory, 'verify.mjs');
  await writeFile(javascriptScript, `import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figure, subplots, toHTML } from '@vesora/core';
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
console.log(JSON.stringify({ version: packageJSON.version, module: modulePath, html: ${JSON.stringify(javascriptHTML)} }));
`, 'utf8');
  run(process.execPath, [javascriptScript], npmDirectory, 'Verifying installed ESM import and HTML export without a DOM…');

  const typeScript = join(npmDirectory, 'verify-types.ts');
  await writeFile(typeScript, `import { figure, subplots, toHTML, downloadHTML, type Figure, type Panel, type Annotation, type ViewSpec, type ViewBookmark } from '@vesora/core';
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
`, 'utf8');
  run(process.execPath, [join(checkout, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', typeScript], npmDirectory, 'Type-checking installed declarations with NodeNext resolution…');

  const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const executablePath = process.env.VESORA_CHROME ?? (existsSync(installedChrome) ? installedChrome : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let outputs;
  try {
    outputs = {
      python: await verifyHTML(browser, 'python', pythonHTML, outputDirectory),
      javascript: await verifyHTML(browser, 'javascript', javascriptHTML, outputDirectory),
    };
  } finally {
    await browser.close();
  }
  const result = { version: expectedVersion, wheel, tarball, workspace, outputs };
  await writeFile(join(workspace, 'verification.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log('Release package verification passed.');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (workspace) console.log(`Verification files retained at: ${workspace}`);
});
