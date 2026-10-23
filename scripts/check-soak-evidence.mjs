// Read-only inspection of run-soaks-sequential evidence. Never collects or publishes a gate.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRelease,sha256} from './release-validation.mjs';
import {checkAwake,validateSoakReport} from './soak-sequential-contracts.mjs';

export const freshnessSeconds=120; // Observational staleness, not a performance acceptance threshold.
export const requiredHarnesses=[
  'scripts/run-soaks-sequential.mjs','scripts/run-soaks-awake.ps1','scripts/soak-sequential-contracts.mjs',
  'scripts/release-validation.mjs','scripts/release-identity.mjs','scripts/run-host-soaks.mjs','scripts/soak-browser-v09.mjs',
  'tests/soak/resources.py','tests/soak/host_workload.py','tests/soak/jupyter_workload.py','tests/soak/verify_environment.py',
  'tests/python/test_v09_soak_desktop.py','tests/python/test_linked_desktop.py','tests/browser/jupyter-soak.spec.mjs',
  'tests/browser/jupyter/server.py','playwright.jupyter-soak.config.ts','playwright.config.ts','pyproject.toml',
];
const hosts=['browser','qt','jupyter'],hashPattern=/^[a-f0-9]{64}$/;
class Incomplete extends Error {}
const date=value=>{const ms=Date.parse(value);assert.ok(Number.isFinite(ms),`Invalid timestamp: ${value}`);return ms;};
const inside=(root,path)=>{const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\');};
async function contained(root,path,expected){
  assert.equal(typeof path,'string','Missing evidence path');
  const absolute=resolve(root,path);
  assert.ok(inside(resolve(root),absolute),`Escaping evidence reference: ${path}`);
  if(expected)assert.equal(absolute,resolve(expected),`Unexpected evidence filename: ${path}`);
  const actual=await realpath(absolute),boundary=await realpath(root);
  assert.ok(inside(boundary,actual),`Evidence realpath escapes its directory: ${path}`);
  return actual;
}
const expectedReport=(run,host,phase)=>host==='browser'?join(run,host,'browser.json'):join(run,host,phase,host,`${host}-soak.json`);
async function hashedFile(root,path,hash,expected){
  assert.match(hash??'',hashPattern,'Missing or invalid evidence SHA256');
  const file=await contained(root,path,expected),bytes=await readFile(file);
  assert.equal(sha256(bytes),hash,`Evidence SHA256 mismatch: ${path}`);
  return bytes;
}
function jsonl(text,{allowPartial=false}={}){
  const lines=text.split(/\r?\n/);let partial=false;
  if(lines.at(-1)==='')lines.pop();
  else if(allowPartial){lines.pop();partial=true;}
  return {rows:lines.map(line=>JSON.parse(line)),partial};
}
async function snapshot(run){
  // The writer appends resources before persisting summary. Read a stable summary around the logs.
  for(let attempt=0;attempt<3;attempt++){
    const before=await readFile(join(run,'summary.json'));
    const summary=JSON.parse(before),live=['running','preparing'].includes(summary.status);
    const optional=async name=>{try{return await readFile(await contained(run,join(run,name)), 'utf8');}catch(error){if(error.code==='ENOENT'&&live)return '';throw error;}};
    const resources=await optional('resources.jsonl'),guard=await optional('power-guard.jsonl');
    const after=await readFile(join(run,'summary.json'));
    if(!before.equals(after))continue;
    return {summary,summarySha256:sha256(before),resources:{...jsonl(resources,{allowPartial:live}),sha256:sha256(resources)},guard:{...jsonl(guard,{allowPartial:live}),sha256:sha256(guard)}};
  }
  throw new Incomplete('Summary changed during all three read attempts; inspect again.');
}
function memoryInformation(rows){
  return Object.fromEntries(hosts.map(host=>{
    const samples=rows.filter(row=>row.host===host),owned=samples.filter(row=>Number.isFinite(row.ownedRssSumBytes));
    return [host,{sampleCount:samples.length,ownedSampleCount:owned.length,
      minimumAvailableBytes:samples.length?Math.min(...samples.map(row=>row.availableMemoryBytes)):null,
      firstOwnedRssBytes:owned[0]?.ownedRssSumBytes??null,lastOwnedRssBytes:owned.at(-1)?.ownedRssSumBytes??null,
      maximumOwnedRssBytes:owned.length?Math.max(...owned.map(row=>row.ownedRssSumBytes)):null}];
  }));
}
function verifyEnvironment(evidence,summary,manifest,releaseDirectory){
  assert.ok(evidence&&evidence.installed_package===true,'Missing installed-environment verification');
  assert.equal(evidence.vesora_version,manifest.pythonVersion);assert.equal(evidence.profile,'isolated');
  assert.equal(evidence.latency_reference,true);
  const wheel=manifest.files.find(file=>file.name.endsWith('.whl'));
  assert.equal(evidence.wheel_sha256,wheel.sha256);assert.equal(resolve(evidence.wheel),join(releaseDirectory,wheel.name));
  assert.ok(Number.isSafeInteger(evidence.verified_wheel_members)&&evidence.verified_wheel_members>0,'No verified wheel members');
  assert.ok(inside(resolve(summary.environment),resolve(evidence.module)),'Installed module is outside the recorded environment');
  for(const key of ['python','platform','PySide6','aiohttp','anywidget','jupyterlab','ipykernel'])assert.ok(typeof evidence[key]==='string'&&evidence[key],`Missing environment ${key}`);
}
async function verifyHtml(root,path,evidence,retention){
  assert.ok(evidence,'Missing HTML export evidence');assert.match(evidence.sha256??'',hashPattern);
  const bytes=await readFile(await contained(root,path,path)),text=bytes.toString('utf8');
  // Undo exactly one Windows newline translation. Qt write_text can produce CRCRLF
  // for CRLF already present in the exported runtime; stripping lone CR changes its hash.
  const rawSha256=sha256(bytes),lfNormalizedSha256=sha256(text.replace(/\r\n/g,'\n'));
  assert.ok(evidence.sha256===rawSha256||evidence.sha256===lfNormalizedSha256,`HTML SHA256 mismatch: ${path}`);
  const match=text.match(/<script\b[^>]*\bid=["']vesora-payload["'][^>]*>([\s\S]*?)<\/script>/);
  assert.ok(match,'Missing source-bound HTML payload');const payload=JSON.parse(match[1]);
  assert.deepEqual(payload.capture,evidence.capture,'HTML capture differs from report');
  assert.equal(payload.capture.source,'displayed');date(payload.capture.capturedAt);
  assert.ok(Number.isSafeInteger(payload.capture.frameId)&&payload.capture.frameId>0);
  assert.equal(payload.snapshot.figure.inspection.frameId,payload.capture.frameId);
  const sources=payload.snapshot.sources,buffers=payload.buffers,layers=payload.snapshot.figure.layers;
  assert.equal(sources.length,6);assert.equal(buffers.length,6);assert.equal(layers.length,3);
  const sourceMap=new Map(sources.map(source=>[source.id,source])),bufferMap=new Map(buffers.map(buffer=>[buffer.id,buffer]));
  assert.equal(sourceMap.size,6,'Duplicate source IDs');assert.equal(bufferMap.size,6,'Duplicate buffer IDs');
  assert.deepEqual([...sourceMap.keys()].sort(),[...bufferMap.keys()].sort(),'Missing source-bound buffers');
  const referenced=[];
  for(const layer of layers){assert.equal(layer.kind,'line');referenced.push(layer.data.x,layer.data.y);}
  assert.deepEqual(referenced.sort(),[...sourceMap.keys()].sort(),'Layer/source references differ');
  for(const source of sources){
    assert.equal(source.dtype,'float64');assert.deepEqual(source.shape,[retention]);assert.equal(source.byteLength,retention*8);
    const encoded=bufferMap.get(source.id).base64;assert.equal(typeof encoded,'string');
    const decoded=Buffer.from(encoded,'base64');assert.equal(decoded.length,source.byteLength);
    assert.equal(decoded.toString('base64'),encoded,'Noncanonical or truncated source buffer');
  }
  const range=evidence.retained_range;
  assert.ok(Array.isArray(range)&&range.length===3&&range.every(Number.isSafeInteger));
  assert.equal(range[2],retention);assert.equal(range[1]-range[0]+1,retention);
  return {path,rawSha256,lfNormalizedSha256,reportHashMode:evidence.sha256===rawSha256?'raw':'crlf-to-lf',capture:payload.capture};
}
async function verifyPng(root,path,evidence){
  assert.ok(evidence,'Missing PNG evidence');
  const bytes=await hashedFile(root,evidence.path,evidence.sha256,path);
  assert.ok(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Invalid PNG signature');
  assert.equal(bytes.toString('ascii',12,16),'IHDR');
  assert.equal(bytes.readUInt32BE(16),evidence.width);assert.equal(bytes.readUInt32BE(20),evidence.height);
  assert.ok(evidence.width>0&&evidence.height>0);
  return {path,rawSha256:evidence.sha256,width:evidence.width,height:evidence.height};
}
async function verifyExports(host,report,reportPath,retention){
  if(host==='browser')return {scope:'HTML/PNG validated in browser memory by the hashed harness; no export files were retained.',retainedFiles:[]};
  const root=dirname(reportPath),files=[];
  const exports=host==='qt'?report.cycles.map(cycle=>({...cycle.export,png:cycle.png})):report.validated_frozen_exports;
  assert.equal(exports?.length,report.cycles.length,'Each freeze cycle needs a validated frozen export');
  for(let i=0;i<exports.length;i++){
    const entry=exports[i],cycle=report.cycles[i],stem=`frozen-${String(i).padStart(3,'0')}`;
    assert.equal(entry.capture.frameId,cycle.held.frameId,'Frozen export frame differs from held frame');
    assert.ok(typeof entry.capture.snapshotId==='string'&&entry.capture.snapshotId,'Missing frozen snapshot identity');
    if(host==='qt')assert.equal(entry.capture.snapshotId,cycle.held.snapshotId);
    else assert.deepEqual(entry.capture,cycle.capture);
    files.push(await verifyHtml(root,join(root,`${stem}.html`),entry,retention));
    files.push(await verifyPng(root,join(root,`${stem}.png`),entry.png));
  }
  assert.deepEqual(report.final_export?.retained_range,[report.next_sequence-retention,report.next_sequence-1,retention],'Final export retained range differs from producer');
  files.push(await verifyHtml(root,join(root,'final-displayed.html'),report.final_export,retention));
  return {scope:'Retained HTML raw/LF-normalized hashes, capture/source completeness and PNG raw hashes/dimensions. No visual or per-value mathematical oracle.',retainedFiles:files};
}

export async function checkSoakEvidence(releaseDirectory,runDirectory,{now=Date.now(),workspaceRoot=process.cwd()}={}){
  const releasePath=resolve(releaseDirectory),run=resolve(runDirectory);
  const result={status:'incomplete',qualifiesTwoHourGate:false,releaseDirectory:releasePath,runDirectory:run,
    checkedAt:new Date(now).toISOString(),reasons:[],checks:[],jobs:{},
    scope:'Read-only run evidence inspection; does not update release gates, authenticate a publisher, prove current PID liveness, or complete human accessibility/pilot gates.',
    environmentScope:'Checks recorded installed-wheel verification and cross-host environment identity against the current archive; does not rerun Python or rehash every installed package member.',
    memoryScope:'Informational sampled process working sets, potentially double-counting shared pages; not GPU memory, a leak verdict, or a latency benchmark.'};
  const check=async(name,fn)=>{try{const value=await fn();result.checks.push({name,status:'passed'});return value;}catch(error){const status=error instanceof Incomplete||error.code==='ENOENT'?'incomplete':'failed';result.checks.push({name,status});result.reasons.push({check:name,status,message:error.message});return undefined;}};
  const release=await check('release',()=>loadRelease(releasePath,{publishable:true}));
  const observed=await check('snapshot',async()=>{await contained(run,join(run,'summary.json'));return snapshot(run);});
  if(!release||!observed)return finish();
  const {summary,resources,guard}=observed,{manifest,manifestSha256}=release;
  result.summarySha256=observed.summarySha256;result.reportedStatus=summary.status;result.phase=summary.phase;result.hosts=summary.hosts;
  result.version=manifest.version;result.archiveCommit=manifest.commit;result.manifestSha256=manifestSha256;
  const live=['running','preparing'].includes(summary.status),seconds=summary.phase==='full'?7200:30,retention=summary.phase==='full'?100000:1000;
  await check('identity',()=>{
    assert.ok(['preparing','running','passed','failed'].includes(summary.status),'Unknown supervisor status');
    assert.equal(summary.version,manifest.version);assert.equal(summary.archiveCommit,manifest.commit);assert.equal(summary.manifestSha256,manifestSha256);
    assert.equal(resolve(summary.releaseDirectory),releasePath);assert.equal(summary.profile,'isolated');
    assert.ok(['short','full'].includes(summary.phase),'Unknown phase');assert.equal(summary.requestedSeconds,seconds);
    assert.ok(Array.isArray(summary.hosts)&&summary.hosts.length>0&&new Set(summary.hosts).size===summary.hosts.length&&summary.hosts.every(host=>hosts.includes(host)),'Invalid host subset');
    assert.ok(summary.jobs&&Object.keys(summary.jobs).every(host=>summary.hosts.includes(host)),'Unexpected job host');
    date(summary.startedAt);assert.equal(typeof summary.workspaceInitial?.status,'string');assert.match(summary.workspaceInitial?.head??'',/^[a-f0-9]{40,64}$/);
    if(summary.status==='passed'){
      assert.equal(summary.qualifiesTwoHourGate,summary.phase==='full'&&summary.hosts.length===3,'Incorrect two-hour qualification claim');
      assert.ok(date(summary.completedAt)>=date(summary.startedAt));
    }
  });
  await check('harnesses',async()=>{
    assert.deepEqual(Object.keys(summary.harnesses??{}).sort(),[...requiredHarnesses].sort(),'Harness fingerprint list differs');
    for(const path of requiredHarnesses)await hashedFile(resolve(workspaceRoot),path,summary.harnesses[path]);
  });
  await check('environment',async()=>{
    if(!summary.verifiedEnvironment&&summary.status==='preparing')throw new Incomplete('Environment verification has not completed.');
    verifyEnvironment(summary.verifiedEnvironment,summary,manifest,releasePath);
    await contained(summary.environment,summary.verifiedEnvironment.module);
  });
  await check('short-prerequisites',async()=>{
    if(summary.phase!=='full'){assert.deepEqual(summary.shortReferences,[]);return;}
    assert.deepEqual(summary.shortReferences?.map(entry=>entry.host).sort(),[...summary.hosts].sort(),'Missing same-archive short prerequisite');
    for(const reference of summary.shortReferences){
      // Prerequisites may live outside this run's parent, but must remain in the inspected workspace.
      const bytes=await hashedFile(resolve(workspaceRoot),reference.path,reference.sha256);
      validateSoakReport(reference.host,JSON.parse(bytes),manifest,manifestSha256,{seconds:30,retention:1000});
    }
  });
  await check('resources',()=>{
    assert.ok(Array.isArray(summary.resourceSamples),'Missing resource summary');
    assert.ok(summary.resourceSamples.length<=resources.rows.length,'Resources JSONL is behind the summary');
    assert.deepEqual(resources.rows.slice(0,summary.resourceSamples.length),summary.resourceSamples,'Resource summary is not a JSONL prefix');
    if(!live)assert.equal(summary.resourceSamples.length,resources.rows.length,'Completed resources must match the entire JSONL');
    if(!resources.rows.length)throw new Incomplete('No resource samples recorded yet.');
    let previous;const visited=[];
    for(const row of resources.rows){
      assert.ok(summary.hosts.includes(row.host),'Resource sample belongs to another host');
      if(visited.at(-1)!==row.host){assert.ok(!visited.includes(row.host),'Host resource samples are interleaved');visited.push(row.host);}
      assert.ok(date(row.at)>=date(summary.startedAt),'Resource sample predates run');
      if(previous){assert.ok(date(row.at)>=date(previous.at),'Resource timestamps moved backwards');
        if(date(row.at)-date(previous.at)>freshnessSeconds*1000)throw new Incomplete('Resource sampling has an unobserved interval over 120 seconds.');}
      checkAwake(previous,row);previous=row;
    }
    assert.deepEqual(visited,summary.hosts.slice(0,visited.length),'Resources are not in the requested host order');
    if(live){
      const age=(now-date(resources.rows.at(-1).at))/1000;result.latestSampleAgeSeconds=age;
      if(age>freshnessSeconds)throw new Incomplete(`Resource evidence is stale (${age.toFixed(1)} seconds).`);
      assert.ok(age>=-5,'Resource timestamp is in the future');
    }
    result.resources={summarySamples:summary.resourceSamples.length,jsonlSamples:resources.rows.length,
      pendingPartialLine:resources.partial,observedJsonlSha256:resources.sha256,firstAt:resources.rows[0].at,lastAt:resources.rows.at(-1).at};
  });
  result.memory=memoryInformation(resources.rows.filter(row=>row&&typeof row==='object'));
  await check('power-guard',async()=>{
    await contained(run,summary.powerGuard?.path,join(run,'power-guard.jsonl'));
    const events=guard.rows;assert.ok(events.length>0,'Missing native guard events');
    assert.ok(Number.isSafeInteger(summary.powerGuard.pid)&&summary.powerGuard.pid>0);
    for(let i=0;i<events.length;i++){
      assert.equal(events[i].pid,summary.powerGuard.pid,'Guard PID differs');date(events[i].atUtc);
      if(i)assert.ok(date(events[i].atUtc)>=date(events[i-1].atUtc),'Guard timestamps moved backwards');
    }
    assert.equal(events[0].event,'acquired');assert.equal(events[0].flags,'0x80000003');
    assert.ok(date(events[0].atUtc)<=date(summary.startedAt));
    if(events.length<2)throw new Incomplete('Native guard has not recorded child startup.');
    assert.equal(events[1].event,'child-started');assert.equal(events[1].ownedJobKillOnClose,true);
    assert.ok(Number.isSafeInteger(events[1].childPid)&&events[1].childPid>0);
    assert.ok(events.length<=4,'Unexpected native guard events');
    if(events[2]){assert.equal(events[2].event,'child-exited');assert.equal(events[2].exitCode,0,'Native guarded child failed');}
    if(events[3]){assert.equal(events[3].event,'released');assert.equal(events[3].success,true,'Native power request not released');}
    result.powerGuard={pid:summary.powerGuard.pid,childPid:events[1].childPid,released:events[3]?.success===true,observedJsonlSha256:guard.sha256};
    if(live&&events[2])throw new Incomplete('Guarded child exited while summary still reports an active run.');
    if(!live){
      if(events.length!==4)throw new Incomplete('Native child exit and successful guard release have not both been recorded.');
      assert.ok(date(events[2].atUtc)>=date(summary.completedAt),'Guard child exit predates completed summary');
    }
  });
  for(const host of Array.isArray(summary.hosts)?summary.hosts:[]){
    await check(`job:${host}`,async()=>{
      const job=summary.jobs?.[host];
      if(!job){if(live){result.jobs[host]={status:'not-started'};return;}throw new Incomplete(`Missing ${host} job.`);}
      assert.ok(['running','passed','failed'].includes(job.status),'Unknown job status');
      const reportPath=expectedReport(run,host,summary.phase),logPath=join(run,`${host}.log`);
      // A running report does not exist yet, but its declared filename must still be safe.
      assert.equal(resolve(job.reportPath),reportPath,'Unexpected report filename');
      await contained(run,job.logPath,logPath);assert.ok(date(job.startedAt)>=date(summary.startedAt));
      const rows=resources.rows.filter(row=>row.host===host);
      assert.deepEqual(rows[0],job.preflight,'Job preflight is not its first resource sample');
      result.jobs[host]={status:job.status,pid:job.pid,reportPath,logPath};
      if(job.status==='failed')throw new Error(job.error??`${host} runner failed`);
      if(job.status==='running'){if(!live)throw new Incomplete(`${host} has not completed.`);return;}
      assert.equal(job.exit?.code,0);assert.equal(job.exit?.signal,null);
      const bytes=await hashedFile(run,job.reportPath,job.reportSha256,reportPath);
      await hashedFile(run,job.logPath,job.logSha256,logPath);
      const report=JSON.parse(bytes),accounting=validateSoakReport(host,report,manifest,manifestSha256,{seconds,retention});
      for(const [key,value] of Object.entries(accounting))assert.equal(job[key],value,`Summary accounting differs: ${key}`);
      assert.ok(date(job.completedAt)>=date(job.startedAt));
      assert.ok(rows.some(row=>row.processes?.some(process=>process.pid===job.pid)),'Missing owned-process sample');
      assert.ok((date(rows.at(-1).at)-date(rows[0].at))/1000>=accounting.actualProducerSeconds,'Resource evidence does not span producer duration');
      assert.ok(date(rows.at(-1).at)<=date(job.completedAt),'Resource sample follows completed host');
      if(host!=='browser'){
        verifyEnvironment(report.evidence,summary,manifest,releasePath);
        for(const [key,value] of Object.entries(summary.verifiedEnvironment))assert.deepEqual(report.evidence[key],value,`Host environment differs: ${key}`);
      }
      Object.assign(result.jobs[host],accounting,{reportSha256:job.reportSha256,logSha256:job.logSha256,
        exports:await verifyExports(host,report,reportPath,retention),hostExtensionErrors:report.host_extension_errors??[]});
    });
  }
  if(summary.status==='failed')result.reasons.push({check:'supervisor',status:'failed',message:summary.error??'Supervisor reported failure.'});
  if(summary.status==='passed'&&Array.isArray(summary.hosts)&&summary.hosts.some(host=>summary.jobs?.[host]?.status!=='passed'))
    result.reasons.push({check:'completion',status:'incomplete',message:'Not every requested host completed successfully.'});
  return finish();

  function finish(){
    result.status=result.reasons.some(reason=>reason.status==='failed')?'failed':result.reasons.length?'incomplete':
      result.reportedStatus==='passed'?'passed':['running','preparing'].includes(result.reportedStatus)?'running':'incomplete';
    result.qualifiesTwoHourGate=result.status==='passed'&&result.phase==='full'&&result.hosts?.length===3;
    return result;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),json=args.includes('--json'),positional=args.filter(arg=>arg!=='--json');
  if(positional.length!==2||positional.some(arg=>arg.startsWith('--'))){console.error('Usage: node scripts/check-soak-evidence.mjs RELEASE RUN [--json]');process.exitCode=2;}
  else{
    const result=await checkSoakEvidence(...positional);
    if(json)console.log(JSON.stringify(result,null,2));
    else{
      console.log(`${result.status}: ${result.runDirectory}\nTwo-hour gate qualified: ${result.qualifiesTwoHourGate}`);
      for(const reason of result.reasons)console.log(`${reason.status} ${reason.check}: ${reason.message}`);
      console.log('Read-only evidence check; human gates and release records are unchanged.');
    }
    process.exitCode=['passed','running'].includes(result.status)?0:1;
  }
}
