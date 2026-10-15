// Resume a partially uploaded draft without replacing any existing asset.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {distributedArtifacts,sha256} from './release-validation.mjs';
const repository=fileURLToPath(new URL('../',import.meta.url));

function viewRelease(tag){
  try{return JSON.parse(execFileSync('gh',['release','view',tag,'--json','tagName,assets,isDraft,isPrerelease,isImmutable'],{cwd:repository,encoding:'utf8',windowsHide:true}));}
  catch(error){if(/(?:^|\n)release not found\s*$/i.test(String(error.stderr??'')))return null;throw error;}
}

export async function publishGitHubArchives(release,directory,{
  view=viewRelease,
  run=args=>execFileSync('gh',args,{cwd:repository,stdio:'inherit',windowsHide:true}),
  read=readFile,
  temporary=()=>mkdtemp(join(tmpdir(),'vesora-release-resume-')),
}={}){
  const {identity}=release,files=distributedArtifacts(release);
  let remote=await view(identity.tag);
  if(!remote){
    await run(['release','create',identity.tag,'--draft','--verify-tag','--generate-notes','--title',`Vesora ${identity.canonical} — PRISM`,...(identity.npmTag==='next'?['--prerelease']:[])]);
    remote=await view(identity.tag);
  }
  assert.ok(remote,'Created GitHub draft could not be read');
  assert.equal(remote.tagName,identity.tag);
  assert.equal(remote.isPrerelease,identity.npmTag==='next','Existing GitHub release has a different release channel');
  const existing=new Map();
  const expected=new Set(files.map(file=>file.name));
  for(const asset of remote.assets){assert.ok(expected.has(asset.name),`Unverified GitHub asset outside the manifest: ${asset.name}`);assert.ok(!existing.has(asset.name),`Duplicate GitHub asset: ${asset.name}`);existing.set(asset.name,asset);}
  const missing=files.filter(file=>!existing.has(file.name));
  assert.ok(!remote.isImmutable||missing.length===0,'An immutable release is missing assets; create a new release identity');
  assert.ok(remote.isDraft||missing.length===0,'A published release is missing assets; create a new release identity');
  // Verify every present byte before uploading anything missing. An interrupted
  // upload may have succeeded remotely even when its local command failed.
  const scratch=files.some(file=>existing.has(file.name))?await temporary():undefined;
  for(const file of files){
    if(!existing.has(file.name))continue;
    await run(['release','download',identity.tag,'--pattern',file.name,'--dir',scratch]);
    assert.equal(sha256(await read(join(scratch,file.name))),file.sha256,`Existing GitHub asset differs: ${file.name}; never overwrite it`);
  }
  for(const file of missing)await run(['release','upload',identity.tag,resolve(directory,file.name)]);
  if(remote.isDraft)await run(['release','edit',identity.tag,'--draft=false']);
}
