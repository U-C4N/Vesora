import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('Studio and Embed reflow by card width and preserve a frozen view across chrome updates',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    const {subplots,figure}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const host=document.querySelector('#chart');host.style.width='100%';
    const card=document.createElement('div');card.id='narrow-card';card.style.width='320px';host.append(card);
    const fig=subplots({rows:1,cols:2,height:260,title:'Embedded experiment'});fig.panel(0,0).plot([0,1,2],[1,2,3]);fig.panel(0,1).plot([0,1,2],[3,2,1]);
    const viewer=mountViewer(fig,card,{mode:'embed',chrome:{inspector:true}});
    const wide=document.createElement('div');wide.id='wide-card';wide.style.width='1000px';host.append(wide);
    const peer=figure({title:'Independent studio',height:260});peer.plot([0,1,2],[1,2,3]);const peerViewer=mountViewer(peer,wide);
    await Promise.all([fig.ready(),peer.ready()]);window.embedCase={fig,viewer,peer,peerViewer};
  });
  const card=page.locator('#narrow-card'),viewer=card.locator('[data-vesora-viewer]');
  await expect.poll(()=>viewer.locator('.vv-body').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1);
  expect(await viewer.locator('.vv-plot').evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(300);
  expect(await card.evaluate(node=>node.scrollWidth)).toBeLessThanOrEqual(320);
  await expect.poll(()=>page.evaluate(()=>{const lease=window.embedCase.fig.captureExport('displayed');try{return lease.snapshot.figure.layout.cols;}finally{lease.release();}})).toBe(1);
  expect(await page.locator('#wide-card .vv-body').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
  await viewer.getByRole('button',{name:'Freeze view',exact:true}).focus();await page.keyboard.press('Enter');
  const frozen=await page.evaluate(()=>{const {fig}=window.embedCase;return {mode:fig.getInspectionState().mode,snapshot:fig.getInspectionSnapshot()};});
  await page.evaluate(()=>window.embedCase.viewer.updateOptions({mode:'studio',chrome:{inspector:false},themeTokens:{accent:'#79b7ff'}}));
  await expect(viewer).toHaveAttribute('data-inspector','hidden');
  expect(await viewer.locator('.vv-plot').evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThan(300);
  expect(await page.evaluate(()=>window.embedCase.fig.getInspectionState().mode)).toBe(frozen.mode);
  expect(await page.evaluate(()=>window.embedCase.fig.getInspectionSnapshot().sources)).toEqual(frozen.snapshot.sources);
  await expect(page.locator('#wide-card .vv-status')).toHaveText('Ready');
  await page.evaluate(()=>{const {fig,viewer,peer,peerViewer}=window.embedCase;viewer.dispose();peerViewer.dispose();fig.close();peer.close();});
});

test('viewer exports the selected source and observation record using the matching frozen semantics',async({page})=>{
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const fig=figure({title:'Temperature source choice',height:300}),line=fig.plot([0,1,2],[298,299,300],{label:'Temperature'});
    line.enableStreaming({maxPoints:8});line.setSemantics({x:{name:'Elapsed time',unit:'s'},y:{name:'Original calibration',unit:'K'}});
    const viewer=mountViewer(fig,document.querySelector('#chart'),{observation:true});await fig.ready();fig.freezeInspection();
    await fig.appendDataBatch([{layer:line,data:{x:[3,4],y:[301,302]}}],{waitFor:'accepted'});
    line.setSemantics({y:{name:'Latest calibration',unit:'K'}});window.exportCase={fig,line,viewer};
  });
  const viewer=page.locator('[data-vesora-viewer]');
  await viewer.locator('summary').filter({hasText:'Data meaning'}).click();
  await expect(viewer.locator('.vv-semantics')).toContainText('Original calibration');
  await expect(viewer.locator('.vv-semantics')).not.toContainText('Latest calibration');
  await viewer.locator('summary').filter({hasText:'Export options'}).click();
  for(const source of ['displayed','accepted']){
    await viewer.getByRole('combobox',{name:'Export source',exact:true}).selectOption(source);
    const promised=page.waitForEvent('download');await viewer.getByRole('button',{name:'Export HTML',exact:true}).click();
    const download=await promised;expect(await download.failure()).toBeNull();
    const html=await readFile(await download.path(),'utf8'),payload=JSON.parse(html.match(/<script[^>]*id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
    expect(payload.capture.source).toBe(source);expect(payload.snapshot.figure.observation.source).toBe(source);
    expect(payload.snapshot.figure.observation.representation.status).toBe(source==='displayed'?'rendered':'not-evaluated');
    const y=payload.snapshot.figure.layers[0].data.y;
    expect(payload.snapshot.figure.semantics.sources[y].name).toBe(source==='displayed'?'Original calibration':'Latest calibration');
    expect(payload.snapshot.sources.find(item=>item.id===y).shape[0]).toBe(source==='displayed'?3:5);
    await expect(viewer.getByRole('status')).toContainText('Frozen snapshot');
  }
  await page.evaluate(()=>{const {fig,viewer}=window.exportCase;viewer.dispose();fig.close();});
});
