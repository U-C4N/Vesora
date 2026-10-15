import {test,expect} from '@playwright/test';

test('shared viewer keyboard, reduced motion and narrow reflow stay scoped and usable',async({page},testInfo)=>{
  await page.setViewportSize({width:1280,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    const {subplots,figure}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const host=document.querySelector('#chart');host.style.width='100%';document.body.style.padding='12px';
    const scientific=subplots({rows:1,cols:2,kinds:[['3d','2d']],height:340,title:'Scientific observation'});
    const surface=scientific.panel(0,0).surface([0,1,2],[0,1,2],[[0,1,0],[1,2,1],[0,1,0]],{label:'Surface',shading:'smooth',wireframe:true});scientific.panel(0,1).slice(surface,{axis:'y',index:1,label:'Profile'});
    const first=mountViewer(scientific,host);const secondHost=document.createElement('div');secondHost.style.marginTop='16px';host.append(secondHost);
    const signal=figure({title:'Independent signal',height:200});signal.plot([0,1,2],[1,2,1],{label:'Signal'});const second=mountViewer(signal,secondHost,{live:false});
    await Promise.all([scientific.ready(),signal.ready()]);window.qaViewers={scientific,signal,first,second};
  });
  const first=page.locator('[data-vesora-viewer]').first(),second=page.locator('[data-vesora-viewer]').nth(1);
  await expect(first.getByRole('figure',{name:'Scientific observation',exact:true})).toBeVisible();
  expect(await first.ariaSnapshot()).toContain('Plot controls:');
  expect(await first.locator('summary').filter({hasText:/^Inspector$/}).evaluate(node=>node.parentElement.open)).toBe(false);
  await expect(first.locator('.vv-statusbar')).not.toContainText('Frame');
  const reset=first.getByRole('button',{name:'Reset view',exact:true}),freeze=first.getByRole('button',{name:'Freeze view',exact:true});
  await reset.focus();await page.keyboard.press('Tab');await expect(freeze).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(reset).toBeFocused();
  expect(await reset.evaluate(node=>getComputedStyle(node).outlineWidth)).toBe('2px');
  const theme=first.getByRole('button',{name:'Light theme',exact:true});await theme.focus();await page.keyboard.press('Enter');await expect(first).toHaveAttribute('data-theme','light');await expect(second).toHaveAttribute('data-theme','dark');
  const layer=first.locator('button.vv-layer').filter({hasText:'Surface'});await layer.focus();await page.keyboard.press('Space');await expect(layer).toBeFocused();await expect(layer).toHaveAttribute('aria-pressed','false');await page.keyboard.press('Space');await expect(layer).toHaveAttribute('aria-pressed','true');
  await freeze.focus();await page.keyboard.press('Enter');const resume=first.getByRole('button',{name:'Return to live',exact:true});await expect(resume).toBeFocused();await page.keyboard.press('Enter');await expect(freeze).toBeFocused();
  expect(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  expect(await reset.evaluate(node=>getComputedStyle(node).transitionDuration)).toBe('0s');
  await first.screenshot({path:testInfo.outputPath('viewer-1280-light.png')});
  await page.setViewportSize({width:360,height:900});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  expect((await freeze.boundingBox()).height).toBeGreaterThanOrEqual(42);
  await first.screenshot({path:testInfo.outputPath('viewer-360-light.png')});
  await first.getByRole('button',{name:'Dark theme',exact:true}).click();await expect(first).toHaveAttribute('data-theme','dark');
  await first.screenshot({path:testInfo.outputPath('viewer-360-dark.png')});
  // 320 CSS pixels also models the reflow width of a 640px viewport at 200%.
  // This is a reflow check, not a claim that real desktop browser zoom was tested.
  await page.setViewportSize({width:320,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await first.screenshot({path:testInfo.outputPath('viewer-320-reflow.png')});
  await first.locator('summary').filter({hasText:/^Inspector$/}).click();
  await expect(first.getByRole('button',{name:'XY',exact:true})).toBeVisible();
  await first.getByRole('button',{name:'XY',exact:true}).click();
  await first.getByRole('slider',{name:'Surface Y slice',exact:true}).fill('0');
  await testInfo.attach('accessibility-scope',{body:JSON.stringify({keyboard:true,reducedMotion:true,widths:[1280,360,320],themes:['light','dark'],realScreenReader:false,realBrowserZoom:false}),contentType:'application/json'});
  await page.evaluate(()=>{const {scientific,signal,first,second}=window.qaViewers;first.dispose();second.dispose();scientific.close();signal.close();});
});
