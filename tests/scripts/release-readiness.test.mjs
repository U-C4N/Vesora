import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {inspectReleaseReadiness} from '../../scripts/check-release-readiness.mjs';
import {releaseFileNames,releaseGateSkeleton,releasePolicy,sha256} from '../../scripts/release-validation.mjs';
import {releaseIdentity} from '../../scripts/release-identity.mjs';

async function fixture(t,{candidate=false,version='0.9.0-rc.6'}={}){
  const directory=await mkdtemp(join(tmpdir(),'vesora-readiness-'));
  t.after(async()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.includes('vesora-readiness-'));await rm(directory,{recursive:true,force:true});});
  const manifest={version,pythonVersion:releaseIdentity(version).python,commit:'a'.repeat(40),candidate,workingTreeDirty:false,tag:`v${version}`,protocolVersions:[1,2,3,4,5,6,7],transportVersions:[2,3],runtime:Object.fromEntries(['index','worker','viewer','labs'].map(key=>[key,'b'.repeat(64)])),files:releaseFileNames(version).map(name=>({name,sha256:sha256(Buffer.from(name))}))};
  for(const file of manifest.files)await writeFile(join(directory,file.name),file.name);
  const bytes=Buffer.from(JSON.stringify(manifest)),manifestSha256=sha256(bytes);
  await writeFile(join(directory,'release-manifest.json'),bytes);
  await writeFile(join(directory,'SHA256SUMS.txt'),[...manifest.files.map(file=>`${file.sha256}  ${file.name}`),`${manifestSha256}  release-manifest.json`].join('\n')+'\n');
  await mkdir(join(directory,'evidence'));
  const gates=releaseGateSkeleton(manifest,manifestSha256);
  async function report(gate,status='passed',overrides={}){
    const path=`evidence/${gate}.json`,bytes=Buffer.from(JSON.stringify({gate,status,version,commit:manifest.commit,manifestSha256,...overrides}));
    await writeFile(join(directory,path),bytes);gates[gate]={status,evidence:[{path,sha256:sha256(bytes)}]};
  }
  for(const gate of releasePolicy(version).requiredGates)await report(gate);
  const save=()=>writeFile(join(directory,'release-gates.json'),JSON.stringify(gates));await save();
  return {directory,manifest,gates,report,save};
}

test('reports exact archives and all local passed gates without modifying them',async t=>{
  const f=await fixture(t),before=await readFile(join(f.directory,'release-gates.json'));
  const result=await inspectReleaseReadiness(f.directory);
  assert.equal(result.status,'ready');assert.equal(result.allLocalGatesPassed,true);assert.equal(result.counts.passed,10);
  assert.deepEqual(await readFile(join(f.directory,'release-gates.json')),before);
});

test('failed soak and unperformed human sessions stay blocked, with valid failed evidence retained',async t=>{
  const f=await fixture(t);await f.report('soak','failed');
  for(const name of ['accessibility','betaPilot'])f.gates[name]={status:'pending',evidence:[]};await f.save();
  const result=await inspectReleaseReadiness(f.directory);
  assert.equal(result.status,'blocked');assert.equal(result.allLocalGatesPassed,false);
  assert.deepEqual(result.counts,{passed:7,failed:1,pending:2,missing:0});
  assert.equal(result.gates.find(gate=>gate.name==='soak').evidenceIntegrity,'valid');
});

test('tampered distributable invalidates readiness before any gates can qualify',async t=>{
  const f=await fixture(t);await writeFile(join(f.directory,f.manifest.files[0].name),'different bytes');
  const result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');assert.equal(result.allLocalGatesPassed,false);assert.match(result.issues[0],/changed after verification/);
});

test('passed labels with missing evidence are invalid',async t=>{
  const f=await fixture(t);f.gates.accessibility.evidence=[];await f.save();
  const result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');assert.match(result.gates.find(gate=>gate.name==='accessibility').issues[0],/hashed reviewed evidence/);
});

test('stale gate inventory cannot qualify current archives',async t=>{
  const f=await fixture(t);f.gates.manifestSha256='c'.repeat(64);await f.save();
  const result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');assert.match(result.issues[0],/does not match/);
});

test('a fresh hash cannot relabel a stale or failed reviewed report as passed',async t=>{
  const f=await fixture(t);await f.report('betaPilot','passed',{status:'failed'});await f.save();
  let result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');assert.match(result.gates.find(gate=>gate.name==='betaPilot').issues[0],/status differs/);
  await f.report('betaPilot','passed',{manifestSha256:'c'.repeat(64)});await f.save();
  result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');assert.match(result.gates.find(gate=>gate.name==='betaPilot').issues[0],/manifestSha256 differs/);
});

test('corrupted evidence and escaping paths are reported rather than treated as unperformed tests',async t=>{
  const f=await fixture(t);await writeFile(join(f.directory,'evidence/qt.json'),'{}');
  f.gates.browser.evidence[0].path='../outside.json';await f.save();
  const result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');
  assert.match(result.gates.find(gate=>gate.name==='qt').issues[0],/changed after review/);
  assert.match(result.gates.find(gate=>gate.name==='browser').issues[0],/leaves the release directory/);
});

test('review candidates never qualify for publication even when local reports are passed',async t=>{
  const f=await fixture(t,{candidate:true}),result=await inspectReleaseReadiness(f.directory);
  assert.equal(result.archivesVerified,true);assert.equal(result.status,'invalid');assert.equal(result.allLocalGatesPassed,false);assert.match(result.issues[0],/cannot be published/);
});

test('v1 readiness discloses three unverified scopes while requiring all seven automatic gates',async t=>{
  const f=await fixture(t,{version:'1.0.0'}),before=await readFile(join(f.directory,'release-gates.json'));
  let result=await inspectReleaseReadiness(f.directory);
  assert.equal(result.status,'ready');assert.equal(result.counts.passed,7);assert.equal(result.gates.length,7);
  assert.deepEqual(result.policy.unverifiedScopes.map(item=>item.status),['unverified','unverified','unverified']);
  assert.deepEqual(await readFile(join(f.directory,'release-gates.json')),before);
  f.gates.qt={status:'pending',evidence:[]};await f.save();
  result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'blocked');assert.equal(result.counts.pending,1);
});

test('v1 readiness rejects missing policy, hidden exclusions and invented human passes',async t=>{
  const f=await fixture(t,{version:'1.0.0'}),policy=structuredClone(f.gates.policy);
  delete f.gates.policy;await f.save();
  let result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');assert.match(result.issues.join('\n'),/Release policy/);
  f.gates.policy={...policy,unverifiedScopes:[]};await f.save();
  result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');
  f.gates.policy=policy;f.gates.betaPilot={status:'passed',evidence:[]};await f.save();
  result=await inspectReleaseReadiness(f.directory);assert.equal(result.status,'invalid');assert.match(result.issues.join('\n'),/must not be represented as a publication gate/);
});
