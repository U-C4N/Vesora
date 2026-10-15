import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {releaseIdentity} from '../../scripts/release-identity.mjs';
import {releaseFileNames,validateReleaseManifest,validateReleaseChecksums,loadRelease,validateTagCommit,validateRemoteTagCommit,releaseGateSkeleton,validateReleaseGates,recordPublicationVerification,sha256,releaseGates,distributedArtifacts} from '../../scripts/release-validation.mjs';

const version='0.9.0-rc.1',commit='a'.repeat(40),hash='b'.repeat(64);
const manifest=()=>({version,pythonVersion:'0.9.0rc1',commit,candidate:false,workingTreeDirty:false,tag:`v${version}`,protocolVersions:[1,2,3,4,5,6,7],transportVersions:[2,3],runtime:Object.fromEntries(['index','worker','viewer','labs'].map(key=>[key,hash])),files:releaseFileNames(version).map(name=>({name,sha256:sha256(Buffer.from(name))}))});
const checksums=(value,manifestHash)=>[...value.files.map(file=>`${file.sha256}  ${file.name}`),`${manifestHash}  release-manifest.json`].join('\n')+'\n';
async function fixture(t,value=manifest()){
  const directory=await mkdtemp(join(tmpdir(),'vesora-release-contract-'));
  t.after(async()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.includes('vesora-release-contract-'));await rm(directory,{recursive:true,force:true});});
  await Promise.all(value.files.map(file=>writeFile(join(directory,file.name),file.name)));
  const bytes=Buffer.from(JSON.stringify(value)),manifestHash=sha256(bytes);
  await writeFile(join(directory,'release-manifest.json'),bytes);await writeFile(join(directory,'SHA256SUMS.txt'),checksums(value,manifestHash));
  return {directory,manifest:value,manifestSha256:manifestHash};
}
function gateFixture(value=manifest()){
  const context={manifest:value,manifestSha256:hash},gates=releaseGateSkeleton(value,hash),reports=new Map();
  for(const gate of releaseGates){const path=`evidence/${gate}.json`,bytes=Buffer.from(JSON.stringify({gate,status:'passed',version,commit,manifestSha256:hash}));gates[gate]={status:'passed',evidence:[{path,sha256:sha256(bytes)}]};reports.set(gate,bytes);}
  const read=async path=>reports.get(path.replaceAll('\\','/').split('/').at(-1).replace('.json',''));
  return {context,gates,reports,read};
}

test('canonical ecosystem identity rejects noncanonical SemVer spellings',()=>{
  assert.equal(releaseIdentity(version).python,'0.9.0rc1');assert.equal(releaseIdentity('1.0.0').npmTag,'latest');
  for(const value of ['00.9.0','0.09.0','0.9.00','0.9.0-rc.01',null,900])assert.throws(()=>releaseIdentity(value));
});
test('clean tagged review candidates are still unpublishable',()=>{
  const value={...manifest(),candidate:true};assert.doesNotThrow(()=>validateReleaseManifest(value));
  assert.throws(()=>validateReleaseManifest(value,{publishable:true}),/candidate archives/);
  assert.throws(()=>validateReleaseManifest({...manifest(),workingTreeDirty:true},{publishable:true}),/clean commit/);
  assert.throws(()=>validateReleaseManifest({...manifest(),tag:null},{publishable:true}),/matching release tag/);
});
test('manifest cannot omit, duplicate, rename or mis-hash a constructed publication filename',()=>{
  for(const mutate of [m=>m.files.shift(),m=>m.files.push(m.files[0]),m=>m.files[0].name='../core.tgz',m=>m.files[0].sha256='bad']){
    const value=manifest();mutate(value);assert.throws(()=>validateReleaseManifest(value));
  }
  assert.throws(()=>validateReleaseManifest({...manifest(),pythonVersion:version}));
  assert.throws(()=>validateReleaseManifest({...manifest(),commit:'HEAD'}));
});
test('byte preflight detects changed archives before an uploader can run',async t=>{
  const value=await fixture(t);await loadRelease(value.directory,{publishable:true});
  await writeFile(join(value.directory,releaseFileNames(version)[1]),'replaced adapter');
  await assert.rejects(loadRelease(value.directory,{packagesOnly:true}),/changed after verification/);
});
test('checksum file must cover the exact manifest and packages with current hashes',()=>{
  const value=manifest(),valid=checksums(value,hash);validateReleaseChecksums(valid,value,hash);
  assert.throws(()=>validateReleaseChecksums(valid.replace(hash,'c'.repeat(64)),value,hash),/Stale checksum/);
  assert.throws(()=>validateReleaseChecksums(valid.split('\n').slice(1).join('\n'),value,hash),/cover every/);
  assert.throws(()=>validateReleaseChecksums(valid+valid.split('\n')[0],value,hash),/Duplicate/);
});
test('candidate preflight reads identity from its own manifest, independent of checkout version',async t=>{
  const value=manifest();value.candidate=true;const release=await fixture(t,value);
  const actual=await loadRelease(release.directory,{packagesOnly:true});assert.equal(actual.identity.canonical,version);assert.equal(actual.manifestSha256,release.manifestSha256);
  await assert.rejects(loadRelease(release.directory,{publishable:true}),/candidate archives/);
});
test('tag evidence must resolve to the exact commit including annotated-tag peeling output',()=>{
  validateTagCommit(manifest(),commit+'\n');assert.throws(()=>validateTagCommit(manifest(),'c'.repeat(40)),/manifest commit/);
});
test('public download verification includes exact manifest and checksum bytes',async t=>{
  const value=await fixture(t),release=await loadRelease(value.directory),artifacts=distributedArtifacts(release);
  assert.equal(artifacts.length,15);assert.equal(new Set(artifacts.map(file=>file.name)).size,15);
  assert.equal(artifacts.find(file=>file.name==='release-manifest.json').sha256,sha256(release.manifestBytes));
  assert.equal(artifacts.find(file=>file.name==='SHA256SUMS.txt').sha256,sha256(release.checksumBytes));
  assert.notEqual(artifacts.find(file=>file.name==='SHA256SUMS.txt').sha256,sha256(Buffer.from('stale checksum file')));
});
test('remote tag proof accepts lightweight and annotated tags but rejects absent or moved tags',()=>{
  const ref=`refs/tags/v${version}`,line=`${commit}\t${ref}\n`;
  validateRemoteTagCommit(manifest(),line);validateRemoteTagCommit(manifest(),`${'c'.repeat(40)}\t${ref}\n${commit}\t${ref}^{}\n`);
  assert.throws(()=>validateRemoteTagCommit(manifest(),''),/missing from origin/);
  assert.throws(()=>validateRemoteTagCommit(manifest(),`${'c'.repeat(40)}\t${ref}`),/manifest commit/);
  assert.throws(()=>validateRemoteTagCommit(manifest(),line+line),/Duplicate/);
});
test('gate statuses alone and old manifest-bound gate files are rejected',async()=>{
  const {context,gates,read}=gateFixture();await validateReleaseGates(tmpdir(),gates,context,read);
  const pending=releaseGateSkeleton(context.manifest,hash);await assert.rejects(validateReleaseGates(tmpdir(),pending,context,read),/has not passed/);
  const missing=structuredClone(gates);missing.soak.evidence=[];await assert.rejects(validateReleaseGates(tmpdir(),missing,context,read),/needs hashed evidence/);
  await assert.rejects(validateReleaseGates(tmpdir(),{...gates,manifestSha256:'c'.repeat(64)},context,read),/exact archives/);
});
test('changed or stale evidence reports cannot be relabelled by a fresh gate file',async()=>{
  const {context,gates,reports,read}=gateFixture();reports.set('soak',Buffer.from('{}'));
  await assert.rejects(validateReleaseGates(tmpdir(),gates,context,read),/changed after review/);
  const bytes=Buffer.from(JSON.stringify({gate:'soak',status:'passed',version,commit,manifestSha256:'c'.repeat(64)}));reports.set('soak',bytes);gates.soak.evidence[0].sha256=sha256(bytes);
  await assert.rejects(validateReleaseGates(tmpdir(),gates,context,read),/stale archives/);
  gates.soak.evidence[0].path='../outside.json';await assert.rejects(validateReleaseGates(tmpdir(),gates,context,read),/inside the release directory/);
});
test('a failed re-verification always clears previously complete publication state',()=>{
  const state={channels:{}};for(const name of ['npm','pypi','github'])recordPublicationVerification(state,name,{status:'download-verified'});
  assert.equal(state.complete,false);recordPublicationVerification(state,'consumers',{status:'verified'});assert.equal(state.complete,true);
  recordPublicationVerification(state,'github',{status:'verification-failed',error:'wrong checksum'});assert.equal(state.complete,false);
  recordPublicationVerification(state,'github',{status:'download-verified'});assert.equal(state.complete,true);
  recordPublicationVerification(state,'npm',{status:'uploaded'});assert.equal(state.complete,false);
});
