import {test,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

test('production Workbench keeps Studio and a 320px Embed card independent',async({page,browser},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:1100});await page.goto('/?demo=workbench');
  const studio=page.locator('[aria-label="Studio workspace"] [data-vesora-viewer]'),card=page.locator('[aria-label="Embedded sensor card"]'),embed=card.locator('[data-vesora-viewer]');
  await expect(studio).toHaveAttribute('data-mode','studio');await expect(embed).toHaveAttribute('data-mode','embed');
  await expect(studio.getByRole('button',{name:'Freeze view',exact:true})).toBeEnabled();
  await studio.getByRole('button',{name:'Freeze view',exact:true}).click();
  await expect(studio.locator('.vv-status')).toContainText('Frozen snapshot');await expect(embed.locator('.vv-status')).toHaveText('Live');
  await embed.getByRole('button',{name:'Freeze view',exact:true}).click();
  await page.getByRole('button',{name:'Show card inspector',exact:true}).click();
  await expect(embed).toHaveAttribute('data-inspector','visible');
  expect(await embed.locator('.vv-body').evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1);
  await expect(embed.locator('.vv-status')).toContainText('Frozen snapshot');
  await page.getByRole('button',{name:'Hide card inspector',exact:true}).click();
  await expect(embed).toHaveAttribute('data-inspector','hidden');
  await studio.locator('summary').filter({hasText:'Data meaning'}).click();
  await expect(studio.locator('.vv-semantics')).toContainText('Sensor A temperature');
  await expect(studio.locator('.vv-semantics')).toContainText('synthetic-temperature-demo');
  const metrics=await page.evaluate(()=>{
    const card=document.querySelector('[aria-label="Embedded sensor card"]'),viewer=card.querySelector('[data-vesora-viewer]'),plot=viewer.querySelector('.vv-plot');
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,cardWidth:card.getBoundingClientRect().width,plotWidth:plot.getBoundingClientRect().width,cardScrollWidth:card.scrollWidth,mode:viewer.dataset.mode,inspector:viewer.dataset.inspector};
  });
  expect(metrics.cardWidth).toBe(320);expect(metrics.plotWidth).toBeGreaterThan(300);expect(metrics.cardScrollWidth).toBeLessThanOrEqual(320);expect(metrics.documentWidth).toBeLessThanOrEqual(1440);
  await page.screenshot({path:testInfo.outputPath('workbench-1440.png'),fullPage:true});
  expect(errors).toEqual([]);
  await writeFile(testInfo.outputPath('workbench-metrics.json'),JSON.stringify({recordedAt:new Date().toISOString(),browser:browser.version(),viewport:{width:1440,height:1100},metrics,pageErrors:errors,scope:'Production React example; synthetic data; functional layout/ownership check, not a performance benchmark.'},null,2)+'\n');
});
