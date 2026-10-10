import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';

test('real JupyterLab runs panel and statistical widgets, interactions, updates, PNG export and cleanup', async ({ page, request }, testInfo) => {
  test.skip(process.env.VESORA_TEST_JUPYTER !== '1', 'Set VESORA_TEST_JUPYTER=1 and install jupyterlab + ipykernel to run the real notebook host');
  test.setTimeout(180_000);
  const localPython = resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python');
  const python = process.env.VESORA_PYTHON ?? process.env.PYTHON ?? (existsSync(localPython) ? localPython : 'python');
  const jupyterData = testInfo.outputPath('jupyter-data');
  await mkdir(jupyterData, {recursive: true});
  const child = spawn(python, ['-u', resolve('tests/browser/jupyter/server.py')], {
    cwd: resolve('.'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', JUPYTER_DATA_DIR: jupyterData },
  });
  let logs = '', metadata;
  child.stderr.on('data', chunk => { logs += chunk; });
  const started = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`JupyterLab startup timed out.\n${logs.slice(-5000)}`)), 60_000);
    let stdout = '';
    child.stdout.on('data', chunk => {
      stdout += chunk; logs += chunk;
      const line = stdout.split(/\r?\n/).slice(0, -1).find(value => value.startsWith('VESORA_JUPYTER '));
      if (line) { clearTimeout(timer); resolveReady(JSON.parse(line.slice('VESORA_JUPYTER '.length))); }
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`JupyterLab exited ${code}.\n${logs.slice(-5000)}`)); });
  });
  try {
    metadata = await started;
    const headers = { Authorization: `token ${metadata.token}` };
    await expect.poll(async () => {
      try { return (await request.get(`${metadata.url}/api/status`, { headers, timeout: 2000 })).status(); }
      catch { return 0; }
    }, { timeout: 45_000 }).toBe(200);
    // Add statistics coverage through the real notebook Contents API, keeping the
    // server fixture's existing v2 panel/interaction cells unchanged.
    const notebookURL = `${metadata.url}/api/contents/vesora-host-test.ipynb`;
    const notebookResponse = await request.get(notebookURL, { headers });
    expect(notebookResponse.ok(), `Notebook read failed (${notebookResponse.status()}): ${await notebookResponse.text()}\n${logs.slice(-5000)}`).toBe(true);
    const notebook = (await notebookResponse.json()).content;
    const statisticalCells = [
      `stats = vs.subplots(2, 2, title="Real notebook statistics", width=900, height=680)
histogram = stats.hist([1, 1, 2, 3, float("nan")], bins=[0, 2, 4], color="#38bdf8")
bars = stats.panel(0, 1).set_categories("x", ["B", "A"])
bar = bars.bar(["A", "B"], [3, -2], color="#38bdf8")
bars.bar(["B", "A"], [2, 4], color="#38bdf8")
boxes = stats.panel(1, 0).boxplot([[1, 2, 3], [1, 2, 3, 40]], labels=["Tight", "Outlier"], color="#38bdf8")
categorical_line = stats.panel(1, 1).plot(["Low", "High"], [1, 3], color="#38bdf8", width=3)
stats.text(1, 2, "Protocol 3 annotation")
assert stats.snapshot()["figure"]["protocolVersion"] == 3
stats.bookmark("Overview")
stats.show()
await stats.savefig_async("statistics-initial.png", timeout=45)
print("VESORA_STATISTICS_READY")`,
      `histogram.set_options(density=True, cumulative=True)
histogram.set_data(samples=[1, 2, 2, 3, float("nan")])
bar.set_data(x=["A", "C"], y=[1, -4])
boxes.set_data(groups=[[2, 3, 4], [1, 3, 4, 90]])
categorical_line.set_data(y=[4, 2])
stats.panel(0, 1).set_axes(xlim=(.5, 2.5))
await stats.savefig_async("statistics-updated.png", timeout=45)
assert Path("statistics-updated.png").read_bytes() != Path("statistics-initial.png").read_bytes()
assert stats.snapshot()["figure"]["categories"]["x:panel-0-1"] == ["B", "A", "C"]
stats.restore_bookmark("Overview")
assert "xDomain" not in stats.snapshot()["figure"]["panels"][1]["view"]
await stats.savefig_async("statistics-restored.png", timeout=45)
statistics_widget = stats._widget
stats.close()
assert statistics_widget._vesora_closed and not stats.snapshot()["sources"]
print("VESORA_STATISTICS_UPDATED_EXPORTED_CLEANED")`,
    ];
    notebook.cells.splice(3, 0, ...statisticalCells.map((source, index) => ({cell_type: 'code', id: `vesora-statistics-${index}`, execution_count: null, metadata: {}, source, outputs: []})));
    const savedNotebook = await request.put(notebookURL, { headers, data: { type: 'notebook', format: 'json', content: notebook } });
    expect(savedNotebook.ok()).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${metadata.url}/lab/tree/vesora-host-test.ipynb?token=${encodeURIComponent(metadata.token)}`);
    const cells = page.locator('.jp-NotebookPanel .jp-CodeCell');
    await expect(cells).toHaveCount(6, { timeout: 45_000 });
    await expect.poll(async () => {
      const response = await request.get(`${metadata.url}/api/kernels`, {headers});
      if (!response.ok()) return false;
      const kernels = await response.json();
      return kernels.some(kernel => kernel.execution_state === 'idle' && kernel.connections > 0);
    }, {timeout: 60_000, message: 'The real notebook kernel must connect before executing cells'}).toBe(true);
    async function run(index, marker) {
      const cell = cells.nth(index);
      await cell.locator('.cm-content').click();
      await page.getByRole('button', {name: 'Run this cell and advance (Shift+Enter)', exact: true}).click();
      await expect(cell.locator('.jp-OutputArea')).toContainText(marker, { timeout: 60_000 });
      await expect(cell.locator('.jp-OutputArea-error')).toHaveCount(0);
    }
    await run(0, 'VESORA_WIDGET_READY');
    const figure = page.locator('.vesora-figure');
    await expect(figure).toHaveCount(1);
    await expect(figure.locator('canvas')).toHaveCount(2);
    const rendered = await figure.locator('canvas').first().evaluate(canvas => {
      const gl = canvas.getContext('webgl2');
      const pixels = new Uint8Array(canvas.width * canvas.height * 4), quadrants = [0, 0, 0, 0];
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let row = 0; row < canvas.height; row++) for (let col = 0; col < canvas.width; col++) {
        const index = (row * canvas.width + col) * 4;
        if (pixels[index] < 100 && pixels[index + 1] > 120 && pixels[index + 2] > 180) {
          quadrants[(row >= canvas.height / 2 ? 2 : 0) + (col >= canvas.width / 2 ? 1 : 0)]++;
        }
      }
      return { quadrants, error: gl.getError() };
    });
    expect(rendered.error).toBe(0);
    for (const count of rendered.quadrants) expect(count).toBeGreaterThan(80);
    await figure.screenshot({ path: testInfo.outputPath('jupyter-initial.png') });
    const canvas = figure.locator('canvas').last();
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * .75, box.y + box.height * .72);
    await page.mouse.wheel(0, -140);
    // The next cell executes on the real kernel after comm events have settled.
    await page.waitForTimeout(500);
    await run(1, 'VESORA_UPDATED_AND_EXPORTED');
    await run(2, 'VESORA_BOOKMARK_RESTORED');
    for (const name of ['overview', 'updated', 'restored']) {
      const png = await readFile(join(metadata.workspace, `${name}.png`));
      expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      expect(png.readUInt32BE(16)).toBeGreaterThan(200);
      expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(680);
      await testInfo.attach(`jupyter-${name}`, { body: png, contentType: 'image/png' });
    }
    await run(3, 'VESORA_STATISTICS_READY');
    await expect(page.locator('.vesora-figure')).toHaveCount(2);
    const statisticalFigure = page.locator('.vesora-figure').nth(1);
    await expect(statisticalFigure.locator('canvas')).toHaveCount(2);
    const statisticalPixels = await statisticalFigure.locator('canvas').first().evaluate(canvas => {
      const gl = canvas.getContext('webgl2');
      const pixels = new Uint8Array(canvas.width * canvas.height * 4), quadrants = [0, 0, 0, 0];
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let row = 0; row < canvas.height; row++) for (let col = 0; col < canvas.width; col++) {
        const offset = (row * canvas.width + col) * 4;
        if (pixels[offset] < 100 && pixels[offset + 1] > 120 && pixels[offset + 2] > 180) quadrants[(row >= canvas.height / 2 ? 2 : 0) + (col >= canvas.width / 2 ? 1 : 0)]++;
      }
      return {quadrants, error: gl.getError()};
    });
    expect(statisticalPixels.error).toBe(0);
    for (const count of statisticalPixels.quadrants) expect(count).toBeGreaterThan(80);
    await statisticalFigure.screenshot({path: testInfo.outputPath('jupyter-statistics.png')});
    await run(4, 'VESORA_STATISTICS_UPDATED_EXPORTED_CLEANED');
    await expect(page.locator('.vesora-figure')).toHaveCount(1);
    for (const name of ['initial', 'updated', 'restored']) {
      const png = await readFile(join(metadata.workspace, `statistics-${name}.png`));
      expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      expect(png.readUInt32BE(16)).toBeGreaterThan(200);
      expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(680);
      await testInfo.attach(`jupyter-statistics-${name}`, {body: png, contentType: 'image/png'});
    }
    await run(5, 'VESORA_CLEANED_UP');
    await expect(page.locator('.vesora-figure')).toHaveCount(0);
  } finally {
    if (metadata && child.exitCode === null) {
      await request.post(`${metadata.url}/api/shutdown`, {
        headers: { Authorization: `token ${metadata.token}` }, timeout: 10_000,
      }).catch(() => {});
    }
    if (child.exitCode === null) {
      await Promise.race([once(child, 'exit'), new Promise(resolveTimeout => setTimeout(resolveTimeout, 10_000))]);
      if (child.exitCode === null) child.kill();
    }
    await testInfo.attach('jupyter-server.log', { body: logs, contentType: 'text/plain' });
  }
});
