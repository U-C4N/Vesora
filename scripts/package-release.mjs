// Build downloadable release assets after npm run build and the release checks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { figure, subplots, toHTML } from '../packages/core/dist/index.js';
import { examples } from '../examples/web/scenarios.js';
import { comparisonExamples } from '../examples/web/comparison-scenarios.js';

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
const comparison = comparisonExamples.find(example => example.id === 'signal-comparison');
const comparisonFigure = subplots({ ...comparison.layout, title: comparison.title, width: 1000, height: 800 });
try {
  comparison.create(comparisonFigure);
  await writeFile(resolve(output, 'vesora-comparison-demo.html'), toHTML(comparisonFigure), 'utf8');
} finally { comparisonFigure.close(); }
const statisticsFigure = subplots({ rows: 2, cols: 2, title: 'Statistics and categories', width: 1100, height: 800 });
try {
  const distribution=statisticsFigure.panel(0,0), bars=statisticsFigure.panel(0,1), boxes=statisticsFigure.panel(1,0), categories=statisticsFigure.panel(1,1);
  distribution.setTitle('Distribution');distribution.hist(Array.from({length:4000},(_,i)=>Math.sin(i*1.618)+.4*Math.cos(i*2.399)),{bins:24,color:'#3569c8'});
  bars.setTitle('Grouped comparison');bars.bar(['A','B','C'],[7,8,6],{label:'Series 1',color:'#137f8b'});bars.bar(['A','C'],[8,9],{label:'Series 2',color:'#d36a55'});
  boxes.setTitle('Spread and outliers');boxes.boxplot([[1,2,3,4,5,14],[2,3,3,4,5,6],[]],{labels:['A','B','Empty'],color:'#137f8b'});
  categories.setTitle('Categorical series');categories.plot(['Small','Medium','Large'],[4,7,6],{color:'#3569c8'});categories.scatter(['Large','Small','Medium'],[8,3,5],{color:'#d36a55',size:9});
  statisticsFigure.bookmark('Overview');distribution.setView({xDomain:[-.5,.5]});statisticsFigure.bookmark('Detail',{note:'Bins and quartiles remain unchanged when zooming.'});statisticsFigure.restoreBookmark('Overview');
  await writeFile(resolve(output,'vesora-statistics-demo.html'),toHTML(statisticsFigure),'utf8');
} finally { statisticsFigure.close(); }
const files = [`vesora-${version}-py3-none-any.whl`, `vesora-core-${version}.tgz`, 'vesora-discovery-demo.html', 'vesora-comparison-demo.html', 'vesora-statistics-demo.html'];
const sums = [];
for (const name of files) {
  const bytes = await readFile(resolve(output, name));
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await writeFile(resolve(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
console.log(`Release assets and SHA256SUMS.txt written to ${output}`);
