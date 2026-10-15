import test from 'node:test';
import assert from 'node:assert/strict';
import {basename} from 'node:path';
import {publishGitHubArchives} from '../../scripts/github-release.mjs';
import {sha256} from '../../scripts/release-validation.mjs';

const payload=Buffer.from('archive'),manifestBytes=Buffer.from('manifest'),checksumBytes=Buffer.from('checksums');
const release={identity:{tag:'v0.9.0-rc.1',canonical:'0.9.0-rc.1',npmTag:'next'},
  manifest:{files:[{name:'core.tgz',sha256:sha256(payload)}]},manifestSha256:sha256(manifestBytes),checksumBytes};
const bytes=new Map([['core.tgz',payload],['release-manifest.json',manifestBytes],['SHA256SUMS.txt',checksumBytes]]);
const remote=(names=[],patch={})=>({tagName:'v0.9.0-rc.1',assets:names.map(name=>({name})),isDraft:true,isPrerelease:true,isImmutable:false,...patch});

test('a new release uploads the exact archives in a draft before publishing',async()=>{
  const calls=[];let reads=0;
  await publishGitHubArchives(release,'dist',{view:()=>++reads===1?null:remote(),run:args=>calls.push(args)});
  assert.ok(calls[0].includes('--draft'));assert.ok(calls[0].includes('--verify-tag'));assert.ok(calls[0].includes('--generate-notes'));
  assert.deepEqual(calls.filter(args=>args[1]==='upload').map(args=>basename(args[3])),[...bytes.keys()]);
  assert.deepEqual(calls.at(-1),['release','edit','v0.9.0-rc.1','--draft=false']);
});
test('a failed upload resumes by hashing present assets and uploading only missing files',async()=>{
  const calls=[];
  await publishGitHubArchives(release,'dist',{view:()=>remote(['core.tgz']),run:args=>calls.push(args),temporary:()=>'/scratch',read:path=>bytes.get(basename(path))});
  assert.equal(calls[0][1],'download');assert.deepEqual(calls.filter(args=>args[1]==='upload').map(args=>basename(args[3])),['release-manifest.json','SHA256SUMS.txt']);
  assert.ok(calls.every(args=>!args.includes('--clobber')));
});
test('different remote bytes stop the retry before any upload or publication',async()=>{
  const calls=[];
  await assert.rejects(publishGitHubArchives(release,'dist',{view:()=>remote(['core.tgz']),run:args=>calls.push(args),temporary:()=>'/scratch',read:()=>Buffer.from('different')}),/never overwrite/);
  assert.deepEqual(calls.map(args=>args[1]),['download']);
});
test('an immutable incomplete release is not mutated',async()=>{
  const calls=[];
  await assert.rejects(publishGitHubArchives(release,'dist',{view:()=>remote(['core.tgz'],{isImmutable:true,isDraft:false}),run:args=>calls.push(args)}),/new release identity/);
  assert.deepEqual(calls,[]);
});
test('unexpected assets cannot be smuggled into a verified draft',async()=>{
  const calls=[];
  await assert.rejects(publishGitHubArchives(release,'dist',{view:()=>remote(['unexpected.zip']),run:args=>calls.push(args)}),/outside the manifest/);
  assert.deepEqual(calls,[]);
});
test('published incomplete releases are not changed even when mutable',async()=>{
  const calls=[];
  await assert.rejects(publishGitHubArchives(release,'dist',{view:()=>remote([],{isDraft:false}),run:args=>calls.push(args)}),/published release is missing/);
  assert.deepEqual(calls,[]);
});
