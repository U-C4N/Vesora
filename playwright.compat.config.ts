import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/compat/**/*.spec.mjs','**/browser/cross-browser-prism.spec.mjs'],
  timeout: 60_000,
  workers: 1,
  use: {baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure'},
  projects: [
    {name: 'firefox', use: {browserName: 'firefox', launchOptions: {firefoxUserPrefs: {'webgl.force-enabled': true, 'webgl.disabled': false}}}},
    {name: 'webkit', use: {browserName: 'webkit'}},
  ],
  webServer: {command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173/tests/browser/harness.html', reuseExistingServer: !process.env.CI},
});
