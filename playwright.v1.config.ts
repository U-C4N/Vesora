import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir:'./tests/browser',testMatch:'advanced.spec.mjs',timeout:30000,workers:1,fullyParallel:false,retries:0,
  outputDir:'test-results/v1',
  use:{baseURL:'http://127.0.0.1:4173',viewport:{width:1800,height:1100},trace:'retain-on-failure',launchOptions:{executablePath:process.env.VESORA_CHROME??(existsSync(chrome)?chrome:undefined),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},
  webServer:{command:'node scripts/serve.mjs',url:'http://127.0.0.1:4173/tests/browser/advanced-harness.html',reuseExistingServer:!process.env.CI},
});
