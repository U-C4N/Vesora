import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

test('real JupyterLab runs panels, statistics and linked cohorts through actual widget comms', async ({ page, request, browser }, testInfo) => {
  test.skip(process.env.VESORA_TEST_JUPYTER !== '1', 'Set VESORA_TEST_JUPYTER=1 and install jupyterlab + ipykernel to run the real notebook host');
  test.setTimeout(240_000);
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
    // Keep all six existing panel/statistics cells; append a real linked workflow.
    const linkedCells = [
      `import asyncio, base64, json, re
linked = vs.subplots(1, 3, title="Real notebook linked cohort", width=1200, height=620)
linked_a = linked.panel(0, 0).scatter([1, 2, 3, 8], [1, 2, 3, 8], size=18, color="#38bdf8")
linked_b = linked.panel(0, 1).scatter([8, 3, 2, 1], [1, 2, 3, 8], size=18, color="#38bdf8")
linked_h = linked.panel(0, 2).hist([1, 2, 3, 8], bins=[0, 2, 4, 10], color="#38bdf8")
for col in range(2):
    linked.panel(0, col).set_axes(xlim=(0, 10), ylim=(0, 10))
linked_link = linked.link_selection(scatter=[linked_a, linked_b], histogram=linked_h)
linked_sources = linked.snapshot()["sources"]
linked_events = []
linked.on("selection", lambda event: linked_events.append((event, linked.snapshot()["figure"]["selectionLink"].get("selection"))))
linked.show()
await linked.savefig_async("linked-initial.png", timeout=45)
print("VESORA_LINKED_WIDGET_READY")`,
      `for attempt in range(100):
    if any(event[0].get("active") for event in linked_events):
        break
    await asyncio.sleep(.05)
selected_event, retained = next(event for event in reversed(linked_events) if event[0].get("active"))
assert selected_event["kind"] == "linked" and selected_event["indices"] == [1, 2]
assert (selected_event["count"], selected_event["total"], selected_event["fraction"]) == (2, 4, .5)
assert selected_event["layerId"] == linked_a.id and selected_event["panelId"] == "main"
assert retained == linked.snapshot()["figure"]["selectionLink"]["selection"]
assert linked.snapshot()["sources"] == linked_sources
linked.save_html("linked-selected.html")
html = Path("linked-selected.html").read_text(encoding="utf-8")
exported = json.loads(re.search(r'<script[^>]*id="vesora-payload"[^>]*>(.*?)</script>', html, re.S).group(1))
assert exported["snapshot"] == linked.snapshot()
assert exported["snapshot"]["figure"]["selectionLink"]["selection"] == retained
assert len(exported["buffers"]) == 5
for source, data in zip(exported["snapshot"]["sources"], exported["buffers"]):
    assert base64.b64decode(data["base64"]) == linked._data_bytes(source["id"], source["version"])
await linked.savefig_async("linked-selected.png", timeout=45)
assert Path("linked-selected.png").read_bytes() != Path("linked-initial.png").read_bytes()
print("VESORA_LINKED_CALLBACK_RETAINED_EXPORTED")`,
      `for attempt in range(100):
    if linked_events and not linked_events[-1][0].get("active") and linked_events[-1][0].get("sequence", 0) > selected_event["sequence"]:
        break
    await asyncio.sleep(.05)
cleared, retained_clear = linked_events[-1]
assert not cleared["active"] and cleared["count"] == 0 and cleared["fraction"] == 0 and cleared["indices"] == []
assert cleared["sequence"] > selected_event["sequence"] and retained_clear is None
assert "selection" not in linked.snapshot()["figure"]["selectionLink"]
await linked.savefig_async("linked-cleared.png", timeout=45)
assert Path("linked-cleared.png").read_bytes() != Path("linked-selected.png").read_bytes()
linked_widget = linked._widget
linked.close()
assert linked_widget._vesora_closed and not linked.snapshot()["sources"] and not linked._listeners
print("VESORA_LINKED_CLEARED_CLEANED")`,
    ];
    notebook.cells.push(...linkedCells.map((source, index) => ({cell_type: 'code', id: `vesora-linked-${index}`, execution_count: null, metadata: {}, source, outputs: []})));
    const presentationCells = [
      `presentation = vs.figure(theme="dark", title="Real notebook presentation", width=900, height=420)
presentation_line = presentation.plot([0, 86400000], [1200, 1500], label="Revenue")
presentation.set_axes(xscale="time", xlim=(0, 86400000), ylim=(0, 2000))
presentation.set_axis_format("x", {"kind":"date", "timeZone":"UTC", "options":{"year":"numeric","month":"short","day":"numeric"}})
presentation.set_axis_format("y", {"kind":"currency", "currency":"USD", "options":{"currencyDisplay":"code","maximumFractionDigits":0}})
presentation.show()
await presentation.savefig_async("presentation-dark.png", timeout=45)
assert presentation.snapshot()["figure"]["protocolVersion"] == 5
print("VESORA_PRESENTATION_READY")`,
      `presentation.set_theme("light")
presentation_line.set_data(y=[1400, 1800])
await presentation.savefig_async("presentation-light.png", timeout=45)
assert Path("presentation-light.png").read_bytes() != Path("presentation-dark.png").read_bytes()
presentation.save_html("presentation-light.html")
presentation_widget = presentation._widget
presentation.close()
assert presentation_widget._vesora_closed and not presentation.snapshot()["sources"]
print("VESORA_PRESENTATION_UPDATED_EXPORTED_CLEANED")`,
    ];
    notebook.cells.push(...presentationCells.map((source, index) => ({cell_type:'code', id:`vesora-presentation-${index}`, execution_count:null, metadata:{}, source, outputs:[]})));
    const savedNotebook = await request.put(notebookURL, { headers, data: { type: 'notebook', format: 'json', content: notebook } });
    expect(savedNotebook.ok()).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`${metadata.url}/lab/tree/vesora-host-test.ipynb?token=${encodeURIComponent(metadata.token)}`);
    const cells = page.locator('.jp-NotebookPanel .jp-CodeCell');
    await expect(cells).toHaveCount(11, { timeout: 45_000 });
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
    await run(6, 'VESORA_LINKED_WIDGET_READY');
    const linkedFigure = page.locator('.vesora-figure');
    await expect(linkedFigure).toHaveCount(1);
    await expect(linkedFigure.locator('canvas')).toHaveCount(2);
    await linkedFigure.locator('canvas').last().scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.__vesoraLinkedText = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        window.__vesoraLinkedText.push(String(text)); return original.call(this, text, ...args);
      };
    });
    const linkedBox = await linkedFigure.locator('canvas').last().boundingBox();
    const plotWidth = linkedBox.width / 3 - 155, plotHeight = linkedBox.height - 70 - 28 - 82 - 36;
    await page.keyboard.down('Shift');
    await page.mouse.move(linkedBox.x + 70 + .15 * plotWidth, linkedBox.y + 98 + .85 * plotHeight);
    await page.mouse.down();
    await page.mouse.move(linkedBox.x + 70 + .35 * plotWidth, linkedBox.y + 98 + .65 * plotHeight, {steps: 8});
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(linkedFigure.locator('.vesora-selection-summary')).toHaveText('Selected 2 / 4 (50.00%)');
    await expect(linkedFigure.locator('.vesora-clear-selection')).toBeEnabled();
    await run(7, 'VESORA_LINKED_CALLBACK_RETAINED_EXPORTED');
    expect(await page.evaluate(() => window.__vesoraLinkedText.includes('Selected 2 / 4 (50.00%)'))).toBe(true);
    const selectedPNG = await readFile(join(metadata.workspace, 'linked-selected.png'));
    const pngInk = await page.evaluate(async ({base64, cssWidth}) => {
      const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data, scale = canvas.width/cssWidth;
      const highlights = [0, 0, 0]; let header = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4, r = pixels[i], g = pixels[i+1], b = pixels[i+2];
        if (r > 190 && g > 40 && g < 150 && b < 70 && pixels[i+3] > 180) highlights[Math.min(2, Math.floor(3*x/canvas.width))]++;
        if (x >= 70*scale && x < 400*scale && y >= 40*scale && y < 57*scale && Math.max(r,g,b) < 150 && pixels[i+3] > 180) header++;
      }
      return {highlights, header};
    }, {base64: selectedPNG.toString('base64'), cssWidth: linkedBox.width});
    for (const count of pngInk.highlights) expect(count).toBeGreaterThan(40);
    expect(pngInk.header).toBeGreaterThan(40);
    await writeFile(testInfo.outputPath('jupyter-linked-selected.png'), selectedPNG);
    await writeFile(testInfo.outputPath('jupyter-linked-selected.html'), await readFile(join(metadata.workspace, 'linked-selected.html')));
    await testInfo.attach('jupyter-linked-selected', {body:selectedPNG, contentType:'image/png'});
    await linkedFigure.locator('.vesora-clear-selection').click();
    await expect(linkedFigure.locator('.vesora-selection-summary')).toHaveText('Shift + drag in either scatter to compare observations');
    await run(8, 'VESORA_LINKED_CLEARED_CLEANED');
    await expect(page.locator('.vesora-figure')).toHaveCount(0);
    await page.evaluate(() => {
      window.presentationLabels = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {window.presentationLabels.push(String(text)); return original.call(this, text, ...args);};
    });
    await run(9, 'VESORA_PRESENTATION_READY');
    await expect(page.locator('.vesora-figure')).toHaveCount(1);
    const darkPNG = await readFile(join(metadata.workspace, 'presentation-dark.png'));
    const corner = await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0)), bitmap = await createImageBitmap(new Blob([bytes], {type:'image/png'}));
      const canvas = document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);return Array.from(ctx.getImageData(10,10,1,1).data);
    }, darkPNG.toString('base64'));
    expect(corner).toEqual([15,23,42,255]);
    const labels=await page.evaluate(()=>window.presentationLabels);
    expect(labels.some(label=>label.includes('1970'))).toBe(true);
    expect(labels.some(label=>label.includes('USD'))).toBe(true);
    await testInfo.attach('jupyter-presentation-dark', {body:darkPNG,contentType:'image/png'});
    await run(10, 'VESORA_PRESENTATION_UPDATED_EXPORTED_CLEANED');
    await expect(page.locator('.vesora-figure')).toHaveCount(0);
    const offlineContext = await browser.newContext({offline:true});
    try {
      const offline = await offlineContext.newPage();
      await offline.goto(pathToFileURL(join(metadata.workspace, 'linked-selected.html')).href);
      await expect(offline.locator('.vesora-selection-summary')).toHaveText('Selected 2 / 4 (50.00%)');
      await expect(offline.locator('.vesora-figure canvas')).toHaveCount(2);
      await offline.locator('.vesora-clear-selection').click();
      await expect(offline.locator('.vesora-selection-summary')).toHaveText('Shift + drag in either scatter to compare observations');
      await offline.goto(pathToFileURL(join(metadata.workspace,'presentation-light.html')).href);
      await expect(offline.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
      const presentationPayload=JSON.parse(await offline.locator('#vesora-payload').textContent());
      expect(presentationPayload.snapshot.figure.protocolVersion).toBe(5);
      expect(presentationPayload.snapshot.figure.theme.background).toBe('#ffffff');
      expect(presentationPayload.snapshot.figure.view.xScale).toBe('time');
    } finally {
      await offlineContext.close();
    }
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
    // A Windows kernel can briefly inherit server pipes after the server exits.
    // Release our handles so an otherwise completed Playwright worker can exit.
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
});
