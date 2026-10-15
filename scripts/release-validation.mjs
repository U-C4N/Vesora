// Pure release contracts plus filesystem validation. No publication or network calls.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {releaseIdentity} from './release-identity.mjs';

export const releaseGates=['correctness','browser','qt','jupyter','reactConsumers','packages','performance','soak','accessibility','betaPilot'];
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
export function releasePackageNames(version){const id=releaseIdentity(version);return [`vesora-core-${id.npm}.tgz`,`vesora-react-${id.npm}.tgz`,`vesora-${id.python}-py3-none-any.whl`];}
export function releaseFileNames(version){return [...releasePackageNames(version),...['discovery','comparison','statistics','linked','saas','quality','streaming','prism-surface','prism-telemetry','prism-labs'].map(name=>`vesora-${name}-demo.html`)];}

export function validateReleaseManifest(manifest,{publishable=false}={}){
  assert.ok(manifest&&typeof manifest==='object','Release manifest must be an object');
  const identity=releaseIdentity(manifest.version);
  assert.equal(manifest.pythonVersion,identity.python,'Python release identity differs');
  assert.match(manifest.commit,/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/,'Release commit must be a full Git object id');
  assert.equal(typeof manifest.candidate,'boolean','Candidate flag is required');
  assert.equal(typeof manifest.workingTreeDirty,'boolean','Working tree state is required');
  assert.ok(manifest.tag===null||manifest.tag===identity.tag,'Release tag differs from canonical identity');
  assert.deepEqual(manifest.protocolVersions,[1,2,3,4,5,6,7]);
  assert.deepEqual(manifest.transportVersions,[2,3]);
  for(const name of ['index','worker','viewer','labs'])assert.match(manifest.runtime?.[name],hashPattern,`Missing runtime hash: ${name}`);
  assert.ok(Array.isArray(manifest.files),'Release artifact list is required');
  assert.deepEqual(manifest.files.map(file=>file?.name).sort(),releaseFileNames(identity.canonical).sort(),'Release manifest must list every expected artifact exactly once');
  for(const file of manifest.files)assert.match(file.sha256,hashPattern,`Invalid artifact hash: ${file.name}`);
  if(publishable){
    assert.equal(manifest.candidate,false,'Local candidate archives cannot be published');
    assert.equal(manifest.workingTreeDirty,false,'Publication requires archives from a clean commit');
    assert.equal(manifest.tag,identity.tag,'Publication requires a matching release tag');
  }
  return identity;
}

export function validateReleaseChecksums(text,manifest,manifestSha256){
  const expected=new Map([...manifest.files.map(file=>[file.name,file.sha256]),['release-manifest.json',manifestSha256]]),actual=new Map();
  for(const line of text.trim().split(/\r?\n/)){
    const match=/^([a-f0-9]{64})  ([^/\\]+)$/.exec(line);
    assert.ok(match,`Malformed checksum entry: ${line}`);
    assert.ok(!actual.has(match[2]),`Duplicate checksum entry: ${match[2]}`);actual.set(match[2],match[1]);
  }
  assert.deepEqual([...actual.keys()].sort(),[...expected.keys()].sort(),'Checksum file must cover every distributable exactly once');
  for(const [name,hash]of expected)assert.equal(actual.get(name),hash,`Stale checksum: ${name}`);
}

export async function loadRelease(directory,{publishable=false,packagesOnly=false}={}){
  const manifestBytes=await readFile(resolve(directory,'release-manifest.json')),manifest=JSON.parse(manifestBytes),manifestSha256=sha256(manifestBytes);
  const identity=validateReleaseManifest(manifest,{publishable});
  const wanted=packagesOnly?new Set(releasePackageNames(identity.canonical)):null;
  for(const file of manifest.files){if(wanted&&!wanted.has(file.name))continue;assert.equal(sha256(await readFile(resolve(directory,file.name))),file.sha256,`${file.name} changed after verification`);}
  let checksumBytes;
  if(!packagesOnly){checksumBytes=await readFile(resolve(directory,'SHA256SUMS.txt'));validateReleaseChecksums(checksumBytes.toString('utf8'),manifest,manifestSha256);}
  return {manifest,identity,manifestBytes,manifestSha256,checksumBytes};
}

export function validateTagCommit(manifest,resolvedCommit){assert.equal(resolvedCommit.trim(),manifest.commit,'The release tag must resolve to the manifest commit');}
export function validateRemoteTagCommit(manifest,output){
  const reference=`refs/tags/${manifest.tag}`,refs=new Map();
  for(const line of output.trim().split(/\r?\n/).filter(Boolean)){
    const match=/^([a-f0-9]{40}(?:[a-f0-9]{24})?)\s+(\S+)$/.exec(line);assert.ok(match,'Malformed remote tag evidence');
    assert.ok(match[2]===reference||match[2]===`${reference}^{}`,'Unexpected remote reference');assert.ok(!refs.has(match[2]),'Duplicate remote tag evidence');refs.set(match[2],match[1]);
  }
  assert.ok(refs.has(reference),'Matching release tag is missing from origin');
  validateTagCommit(manifest,refs.get(`${reference}^{}`)??refs.get(reference));
}

export function distributedArtifacts({manifest,manifestSha256,checksumBytes}){assert.ok(checksumBytes,'Validated checksum bytes are required');return [...manifest.files,{name:'release-manifest.json',sha256:manifestSha256},{name:'SHA256SUMS.txt',sha256:sha256(checksumBytes)}];}

export function releaseGateSkeleton(manifest,manifestSha256){return {version:manifest.version,commit:manifest.commit,manifestSha256,...Object.fromEntries(releaseGates.map(gate=>[gate,{status:'pending',evidence:[]}]))};}

export async function validateReleaseGates(directory,gates,{manifest,manifestSha256},read=readFile){
  assert.equal(gates.version,manifest.version);assert.equal(gates.commit,manifest.commit);
  assert.equal(gates.manifestSha256,manifestSha256,'Gate evidence must refer to these exact archives');
  for(const gate of releaseGates){
    const entry=gates[gate];assert.equal(entry?.status,'passed',`Release gate ${gate} has not passed`);
    assert.ok(Array.isArray(entry.evidence)&&entry.evidence.length,`Release gate ${gate} needs hashed evidence`);
    for(const evidence of entry.evidence){
      assert.equal(typeof evidence.path,'string');const path=resolve(directory,evidence.path),rel=relative(directory,path);
      assert.ok(rel&&!isAbsolute(evidence.path)&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..\\`)&&!rel.startsWith('../'),`Evidence must stay inside the release directory: ${evidence.path}`);
      assert.match(evidence.sha256,hashPattern);const bytes=await read(path);
      assert.equal(sha256(bytes),evidence.sha256,`${gate} evidence changed after review`);
      const report=JSON.parse(bytes);
      assert.equal(report.gate,gate,`${gate} evidence identifies another gate`);
      assert.equal(report.status,'passed',`${gate} report has not passed`);
      assert.equal(report.version,manifest.version);assert.equal(report.commit,manifest.commit);
      assert.equal(report.manifestSha256,manifestSha256,`${gate} report belongs to stale archives`);
    }
  }
}

export function publicationComplete(state){return ['npm','pypi','github'].every(key=>state.channels?.[key]?.status==='download-verified')&&state.channels?.consumers?.status==='verified';}
export function recordPublicationVerification(state,channel,result){state.channels??={};state.channels[channel]={...state.channels[channel],...result};state.complete=publicationComplete(state);return state;}
