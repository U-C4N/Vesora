// Publish only previously built, verified archives. No workspace packing occurs here.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRelease,validateReleaseGates,validateTagCommit,validateRemoteTagCommit,recordPublicationVerification} from './release-validation.mjs';
import {publishGitHubArchives} from './github-release.mjs';

const directory=resolve(process.argv[2]??''), channel=process.argv[3];
if(!process.argv[2]||!['npm','pypi','github'].includes(channel))throw new Error('Usage: npm run publish:packages -- dist/release-vVERSION npm|pypi|github');
const release=await loadRelease(directory,{publishable:true}),{manifest,manifestSha256,identity}=release;
validateTagCommit(manifest,execFileSync('git',['rev-parse','--verify',`${identity.tag}^{commit}`],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',windowsHide:true}));
const gates=JSON.parse(await readFile(resolve(directory,'release-gates.json'),'utf8'));
await validateReleaseGates(directory,gates,release);
validateRemoteTagCommit(manifest,execFileSync('git',['ls-remote','--tags','origin',`refs/tags/${identity.tag}`,`refs/tags/${identity.tag}^{}`],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',windowsHide:true}));
const statePath=resolve(directory,'publication-state.json');
let state;try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={version:identity.canonical,manifestSha256,commit:manifest.commit,channels:{}};}
assert.equal(state.version,identity.canonical);
assert.equal(state.manifestSha256,manifestSha256,'A publication attempt is bound to immutable archives; changed bytes require a new release identity');
const record=async(name,status,detail)=>{recordPublicationVerification(state,name,{status,detail,updatedAt:new Date().toISOString()});await writeFile(statePath,JSON.stringify(state,null,2)+'\n');};
const run=(command,args)=>execFileSync(command,args,{stdio:'inherit',windowsHide:true});
if(['uploaded','download-verified','verified','verification-failed'].includes(state.channels[channel]?.status))throw new Error(`${channel} was already uploaded. Retry exact-version verification; never overwrite a release.`);
try{
  if(channel==='npm'){
    const npm=process.env.npm_execpath;if(!npm)throw new Error('Run through npm run publish:packages');
    for(const pkg of ['core','react']){
      const key=`npm-${pkg}`;if(state.channels[key]?.status==='uploaded')continue;
      run(process.execPath,[npm,'publish',resolve(directory,`vesora-${pkg}-${identity.npm}.tgz`),'--access','public','--tag',identity.npmTag]);
      await record(key,'uploaded','Exact manifest archive uploaded; registry download verification pending');
    }
  }else if(channel==='pypi')run(process.env.VESORA_PYTHON??'python',['-m','twine','upload',resolve(directory,`vesora-${identity.python}-py3-none-any.whl`)]);
  else await publishGitHubArchives(release,directory);
  await record(channel,'uploaded','Upload finished; exact-version download/hash/install verification still required');
}catch(error){await record(channel,'failed',error.message);throw error;}
