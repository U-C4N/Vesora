import {releaseIdentity} from './release-identity.mjs';
// Verify the exact files that will be distributed, including offline demo exports.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {chromium} from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const {version} = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const directory = resolve(process.argv[2] ?? join(root, 'dist', `release-v${version}`));
const evidence = resolve(root, 'artifacts', 'release');
const demos = ['discovery', 'comparison', 'statistics', 'linked', 'saas', 'quality', 'streaming','prism-surface','prism-telemetry','prism-labs'].map(name => `vesora-${name}-demo.html`);
const expected = [`vesora-${releaseIdentity(version).python}-py3-none-any.whl`, `vesora-core-${version}.tgz`, `vesora-react-${version}.tgz`, ...demos, 'release-manifest.json'];
const actual = await readdir(directory);
const operational=new Set(['release-gates.json','publication-state.json','downloaded','evidence']);
assert.deepEqual(actual.filter(name=>!operational.has(name)).sort(), [...expected, 'SHA256SUMS.txt'].sort(), 'Release directory must contain exactly the expected distributables and recognized verification state.');
const checksums = new Map();
for (const line of (await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/)) {
  const match = /^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
  assert.ok(match, `Malformed checksum entry: ${line}`);
  assert.ok(!checksums.has(match[2]), `Duplicate checksum entry: ${match[2]}`);
  checksums.set(match[2], match[1]);
}
assert.deepEqual([...checksums.keys()].sort(), expected.sort(), 'Checksum manifest must cover every distributable exactly once.');
const hashes = {};
for (const name of expected) {
  const bytes = await readFile(join(directory, name));
  assert.ok(bytes.length, `${name} is empty.`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, checksums.get(name), `${name}: SHA-256 mismatch`);
  hashes[name] = hash;
}
const manifest = JSON.parse(await readFile(join(directory, 'release-manifest.json'), 'utf8'));
assert.equal(manifest.version, version, 'Release manifest version must match the packages.');
assert.deepEqual(manifest.files.map(file => file.name).sort(), expected.filter(name => name !== 'release-manifest.json').sort(), 'Release provenance must list every package and demo.');
for (const file of manifest.files) assert.equal(file.sha256, hashes[file.name], `${file.name}: provenance hash does not match the distributed bytes`);
assert.deepEqual(manifest.protocolVersions, [1, 2, 3, 4, 5, 6, 7], 'Release must retain scene protocols 1–6.');
for(const name of ['index','worker','viewer','labs']){
  assert.match(manifest.runtime[name],/^[a-f0-9]{64}$/);
  const bytes=execFileSync('tar',['-xOf',join(directory,`vesora-core-${version}.tgz`),`package/dist/${name}.js`],{windowsHide:true,maxBuffer:32*1024*1024});
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.runtime[name],`${name}: runtime provenance must match the distributed core archive`);
}
await mkdir(evidence, {recursive: true});
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath: process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const results = [];
try {
  for (const name of demos) {
    const context = await browser.newContext({offline: true, viewport: {width: 1280, height: 900}, acceptDownloads: true});
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
    page.on('request', request => {if (/^https?:/i.test(request.url())) requests.push(request.url());});
    try {
      await page.goto(pathToFileURL(join(directory, name)).href);
      await page.waitForSelector('#vesora-viewer[data-ready="ready"]', {timeout: 60_000});
      assert.equal(await page.locator('#vesora-error').isVisible(), false, `${name}: visible viewer error`);
      const payload=JSON.parse(await page.locator('#vesora-payload').textContent()),shared=page.locator('[data-vesora-viewer]');
      if(name.startsWith('vesora-prism-')){
        assert.equal(payload.snapshot.figure.protocolVersion,7,`${name}: PRISM capture needs protocol7`);assert.equal(await shared.count(),1,`${name}: shared viewer missing`);
        assert.equal(await shared.getByRole('button',{name:'Freeze view',exact:true}).isVisible(),false,`${name}: offline scenes must not present a live producer`);
        const layers=payload.snapshot.figure.layers,sources=payload.snapshot.sources;
        if(name==='vesora-prism-surface-demo.html'){
          assert.equal(payload.snapshot.figure.slices.length,2);assert.equal(layers.filter(layer=>layer.kind==='surface').length,1);
          await shared.locator('summary').filter({hasText:/^Inspector$/}).click();
          const sliders=shared.getByRole('slider');assert.equal(await sliders.count(),2);await sliders.first().fill('5');await shared.getByRole('button',{name:'XY',exact:true}).click();
        }else if(name==='vesora-prism-telemetry-demo.html'){
          assert.deepEqual(layers.map(layer=>layer.kind),['line','line','line']);for(const layer of layers)assert.equal(sources.find(source=>source.id===layer.data.x).shape[0],600);
        }else{
          assert.deepEqual(layers.map(layer=>layer.kind),['surface','heatmap','line3d']);assert.deepEqual(sources.find(source=>source.id===layers[0].data.z).shape,[16,48]);assert.equal(sources.find(source=>source.id===layers[2].data.x).shape[0],400);
          await shared.locator('summary').filter({hasText:/^Inspector$/}).click();
          await shared.getByRole('combobox',{name:'3D panel'}).selectOption('panel-0-2');await shared.getByRole('button',{name:'XZ',exact:true}).click();
        }
      }
      const pending = page.waitForEvent('download');
      const pngButton=await shared.count()?shared.getByRole('button',{name:/^(Download|Export) PNG$/}):page.getByRole('button', {name: 'Download PNG', exact: true});
      assert.equal(await pngButton.count(),1,`${name}: PNG action must be unambiguous`);await pngButton.click();
      const download = await pending, pngPath = join(evidence, name.replace(/\.html$/, '.png'));
      await download.saveAs(pngPath);
      assert.equal(await download.failure(), null, `${name}: PNG export failed`);
      const png = await readFile(pngPath);
      assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${name}: invalid PNG`);
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      assert.ok(width >= 200 && height >= 180, `${name}: invalid PNG dimensions`);
      assert.deepEqual(requests, [], `${name}: unexpected external HTTP requests`);
      assert.deepEqual(errors, [], `${name}: browser errors`);
      if(name.startsWith('vesora-prism-'))await page.screenshot({path:join(evidence,name.replace(/\.html$/,'-viewer.png')),fullPage:true});
      results.push({name, ready: true, offline: true,sharedViewer:await shared.count()===1,protocol:payload.snapshot.figure.protocolVersion,png: {width, height, bytes: png.length}});
      console.log(`${name}: verified checksum, offline render and ${width}×${height} PNG.`);
    } finally {await context.close();}
  }
  await writeFile(join(evidence, 'verification.json'), JSON.stringify({version, recordedAt: new Date().toISOString(), browser: browser.version(), directory, hashes, demos: results}, null, 2));
} finally {await browser.close();}
