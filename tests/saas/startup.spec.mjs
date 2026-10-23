import {test,expect} from '@playwright/test';

test('a failed isolated production route import exposes an accessible reload and recovers without external network',async({page,baseURL},testInfo)=>{
  const errors=[],requested=[],blockedExternal=[],externalResponses=[],origin=new URL(baseURL).origin;let aborted=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requested.push(request.url()));
  page.on('response',response=>{const url=new URL(response.url());if(/^https?:$/.test(url.protocol)&&url.origin!==origin)externalResponses.push({url:url.href,status:response.status()});});
  // A Workbench startup must work without dashboard fonts or other network services.
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(/^https?:$/.test(url.protocol)&&url.origin!==origin){blockedExternal.push(url.href);return route.abort('blockedbyclient');}
    return route.continue();
  });
  const chunk='**/assets/WorkbenchDemo-*.js';
  await page.route(chunk,route=>{aborted++;return route.abort('failed');});
  await page.goto('/?demo=workbench');
  await expect(page.getByRole('alert')).toHaveText('This screen could not be loaded. Check your connection and reload.');
  await expect(page.locator('.vesora-opening')).toHaveAttribute('aria-busy','false');
  expect(aborted).toBeGreaterThan(0);
  await expect(page.locator('[data-vesora-viewer]')).toHaveCount(0);
  const retry=page.getByRole('button',{name:'Reload screen',exact:true});
  await retry.focus();await expect(retry).toBeFocused();
  await page.unroute(chunk);
  await Promise.all([page.waitForNavigation(),retry.press('Enter')]);
  await expect(page.getByRole('heading',{name:'Experiment workbench',exact:true})).toBeVisible();
  await expect(page.locator('[data-vesora-viewer][data-mode="studio"]')).toBeVisible();
  await expect(page.locator('[data-vesora-viewer][data-mode="embed"]')).toBeVisible();
  await expect(page.locator('.vesora-opening')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const unrelated=requested.filter(url=>/\/(?:App|BalanceDemo|StreamingDemo|html-template)-[^/]+\.(?:js|css)$/.test(new URL(url).pathname));
  await testInfo.attach('startup-request-isolation',{body:JSON.stringify({abortedWorkbenchRequests:aborted,requested,blockedExternal,externalResponses,unrelated},null,2),contentType:'application/json'});
  expect(unrelated).toEqual([]);
  // Local browser/security software may inject requests. Record them, but never
  // permit an external response or depend on one for route recovery.
  for(const request of requested){const url=new URL(request);if(/^https?:$/.test(url.protocol)&&url.origin!==origin)expect(blockedExternal).toContain(url.href);}
  expect(externalResponses).toEqual([]);
  expect(errors).toEqual([]);
});
