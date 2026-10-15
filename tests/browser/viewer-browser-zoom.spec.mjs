import {test,expect,chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';

test('actual automatic Chromium browser zoom at 200 percent preserves viewer controls and reflow',async({},testInfo)=>{
  const extension=resolve('tests/fixtures/viewer-zoom-extension');
  const context=await chromium.launchPersistentContext('',{channel:'chromium',executablePath:chromium.executablePath(),headless:true,timeout:15000,viewport:null,baseURL:testInfo.project.use.baseURL,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--window-size=1440,1000','--force-device-scale-factor=1','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:10000});
    const page=await context.newPage();await page.goto('/tests/browser/harness.html');
    await page.evaluate(async()=>{
      const {subplots}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
      document.querySelector('#chart').style.width='100%';document.body.style.padding='12px';
      const fig=subplots({rows:1,cols:2,kinds:[['3d','2d']],height:340,title:'Browser zoom verification'});
      const surface=fig.panel(0,0).surface([0,1,2],[0,1,2],[[0,1,0],[1,2,1],[0,1,0]],{label:'Surface',shading:'smooth'});fig.panel(0,1).slice(surface,{axis:'y',index:1,label:'Profile'});
      const viewer=mountViewer(fig,document.querySelector('#chart'));await fig.ready();window.zoomFixture={fig,viewer};
    });
    const measure=()=>page.evaluate(()=>({innerWidth,outerWidth,devicePixelRatio,visualViewportScale:visualViewport.scale,documentWidth:document.documentElement.scrollWidth,cssZoom:getComputedStyle(document.documentElement).zoom}));
    const before=await measure();
    const zoom=await worker.evaluate(async()=>{
      const [tab]=await chrome.tabs.query({url:'http://127.0.0.1:4173/tests/browser/harness.html'});if(!tab?.id)throw new Error('Local test tab not found');
      await chrome.tabs.setZoomSettings(tab.id,{mode:'automatic',scope:'per-tab'});await chrome.tabs.setZoom(tab.id,2);
      return {factor:await chrome.tabs.getZoom(tab.id),settings:await chrome.tabs.getZoomSettings(tab.id)};
    });
    expect(zoom.factor).toBe(2);expect(zoom.settings.mode).toBe('automatic');
    await expect.poll(async()=>(await measure()).devicePixelRatio).toBeCloseTo(before.devicePixelRatio*2,4);
    await expect.poll(async()=>(await measure()).innerWidth).toBeLessThanOrEqual(Math.ceil(before.innerWidth/2));
    const after=await measure();expect(after.visualViewportScale).toBe(1);expect(after.cssZoom).toBe('1');expect(after.outerWidth).toBe(before.outerWidth);expect(after.documentWidth).toBeLessThanOrEqual(after.innerWidth);
    const viewer=page.locator('[data-vesora-viewer]'),reset=viewer.getByRole('button',{name:'Reset view',exact:true}),freeze=viewer.getByRole('button',{name:'Freeze view',exact:true});
    await reset.focus();await page.keyboard.press('Tab');await expect(freeze).toBeFocused();await page.keyboard.press('Enter');
    await expect(viewer.getByRole('button',{name:'Return to live',exact:true})).toBeFocused();await page.keyboard.press('Enter');
    // Locator screenshot clipping is not browser-zoom aware. Capture the browser's
    // actual viewport without a CSS-pixel clip, then scroll to the second state.
    const cdp=await context.newCDPSession(page),screenshots=[];
    const captureViewport=async(name)=>{const {data}=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const png=Buffer.from(data,'base64');const dimensions={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};expect(dimensions.width).toBeGreaterThanOrEqual(after.innerWidth*after.devicePixelRatio);await writeFile(testInfo.outputPath(name),png);screenshots.push({name,...dimensions,method:'CDP Page.captureScreenshot without clip'});};
    await page.evaluate(()=>scrollTo(0,0));await captureViewport('browser-zoom-200-dark.png');
    await viewer.getByRole('button',{name:'Light theme',exact:true}).click();await viewer.locator('summary').filter({hasText:/^Inspector$/}).click();
    await viewer.getByRole('button',{name:'XY',exact:true}).click();await viewer.getByRole('slider',{name:'Surface Y slice',exact:true}).fill('0');
    await page.evaluate(()=>window.zoomFixture.fig.ready({target:'displayed'}));await viewer.getByRole('button',{name:'Focus selection',exact:true}).scrollIntoViewIfNeeded();await captureViewport('browser-zoom-200-light-inspector.png');
    const core=await readFile('packages/core/dist/index.js'),chrome=await readFile('packages/core/dist/viewer.js');
    await writeFile(testInfo.outputPath('evidence.json'),JSON.stringify({status:'passed',method:'chrome.tabs.setZoom, automatic browser handling, per-tab scope',headless:true,browser:context.browser().version(),zoom,before,after,screenshots,realBrowserZoom:true,realScreenReader:false,buildSha256:{core:createHash('sha256').update(core).digest('hex'),viewer:createHash('sha256').update(chrome).digest('hex')},sources:['https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom','https://developer.chrome.com/docs/extensions/reference/api/tabs#type-ZoomSettingsMode','https://playwright.dev/docs/chrome-extensions']},null,2));
  }finally{await context.close();}
});
