// Capture the real production starter, then run its interaction/export checks.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(process.execPath, [
  resolve(root, 'node_modules/@playwright/test/cli.js'),
  'test', '--config', 'playwright.saas.config.ts', 'tests/saas/starter.spec.mjs',
  '--output', 'artifacts/readme-capture',
], {
  cwd: root,
  env: {...process.env, VESORA_CAPTURE_README: '1'},
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
