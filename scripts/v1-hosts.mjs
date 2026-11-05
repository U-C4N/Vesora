import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium, expect} from '@playwright/test';
import {loadRelease} from './release-validation.mjs';
import {killTree} from './v1-runner.mjs';

const root = resolve('.'), directory = resolve(process.argv[2]);
const output = process.env.VESORA_V1_OUTPUT ?? resolve('artifacts/v1-verification/manual');
await mkdir(output, {recursive: true});
const release = await loadRelease(directory, {packagesOnly: true});
const python = process.env.VESORA_PYTHON ?? (existsSync('.venv/Scripts/python.exe') ? resolve('.venv/Scripts/python.exe') : 'python');
const target = resolve(output, 'installed-python');
const env = {...process.env, VESORA_INSTALL_TARGET: target, VESORA_V1_OUTPUT: output, PYTHONPATH: target, PYTHONUTF8: '1'};
execFileSync(python, ['-m', 'pip', 'install', '--no-deps', '--no-compile', '--no-index', '--target', target, resolve(directory, `vesora-${release.identity.python}-py3-none-any.whl`)], {cwd: output, env, windowsHide: true, stdio: 'inherit', timeout: 45000});
execFileSync(python, [resolve(root, 'scripts/v1-host-probe.py')], {cwd: output, env, windowsHide: true, stdio: 'inherit', timeout: 60000});
const server = spawn(python, [resolve(root, 'scripts/v1-jupyter-server.py')], {cwd: output, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']});
let logs = '', browser;
server.stderr.on('data', chunk => {logs = (logs + chunk).slice(-20000);});
try {
  const metadata = await new Promise((resolveReady, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => reject(new Error(`Real Jupyter startup timed out\n${logs}`)), 45000);
    server.stdout.on('data', chunk => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find(value => value.startsWith('VESORA_V1_JUPYTER '));
      if (line) {clearTimeout(timeout); resolveReady(JSON.parse(line.slice('VESORA_V1_JUPYTER '.length)));}
    });
    server.once('error', error => {clearTimeout(timeout); reject(error);});
    server.once('exit', code => {clearTimeout(timeout); reject(new Error(`Real Jupyter exited ${code}\n${logs}`));});
  });
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser = await chromium.launch({executablePath: process.env.VESORA_CHROME ?? (existsSync(chrome) ? chrome : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport: {width: 1700, height: 1100}});
  await page.goto(`${metadata.url}/lab/tree/v1.ipynb?token=${encodeURIComponent(metadata.token)}`);
  const cells = page.locator('.jp-NotebookPanel .jp-CodeCell');
  await expect(cells).toHaveCount(2, {timeout: 45000});
  await expect.poll(async () => {
    const response = await page.request.get(`${metadata.url}/api/kernels`, {headers: {Authorization: `token ${metadata.token}`}});
    if (!response.ok()) return false;
    return (await response.json()).some(kernel => kernel.execution_state === 'idle' && kernel.connections > 0);
  }, {timeout: 45000}).toBe(true);
  for (const [index, marker] of [[0, 'VESORA_V1_NOTEBOOK_RENDERED'], [1, 'VESORA_V1_NOTEBOOK_CLEANED']]) {
    const cell = cells.nth(index);
    await cell.locator('.cm-content').click();
    await page.getByRole('button', {name: 'Run this cell and advance (Shift+Enter)', exact: true}).click();
    await expect(cell.locator('.jp-OutputArea')).toContainText(marker, {timeout: 45000});
    await expect(cell.locator('.jp-OutputArea-error')).toHaveCount(0);
    if (index === 0) await page.screenshot({path: resolve(output, 'jupyter-advanced.png'), fullPage: true});
  }
  const png = await readFile(resolve(output, 'jupyter-workspace/advanced.png'));
  assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
  await writeFile(resolve(output, 'jupyter.json'), JSON.stringify({status: 'passed', host: 'real-JupyterLab', version: release.identity.canonical, analysisFamilies: 10, installedWheel: true, sourceCleanup: true}, null, 2));
  console.log('Real installed-wheel JupyterLab rendered all ten families and released sources');
} catch (error) {throw new Error(`${error.message}\n${logs}`);}
finally {await browser?.close(); await killTree(server);}
