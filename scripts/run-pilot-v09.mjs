// Local observer setup only: no participant messaging, publication, or result grading.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRelease,sha256} from './release-validation.mjs';

const usage='Usage: node scripts/run-pilot-v09.mjs <release-directory> [--port 0..65535] [--prepare-only]';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log(usage);process.exit(0);}
assert.ok(args[0]&&!args[0].startsWith('--'),usage);
const directory=resolve(args.shift());let port=0,prepareOnly=false;
while(args.length){
  const flag=args.shift();
  if(flag==='--port'){const value=args.shift();assert.match(value??'',/^\d+$/,usage);port=Number(value);assert.ok(Number.isSafeInteger(port)&&port<=65535,usage);}
  else if(flag==='--prepare-only')prepareOnly=true;
  else throw new Error(`Unknown option: ${flag}\n${usage}`);
}

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const release=await loadRelease(directory),{manifest,manifestSha256,identity}=release;
const archiveName=`vesora-core-${identity.npm}.tgz`,archive=join(directory,archiveName);
const archiveSha256=manifest.files.find(file=>file.name===archiveName).sha256;
const parent=join(repo,'artifacts','v09','pilot');await mkdir(parent,{recursive:true});
const output=await mkdtemp(join(parent,`${identity.npm}-`));
const installed=join(output,'installed','package');await mkdir(join(installed,'dist'),{recursive:true});
const fixture=join(output,'fixture');await mkdir(fixture);
const assets=new Map(),sources=[];
const remember=async(route,bytes,type,path,origin)=>{
  await writeFile(path,bytes);assets.set(route,{bytes,type});
  sources.push({route,origin,file:path,sha256:sha256(bytes),bytes:bytes.length});
};

// Extract only named regular-file bytes. The archive never selects filesystem paths.
for(const member of ['package.json',...['index','worker','viewer','labs'].map(name=>`dist/${name}.js`)]){
  const bytes=execFileSync('tar',['-xOzf',archive,`package/${member}`],{windowsHide:true,maxBuffer:64*1024*1024});
  if(member==='package.json'){
    const pkg=JSON.parse(bytes);assert.equal(pkg.name,'@vesora/core');assert.equal(pkg.version,identity.npm);
    await writeFile(join(installed,member),bytes);
  }else{
    const name=member.slice(5,-3);assert.equal(sha256(bytes),manifest.runtime[name],`Extracted ${name} differs from the release runtime`);
    await remember(`/packages/core/${member}`,bytes,'text/javascript; charset=utf-8',join(installed,member),`${archiveName}:package/${member}`);
  }
}
assert.equal(sha256(await readFile(archive)),archiveSha256,'Core archive changed while preparing the pilot');
for(const name of ['v09-surface-lab.js','v09-common.js']){
  const source=join(repo,'examples','web',name),bytes=await readFile(source);
  await remember(`/examples/web/${name}`,bytes,'text/javascript; charset=utf-8',join(fixture,name),`checkout:examples/web/${name}`);
}

const page=Buffer.from(`<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vesora çalışma oturumu</title><link rel="stylesheet" href="/pilot.css"></head>
<body><main><header><span class="brand">vesora.</span><span>Bilimsel çalışma alanı · sentetik veri</span></header>
<div id="demo"></div><p id="error" role="alert" hidden></p></main><script type="module" src="/pilot.js"></script></body></html>`);
const style=Buffer.from(`:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#edf0f4;background:#101215}*{box-sizing:border-box}body{margin:0}main{max-width:1260px;margin:auto;padding:24px}header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px;color:#a2abb8;font-size:13px}.brand{font-size:22px;font-weight:700;color:#edf0f4}.demo-copy,.demo-controls{display:none}.demo-status{font-size:12px;color:#a2abb8;min-height:1.5em}#error{color:#ffb3a8}@media(max-width:640px){main{padding:12px}header{align-items:flex-start}}`);
const bootstrap=Buffer.from(`import {mountSurfaceLab} from '/examples/web/v09-surface-lab.js';
import {producerLoop} from '/examples/web/v09-common.js';
let current,stopProducer;
try{
  current=await mountSurfaceLab(document.querySelector('#demo'));
  document.querySelector('.demo-copy')?.remove();
  document.querySelector('.demo-controls')?.remove();
  const status=document.querySelector('.demo-status');
  if(status)status.textContent='Sentetik canlı veri · 65 × 49 kaynak düğümü · saniyede bir kaynak güncellemesi';
  let tick=0;
  stopProducer=producerLoop(()=>current.advance(++tick*.12),1000,error=>{
    const message=document.querySelector('#error');message.hidden=false;message.textContent='Veri üreticisi durdu: '+error.message;
  });
}catch(error){const message=document.querySelector('#error');message.hidden=false;message.textContent=error.message;}
window.addEventListener('pagehide',()=>{stopProducer?.();current?.dispose();},{once:true});
`);
await remember('/',page,'text/html; charset=utf-8',join(fixture,'index.html'),'pilot wrapper');
await remember('/pilot.css',style,'text/css; charset=utf-8',join(fixture,'pilot.css'),'pilot wrapper');
await remember('/pilot.js',bootstrap,'text/javascript; charset=utf-8',join(fixture,'pilot.js'),'pilot wrapper');
await writeFile(join(output,'release-manifest.json'),release.manifestBytes);
const template=await readFile(join(repo,'docs','pilot','v0.9.0','results-template.md'));
let results=template.toString('utf8');
const scene=sources.find(source=>source.route==='/examples/web/v09-surface-lab.js');
for(const [field,value]of [
  ['RC sürümü / kaynak commit',`${manifest.version} / ${manifest.commit}`],
  ['Release manifest SHA-256',manifestSha256],
  ['Kurulan arşiv adı / SHA-256',`${archiveName} / ${archiveSha256}`],
  ['Bilimsel örnek dosyası, kaynak türü ve hash\'i',`${scene.origin.replace('checkout:','')} / sentetik, canlı (1 Hz) / ${scene.sha256}`],
]){
  const row=`| ${field} | — |`;assert.equal(results.split(row).length,2,`Results template field changed: ${field}`);
  results=results.replace(row,`| ${field} | ${value} |`);
}
const tasks=await readFile(join(repo,'docs','pilot','v0.9.0','participant-tasks.tr.md'));
await writeFile(join(output,'results.md'),results);await writeFile(join(output,'participant-tasks.tr.md'),tasks);
const documents=[
  {file:'results.md',sha256:sha256(Buffer.from(results)),templateSha256:sha256(template),purpose:'Observer form; only archive/fixture identity prefilled; results remain pending'},
  {file:'participant-tasks.tr.md',sha256:sha256(tasks),purpose:'Unmodified participant task wording'},
];
const provenance={
  preparedAt:new Date().toISOString(),version:manifest.version,commit:manifest.commit,tag:manifest.tag,
  candidate:manifest.candidate,workingTreeDirty:manifest.workingTreeDirty,releaseDirectory:directory,
  manifestSha256,archive:{name:archiveName,sha256:archiveSha256},runtimeHashes:manifest.runtime,
  fixture:{kind:'synthetic-live-surface',producer:true,producerIntervalMs:1000,phasePerUpdate:.12,source:'examples/web/v09-surface-lab.js',
    description:'Mixed surface/scalar field/exact slices demo with one atomic height/profile update per second, continuing while inspection is frozen. Scalar color remains fixed. The wrapper removes instructional demo copy and duplicate source-only slice controls, retaining archive viewer controls. Runtime modules are exact archive bytes; fixture sources are separately hashed. Disposal stops the producer.'},
  sources,documents,server:{host:'127.0.0.1',url:null},pilotResult:'pending',
};
const saveProvenance=()=>writeFile(join(output,'provenance.json'),JSON.stringify(provenance,null,2)+'\n');
await saveProvenance();
console.log(`Candidate: ${manifest.version} (manifest candidate=${manifest.candidate}; dirty=${manifest.workingTreeDirty})\nCommit: ${manifest.commit}\nTag: ${manifest.tag??'none'}\nArchive: ${archiveName}\nArchive SHA-256: ${archiveSha256}\nManifest SHA-256: ${manifestSha256}\nFixture/provenance: ${output}`);
console.log(`Observer results: ${join(output,'results.md')}\nParticipant tasks: ${join(output,'participant-tasks.tr.md')}`);

if(prepareOnly){console.log('Prepared only; no server started. Pilot result remains pending.');}
else{
  const server=createServer((request,response)=>{
    const allowedHost=`127.0.0.1:${server.address().port}`;
    if(request.headers.host!==allowedHost){response.writeHead(403);response.end('Local host only');return;}
    if(request.method!=='GET'&&request.method!=='HEAD'){response.writeHead(405,{Allow:'GET, HEAD'});response.end();return;}
    let path;try{path=new URL(request.url,`http://${allowedHost}`).pathname;}catch{response.writeHead(400);response.end();return;}
    const asset=assets.get(path);
    response.writeHead(asset?200:404,{
      'Content-Type':asset?.type??'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(request.method==='HEAD'?undefined:asset?.bytes??'Not found');
  });
  await new Promise((ready,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',ready);});
  provenance.server.url=`http://127.0.0.1:${server.address().port}/`;await saveProvenance();
  console.log(`URL: ${provenance.server.url}\nOpen the URL in the participant browser. Ctrl+C stops the local server. Pilot result remains pending.`);
  const stop=()=>{server.close();server.closeAllConnections();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
