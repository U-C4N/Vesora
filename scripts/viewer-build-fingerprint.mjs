import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

/** Bind source-checkout viewer evidence to every runtime it can load. */
export async function viewerBuildFingerprint(){
  return Object.fromEntries(await Promise.all([
    ['core','index'],['viewer','viewer'],['runtime','runtime'],['htmlTemplate','html-template'],['worker','worker'],
  ].map(async([name,file])=>[name,createHash('sha256').update(await readFile(new URL(`../packages/core/dist/${file}.js`,import.meta.url))).digest('hex')])));
}
