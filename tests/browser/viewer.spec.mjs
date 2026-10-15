import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('surface omission counts follow displayed geometry and distinguish triangles from vertices',async({page})=>{
  await page.goto('/tests/browser/harness.html');
  const initial=await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const fig=figure({kind:'3d'}),surface=fig.surface([0,1],[0,1],[[0,1],[1,0]],{values:[[NaN,2],[3,4]],label:'Temperature'});
    const viewer=mountViewer(fig,document.querySelector('#chart'),{inspector:true});await fig.ready();window.omissionFixture={fig,surface,viewer};return fig.inspect()[0];
  });
  expect(initial).toMatchObject({total:4,totalTriangles:2,omittedTriangles:2,rendered:0});
  const notice=page.getByText('Temperature: 2 / 2 triangles omitted because coordinates or scalar values are not finite.',{exact:true});
  await expect(notice).toBeVisible();
  await page.evaluate(async()=>{const {fig,surface}=window.omissionFixture;surface.setData({color:[[1,2],[3,4]]});await fig.ready();fig.freezeInspection();surface.setData({color:[[NaN,2],[3,4]]});});
  await expect(notice).toHaveCount(0);
  const resumed=await page.evaluate(async()=>{const {fig}=window.omissionFixture;await fig.resumeLive();return fig.inspect()[0];});
  expect(resumed.omittedTriangles).toBe(2);await expect(notice).toBeVisible();
  await page.evaluate(()=>{window.omissionFixture.viewer.dispose();window.omissionFixture.fig.close();});
});
test('shared viewer freezes inspection while accepted telemetry advances and preserves application ownership',async({page})=>{
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/index.js');const {mountViewer}=await import('/packages/core/dist/viewer.js');
    const fig=figure({title:'Viewer telemetry',height:320});const line=fig.plot([0,1,2],[0,1,0],{label:'Signal'}).enableStreaming({maxPoints:3});fig.setHoverMode('x');
    const viewer=mountViewer(fig,document.querySelector('#chart'));await fig.ready();window.viewerFixture={fig,line,viewer};
  });
  await page.getByRole('button',{name:'Freeze view',exact:true}).click();
  await page.evaluate(async()=>{const {line}=window.viewerFixture;await line.appendData({x:[3,4,5],y:[1,0,1]},{waitFor:'accepted'});});
  const state=await page.evaluate(()=>{const {fig,line}=window.viewerFixture;return {inspection:fig.getInspectionState(),live:fig.getStreamingState(line.id),shown:fig.getDisplayedStreamingState(line.id)};});
  expect(state.inspection.mode).toBe('frozen');expect(state.live.nextSequence).toBe(6);expect(state.shown.nextSequence).toBe(3);
  await expect(page.getByRole('status')).toContainText('Frozen snapshot');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();expect(await(await download).failure()).toBeNull();
  await page.getByRole('button',{name:'Return to live',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.viewerFixture.fig.getDisplayedStreamingState(window.viewerFixture.line.id)?.nextSequence)).toBe(6);
  const retained=await page.evaluate(async()=>{const {fig,viewer}=window.viewerFixture;viewer.dispose();const count=fig.registry.get(fig.spec.layers[0].data.x).values.length;fig.mount(document.querySelector('#chart'));await fig.ready();return count;});expect(retained).toBe(3);
});

test('protocol 7 offline figures reuse the viewer with camera controls and no live producer',async({page,context})=>{
  await page.goto('/tests/browser/harness.html');
  const html=await page.evaluate(async()=>{
    const {figure,toHTML}=await import('/packages/core/dist/index.js');const fig=figure({kind:'3d',title:'Surface snapshot'});fig.surface([0,1,2],[0,1,2],[[0,1,0],[1,2,1],[0,1,0]],{shading:'smooth',label:'Surface'});const html=toHTML(fig);fig.close();return html;
  });
  await context.setOffline(true);await page.goto(`data:text/html,${encodeURIComponent(html)}`);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await expect(page.locator('[data-vesora-viewer]')).toBeVisible();
  await expect(page.getByRole('button',{name:'Freeze view',exact:true})).toBeHidden();
  await page.locator('summary').filter({hasText:/^Inspector$/}).click();
  await page.getByRole('button',{name:'XY',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download PNG',exact:true}).click();expect(await(await download).failure()).toBeNull();
  await expect(page.locator('#vesora-error')).toBeHidden();
});

test('narrow shared viewer stacks mixed panels and exports the displayed arrangement without changing the source layout',async({page})=>{
  await page.setViewportSize({width:360,height:900});await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    const {subplots}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const host=document.querySelector('#chart');host.style.width='100%';
    const fig=subplots({rows:1,cols:2,kinds:[['3d','2d']],height:320,title:'Mixed scientific capture'});
    const surface=fig.panel(0,0).surface([0,1],[0,1],[[0,1],[1,0]],{label:'Surface',shading:'smooth'});fig.panel(0,1).slice(surface,{axis:'y',index:0,label:'Profile'});
    const viewer=mountViewer(fig,host);await fig.ready();window.responsiveFixture={fig,viewer};
  });
  await expect(page.getByRole('button',{name:'Freeze view',exact:true})).toBeVisible();
  const result=await page.evaluate(async()=>{
    const {fig}=window.responsiveFixture,lease=fig.captureExport('displayed'),snapshot=lease.snapshot;lease.release();
    const blob=await fig.savefig({source:'displayed'}),bitmap=await createImageBitmap(blob),png={width:bitmap.width,height:bitmap.height};bitmap.close();
    const plot=document.querySelector('.vesora-figure');return {source:fig.spec.layout,shown:snapshot.figure.layout,panels:snapshot.figure.panels.map(({id,row,col})=>({id,row,col})),width:snapshot.figure.width,height:snapshot.figure.height,png,scrollWidth:plot.scrollWidth,clientWidth:plot.clientWidth,pageWidth:document.documentElement.scrollWidth};
  });
  expect(result.source).toMatchObject({rows:1,cols:2});expect(result.shown).toMatchObject({rows:2,cols:1});
  expect(result.panels).toEqual([{id:'main',row:0,col:0},{id:'panel-0-1',row:1,col:0}]);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth);expect(result.pageWidth).toBeLessThanOrEqual(360);expect(result.png).toEqual({width:result.width,height:result.height});
  await page.getByRole('button',{name:'Freeze view',exact:true}).click();await page.setViewportSize({width:1200,height:900});
  await expect.poll(()=>page.evaluate(()=>{const lease=window.responsiveFixture.fig.captureExport('displayed');try{return lease.snapshot.figure.layout.cols;}finally{lease.release();}})).toBe(2);
  await page.evaluate(()=>{window.responsiveFixture.viewer.dispose();window.responsiveFixture.fig.close();});
});

test('clicked frozen scientific identity survives viewer PNG and HTML exports and offline reopening',async({page,context})=>{
  await page.goto('/tests/browser/harness.html');
  const location=await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const fig=figure({kind:'3d',height:360,title:'Identity roundtrip'});fig.surface([0,1,2],[0,1,2],[[0,1,0],[1,2,1],[0,1,0]],{label:'Measured field',shading:'smooth'});fig.setCameraPreset('xy');
    const viewer=mountViewer(fig,document.querySelector('#chart'));await fig.ready();
    window.identityFixture={fig,viewer};fig.on('click',hit=>{window.identityFixture.hit=hit;});
    const plot=fig.view.panels[0].rect,canvas=viewer.element.querySelectorAll('.vesora-figure canvas')[1].getBoundingClientRect();
    return {x:canvas.left+plot.left+plot.width*.55,y:canvas.top+plot.top+plot.height*.45};
  });
  await page.mouse.click(location.x,location.y);
  await expect.poll(()=>page.evaluate(()=>window.identityFixture.hit?.kind)).toBe('surface');
  await page.mouse.move(2,2);
  await expect(page.locator('.vv-inspection').first()).toContainText('Selected interpolated value');
  await page.getByRole('button',{name:'Freeze view',exact:true}).click();
  const identity=await page.evaluate(()=>window.identityFixture.hit);
  await expect(page.locator('.vv-inspection').first()).toContainText(`Cell row, column: ${identity.cell.join(', ')}`);
  const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();expect(await(await pngDownload).failure()).toBeNull();
  const htmlDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export HTML',exact:true}).click();const file=await htmlDownload;expect(await file.failure()).toBeNull();
  const html=await readFile(await file.path(),'utf8');
  await context.setOffline(true);await page.goto(`data:text/html,${encodeURIComponent(html)}`);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  const inspector=page.locator('.vv-inspection').first();
  await expect(inspector).toContainText('Selected interpolated value');await expect(inspector).toContainText(`Cell row, column: ${identity.cell.join(', ')}`);await expect(inspector).toContainText(`Triangle: ${identity.triangle}`);await expect(inspector).toContainText(`x: ${String(identity.x)}`);await expect(inspector).toContainText(`value: ${String(identity.value)}`);
  await expect(page.locator('[data-vesora-viewer]')).toContainText('Captured ');await expect(page.locator('[data-vesora-viewer]')).toContainText('Source frame ');
});
