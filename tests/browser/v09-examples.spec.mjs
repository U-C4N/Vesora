import {test,expect} from '@playwright/test';

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
