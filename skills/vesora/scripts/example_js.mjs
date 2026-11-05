import {subplots, toHTMLAsync} from '@vesora/core/runtime';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {makeFigure as makeGallery} from './gallery.mjs';
export const makeFigure = () => makeGallery({subplots});

export async function writeExample(output = 'artifacts/skill-examples/vesora-analysis.html') {
  const fig = makeFigure();
  try {
    if (fig.snapshot().figure.protocolVersion !== 9) throw new Error('Analysis example requires protocol 9');
    const target = resolve(output);
    await mkdir(dirname(target), {recursive: true});
    await writeFile(target, await toHTMLAsync(fig, {observation: true}), 'utf8');
    return target;
  } finally {fig.close();}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(await writeExample(process.argv[2]));
}
