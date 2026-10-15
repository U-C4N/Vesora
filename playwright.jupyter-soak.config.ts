import {defineConfig} from '@playwright/test';
import config from './playwright.config';

// The existing fixture launches its own real Lab server and Python kernel.
export default defineConfig({...config,testMatch:'**/jupyter-soak.spec.mjs',workers:1,webServer:undefined,
  use:{...config.use,trace:'off',video:'off',acceptDownloads:true}});
