import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {viewerBuildFingerprint} from '../../scripts/viewer-build-fingerprint.mjs';

export async function mountScientificViewer(page,theme='dark'){
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async(theme)=>{
    const {subplots}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const host=document.querySelector('#chart');host.style.width='100%';document.body.style.padding='12px';
    const fig=subplots({rows:1,cols:2,kinds:[['3d','2d']],height:340,title:'Scientific observation'});
    const surface=fig.panel(0,0).surface([0,1,2],[0,1,2],[[0,1,0],[1,2,1],[0,1,0]],{label:'Surface',shading:'smooth',wireframe:true});
    fig.panel(0,1).slice(surface,{axis:'y',index:1,label:'Profile'});
    const viewer=mountViewer(fig,host,{theme});await fig.ready();window.matrixFixture={fig,viewer};
  },theme);
}

for(const width of [360,768,1440])for(const dpr of [1,2])for(const theme of ['dark','light'])for(const motion of ['no-preference','reduce']){
  test(`viewer matrix ${width}px DPR${dpr} ${theme} motion-${motion}`,async({browser},testInfo)=>{
    const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:dpr,reducedMotion:motion,baseURL:testInfo.project.use.baseURL});
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    try{
      await mountScientificViewer(page,theme);
      const viewer=page.locator('[data-vesora-viewer]');await expect(viewer).toHaveAttribute('data-theme',theme);
      const reset=viewer.getByRole('button',{name:'Reset view',exact:true}),freeze=viewer.getByRole('button',{name:'Freeze view',exact:true});
      await reset.focus();await page.keyboard.press('Tab');await expect(freeze).toBeFocused();
      await page.keyboard.press('Enter');await expect(viewer.getByRole('button',{name:'Return to live',exact:true})).toBeFocused();
      await page.keyboard.press('Enter');await expect(freeze).toBeFocused();
      const metrics=await page.evaluate(()=>{
        const root=document.querySelector('[data-vesora-viewer]'),plot=root.querySelector('.vesora-figure'),fixture=window.matrixFixture;
        const lease=fixture.fig.captureExport('displayed');let layout;try{layout=lease.snapshot.figure.layout;}finally{lease.release();}
        return {width:innerWidth,dpr:devicePixelRatio,documentWidth:document.documentElement.scrollWidth,plotWidth:plot.clientWidth,plotScrollWidth:plot.scrollWidth,layout,motionReduced:matchMedia('(prefers-reduced-motion:reduce)').matches,transition:getComputedStyle(root.querySelector('button')).transitionDuration};
      });
      expect(metrics.width).toBe(width);expect(metrics.dpr).toBe(dpr);expect(metrics.documentWidth).toBeLessThanOrEqual(width);expect(metrics.plotScrollWidth).toBeLessThanOrEqual(metrics.plotWidth);
      expect(metrics.motionReduced).toBe(motion==='reduce');if(motion==='reduce')expect(metrics.transition).toBe('0s');
      expect(metrics.layout.cols).toBe(metrics.plotWidth<720?1:2);
      expect(await freeze.evaluate(node=>getComputedStyle(node).outlineWidth)).toBe('2px');
      await viewer.screenshot({path:testInfo.outputPath('default.png')});
      await viewer.locator('summary').filter({hasText:/^Inspector$/}).click();
      await viewer.getByRole('button',{name:'XY',exact:true}).click();await viewer.getByRole('slider',{name:'Surface Y slice',exact:true}).fill('0');
      await page.evaluate(()=>window.matrixFixture.fig.ready({target:'displayed'}));
      await expect(viewer.getByRole('button',{name:'Focus selection',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await viewer.screenshot({path:testInfo.outputPath('inspector.png')});
      const evidence={status:'passed',width,dpr,theme,motion,metrics,browser:browser.version(),errors,realScreenReader:false,realBrowserZoom:false,buildSha256:await viewerBuildFingerprint()};
      expect(errors).toEqual([]);await writeFile(testInfo.outputPath('evidence.json'),JSON.stringify(evidence,null,2));
    }finally{await context.close();}
  });
}
