import {build} from 'esbuild';
import {copyFile, mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = `${root}/packages/react/dist`;
await mkdir(output, {recursive: true});
execFileSync(process.execPath, [`${root}/node_modules/typescript/bin/tsc`, '-p', `${root}/packages/react/tsconfig.json`, '--emitDeclarationOnly'], {stdio: 'inherit', cwd: root});
for (const file of await readdir(output)) {
  if (!file.endsWith('.d.ts')) continue;
  const path = `${output}/${file}`;
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/(from\s*['"]|import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, prefix, specifier, suffix) => `${prefix}${/\.[^/]+$/.test(specifier) ? specifier : `${specifier}.js`}${suffix}`));
}
await build({
  entryPoints: [`${root}/packages/react/src/index.ts`], outfile: `${output}/index.js`,
  bundle: true, format: 'esm', target: 'es2022', sourcemap: true, jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@vesora/core'],
});
await copyFile(`${root}/LICENSE`, `${root}/packages/react/LICENSE`);
await build({
  entryPoints: [`${root}/tests/fixtures/react/fixture.tsx`],
  outfile: `${root}/tests/fixtures/react/fixture.js`, bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic',
  external: ['@vesora/core'], alias: {'@vesora/react': `${output}/index.js`},
  define: {'process.env.NODE_ENV': '"development"'},
});
console.log('Built @vesora/react and the React browser fixture.');
