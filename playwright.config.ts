import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const installedChrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const executablePath = process.env.VESORA_CHROME ?? (existsSync(installedChrome) ? installedChrome : undefined);

export default defineConfig({
  testDir: './tests/browser',
  timeout: 45_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    launchOptions: { executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'node scripts/serve.mjs', url: 'http://127.0.0.1:4173/tests/browser/harness.html', reuseExistingServer: !process.env.CI },
});
