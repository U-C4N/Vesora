import {test, expect} from '@playwright/test';

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/tests/fixtures/react/harness.html');
  await ready(page);
  return errors;
}
async function ready(page) {
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-state', 'ready');
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-rendering', 'false');
}
async function payload(page) {
  return page.evaluate(async () => {
    const html = await window.reactFixture.exportHTML();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return JSON.parse(parsed.querySelector('#vesora-payload').textContent);
  });
}

test('StrictMode keeps one mounted figure; refresh retains source layers and the canvas', async ({page}) => {
  const errors = await open(page);
  await expect(page.locator('.vesora-figure')).toHaveCount(1);
  const before = await payload(page);
  await page.evaluate(() => {window.originalCanvas = document.querySelector('.vesora-figure canvas');});
  await page.getByRole('button', {name: 'Refresh data'}).click();
  await ready(page);
  const after = await payload(page);
  expect(after.snapshot.figure.layers.map(layer => layer.id)).toEqual(before.snapshot.figure.layers.map(layer => layer.id));
  expect(await page.evaluate(() => window.originalCanvas === document.querySelector('.vesora-figure canvas'))).toBe(true);
  expect(await page.evaluate(() => window.reactFixture.exportPNG())).toBeGreaterThan(1000);
  await page.getByRole('button', {name: 'Toggle mount'}).click();
  await expect(page.locator('.vesora-figure')).toHaveCount(0);
  await page.getByRole('button', {name: 'Toggle mount'}).click();
  await ready(page);
  await expect(page.locator('.vesora-figure')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('theme, accessible legend, resize and API states compose with existing charts', async ({page}) => {
  const errors = await open(page);
  const revenue = page.getByRole('button', {name: 'Revenue', exact: true});
  await revenue.focus();
  await page.keyboard.press('Space');
  await expect(revenue).toHaveAttribute('aria-pressed', 'false');
  await revenue.press('Enter');
  await expect(revenue).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Change theme'}).click();
  await ready(page);
  const dark = await payload(page);
  expect(dark.snapshot.figure.theme.background).not.toBe('#ffffff');
  expect(dark.snapshot.figure.view.xScale).toBe('time');
  expect(dark.snapshot.figure.view.yFormat.kind).toBe('currency');
  await page.getByRole('button', {name: 'Resize card'}).click();
  await expect.poll(() => page.locator('.vesora-figure canvas').first().evaluate(canvas => canvas.clientWidth)).toBe(420);
  await page.getByRole('button', {name: 'Loading', exact: true}).click();
  await expect(page.getByRole('status')).toHaveText('Loading data…');
  await page.getByRole('button', {name: 'Loading', exact: true}).click();
  await page.getByRole('button', {name: 'API error'}).click();
  await expect(page.getByRole('alert')).toContainText('The API is unavailable.');
  await page.getByRole('button', {name: 'API error'}).click();
  await page.getByRole('button', {name: 'Empty data'}).click();
  await expect(page.getByRole('status')).toHaveText('No data available.');
  await page.getByRole('button', {name: 'Restore data'}).click();
  await ready(page);
  expect(errors).toEqual([]);
});

test('real scatter hover supplies a React tooltip and click maps back to an application row', async ({page}) => {
  const errors = await open(page);
  await page.getByRole('button', {name: 'Change type'}).click();
  await ready(page);
  const target = await page.locator('.vesora-figure canvas').first().evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rect = canvas.getBoundingClientRect();
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] < 80 && pixels[i + 1] < 150 && pixels[i + 2] > 180) return {x: rect.left + x / canvas.width * rect.width, y: rect.top + (canvas.height - y - 1) / canvas.height * rect.height};
    }
    throw new Error('No scatter data pixels were rendered.');
  });
  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId('custom-tooltip')).toBeVisible();
  await expect(page.getByTestId('custom-tooltip')).toContainText('TRY');
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId('clicked')).toHaveText(/^[abc]$/);
  await page.mouse.move(10, 10);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('frozen React callbacks and exports own the displayed static rows after live schema replacement',async({page})=>{
  const errors=await open(page);
  await page.getByRole('button',{name:'Change type',exact:true}).click();await ready(page);
  const target=await page.locator('.vesora-figure canvas').first().evaluate(canvas=>{
    const gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4),rect=canvas.getBoundingClientRect();
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(pixels[i]<80&&pixels[i+1]<150&&pixels[i+2]>180)return {x:rect.left+x/canvas.width*rect.width,y:rect.top+(canvas.height-y-1)/canvas.height*rect.height};}
    throw new Error('No scatter data pixels were rendered.');
  });
  await page.mouse.click(target.x,target.y);
  const original=await page.evaluate(()=>window.reactFixture.lastClick());
  expect(original.series.key).toBe('revenue');expect(original.row.id).toMatch(/^[abc]$/);
  const frozen=await page.evaluate(()=>window.reactFixture.freezeInspection());
  await page.evaluate(()=>{window.reactFixture.replaceData([{id:'replacement',timestamp:Date.UTC(2026,10,1),revenue:999,expense:.25,lower:998,upper:1000}]);window.reactFixture.replaceSchema();});
  await expect.poll(()=>page.evaluate(()=>window.reactFixture.getInspectionState().acceptedRevision)).toBeGreaterThan(frozen.acceptedRevision);
  await ready(page);
  await page.mouse.click(target.x,target.y);
  const held=await page.evaluate(()=>window.reactFixture.lastClick());
  expect(held.row).toEqual(original.row);expect(held.series).toEqual(original.series);expect(held.formattedY).toBe(original.formattedY);
  await expect(page.getByRole('button',{name:'Revenue',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'New expense',exact:true})).toHaveCount(0);
  const exports=await page.evaluate(async()=>{
    const read=async source=>JSON.parse(new DOMParser().parseFromString(await window.reactFixture.exportHTML({source}),'text/html').querySelector('#vesora-payload').textContent);
    const displayed=await read('displayed'),accepted=await read('accepted');
    const column=(payload,key)=>{const source=payload.buffers.find(buffer=>buffer.id===payload.snapshot.figure.layers[0].data[key]);return [...new Float64Array(Uint8Array.from(atob(source.base64),c=>c.charCodeAt(0)).buffer)];};
    return {displayedRows:column(displayed,'y'),acceptedRows:column(accepted,'y'),selection:displayed.snapshot.figure.inspection.selection,displayedFormat:displayed.snapshot.figure.view.yFormat.kind,acceptedFormat:accepted.snapshot.figure.view.yFormat.kind};
  });
  expect(exports).toMatchObject({displayedRows:[20,40,30],acceptedRows:[.25],selection:{y:original.event.y},displayedFormat:'currency',acceptedFormat:'percent'});
  await page.evaluate(()=>window.reactFixture.resumeLive());await ready(page);
  await expect(page.getByRole('button',{name:'New expense',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Revenue',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
});

for(const kind of ['empty','nan'])test(`frozen React static view stays visible until the ${kind} replacement frame resumes`,async({page})=>{
  const errors=await open(page),frozen=await page.evaluate(()=>window.reactFixture.freezeInspection());
  await page.evaluate(kind=>window.reactFixture.replaceData(kind==='empty'?[]:[{id:'invalid',timestamp:Date.UTC(2026,10,1),revenue:NaN,expense:NaN,lower:NaN,upper:NaN}]),kind);
  await expect.poll(()=>page.evaluate(()=>window.reactFixture.getInspectionState().acceptedRevision)).toBeGreaterThan(frozen.acceptedRevision);
  await ready(page);await expect(page.locator('[data-vesora-host]')).toBeVisible();
  await expect(page.locator('[data-vesora-chart]')).toContainText('3 rows and 2 series');
  expect(await page.evaluate(()=>window.reactFixture.getInspectionState().displayedRevision)).toBe(frozen.displayedRevision);
  await page.evaluate(()=>window.reactFixture.resumeLive());
  await expect(page.locator('[data-vesora-chart]')).toHaveAttribute('data-vesora-state','empty');
  await expect(page.getByRole('status')).toHaveText('No data available.');
  expect(errors).toEqual([]);
});
