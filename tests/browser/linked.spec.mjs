import {test, expect} from '@playwright/test';
import {mkdir, writeFile, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';

async function load(page, {fallback = false} = {}) {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 1280, height: 900});
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async fallback => {
    window.drawnText = []; window.events = []; window.workerMessages = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {drawnText.push(text); return fill.call(this, text, ...args);};
    if (fallback) window.Worker = class {constructor() {throw new Error('Exercise cooperative fallback');}};
    else {const post = Worker.prototype.postMessage; Worker.prototype.postMessage = function (message, ...args) {workerMessages.push({type: message.type, id: message.id}); return post.call(this, message, ...args);};}
    window.vs = await import('/packages/core/dist/index.js');
    document.querySelector('#chart').style.width = '1100px';
  }, fallback);
  return errors;
}

async function small(page, {fallback = false, special = false} = {}) {
  const errors = await load(page, {fallback});
  await page.evaluate(async special => {
    window.fig = vs.subplots({rows: 1, cols: 3, width: 1100, height: 480, title: 'Linked measurements Ω'});
    const x = special ? [-2, -1, 1, 2, NaN, 4] : [0, 1, 2, 3, 4, 5];
    const y = special ? [1, 1, 1, 1, 1, 1] : [0, 1, 1, 3, 4, 5];
    window.a = fig.panel(0, 0).scatter(x, y, {color: '#2563eb', size: 12, label: 'First projection', ...(special ? {values: [NaN, 1, NaN, 3, 4, 5]} : {})});
    window.b = fig.panel(0, 1).scatter(special ? [0, 1, NaN, 3, 4, 5] : [5, 4, 3, 2, 1, 0], special ? [0, 1, 2, 3, 4, 5] : [5, 4, 3, 2, 1, 0], {color: '#16a34a', size: 12, label: 'Other projection'});
    window.hist = fig.panel(0, 2).hist(special ? [0, 1, 2, 9, 3, NaN] : [0, 1, 2, 3, NaN, 9], {bins: [0, 2, 4, 6], color: '#64748b', label: 'Signal'});
    fig.panel(0, 0).setView({xDomain: special ? [-3, 5] : [0, 6], yDomain: [0, 6]});
    fig.panel(0, 1).setView({xDomain: [0, 6], yDomain: [0, 6]});
    fig.panel(0, 2).setView({xDomain: [0, 6], yDomain: [0, 4]});
    window.link = fig.linkSelection({scatter: [a, b], histogram: hist});
    fig.bookmark('Overview'); fig.panel(0, 0).setView({xDomain: [0, 3], yDomain: [0, 3]}); fig.bookmark('Detail'); fig.restoreBookmark('Overview');
    fig.on('selection', value => events.push(value)); fig.mount(document.querySelector('#chart')); await fig.ready(); events.length = 0;
  }, special);
  return errors;
}

async function large(page) {
  const errors = await load(page);
  await page.evaluate(async () => {
    const n = 1_000_000, x = Float64Array.from({length: n}, (_, i) => i), reverse = Float64Array.from({length: n}, (_, i) => n - 1 - i), y = new Float64Array(n).fill(1);
    window.fig = vs.subplots({rows: 1, cols: 3, height: 480, title: 'Full million-row cohort'});
    window.a = fig.panel(0, 0).scatter(x, y); window.b = fig.panel(0, 1).scatter(reverse, y);
    window.hist = fig.panel(0, 2).hist(Float64Array.from({length: n}, (_, i) => i % 4), {bins: [0, 1, 2, 4]});
    for (let col = 0; col < 2; col++) fig.panel(0, col).setView({xDomain: [0, n - 1], yDomain: [0, 2]});
    fig.panel(0, 2).setView({xDomain: [0, 4], yDomain: [0, 600_000]});
    window.link = fig.linkSelection({scatter: [a, b], histogram: hist});
    fig.on('selection', value => events.push(value)); fig.mount(document.querySelector('#chart')); await fig.ready(); events.length = 0;
  });
  return errors;
}

async function state(page) {
  return page.evaluate(() => {
    const result = fig.view.linkedResult;
    return {count: result?.count, total: result?.total, maskBytes: result?.mask.byteLength, previewLength: result?.preview.length, truncated: result?.truncated,
      histogram: result?.histogram.items.map(item => item.count), histogramInfo: result?.histogram.info,
      plans: [...fig.view.selectedPlans].sort(([left], [right]) => fig.spec.selectionLink.scatter.indexOf(left) - fig.spec.selectionLink.scatter.indexOf(right)).map(([id, plan]) => ({id, kind: plan.kind, total: plan.info.total, visible: plan.info.visible, sum: plan.kind === 'density' ? plan.counts.reduce((sum, count) => sum + count, 0) : undefined, indices: plan.kind === 'points' ? [...plan.indices] : undefined})),
      selection: fig.snapshot().figure.selectionLink, lastEvent: events.at(-1)};
  });
}

async function nativeBrush(page, bounds) {
  const points = await page.evaluate(bounds => {
    const panel = fig.view.panels.find(panel => panel.id === (a.spec.panelId ?? 'main')), r = panel.rect, offset = fig.view.overlay.getBoundingClientRect();
    const x = value => offset.left + r.left + (value - panel.bounds.x[0]) / (panel.bounds.x[1] - panel.bounds.x[0]) * r.width;
    const y = value => offset.top + r.top + (1 - (value - panel.bounds.y[0]) / (panel.bounds.y[1] - panel.bounds.y[0])) * r.height;
    return [{x: x(bounds.x[0]), y: y(bounds.y[1])}, {x: x(bounds.x[1]), y: y(bounds.y[0])}];
  }, bounds);
  await page.keyboard.down('Shift'); await page.mouse.move(points[0].x, points[0].y); await page.mouse.down(); await page.mouse.move(points[1].x, points[1].y, {steps: 5}); await page.mouse.up(); await page.keyboard.up('Shift');
  await page.evaluate(() => fig.ready());
}

async function gpu(page, selector = '#chart') {
  return page.evaluate(selector => {
    const canvas = document.querySelector(`${selector} canvas`), gl = canvas.getContext('webgl2'), data = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const orange = [0, 0, 0]; let hash = 2166136261, ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let j = 0; j < 3; j++) hash = Math.imul(hash ^ data[i + j], 16777619);
      if (Math.min(data[i], data[i + 1], data[i + 2]) < 220) ink++;
      if (data[i] > 200 && data[i + 1] < 160 && data[i + 2] < 100) orange[Math.min(2, Math.floor(((i / 4) % canvas.width) / (canvas.width / 3)))]++;
    }
    return {hash: hash >>> 0, orange, ink, error: gl.getError()};
  }, selector);
}

for (const fallback of [false, true]) test(`native rectangle links exact source rows and selected histogram (${fallback ? 'fallback' : 'worker'})`, async ({page}) => {
  const errors = await small(page, {fallback});
  await nativeBrush(page, {x: [.5, 2.5], y: [.5, 1.5]});
  const current = await state(page);
  expect(current).toMatchObject({count: 2, total: 6, histogram: [1, 1, 0], truncated: false});
  expect(current.lastEvent).toMatchObject({kind: 'linked', count: 2, total: 6, fraction: 1 / 3, indices: [1, 2], active: true});
  expect(current.plans.map(plan => plan.indices)).toEqual([[1, 2], [1, 2]]);
  const drawing = await gpu(page); expect(drawing.error).toBe(0); for (const pixels of drawing.orange) expect(pixels).toBeGreaterThan(15);
  const before = await page.evaluate(() => fig.spec.selectionLink.selection);
  await page.evaluate(async () => {fig.restoreBookmark('Detail'); await fig.ready(); fig.restoreBookmark('Overview'); await fig.ready();});
  expect(await page.evaluate(() => fig.spec.selectionLink.selection)).toEqual(before);
  await page.getByRole('button', {name: 'Clear selection', exact: true}).click(); await page.evaluate(() => fig.ready());
  expect(await state(page)).toMatchObject({count: 0, histogram: [0, 0, 0], plans: []});
  expect(await page.evaluate(() => fig.spec.selectionLink.selection)).toBeUndefined(); expect(errors).toEqual([]);
});

test('raw cohort survives non-finite colors, missing target coordinates and log/representation changes', async ({page}) => {
  const errors = await small(page, {special: true});
  await page.evaluate(async () => {fig.selectLinked(a.id, {x: [-3, 5], y: [0, 2]}); await fig.ready();});
  const before = await state(page); expect(before).toMatchObject({count: 5, total: 6, histogram: [2, 1, 0]});
  expect(before.histogramInfo).toMatchObject({valid: 4, rangeExcluded: 1, omitted: 1, visible: 3});
  expect(before.plans.map(plan => plan.visible)).toEqual([5, 4]);
  await page.evaluate(async () => {a.setStyle({representation: 'density'}); b.setStyle({representation: 'density'}); await fig.ready();});
  expect((await state(page)).plans.map(plan => plan.sum)).toEqual([5, 4]);
  await page.evaluate(async () => {fig.panel(0, 0).setView({xScale: 'log', xDomain: [.5, 10]}); a.setStyle({representation: 'points'}); b.setStyle({representation: 'points'}); await fig.ready();});
  const after = await state(page); expect(after.count).toBe(5); expect(after.histogram).toEqual(before.histogram);
  expect(after.plans.map(plan => plan.visible)).toEqual([3, 4]); expect(after.plans.map(plan => plan.total)).toEqual([5, 5]);
  expect(after.selection.selection).toEqual(before.selection.selection); expect((await gpu(page)).error).toBe(0); expect(errors).toEqual([]);
});

test('million-row selection remains complete through density and sparse target view', async ({page}) => {
  const errors = await large(page);
  await page.evaluate(async () => {fig.selectLinked(a.id, {x: [0, 299_999], y: [0, 2]}); await fig.ready();});
  const dense = await state(page); expect(dense).toMatchObject({count: 300_000, total: 1_000_000, maskBytes: 125_000, previewLength: 10_000, truncated: true, histogram: [75_000, 75_000, 150_000]});
  expect(dense.lastEvent.indices).toHaveLength(10_000); expect(dense.lastEvent).toMatchObject({count: 300_000, fraction: .3, truncated: true});
  expect(dense.plans.map(plan => plan.kind)).toEqual(['density', 'density']); expect(dense.plans.map(plan => plan.sum)).toEqual([300_000, 300_000]);
  await page.evaluate(async () => {fig.panel(0, 1).setView({xDomain: [999_989, 1_000_000]}); await fig.ready();});
  const sparse = await state(page); expect(sparse.count).toBe(300_000); expect(sparse.plans[1]).toMatchObject({kind: 'points', visible: 11, indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]});
  await page.evaluate(async () => {fig.panel(0, 1).setView({xDomain: [0, 999_999]}); await fig.ready();});
  expect((await state(page)).plans[1]).toMatchObject({kind: 'density', sum: 300_000}); expect(errors).toEqual([]);
});

test('rapid replacement and removal cannot commit obsolete selection work', async ({page}) => {
  const errors = await large(page);
  await page.evaluate(async () => {
    fig.selectLinked(a.id, {x: [0, 599_999], y: [0, 2]});
    await new Promise(requestAnimationFrame);
    fig.selectLinked(a.id, {x: [500_000, 799_999], y: [0, 2]}); await fig.ready();
  });
  const current = await state(page); expect(current.count).toBe(300_000); expect(current.selection.selection.bounds.x).toEqual([500_000, 799_999]); expect(current.lastEvent.count).toBe(300_000);
  const cleared = await page.evaluate(async () => {
    fig.selectLinked(a.id, {x: [0, 899_999], y: [0, 2]}); await new Promise(requestAnimationFrame); link.clear(); await fig.ready();
    return {active: !!fig.spec.selectionLink.selection, count: fig.view.linkedResult.count, plans: fig.view.selectedPlans.size, pending: fig.view.scheduler.stats.pending, event: events.at(-1)};
  });
  expect(cleared).toMatchObject({active: false, count: 0, plans: 0, pending: 0, event: {kind: 'linked', active: false, count: 0, fraction: 0}});
  const removed = await page.evaluate(async () => {
    events.length = 0; fig.selectLinked(a.id, {x: [0, 899_999], y: [0, 2]}); await new Promise(requestAnimationFrame); link.remove(); await fig.ready();
    return {link: fig.spec.selectionLink, derived: fig.view.linkedResult, events, pending: fig.view.scheduler.stats.pending, hidden: document.querySelector('[data-vesora-selection]').hidden};
  });
  expect(removed.link).toBeUndefined(); expect(removed.derived).toBeUndefined(); expect(removed.events.filter(event => event.active)).toEqual([]); expect(removed.pending).toBe(0); expect(removed.hidden).toBe(true); expect(errors).toEqual([]);
});

test('member removal releases linked sources and close disposes worker/GPU view resources', async ({page}) => {
  const errors = await small(page);
  const result = await page.evaluate(async () => {
    fig.selectLinked(a.id, {x: [.5, 2.5], y: [.5, 1.5]}); await fig.ready();
    const ids = Object.values(a.spec.data), before = fig.registry.size; a.remove(); await fig.ready();
    const after = {sources: fig.registry.size, linked: !!fig.spec.selectionLink, derived: !!fig.view.linkedResult, pending: fig.view.scheduler.stats.pending, freed: ids.every(id => !fig.registry.has(id)), released: ids.every(id => workerMessages.some(message => message.type === 'release' && message.id === id))};
    fig.close(); return {before, after, closedSources: fig.registry.size, canvases: document.querySelectorAll('#chart canvas').length, disposed: workerMessages.some(message => message.type === 'dispose')};
  });
  expect(result).toEqual({before: 5, after: {sources: 3, linked: false, derived: false, pending: 0, freed: true, released: true}, closedSources: 0, canvases: 0, disposed: true}); expect(errors).toEqual([]);
});

test('empty datasets and active zero-hit brushes report a defined zero fraction', async ({page}) => {
  const errors = await load(page);
  await page.evaluate(async () => {
    window.fig = vs.subplots({rows: 1, cols: 3, height: 480}); window.a = fig.panel(0, 0).scatter([], []); window.b = fig.panel(0, 1).scatter([], []);
    window.hist = fig.panel(0, 2).hist([], {bins: [0, 1, 2]}); window.link = fig.linkSelection({scatter: [a, b], histogram: hist});
    fig.on('selection', event => events.push(event)); fig.mount(document.querySelector('#chart')); await fig.ready(); fig.selectLinked(a.id, {x: [0, 1], y: [0, 1]}); await fig.ready();
  });
  expect(await state(page)).toMatchObject({count: 0, total: 0, maskBytes: 0, histogram: [0, 0], lastEvent: {active: true, count: 0, total: 0, fraction: 0, indices: [], truncated: false}});
  await expect(page.locator('.vesora-selection-summary')).toContainText('Selected 0 / 0 (0.00%)');
  await page.getByRole('button', {name: 'Clear selection', exact: true}).click(); await page.evaluate(() => fig.ready()); expect((await state(page)).lastEvent).toMatchObject({active: false, fraction: 0});
  const nonemptyErrors = await small(page);
  await page.evaluate(async () => {fig.selectLinked(a.id, {x: [10, 11], y: [10, 11]}); await fig.ready();});
  expect(await state(page)).toMatchObject({count: 0, total: 6, histogram: [0, 0, 0], lastEvent: {active: true, count: 0, total: 6, fraction: 0, indices: [], truncated: false}});
  await expect(page.locator('.vesora-selection-summary')).toContainText('No observations in this selection');
  expect(errors).toEqual([]); expect(nonemptyErrors).toEqual([]);
});

for(const fallback of [false,true])test(`linking a rendered figure detaches caller storage and replaces caches (${fallback?'fallback':'worker'})`,async({page})=>{
  const errors=await load(page,{fallback});
  const actual=await page.evaluate(async()=>{
    const x=Float64Array.of(0,1,2),y=Float64Array.of(0,1,2),samples=Float64Array.of(0,1,2);
    window.fig=vs.subplots({rows:1,cols:3,height:480});window.a=fig.panel(0,0).scatter(x,y);
    window.b=fig.panel(0,1).scatter(x,y);window.hist=fig.panel(0,2).hist(samples,{bins:[0,1,2,3]});
    fig.on('selection',event=>events.push(event));fig.mount(document.querySelector('#chart'));await fig.ready();
    // Establishing the immutable relation takes the current source values, even
    // if a prior unlinked worker frame contains an older borrowed array.
    x[0]=1;y[0]=1;samples[0]=2;
    window.link=fig.linkSelection({scatter:[a,b],histogram:hist});
    x.fill(99);y.fill(99);samples.fill(99);
    fig.selectLinked(a.id,{x:[1,1],y:[1,1]});await fig.ready();
    const before={count:fig.view.linkedResult.count,indices:[...fig.view.linkedResult.preview],histogram:fig.view.linkedResult.histogram.items.map(bin=>bin.count)};
    const snapshot=fig.snapshot(),data=new Map([...fig.registry.entries()].map(([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength)]));
    fig.applySnapshot(snapshot,data);for(const buffer of data.values())new Float64Array(buffer).fill(99);await fig.ready();
    return {before,after:{count:fig.view.linkedResult.count,indices:[...fig.view.linkedResult.preview],histogram:fig.view.linkedResult.histogram.items.map(bin=>bin.count)},pending:fig.view.scheduler.stats.pending};
  });
  expect(actual).toEqual({before:{count:2,indices:[0,1],histogram:[0,1,1]},after:{count:2,indices:[0,1],histogram:[0,1,1]},pending:0});
  expect((await gpu(page)).error).toBe(0);expect(errors).toEqual([]);
});

for (const producer of ['JavaScript', 'Python']) test(`${producer} active predicate, reset/bookmarks and composited PNG survive network-offline HTML`, async ({page, context}, info) => {
  const path = info.outputPath('linked.html'); await mkdir(dirname(path), {recursive: true});
  if (producer === 'JavaScript') {
    await small(page);
    const html = await page.evaluate(async () => {fig.selectLinked(a.id, {x: [.5, 2.5], y: [.5, 1.5]}); await fig.ready(); return vs.toHTML(fig);});
    await writeFile(path, html, 'utf8');
  } else {
    const python = process.env.VESORA_PYTHON ?? (existsSync('.venv/Scripts/python.exe') ? resolve('.venv/Scripts/python.exe') : 'python');
    execFileSync(python, ['-X', 'utf8', '-c', `import sys
import vesora as vs
fig=vs.subplots(1,3,width=1100,height=480,title='Linked measurements Ω')
a=fig.panel(0,0).scatter([0,1,2,3,4,5],[0,1,1,3,4,5],color='#2563eb',size=12,label='First projection')
b=fig.panel(0,1).scatter([5,4,3,2,1,0],[5,4,3,2,1,0],color='#16a34a',size=12,label='Other projection')
h=fig.panel(0,2).hist([0,1,2,3,float('nan'),9],bins=[0,2,4,6],color='#64748b',label='Signal')
for col in range(2): fig.panel(0,col).set_axes(xlim=(0,6),ylim=(0,6))
fig.panel(0,2).set_axes(xlim=(0,6),ylim=(0,4))
link=fig.link_selection(scatter=[a,b],histogram=h)
fig.bookmark('Overview')
fig.panel(0,0).set_axes(xlim=(0,3),ylim=(0,3))
fig.bookmark('Detail')
fig.restore_bookmark('Overview')
# Same inbound event contract used by the desktop and notebook hosts.
fig._emit('selection',dict(kind='linked',linkId=link.id,generation=1,sequence=1,layerId=a.id,panelId='main',bounds=dict(x=[.5,2.5],y=[.5,1.5]),active=True,count=2,total=6,fraction=2/6,indices=[1,2],truncated=False))
fig.save_html(sys.argv[1])
fig.close()`, path], {env: {...process.env, PYTHONPATH: resolve('python')}, encoding: 'utf8', windowsHide: true});
  }
  const requests = [], errors = []; page.on('request', request => {if (/^https?:/.test(request.url())) requests.push(request.url());}); page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.drawnText = []; const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {drawnText.push(text); return fill.call(this, text, ...args);};
  });
  await context.setOffline(true); await page.goto(pathToFileURL(path).href);
  const viewer = page.locator('#vesora-viewer'); await expect(viewer).toHaveAttribute('data-ready', 'ready');
  await expect(page.locator('#vesora-selection-summary')).toContainText('Selected 2 / 6 (33.33%)');
  const payload = await page.evaluate(() => JSON.parse(document.querySelector('#vesora-payload').textContent));
  expect(payload.snapshot.figure).toMatchObject({protocolVersion: 4, selectionLink: {selection: {bounds: {x: [.5, 2.5], y: [.5, 1.5]}}}});
  expect(payload.snapshot.figure.selectionLink).not.toHaveProperty('mask'); expect(payload.snapshot.figure.selectionLink).not.toHaveProperty('indices');
  const initial = await gpu(page, '#vesora-chart'); for (const count of initial.orange) expect(count).toBeGreaterThan(15);
  await page.getByRole('button', {name: 'Detail', exact: true}).click(); await expect(viewer).toHaveAttribute('data-ready', 'ready');
  await expect(page.locator('#vesora-selection-summary')).toContainText('Selected 2 / 6'); expect((await gpu(page, '#vesora-chart')).hash).not.toBe(initial.hash);
  await page.getByRole('button', {name: 'Reset view', exact: true}).click(); await expect(viewer).toHaveAttribute('data-ready', 'ready');
  expect((await gpu(page, '#vesora-chart')).hash).toBe(initial.hash); await expect(page.locator('#vesora-selection-summary')).toContainText('Selected 2 / 6');
  const waiting = page.waitForEvent('download'); await page.locator('#vesora-png').click(); const pngPath = info.outputPath('linked.png'); await (await waiting).saveAs(pngPath);
  const png = await readFile(pngPath); expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const composited = await page.evaluate(async base64 => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob()), canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bands = [0, 0]; for (let y = 10; y < Math.min(canvas.height, 65); y++) for (let x = 65; x < Math.min(canvas.width, 700); x++) {const i = (y * canvas.width + x) * 4; if (Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) < 180) bands[y < 35 ? 0 : 1]++;}
    return {width: bitmap.width, height: bitmap.height, bands};
  }, png.toString('base64'));
  expect(composited.width).toBeGreaterThanOrEqual(1080); expect(composited.height).toBeGreaterThanOrEqual(480); for (const ink of composited.bands) expect(ink).toBeGreaterThan(20);
  expect(await page.evaluate(() => drawnText)).toContain('Linked measurements Ω'); expect(await page.evaluate(() => drawnText.some(text => text.includes('Selected 2 / 6')))).toBe(true);
  await page.locator('#vesora-clear-selection').click(); await expect(viewer).toHaveAttribute('data-ready', 'ready'); await expect(page.locator('#vesora-clear-selection')).toBeDisabled();
  await expect(page.locator('#vesora-selection-summary')).toContainText('Shift + drag'); expect((await gpu(page, '#vesora-chart')).hash).not.toBe(initial.hash);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('invalid linked imports roll back and v1/v2/v3 replacements render without retained cohort state', async ({page}) => {
  const errors = await small(page);
  const results = await page.evaluate(async () => {
    fig.selectLinked(a.id, {x: [.5, 2.5], y: [.5, 1.5]}); await fig.ready();
    const before = fig.snapshot(), data = new Map([...fig.registry.entries()].map(([id, entry]) => [id, entry.values.buffer.slice(entry.values.byteOffset, entry.values.byteOffset + entry.values.byteLength)]));
    const invalid = structuredClone(before); invalid.figure.protocolVersion = 3; let rejected = false;
    try {fig.applySnapshot(invalid, data);} catch {rejected = true;}
    const rolledBack = JSON.stringify(fig.snapshot()) === JSON.stringify(before), legacy = [];
    for (const version of [1, 2, 3]) {
      const source = version === 2 ? vs.subplots({rows: 1, cols: 2, height: 480}) : vs.figure({height: 480});
      if (version === 3) source.hist([0, 1, 1, 2], {bins: [0, 1, 2]}); else source.scatter([0, 1, 2], [1, 2, 1], {size: 15});
      const buffers = new Map([...source.registry.entries()].map(([id, entry]) => [id, entry.values.buffer.slice(entry.values.byteOffset, entry.values.byteOffset + entry.values.byteLength)]));
      fig.applySnapshot(source.snapshot(), buffers); await fig.ready(); legacy.push({version: fig.spec.protocolVersion, linked: fig.view.linkedResult !== undefined, count: fig.inspect()[0].total}); source.close();
    }
    return {rejected, rolledBack, legacy};
  });
  expect(results).toEqual({rejected: true, rolledBack: true, legacy: [{version: 1, linked: false, count: 3}, {version: 2, linked: false, count: 3}, {version: 3, linked: false, count: 4}]});
  expect((await gpu(page)).ink).toBeGreaterThan(50); expect(errors).toEqual([]);
});
