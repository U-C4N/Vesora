// Initialize pending gates only; never infer a pass or replace reviewed evidence.
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadRelease,releaseGateSkeleton} from './release-validation.mjs';
if(!process.argv[2])throw new Error('Usage: node scripts/init-release-gates.mjs RELEASE_DIRECTORY');
const directory=resolve(process.argv[2]),release=await loadRelease(directory);
await writeFile(resolve(directory,'release-gates.json'),JSON.stringify(releaseGateSkeleton(release.manifest,release.manifestSha256),null,2)+'\n',{flag:'wx'});
console.log('Created pending release gates. No gate has been marked passed.');
