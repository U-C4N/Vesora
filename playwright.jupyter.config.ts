import {defineConfig} from '@playwright/test';
import config from './playwright.config';

// The real notebook fixture owns its Jupyter HTTP server and kernel. It does
// not use the gallery harness server or its separate shutdown lifecycle.
export default defineConfig({...config,testMatch:'**/jupyter.spec.mjs',workers:1,webServer:undefined});
