import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, symlink, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';
import {loadRelease, validateRuntimeHashes, sha256} from './release-validation.mjs';

const root = resolve('.'), directory = resolve(process.argv[2]);
const output = process.env.VESORA_V1_OUTPUT ?? resolve('artifacts/v1-verification/manual');
await mkdir(output, {recursive: true});
const release = await loadRelease(directory);
assert.equal(release.identity.canonical, '1.0.0');
const installed = resolve(output, 'installed-js');
for (const [name, archive] of [['core', `vesora-core-${release.identity.npm}.tgz`], ['react', `vesora-react-${release.identity.npm}.tgz`]]) {
  const target = resolve(installed, 'node_modules/@vesora', name); await mkdir(target, {recursive: true});
  execFileSync('tar', ['-xzf', resolve(directory, archive), '--strip-components=1', '-C', target], {windowsHide: true, timeout: 30000});
  const pkg = JSON.parse(await readFile(resolve(target, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.0');
}
for (const name of validateRuntimeHashes(release.manifest.runtime)) {
  assert.equal(sha256(await readFile(resolve(installed, 'node_modules/@vesora/core/dist', `${name}.js`))), release.manifest.runtime[name]);
}
for (const name of ['react', 'react-dom', 'scheduler']) {
  const target = resolve(installed, 'node_modules', name);
  if (!existsSync(target) && existsSync(resolve(root, 'node_modules', name))) await symlink(resolve(root, 'node_modules', name), target, process.platform === 'win32' ? 'junction' : 'dir');
}
const source = await readFile(resolve(root, 'skills/vesora/scripts/example_js.mjs'), 'utf8');
const consumer = resolve(installed, 'consumer.mjs');
await writeFile(resolve(installed, 'gallery.mjs'), await readFile(resolve(root, 'skills/vesora/scripts/gallery.mjs'), 'utf8'));
await writeFile(consumer, source + '\nconst adapter=await import("@vesora/react"); if(typeof adapter.VesoraChart!=="function"&&adapter.VesoraChart?.$$typeof!==Symbol.for("react.forward_ref"))throw new Error("Installed React adapter missing");\n');
execFileSync(process.execPath, [consumer, resolve(output, 'installed-js.html')], {cwd: installed, env: process.env, windowsHide: true, stdio: 'inherit', timeout: 45000});

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath: process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const results = [];
try {
  const demos = release.manifest.files.filter(file => file.name.endsWith('.html')).map(file => resolve(directory, file.name));
  demos.push(resolve(output, 'installed-js.html'), resolve(output, 'skill-python.html'));
  for (const html of demos) {
    const context = await browser.newContext({offline: true, viewport: {width: 1660, height: 1100}, acceptDownloads: true});
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {if (/^https?:/i.test(request.url())) requests.push(request.url());});
    try {
      await page.goto(pathToFileURL(html).href);
      await page.waitForSelector('#vesora-viewer[data-ready="ready"]', {timeout: 30_000});
      const payload = JSON.parse(await page.locator('#vesora-payload').textContent());
      const advanced = html.includes('advanced-demo') || html.includes('installed-js.html') || html.includes('skill-python.html');
      if (advanced) {
        assert.equal(payload.snapshot.figure.protocolVersion, 9);
        assert.ok(payload.snapshot.figure.layers.length >= 10);
        const shared = page.locator('[data-vesora-viewer]');
        const pending = page.waitForEvent('download', {timeout: 20000});
        await shared.getByRole('button', {name: /^(Download|Export) PNG$/}).click();
        const download = await pending, name = `archive-${results.length}.png`;
        await download.saveAs(resolve(output, name));
        const bytes = await readFile(resolve(output, name));
        assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
        assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
        await page.screenshot({path: resolve(output, `archive-${results.length}.png`), fullPage: true});
      }
      assert.deepEqual(errors, [], `Offline render error in ${html}`);
      assert.deepEqual(requests, [], `Offline document requested external network: ${html}`);
      results.push({html, protocolVersion: payload.snapshot.figure.protocolVersion, advanced});
      console.log(`Verified offline: ${html}`);
    } finally {await context.close();}
  }
} finally {await browser.close();}
await writeFile(resolve(output, 'archives.json'), JSON.stringify({version: release.identity.canonical, manifestSha256: release.manifestSha256, results}, null, 2) + '\n');
