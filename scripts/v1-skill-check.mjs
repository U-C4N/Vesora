import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {makeFigure, writeExample} from '../skills/vesora/scripts/example_js.mjs';

const output = process.env.VESORA_V1_OUTPUT ?? resolve('artifacts/skill-examples');
const fig = makeFigure();
try {
  const snapshot = fig.snapshot();
  assert.equal(snapshot.figure.protocolVersion, 9);
  assert.equal(snapshot.figure.layout.rows, 5);
  assert.deepEqual(new Set(snapshot.figure.layers.map(layer => layer.kind)), new Set(['ecdf', 'spectrogram', 'eventTimeline', 'errorbar', 'contour', 'quiver', 'parallelCoordinates', 'paretoFront', 'phasePortrait', 'ternary']), 'All ten analysis families must construct real layers');
} finally {fig.close();}
await writeExample(resolve(output, 'skill-js.html'));
const python = process.env.VESORA_PYTHON ?? (existsSync('.venv/Scripts/python.exe') ? resolve('.venv/Scripts/python.exe') : 'python');
execFileSync(python, ['skills/vesora/scripts/example_python.py', resolve(output, 'skill-python.html')], {env: {...process.env, PYTHONPATH: resolve('python')}, stdio: 'inherit', windowsHide: true, timeout: 45_000});
const result = await build({entryPoints: ['skills/vesora/scripts/example_react.tsx'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'warning'});
assert.ok(result.outputFiles[0].contents.length > 0, 'The React guide must compile against real exports');
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', 'skills/vesora/scripts/example_react.tsx', '--noEmit', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', '--jsx', 'react-jsx', '--strict', '--skipLibCheck'], {stdio: 'inherit', windowsHide: true, timeout: 45000});
console.log('Python, JavaScript and React skill examples construct/compile against actual Vesora APIs.');
