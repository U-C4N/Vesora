import {defineConfig} from '@playwright/test';
import base from './playwright.config';

export default defineConfig({...base, testDir: './tests/saas', workers: 1,
  use: {...base.use, baseURL: 'http://127.0.0.1:4187'},
  webServer: {command: 'npm run preview --workspace vesora-react-saas-example -- --host 127.0.0.1 --port 4187 --strictPort', url: 'http://127.0.0.1:4187', reuseExistingServer: !process.env.CI},
});
