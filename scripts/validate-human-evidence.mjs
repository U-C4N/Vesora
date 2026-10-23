// Read-only: this command neither updates release-gates.json nor publishes evidence.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {loadRelease,sha256} from './release-validation.mjs';
import {humanEvidenceReferences,validateHumanEvidence,verifyHumanEvidenceFiles} from './human-evidence.mjs';

const usage='Usage: node scripts/validate-human-evidence.mjs <release-directory> <session-directory> [--require-passed]';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log(usage);process.exit(0);}
assert.ok(args.length===2||args.length===3&&args[2]==='--require-passed',usage);
const release=await loadRelease(resolve(args[0])),session=resolve(args[1]);
const bytes=await readFile(join(session,'human-evidence.json')),input=JSON.parse(bytes);
const results=validateHumanEvidence(input,release);
const files=await verifyHumanEvidenceFiles(session,humanEvidenceReferences(input));
console.log(JSON.stringify({version:release.manifest.version,commit:release.manifest.commit,manifestSha256:release.manifestSha256,
  inputSha256:sha256(bytes),results,verifiedFiles:files,
  notice:'Supplied human records and artifact hashes checked. No human observation was performed by this command. Release gates remain unchanged.'},null,2));
if(args[2]==='--require-passed'&&Object.values(results).some(value=>value.status!=='passed'))process.exitCode=1;
