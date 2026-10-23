// Read-only local release status. Never runs tests, changes gates, or publishes.
import {readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadRelease,releaseGates,sha256,validateReleaseManifest} from './release-validation.mjs';

const statuses=new Set(['pending','passed','failed']);
const inside=(root,path)=>{const part=relative(root,path);return Boolean(part)&&!isAbsolute(part)&&part!=='..'&&!part.startsWith('../')&&!part.startsWith('..\\');};
const message=error=>error instanceof Error?error.message:String(error);

export async function inspectReleaseReadiness(directory){
  directory=resolve(directory);
  const result={directory,scope:'Local archive checksums and reviewed report integrity only. This does not run tests, authenticate human observations, verify remote tags, or publish packages.',status:'invalid',allLocalGatesPassed:false,issues:[],gates:[]};
  let release;
  try{release=await loadRelease(directory);}
  catch(error){result.issues.push(`Archive validation: ${message(error)}`);return result;}
  const {manifest,manifestSha256}=release;
  Object.assign(result,{version:manifest.version,commit:manifest.commit,manifestSha256,archivesVerified:true});
  try{validateReleaseManifest(manifest,{publishable:true});}
  catch(error){result.issues.push(`Publication identity: ${message(error)}`);}
  let gates;
  try{gates=JSON.parse(await readFile(resolve(directory,'release-gates.json'),'utf8'));}
  catch(error){result.issues.push(`Gate inventory: ${message(error)}`);return result;}
  for(const [key,expected] of Object.entries({version:manifest.version,commit:manifest.commit,manifestSha256})){
    if(gates?.[key]!==expected)result.issues.push(`Gate inventory ${key} does not match these archives`);
  }
  const realDirectory=await realpath(directory);
  for(const name of releaseGates){
    const entry=gates?.[name],gate={name,status:entry?.status??'missing',evidenceIntegrity:'pending',reports:[],issues:[]};
    if(!statuses.has(entry?.status))gate.issues.push('Missing or invalid gate status');
    if(!Array.isArray(entry?.evidence))gate.issues.push('Evidence list is required');
    else{
      if(entry.status!=='pending'&&!entry.evidence.length)gate.issues.push('A completed gate needs hashed reviewed evidence');
      for(const evidence of entry.evidence){
        try{
          if(typeof evidence?.path!=='string'||isAbsolute(evidence.path))throw new Error('Evidence path must be relative to the release directory');
          const path=resolve(directory,evidence.path);
          if(!inside(directory,path)||!inside(realDirectory,await realpath(path)))throw new Error('Evidence path leaves the release directory');
          if(!/^[a-f0-9]{64}$/.test(evidence.sha256))throw new Error('Invalid evidence SHA-256');
          const bytes=await readFile(path);
          if(sha256(bytes)!==evidence.sha256)throw new Error('Evidence changed after review');
          const report=JSON.parse(bytes);
          for(const [key,expected] of Object.entries({gate:name,status:entry.status,version:manifest.version,commit:manifest.commit,manifestSha256})){
            if(report?.[key]!==expected)throw new Error(`Reviewed report ${key} differs from the gate or archives`);
          }
          gate.reports.push({path:evidence.path,sha256:evidence.sha256,status:report.status});
        }catch(error){gate.issues.push(`${evidence?.path??'(missing path)'}: ${message(error)}`);}
      }
    }
    gate.evidenceIntegrity=gate.issues.length?'invalid':gate.reports.length?'valid':'pending';
    result.gates.push(gate);
  }
  result.counts=Object.fromEntries(['passed','failed','pending','missing'].map(status=>[status,result.gates.filter(gate=>gate.status===status).length]));
  const invalid=result.issues.length>0||result.gates.some(gate=>gate.issues.length);
  result.allLocalGatesPassed=!invalid&&result.gates.every(gate=>gate.status==='passed'&&gate.evidenceIntegrity==='valid');
  result.status=invalid?'invalid':result.allLocalGatesPassed?'ready':'blocked';
  return result;
}

async function main(){
  const args=process.argv.slice(2),json=args.includes('--json'),paths=args.filter(arg=>arg!=='--json');
  if(paths.length>1||paths.some(arg=>arg.startsWith('--')))throw new Error('Usage: node scripts/check-release-readiness.mjs [RELEASE_DIRECTORY] [--json]');
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const directory=paths[0]??resolve(root,'dist',`release-v${JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version}`);
  const result=await inspectReleaseReadiness(directory);
  if(json)console.log(JSON.stringify(result,null,2));
  else{
    console.log(`Release ${result.version??directory}: ${result.status}`);
    console.log(result.scope);
    for(const gate of result.gates){console.log(`${gate.name}: ${gate.status}; evidence ${gate.evidenceIntegrity}`);for(const issue of gate.issues)console.log(`  ${issue}`);}
    for(const issue of result.issues)console.log(issue);
  }
  process.exitCode=result.status==='ready'?0:result.status==='blocked'?1:2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(message(error));process.exitCode=2;});
