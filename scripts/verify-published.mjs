// Verify exact-version registry bytes; upload success alone is not a release result.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadRelease,recordPublicationVerification,distributedArtifacts} from './release-validation.mjs';
const directory=resolve(process.argv[2]??''),channel=process.argv[3];
if(!process.argv[2]||!['npm','pypi','github','consumers'].includes(channel))throw new Error('Usage: node scripts/verify-published.mjs RELEASE_DIRECTORY npm|pypi|github|consumers');
const verifiedRelease=await loadRelease(directory,{publishable:true}),{manifest,identity,manifestSha256}=verifiedRelease;
const artifacts=distributedArtifacts(verifiedRelease);
const destination=resolve(directory,'downloaded'),statePath=resolve(directory,'publication-state.json');
await mkdir(destination,{recursive:true});
const state=JSON.parse(await readFile(statePath,'utf8'));assert.equal(state.version,identity.canonical);
assert.equal(state.manifestSha256,manifestSha256,'Publication state belongs to different archive bytes');
const get=async url=>{const response=await fetch(url);if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);return response;};
const download=async(name,url)=>{
  assert.equal(basename(name),name);const expected=artifacts.find(file=>file.name===name);assert.ok(expected,`Unknown artifact ${name}`);
  const bytes=new Uint8Array(await(await get(url)).arrayBuffer()),hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,expected.sha256,`${name}: registry bytes differ from verified archive`);
  await writeFile(resolve(destination,name),bytes);return {name,sha256:hash,url};
};
try{
  const files=[];
  if(channel==='npm')for(const name of ['core','react']){const metadata=await(await get(`https://registry.npmjs.org/${encodeURIComponent(`@vesora/${name}`)}/${identity.npm}`)).json();assert.equal(metadata.version,identity.npm);files.push(await download(`vesora-${name}-${identity.npm}.tgz`,metadata.dist.tarball));}
  else if(channel==='pypi'){const metadata=await(await get(`https://pypi.org/pypi/vesora/${identity.python}/json`)).json(),name=`vesora-${identity.python}-py3-none-any.whl`,file=metadata.urls.find(item=>item.filename===name);assert.ok(file,'Exact-version wheel missing');files.push(await download(name,file.url));}
  else if(channel==='github'){
    const release=await(await get(`https://api.github.com/repos/U-C4N/Vesora/releases/tags/${encodeURIComponent(identity.tag)}`)).json();assert.equal(release.tag_name,identity.tag);
    for(const file of artifacts){const assets=release.assets.filter(asset=>asset.name===file.name);assert.equal(assets.length,1,`GitHub artifact missing or duplicated: ${file.name}`);files.push(await download(file.name,assets[0].browser_download_url));}
  }else{
    for(const name of [`vesora-core-${identity.npm}.tgz`,`vesora-react-${identity.npm}.tgz`,`vesora-${identity.python}-py3-none-any.whl`]){const expected=manifest.files.find(file=>file.name===name);assert.equal(createHash('sha256').update(await readFile(resolve(destination,name))).digest('hex'),expected.sha256);}
    await copyFile(resolve(directory,'release-manifest.json'),resolve(destination,'release-manifest.json'));
    execFileSync(process.execPath,['scripts/verify-packages.mjs',destination],{stdio:'inherit',windowsHide:true});
    for(const version of ['18.3.1','19'])execFileSync(process.execPath,['scripts/verify-react-consumers.mjs',destination],{stdio:'inherit',windowsHide:true,env:{...process.env,VESORA_REACT_VERSION:version}});
  }
  recordPublicationVerification(state,channel,{status:channel==='consumers'?'verified':'download-verified',files,verifiedAt:new Date().toISOString()});
}catch(error){recordPublicationVerification(state,channel,{status:'verification-failed',error:error.message});throw error;}
finally{await writeFile(statePath,JSON.stringify(state,null,2)+'\n');}
