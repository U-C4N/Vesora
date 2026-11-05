// Bounded automatic checks for the new version. Does not modify publication gates.
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {killTree, parseBudget, runProcess} from './v1-runner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const budgetMs = parseBudget(process.argv.slice(2)), start = performance.now(), deadline = start + budgetMs;
const version = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')).version;
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = resolve(root, 'artifacts', 'v1-verification', runId);
await mkdir(output, {recursive: true});
const npmCLI = [process.env.npm_execpath, resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(path => path && existsSync(path));
if (!npmCLI) throw new Error('Cannot locate npm CLI; run this verifier with npm run verify:next');
const python = process.env.VESORA_PYTHON ?? (existsSync(resolve(root, '.venv/Scripts/python.exe')) ? resolve(root, '.venv/Scripts/python.exe') : existsSync(resolve(root, '.venv/bin/python')) ? resolve(root, '.venv/bin/python') : 'python');
const env = {...process.env, PYTHONPATH: resolve(root, 'python'), VESORA_PYTHON: python, VESORA_TEST_QT: '0', VESORA_TEST_JUPYTER: '0', VESORA_V1_OUTPUT: output, PYTHONUTF8: '1', NEXT_TELEMETRY_DISABLED: '1'};
const active = new Set(), stages = [];
const report = {kind: 'bounded-automatic-verification', version, budgetMs, startedAt: new Date().toISOString(), status: 'running', stages, excludes: ['dependency installation', 'registry publication', 'long-duration endurance claims', 'human pilot and screen-reader claims']};
const reportPath = resolve(output, 'report.json');
let saving = Promise.resolve();
const save = () => {
  const bytes = JSON.stringify({...report, elapsedMs: Math.round(performance.now() - start)}, null, 2) + '\n';
  saving = saving.then(() => writeFile(reportPath, bytes));
  return saving;
};
async function stage(name, command, args, overrides = {}) {
  const row = {name, status: 'running', startedAt: new Date().toISOString()}; stages.push(row);
  const began = performance.now(); console.log(`[verify:next] ${name}`); await save();
  try {
    await runProcess(command, args, {cwd: root, env, deadline, logPath: resolve(output, `${name}.log`), active, ...overrides});
    row.status = 'passed';
  } catch (error) {row.status = 'failed'; row.error = error.message; throw error;}
  finally {row.durationMs = Math.round(performance.now() - began); await save();}
}
const npm = (name, args = []) => [process.execPath, [npmCLI, 'run', name, ...args]];
async function group(jobs) {
  const results = await Promise.allSettled(jobs.map(job => stage(...job)));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, errors.map(error => error.message).join('\n'));
}
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true; report.status = 'failed'; report.error = `Interrupted by ${signal}`;
  void Promise.all([...active].map(killTree)).then(save);
});
try {
  await stage('environment', python, ['-c', 'import pytest, setuptools, wheel, aiohttp, PySide6, anywidget, jupyterlab, ipykernel; print("Required real-host dependencies available")']);
  await stage('build', ...npm('build'));
  await group([
    ['types', ...npm('typecheck')],
    ['react-example-build', ...npm('build:example')],
    ['unit-react', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/unit', 'tests/react', '--maxWorkers=4']],
    ['python', python, ['-m', 'pytest', 'tests/python', '-q']],
    ['release-contracts', ...npm('test:release-contracts')],
    ['v1-runner-contracts', process.execPath, ['--test', 'tests/scripts/v1-runner.test.mjs']],
    ['package', ...npm('package:release', ['--', '--candidate'])],
  ]);
  const manifestPath = resolve(root, 'dist', `release-v${version}`, 'release-manifest.json');
  const manifestBytes = await readFile(manifestPath), manifest = JSON.parse(manifestBytes);
  report.artifactManifest = {path: manifestPath, sha256: createHash('sha256').update(manifestBytes).digest('hex'), commit: manifest.commit, candidate: manifest.candidate, workingTreeDirty: manifest.workingTreeDirty};
  await save();
  await group([
    ['parity', ...npm('test:parity')],
    ['v1-parity', process.execPath, ['scripts/v1-parity.mjs']],
    ['skill-examples', process.execPath, ['scripts/v1-skill-check.mjs']],
  ]);
  await stage('browser', process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.v1.config.ts', '--reporter=line']);
  await stage('workspaces-ui', process.execPath, ['scripts/v1-ui-check.mjs']);
  await stage('chart-tour-ui', process.execPath, ['scripts/v1-tour-ui-check.mjs']);
  await stage('archives-offline', process.execPath, ['scripts/v1-archives.mjs', resolve(root, 'dist', `release-v${version}`)]);
  await stage('real-hosts', process.execPath, ['scripts/v1-hosts.mjs', resolve(root, 'dist', `release-v${version}`)]);
  if (interrupted || performance.now() > deadline) throw new Error('Verification interrupted or budget exceeded');
  report.status = 'passed';
} catch (error) {report.status = 'failed'; report.error = error.message; process.exitCode = 1;}
finally {
  await Promise.all([...active].map(killTree));
  report.finishedAt = new Date().toISOString(); await save();
  console.log(`[verify:next] ${report.status.toUpperCase()} in ${Math.round((performance.now() - start) / 1000)}s. ${reportPath}`);
  if (report.error) console.error(report.error);
}
