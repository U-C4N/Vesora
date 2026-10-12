import {test, expect} from '@playwright/test';

async function ready(page) {
  const charts = page.locator('[data-vesora-chart]');
  await expect(charts).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await expect(charts.nth(index)).toHaveAttribute('data-vesora-state', 'ready');
    await expect(charts.nth(index)).toHaveAttribute('data-vesora-rendering', 'false');
  }
}

async function open(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await ready(page);
  return errors;
}

test('signal lenses and comparison keep the selected metric and available history explicit', async ({page}) => {
  const errors = await open(page);
  const trend = page.locator('.trend-card');
  const revenue = trend.getByRole('button', {name: 'Revenue', exact: true});
  const adoption = trend.getByRole('button', {name: 'Adoption', exact: true});
  const expansion = trend.getByRole('button', {name: 'Expansion', exact: true});
  const compare = trend.getByRole('button', {name: 'Compare', exact: true});

  await expect(revenue).toHaveAttribute('aria-pressed', 'true');
  await adoption.click();
  await ready(page);
  await expect(adoption).toHaveAttribute('aria-pressed', 'true');
  await expect(revenue).toHaveAttribute('aria-pressed', 'false');
  await expect(trend.getByRole('heading', {name: 'Adoption rhythm'})).toBeVisible();
  await expect(trend.getByRole('button', {name: 'Active users', exact: true})).toBeVisible();

  await expansion.focus();
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(expansion).toHaveAttribute('aria-pressed', 'true');
  await expect(adoption).toHaveAttribute('aria-pressed', 'false');
  await expect(trend.getByRole('heading', {name: 'Expansion rhythm'})).toBeVisible();

  await compare.click();
  await ready(page);
  await expect(compare).toHaveAttribute('aria-pressed', 'true');
  await expect(trend.getByRole('button', {name: 'Prior period · aligned', exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Period', exact: true}).selectOption('90');
  await ready(page);
  await expect(compare).toBeDisabled();
  await expect(compare).toHaveAttribute('aria-pressed', 'false');
  await expect(trend.getByRole('button', {name: 'Prior period · aligned', exact: true})).toHaveCount(0);

  await page.getByRole('combobox', {name: 'Period', exact: true}).selectOption('7');
  await ready(page);
  await expect(compare).toBeEnabled();
  await revenue.click();
  await ready(page);
  await expect(trend.getByRole('heading', {name: 'Revenue rhythm'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('account filters, search and pagination compose and recover from an empty result', async ({page}) => {
  const errors = await open(page);
  const accounts = page.locator('#accounts');
  const rows = accounts.locator('tbody tr');
  const next = accounts.getByRole('button', {name: 'Next account page'});
  const previous = accounts.getByRole('button', {name: 'Previous account page'});
  const search = accounts.getByRole('textbox', {name: 'Search accounts'});
  const firstAccount = await rows.first().locator('td').first().innerText();

  await expect(rows).toHaveCount(6);
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(accounts.locator('.table-pagination')).toContainText('7–12');
  await expect(rows.first().locator('td').first()).not.toHaveText(firstAccount);

  await accounts.getByRole('button', {name: 'Starter', exact: true}).click();
  await expect(accounts.getByRole('button', {name: 'Starter', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(previous).toBeDisabled();
  await expect(accounts.locator('.chart-badge')).toHaveText('8 in view');
  await expect(rows).toHaveCount(6);
  for (let index = 0; index < 6; index++) await expect(rows.nth(index).locator('td').nth(1)).toHaveText('Starter');

  await search.fill('Aster');
  await expect(rows).toHaveCount(4);
  await expect(next).toBeDisabled();
  await search.fill('an-account-that-does-not-exist');
  await expect(rows).toHaveCount(0);
  await expect(accounts.getByText('No accounts in this view.', {exact: true})).toBeVisible();
  await accounts.getByRole('button', {name: 'Clear filters', exact: true}).click();
  await expect(search).toHaveValue('');
  await expect(accounts.getByRole('button', {name: 'All accounts', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(6);
  await expect(accounts.locator('.chart-badge')).toHaveText('24 in view');
  expect(errors).toEqual([]);
});

test('a keyboard account selection focuses its spotlight and Escape restores the originating control', async ({page}) => {
  const errors = await open(page);
  const inspect = page.locator('#accounts').getByRole('button', {name: 'Inspect Aster 1', exact: true});
  await inspect.focus();
  await page.keyboard.press('Enter');
  const spotlight = page.locator('.account-spotlight');
  await expect(spotlight).toBeVisible();
  await expect(spotlight).toBeFocused();
  await expect(spotlight.getByRole('heading', {name: 'Aster 1', exact: true})).toBeVisible();
  await expect(page.locator('#accounts tbody tr')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(spotlight).toHaveCount(0);
  await expect(inspect).toBeFocused();
  await expect(page.locator('#accounts tbody tr')).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('quick actions support search, a keyboard focus loop, Escape and actions that deliberately move focus', async ({page}) => {
  const errors = await open(page);
  const accountSearch = page.getByRole('textbox', {name: 'Search accounts'});
  await page.keyboard.press('/');
  await expect(accountSearch).toBeFocused();
  await accountSearch.fill('North');
  await page.keyboard.press('/');
  await expect(accountSearch).toHaveValue('North/');
  await accountSearch.fill('');
  const launcher = page.getByRole('button', {name: 'Open quick actions', exact: true});
  await launcher.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {name: 'Quick actions', exact: true});
  const search = dialog.getByRole('combobox', {name: 'Search quick actions'});
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', {name: 'Close quick actions'})).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await search.fill('no-such-action-exists');
  await expect(dialog.getByRole('status')).toContainText('No matching actions');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();

  await launcher.click();
  await expect(search).toBeFocused();
  await search.fill('theme');
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.dashboard')).toHaveAttribute('data-theme', 'dark');
  await ready(page);

  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill('Find an account');
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('textbox', {name: 'Search accounts'})).toBeFocused();
  expect(errors).toEqual([]);
});

for (const width of [390, 768, 1440]) {
  test(`studio remains navigable without document overflow at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 1000});
    await page.emulateMedia({reducedMotion: 'reduce'});
    const errors = await open(page);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('heading', {level: 1})).toHaveCount(1);
    const navigation = page.getByRole('navigation', {name: 'Dashboard', exact: true});
    await expect(navigation).toBeVisible();
    for (const label of ['Overview', 'Plans', 'Accounts']) await expect(navigation.getByRole('link', {name: label, exact: true})).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width === 390) {
      // The chart must use the card's width, not merely avoid page overflow.
      const span = await page.locator('.trend-card .vesora-figure canvas').first().evaluate(canvas => {
        const gl = canvas.getContext('webgl2');
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let first = canvas.width, last = -1;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (pixels[i] > 180 && pixels[i + 1] > 210 && pixels[i + 2] < 150) {first = Math.min(first, x); last = Math.max(last, x);}
        }
        return (last - first) / canvas.width;
      });
      expect(span).toBeGreaterThan(.6);
    }
    await expect.poll(() => page.locator('.page-heading').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await page.screenshot({path: testInfo.outputPath(`studio-${width}.png`), fullPage: true});

    await navigation.getByRole('link', {name: 'Accounts', exact: true}).click();
    await expect(page.locator('#accounts')).toBeInViewport();
    await expect(navigation.getByRole('link', {name: 'Accounts', exact: true})).toHaveAttribute('aria-current', 'location');
    const launcher = page.getByRole('button', {name: 'Open quick actions', exact: true});
    await launcher.click();
    await expect(page.getByRole('dialog', {name: 'Quick actions', exact: true})).toBeVisible();
    await expect(page.getByRole('combobox', {name: 'Search quick actions'})).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(launcher).toBeFocused();
    expect(errors).toEqual([]);
  });
}
