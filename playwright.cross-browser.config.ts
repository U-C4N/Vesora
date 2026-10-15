import {defineConfig} from '@playwright/test';

// Desktop automation engines only. This does not imply Safari/iOS certification.
export default defineConfig({
  testDir:'./tests/browser',testMatch:'cross-browser-prism.spec.mjs',timeout:60_000,fullyParallel:false,workers:1,
  outputDir:'test-results/cross-browser',
  reporter:[['list'],['json',{outputFile:'artifacts/v09/cross-browser-results.json'}]],
  use:{baseURL:'http://127.0.0.1:4173',viewport:{width:1200,height:850},trace:'retain-on-failure'},
  projects:[{name:'firefox',use:{browserName:'firefox'}},{name:'webkit',use:{browserName:'webkit'}}],
  webServer:{command:'node scripts/serve.mjs',url:'http://127.0.0.1:4173/tests/browser/harness.html',reuseExistingServer:!process.env.CI},
});
