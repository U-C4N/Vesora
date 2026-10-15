import {test,expect} from '@playwright/test';

test('pilot surface keeps accepting atomic profiles while its displayed export is frozen',async({page})=>{
  await page.goto('/tests/browser/harness.html');
  const result=await page.evaluate(async()=>{
    const {mountSurfaceLab}=await import('/examples/web/v09-surface-lab.js');
    const {producerLoop}=await import('/examples/web/v09-common.js');
    const {toHTML}=await import('/packages/core/dist/index.js');
    const demo=await mountSurfaceLab(document.querySelector('#chart')),fig=demo.figure;
    let ticks=0,stop;const errors=[];
    const capture=source=>{const lease=fig.captureExport(source);try{
      return {snapshot:lease.snapshot,data:Object.fromEntries(Array.from(lease.registry.entries(),([id,entry])=>[id,Array.from(entry.values)]))};
    }finally{lease.release();}};
    try{
      const initial=fig.freezeInspection(),before=capture('displayed');
      await new Promise(resolve=>{stop=producerLoop(()=>{demo.advance(++ticks*.12);if(ticks===2){stop();resolve();}},1000,error=>{errors.push(error.message);resolve();});});
      const after=fig.getInspectionState(),held=capture('displayed'),live=capture('accepted');
      const surface=live.snapshot.figure.layers.find(layer=>layer.kind==='surface');
      const z=live.data[surface.data.z],width=live.data[surface.data.x].length,height=live.data[surface.data.y].length;
      const profiles=live.snapshot.figure.slices.map(slice=>{
        const layer=live.snapshot.figure.layers.find(layer=>layer.id===slice.targetLayerId);
        const expected=slice.axis==='x'?Array.from({length:height},(_,row)=>z[row*width+slice.index]):z.slice(slice.index*width,(slice.index+1)*width);
        return {actual:live.data[layer.data.y],expected};
      });
      const html=toHTML(fig,{source:'displayed'}),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('#vesora-payload').textContent);
      await fig.resumeLive();const resumed=fig.getInspectionState();
      return {initial,after,resumed,unchanged:JSON.stringify(before)===JSON.stringify(held),
        sourceChanged:JSON.stringify(before.data[surface.data.z])!==JSON.stringify(z),
        scalarUnchanged:JSON.stringify(before.data[surface.data.color])===JSON.stringify(live.data[surface.data.color]),profiles,payload,ticks,errors};
    }finally{stop?.();demo.dispose();}
  });
  expect(result.errors).toEqual([]);expect(result.ticks).toBe(2);
  expect(result.after.acceptedRevision).toBe(result.initial.acceptedRevision+2);
  expect(result.after.frameId).toBe(result.initial.frameId);expect(result.unchanged).toBe(true);
  expect(result.sourceChanged).toBe(true);expect(result.scalarUnchanged).toBe(true);
  for(const profile of result.profiles)expect(profile.actual).toEqual(profile.expected);
  expect(result.payload.capture.snapshotId).toBe(result.initial.snapshotId);
  expect(result.resumed.displayedRevision).toBeGreaterThanOrEqual(result.after.acceptedRevision);
  await expect(page.locator('[data-vesora-viewer]')).toHaveCount(0);
});

test('v0.9 reference studies mount, switch, freeze and save retained evidence',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/examples/web/v09.html');
  await expect(page.locator('[data-vesora-viewer]')).toHaveCount(1);await expect(page.locator('.demo-status')).toContainText('65 × 49');
  await page.getByRole('slider',{name:'x slice index'}).fill('8');await expect(page.locator('.demo-controls output').first()).toContainText('x[8]');
  await page.getByRole('button',{name:'02 · Trajectory · Labs',exact:true}).click();await expect(page.locator('.demo-status')).toContainText('acquired');
  await page.getByRole('button',{name:'Freeze inspection',exact:true}).click();await expect(page.getByRole('button',{name:'Resume inspection',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Pin A',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save A HTML',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('vesora-a.html');await download.cancel();
  await page.getByRole('button',{name:'03 · Rolling field · Labs',exact:true}).click();await expect(page.locator('.demo-status')).toContainText('64');await expect(page.locator('[data-vesora-viewer]')).toHaveCount(1);
  await page.getByRole('button',{name:'Freeze inspection',exact:true}).click();await expect(page.locator('.demo-status')).toContainText('Frozen inspection');await page.getByRole('button',{name:'Resume inspection',exact:true}).click();await expect(page.locator('.demo-status')).toContainText('Live inspection');
  await page.getByRole('button',{name:'01 · Surface + slices',exact:true}).click();await expect(page.locator('.demo-status')).toContainText('65 × 49');expect(errors).toEqual([]);
});
