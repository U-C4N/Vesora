import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {figure,subplots,toHTML} from '../../packages/core/dist/index.js';

const themes=[
  {name:'default',background:'#101215',chrome:'dark'},
  {name:'dark',theme:'dark',background:'#0f172a',chrome:'dark'},
  {name:'light',theme:'light',background:'#ffffff',chrome:'light'},
  {name:'custom',theme:{background:'#2b1834',foreground:'#f5eafa',muted:'#d4bfdc',grid:'#684774',axis:'#a17aad'},background:'#2b1834',chrome:'dark'},
];
const rgb=hex=>`rgb(${hex.slice(1).match(/../g).map(value=>parseInt(value,16)).join(', ')})`;

async function appearance(locator){
  return locator.evaluate(element=>{
    const style=getComputedStyle(element);
    const channels=color=>color.match(/[\d.]+/g).map(Number);
    let ancestor=element,background;
    while(ancestor){const value=getComputedStyle(ancestor).backgroundColor,parts=channels(value);if(parts.length===3||parts[3]===1){background=value;break;}ancestor=ancestor.parentElement;}
    if(!background)throw new Error('No opaque background behind visible text');
    const luminance=color=>channels(color).slice(0,3).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
    return {text:element.textContent.trim(),foreground:style.color,background,contrast:contrast(style.color,background),colorScheme:style.colorScheme,outlineColor:style.outlineColor,outlineWidth:parseFloat(style.outlineWidth),outlineStyle:style.outlineStyle,focusVisible:element.matches(':focus-visible'),outlineContrast:contrast(style.outlineColor,background)};
  });
}

async function canvasPixels(page){
  return page.locator('.vesora-figure canvas').first().evaluate(canvas=>{
    const gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let hash=2166136261;for(const value of pixels)hash=Math.imul(hash^value,16777619);
    return {hash:hash>>>0,width:canvas.width,height:canvas.height,error:gl.getError()};
  });
}

for(const entry of themes)test(`protocol 7 ${entry.name} offline wrapper keeps text and controls readable through chrome theme changes`,async({page,context},testInfo)=>{
  const fig=subplots({rows:1,cols:2,kinds:[['3d','2d']],width:900,height:360,title:'Saved scientific colors',...(entry.theme?{theme:entry.theme}:{})});
  const surface=fig.panel(0,0).surface([0,1,2],[0,1,2],[[0,1,0],[1,2,1],[0,1,0]],{values:[[10,20,30],[40,50,60],[70,80,90]],label:'Scalar measurements',colorbarLabel:'Value'});
  fig.panel(0,1).slice(surface,{axis:'y',index:1,label:'Measured row'});
  const html=toHTML(fig),saved=JSON.parse(html.match(/<script[^>]*id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
  expect(saved.capture.source).toBe('accepted');expect(saved.snapshot.figure.inspection).toBeUndefined();
  const path=testInfo.outputPath('figure.html');await mkdir(dirname(path),{recursive:true});await writeFile(path,html);fig.close();
  const requests=[],errors=[];page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});page.on('pageerror',error=>errors.push(error.message));
  await context.setOffline(true);await page.setViewportSize({width:1600,height:1050});await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await expect(page.locator('#vesora-legacy-style')).toHaveCount(0);
  const viewer=page.locator('[data-vesora-viewer]'),note=page.locator('#vesora-offline-note'),reset=page.getByRole('button',{name:'Reset view',exact:true});
  await expect(viewer).toHaveAttribute('data-theme',entry.chrome);await expect(note).toContainText('No live producer is connected.');
  await expect(note).toBeVisible();await expect(note).toContainText(`Captured ${saved.capture.capturedAt}`);
  expect(await note.evaluate(element=>!!element.closest('[data-vesora-viewer]'))).toBe(true);
  await page.locator('summary').filter({hasText:/^Inspector$/}).click();
  const sourcePixels=await canvasPixels(page),payloadBefore=await page.locator('#vesora-payload').textContent(),measurements=[];
  for(const theme of [entry.chrome,entry.chrome==='dark'?'light':'dark']){
    if(theme!==entry.chrome)await page.getByRole('button',{name:theme==='dark'?'Dark theme':'Light theme',exact:true}).click();
    await expect(viewer).toHaveAttribute('data-theme',theme);
    for(const selector of ['.vv-title','.vv-help','.vv-status','summary','.vv-layer','.vv-field','.vv-inspection','button:not(:disabled)','select']){
      for(const element of await viewer.locator(selector).all())if(await element.isVisible()){
        const result=await appearance(element);expect(result.contrast,`${theme} ${selector}: ${JSON.stringify(result)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    await page.mouse.move(0,0);measurements.push({theme,state:'normal',...await appearance(reset)});
    await reset.hover();measurements.push({theme,state:'hover',...await appearance(reset)});
    await page.mouse.down();try{measurements.push({theme,state:'active',...await appearance(reset)});}finally{await page.mouse.up();}
    await reset.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
    const focus=await appearance(reset);expect(focus.focusVisible).toBe(true);expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);expect(focus.outlineContrast).toBeGreaterThanOrEqual(3);measurements.push({theme,state:'focus',...focus});
    for(const control of [page.getByRole('combobox',{name:'3D panel'}),page.getByRole('slider',{name:/Y slice$/})]){
      await control.focus();expect(await control.evaluate(element=>getComputedStyle(element).colorScheme)).toBe(theme);
    }
    const pageStyles=await page.evaluate(()=>({html:getComputedStyle(document.documentElement).backgroundColor,body:getComputedStyle(document.body).backgroundColor,bodyMargin:getComputedStyle(document.body).margin,meta:document.querySelector('meta[name="color-scheme"]').content,rootWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
    expect(pageStyles.html).toBe(rgb(entry.background));expect(pageStyles.body).toBe(rgb(entry.background));expect(pageStyles.bodyMargin).toBe('0px');expect(pageStyles.meta).toBe(entry.chrome);expect(pageStyles.rootWidth).toBeLessThanOrEqual(pageStyles.viewport);
    expect(await canvasPixels(page)).toEqual(sourcePixels);expect(await page.locator('#vesora-payload').textContent()).toBe(payloadBefore);
    await page.screenshot({path:testInfo.outputPath(`${theme}-chrome.png`),fullPage:true});
    measurements.push({theme,state:'caption',...await appearance(note)});
  }
  for(const result of measurements)expect(result.contrast,JSON.stringify(result)).toBeGreaterThanOrEqual(4.5);
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Download PNG',exact:true}).click();const download=await downloadPromise;expect(await download.failure()).toBeNull();await download.saveAs(testInfo.outputPath('saved-colors.png'));
  expect(requests).toEqual([]);expect(errors).toEqual([]);await expect(page.locator('#vesora-error')).toBeHidden();
  await page.reload();await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');await expect(page.locator('#vesora-offline-note')).toContainText(`Captured ${saved.capture.capturedAt}`);
  const colorsPath=testInfo.outputPath('offline-wrapper-colors.json');await writeFile(colorsPath,JSON.stringify({entry,measurements,sourcePixels,externalRequests:requests,errors},null,2)+'\n');
  await testInfo.attach('offline-wrapper-colors',{path:colorsPath,contentType:'application/json'});
});

test('offline caption preserves the frozen capture time instead of export or reopening time',async({page,context},testInfo)=>{
  await page.goto('/tests/browser/harness.html');
  const exported=await page.evaluate(async()=>{
    const {figure,toHTML}=await import('/packages/core/dist/index.js'),fig=figure({kind:'3d'});
    fig.surface([0,1],[0,1],[[0,1],[1,0]],{values:[[10,20],[30,40]]});fig.mount(document.querySelector('#chart'));await fig.ready();
    const frozen=fig.freezeInspection();await new Promise(resolve=>setTimeout(resolve,20));
    const html=toHTML(fig,{source:'displayed'});fig.close();return {html,capturedAt:frozen.capturedAt};
  });
  const saved=JSON.parse(exported.html.match(/<script[^>]*id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
  expect(saved.capture.source).toBe('displayed');expect(saved.capture.capturedAt).not.toBe(exported.capturedAt);expect(saved.snapshot.figure.inspection.capturedAt).toBe(exported.capturedAt);
  const path=testInfo.outputPath('frozen.html');await mkdir(dirname(path),{recursive:true});await writeFile(path,exported.html);
  await context.setOffline(true);await page.goto(pathToFileURL(path).href);
  for(let reopen=0;reopen<2;reopen++){
    if(reopen)await page.reload();await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
    const note=page.locator('#vesora-offline-note');await expect(note).toBeVisible();await expect(note).toContainText(`Captured ${exported.capturedAt}`);await expect(note).not.toContainText(saved.capture.capturedAt);
  }
});

test('optional missing or invalid export capture metadata does not invent an offline capture time',async({page,context},testInfo)=>{
  const fig=figure({kind:'3d'});fig.surface([0,1],[0,1],[[0,1],[1,0]],{values:[[10,20],[30,40]]});const html=toHTML(fig);fig.close();await context.setOffline(true);
  for(const [name,capture]of [['missing',undefined],['invalid',{source:'accepted',capturedAt:'not a date'}]]){
    const edited=html.replace(/(<script[^>]*id="vesora-payload"[^>]*>)([\s\S]*?)(<\/script>)/,(_,start,json,end)=>{const payload=JSON.parse(json);payload.capture=capture;return start+JSON.stringify(payload)+end;});
    const path=testInfo.outputPath(`${name}.html`);await mkdir(dirname(path),{recursive:true});await writeFile(path,edited);await page.goto(pathToFileURL(path).href);
    await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');await expect(page.locator('#vesora-offline-note')).toHaveText('Offline snapshot · The retained source data is included. No live producer is connected.');
  }
});

test('an accepted re-export of updated imported data uses its own export time',async({page,context},testInfo)=>{
  await page.goto('/tests/browser/harness.html');
  const point=await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/index.js'),original=figure({kind:'3d'});
    original.surface([0,1],[0,1],[[0,1],[1,0]],{values:[[10,20],[30,40]]});original.setCameraPreset('xy');original.mount(document.querySelector('#chart'));await original.ready();window.reexportOriginal=original;
    const rect=original.view.panels[0].rect,canvas=document.querySelectorAll('.vesora-figure canvas')[1].getBoundingClientRect();return {x:canvas.left+rect.left+rect.width*.53,y:canvas.top+rect.top+rect.height*.47};
  });
  await page.mouse.click(point.x,point.y);await expect.poll(()=>page.evaluate(()=>window.reexportOriginal.getInspectionSelection()?.kind)).toBe('surface');
  const exported=await page.evaluate(async()=>{
    const {figure,toHTML}=await import('/packages/core/dist/index.js'),original=window.reexportOriginal;
    const frozen=original.freezeInspection(),lease=original.captureExport('displayed'),imported=figure();
    const originalHTML=toHTML(original,{source:'displayed'});
    try{const buffers=new Map([...lease.registry.entries()].map(([id,entry])=>[id,entry.values.slice().buffer]));imported.applySnapshot(lease.snapshot,buffers);}finally{lease.release();original.close();}
    imported.updateData(imported.spec.layers[0],{z:[[100,200],[300,400]]});await new Promise(resolve=>setTimeout(resolve,20));
    const html=toHTML(imported,{source:'accepted'});imported.close();return {html,originalHTML,originalCapturedAt:frozen.capturedAt};
  });
  const saved=JSON.parse(exported.html.match(/<script[^>]*id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);expect(saved.capture.source).toBe('accepted');expect(saved.capture.capturedAt).not.toBe(exported.originalCapturedAt);
  expect(saved.snapshot.figure.inspection).toBeUndefined();
  const original=JSON.parse(exported.originalHTML.match(/<script[^>]*id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);expect(original.snapshot.figure.inspection.capturedAt).toBe(exported.originalCapturedAt);expect(original.snapshot.figure.inspection.selection.kind).toBe('surface');
  const path=testInfo.outputPath('accepted-reexport.html');await mkdir(dirname(path),{recursive:true});await writeFile(path,exported.html);
  await context.setOffline(true);await page.goto(pathToFileURL(path).href);await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  const note=page.locator('#vesora-offline-note');await expect(note).toContainText(`Captured ${saved.capture.capturedAt}`);await expect(note).not.toContainText(exported.originalCapturedAt);
  await page.locator('summary').filter({hasText:/^Inspector$/}).click();await expect(page.locator('.vv-inspection').first()).toContainText('Select or hover a sample');await expect(page.locator('.vv-inspection').first()).not.toContainText('Selected interpolated value');
});

test('protocols 1 through 6 keep their existing standalone document stylesheet and controls',async({page,context},testInfo)=>{
  await context.setOffline(true);
  for(const version of [1,2,3,4,5,6]){
    const fig=figure({width:640,height:360,title:`Legacy protocol ${version}`});fig.plot([0,1,2],[0,1,0]);
    // The same minimal line scene is valid in each supported legacy envelope.
    fig.spec.protocolVersion=version;const path=testInfo.outputPath(`legacy-${version}.html`);await mkdir(dirname(path),{recursive:true});await writeFile(path,toHTML(fig));fig.close();
    await page.goto(pathToFileURL(path).href);await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
    await expect(page.locator('#vesora-legacy-style')).toHaveCount(1);await expect(page.locator('[data-vesora-viewer]')).toHaveCount(0);await expect(page.locator('#vesora-offline-note')).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Download PNG',exact:true})).toBeEnabled();await expect(page.locator('#vesora-error')).toBeHidden();
    expect(await page.locator('html').evaluate(element=>getComputedStyle(element).backgroundColor)).toBe('rgb(244, 242, 236)');
    const reset=page.getByRole('button',{name:'Reset view',exact:true});await reset.hover();expect((await appearance(reset)).background).toBe('rgb(244, 246, 255)');
  }
});

test('protocol 7 capability errors remain visible and readable without the legacy stylesheet',async({page,context},testInfo)=>{
  const fig=figure({kind:'3d',theme:'dark'});fig.surface([0,1],[0,1],[[0,1],[1,0]],{values:[[10,20],[30,40]]});
  const path=testInfo.outputPath('unsupported.html');await mkdir(dirname(path),{recursive:true});await writeFile(path,toHTML(fig));fig.close();
  await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};});
  await context.setOffline(true);await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','error');
  const error=page.locator('#vesora-error');await expect(error).toBeVisible();await expect(error).toContainText('WebGL2');
  expect((await appearance(error)).contrast).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({path:testInfo.outputPath('capability-error.png'),fullPage:true});
});
