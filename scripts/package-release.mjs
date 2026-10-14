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
import { linkedExamples } from '../examples/web/linked-scenarios.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(resolve(root, 'packages/core/package.json'), 'utf8'));
const version = pkg.version;
const reactPackage = JSON.parse(await readFile(resolve(root, 'packages/react/package.json'), 'utf8'));
assert.equal(reactPackage.version, version, 'Core and React release versions must match');
assert.equal(pkg.license, 'MIT');
assert.equal(reactPackage.license, 'MIT');
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
execFileSync(process.execPath, [npm, 'pack', './packages/core', '--pack-destination', output, '--cache', process.env.VESORA_NPM_CACHE ?? resolve(root, 'artifacts', 'npm-cache')], { cwd: root, stdio: 'inherit', windowsHide: true });
execFileSync(process.execPath, [npm, 'pack', './packages/react', '--pack-destination', output, '--cache', process.env.VESORA_NPM_CACHE ?? resolve(root, 'artifacts', 'npm-cache')], { cwd: root, stdio: 'inherit', windowsHide: true });

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
const linked = linkedExamples[0];
const linkedFigure = subplots({...linked.layout, title: linked.title, width: 1200, height: 520});
try {
  linked.create(linkedFigure);
  await writeFile(resolve(output, 'vesora-linked-demo.html'), toHTML(linkedFigure), 'utf8');
} finally { linkedFigure.close(); }
const saasFigure = figure({ title: 'SaaS revenue', width: 1000, height: 460, theme: 'dark' });
try {
  const start = Date.UTC(2026, 9, 1);
  saasFigure.plot(Array.from({length: 12}, (_, i) => start + i * 86400000), Array.from({length: 12}, (_, i) => 4200 + i * 310 + Math.sin(i) * 250), {label: 'Revenue'});
  saasFigure.setView({xScale: 'time'});
  saasFigure.setAxisFormat('x', {kind: 'date', locale: 'en-US', timeZone: 'UTC'});
  saasFigure.setAxisFormat('y', {kind: 'currency', currency: 'USD', locale: 'en-US'});
  saasFigure.bookmark('Overview');
  await writeFile(resolve(output, 'vesora-saas-demo.html'), toHTML(saasFigure), 'utf8');
} finally { saasFigure.close(); }
const qualityFigure = subplots({rows: 1, cols: 2, title: 'Readable scientific figures', width: 1100, height: 520,
  theme: {titleFontSize: 20, labelFontSize: 16, tickFontSize: 14, legendFontSize: 14}});
try {
  const steps = Array.from({length: 101}, (_, i) => i * 100);
  const loss = steps.map(x => .2 + 3 * Math.exp(-x / 2500));
  const curves = qualityFigure.panel(0, 0).setTitle('Synthetic illustrative interval');
  curves.fillBetween(steps, loss.map(y => y * .85), loss.map(y => y * 1.15), {color: '#3569c8', opacity: .18});
  curves.plot(steps, loss, {color: '#3569c8', label: 'Model A'});
  curves.plot(steps, loss.map(y => y * 1.2), {color: '#d36a55', label: 'Model B'});
  curves.setView({xLabel: 'Training step', yLabel: 'Loss', yScale: 'log'});
  qualityFigure.panel(0, 1).setTitle('Scalar units').heatmap([0, 1, 2], [0, 1, 2], [[1, 2, 3], [2, 4, 6], [3, 6, 9]], {colorbarLabel: 'Amplitude'});
  qualityFigure.setHoverMode('x').bookmark('Overview');
  await writeFile(resolve(output, 'vesora-quality-demo.html'), toHTML(qualityFigure), 'utf8');
} finally { qualityFigure.close(); }
const streamingFigure=figure({title:'Retained synthetic telemetry snapshot',width:1100,height:520});
try{
  const layers=['#3569c8','#137f8b','#d36a55'].map((color,i)=>streamingFigure.plot([],[],{color,label:`Model ${String.fromCharCode(65+i)}`}).enableStreaming({maxPoints:500}));
  streamingFigure.setView({xLabel:'Training step',yLabel:'Synthetic loss'});streamingFigure.setHoverMode('x');
  for(let start=0;start<2000;start+=100){const x=Array.from({length:100},(_,i)=>start+i);await streamingFigure.appendDataBatch(layers.map((layer,j)=>({layer,data:{x,y:x.map(t=>(j+1)*.15+3*Math.exp(-t/2000)+.08*Math.sin(t*.07+j))}})));}
  await writeFile(resolve(output,'vesora-streaming-demo.html'),toHTML(streamingFigure),'utf8');
}finally{streamingFigure.close();}
const files = [`vesora-${version}-py3-none-any.whl`, `vesora-core-${version}.tgz`, `vesora-react-${version}.tgz`, 'vesora-discovery-demo.html', 'vesora-comparison-demo.html', 'vesora-statistics-demo.html', 'vesora-linked-demo.html', 'vesora-saas-demo.html', 'vesora-quality-demo.html','vesora-streaming-demo.html'];
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const dirty=!!execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
const manifest={version,commit,workingTreeDirty:dirty,createdAt:new Date().toISOString(),node:process.version,python:execFileSync(python,['--version'],{encoding:'utf8',windowsHide:true}).trim(),protocolVersions:[1,2,3,4,5,6],runtime:{index:await hash(resolve(root,'packages/core/dist/index.js')),worker:await hash(resolve(root,'packages/core/dist/worker.js'))},files:await Promise.all(files.map(async name=>({name,sha256:await hash(resolve(output,name))})))};
await writeFile(resolve(output,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n','utf8');files.push('release-manifest.json');
const sums = [];
for (const name of files) {
  const bytes = await readFile(resolve(output, name));
  sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
}
await writeFile(resolve(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
console.log(`Release assets and SHA256SUMS.txt written to ${output}`);
