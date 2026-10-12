import {test, expect} from '@playwright/test';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

async function ready(page) {
  const charts=page.locator('[data-vesora-chart]');
  await expect(charts).toHaveCount(3);
  for(let i=0;i<3;i++){
    await expect(charts.nth(i)).toHaveAttribute('data-vesora-state','ready');
    await expect(charts.nth(i)).toHaveAttribute('data-vesora-rendering','false');
  }
}

async function captureReadme(page) {
  const assets = resolve('docs/assets');
  await mkdir(assets, {recursive: true});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.setViewportSize({width: 1440, height: 1800});
  await ready(page);
  const charts = await page.locator('.chart-grid').boundingBox();
  const desktop = {width: 1440, height: Math.ceil(charts.y + charts.height + 24)};
  await page.setViewportSize(desktop);
  await ready(page);
  await page.screenshot({path: resolve(assets, 'signal-studio-light.png')});
  await page.getByRole('button', {name: 'Switch to dark theme'}).click();
  await ready(page);
  await page.screenshot({path: resolve(assets, 'signal-studio-dark.png')});
  await page.getByRole('button', {name: 'Switch to light theme'}).click();
  await page.setViewportSize({width: 390, height: 844});
  await ready(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path: resolve(assets, 'signal-studio-mobile.png'), fullPage: true});
  await page.setViewportSize({width: 390, height: 940});
  await ready(page);
  await page.locator('.trend-card').scrollIntoViewIfNeeded();
  await page.screenshot({path: resolve(assets, 'signal-studio-mobile-preview.png')});
  await page.setViewportSize({width: 1440, height: 1100});
  await page.getByRole('link', {name: 'Overview', exact: true}).click();
  await ready(page);
}

test('SaaS starter refreshes API data, themes, filters, handles failures and exports',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:1100});await page.goto('/');await ready(page);
  if (process.env.VESORA_CAPTURE_README === '1') await captureReadme(page);
  await expect(page.getByRole('heading',{name:'See what moves.'})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('signal-studio-desktop.png'),fullPage:false});
  await page.screenshot({path:testInfo.outputPath('saas-light.png'),fullPage:true});
  await page.getByRole('button',{name:'Switch to dark theme'}).click();await ready(page);
  await expect(page.locator('.dashboard')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:testInfo.outputPath('saas-dark.png'),fullPage:true});
  const revenue=page.getByRole('button',{name:'Daily revenue',exact:true});
  await revenue.focus();await page.keyboard.press('Space');await expect(revenue).toHaveAttribute('aria-pressed','false');
  await page.keyboard.press('Space');await expect(revenue).toHaveAttribute('aria-pressed','true');
  await page.getByRole('combobox',{name:'Period'}).selectOption('7');await ready(page);
  await page.getByRole('button',{name:/Refresh data/}).click();await ready(page);
  await expect(page.locator('.demo-notice')).toContainText('snapshot #1');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'PNG',exact:true}).click();
  const png=await downloadPromise;await png.saveAs(testInfo.outputPath('saas-export.png'));
  expect((await readFile(testInfo.outputPath('saas-export.png'))).subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  await page.locator('.demo-controls summary').click();
  await page.getByRole('checkbox',{name:'Simulate API failure on next refresh'}).check();
  await page.getByRole('button',{name:/Refresh data/}).click();await expect(page.getByRole('alert')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'PNG',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Simulate API failure on next refresh'}).uncheck();
  await page.getByRole('button',{name:/Refresh data/}).click();await ready(page);
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('saas-mobile.png'),fullPage:true});
  expect(errors).toEqual([]);
});
