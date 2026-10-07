// Build downloadable release assets after npm run build and the release checks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figure, toHTML } from '../packages/core/dist/index.js';
import { examples } from '../examples/web/scenarios.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(resolve(root, 'packages/core/package.json'), 'utf8'));
const version = pkg.version;
const output = resolve(root, 'dist', `release-v${version}`);
const localPython = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
const python = process.env.VESORA_PYTHON ?? process.env.PYTHON ?? (existsSync(localPython) ? localPython : 'python');
const env = { ...process.env, PYTHONPATH: resolve(root, 'python') };
const pythonVersion = execFileSync(python, ['-c', 'import vesora; print(vesora.__version__)'], { cwd: root, env, encoding: 'utf8', windowsHide: true }).trim();
assert.equal(pythonVersion, version, 'Python and JavaScript versions must match');
await mkdir(output, { recursive: true });
execFileSync(python, ['-m', 'pip', 'wheel', '--no-deps', '--no-build-isolation', '.', '--wheel-dir', output], { cwd: root, env, stdio: 'inherit', windowsHide: true });
// npm_execpath is supplied by npm run; invoking its JS entry avoids Windows shell quoting.
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script with npm run package:release.');
execFileSync(process.execPath, [npm, 'pack', './packages/core', '--pack-destination', output], { cwd: root, stdio: 'inherit', windowsHide: true });

const demo = examples.find(example => example.id === 'density');
assert.ok(demo, 'The discovery demo must be present in the gallery');
const fig = figure({ title: demo.title, width: 1000, height: 520 });
try {
  demo.create(fig);
  fig.restoreBookmark('Overview');
  await writeFile(resolve(output, 'vesora-discovery-demo.html'), toHTML(fig), 'utf8');
} finally {
  fig.close();
}
const files = [`vesora-${version}-py3-none-any.whl`, `vesora-core-${version}.tgz`, 'vesora-discovery-demo.html'];
const sums = [];
for (const name of files) {
  const bytes = await readFile(resolve(output, name));
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await writeFile(resolve(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
console.log(`Release assets and SHA256SUMS.txt written to ${output}`);
