import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {checkSoakEvidence,requiredHarnesses} from '../../scripts/check-soak-evidence.mjs';
import {releaseFileNames,sha256} from '../../scripts/release-validation.mjs';

const start=Date.parse('2026-10-23T10:00:00Z'),iso=seconds=>new Date(start+seconds*1000).toISOString();
const save=async(path,data)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,typeof data==='string'||Buffer.isBuffer(data)?data:JSON.stringify(data));};
const jsonl=rows=>rows.map(row=>JSON.stringify(row)+'\n').join('');
async function fixture(t,{phase='short',hosts=['browser','qt','jupyter']}={}){
  const root=await mkdtemp(join(tmpdir(),'vesora-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const release=join(root,'release'),run=join(root,'runs','current'),env=join(root,'environment');
  const manifest={version:'0.9.0-rc.6',pythonVersion:'0.9.0rc6',commit:'a'.repeat(40),tag:'v0.9.0-rc.6',candidate:false,workingTreeDirty:false,
    protocolVersions:[1,2,3,4,5,6,7],transportVersions:[2,3],runtime:Object.fromEntries(['index','worker','viewer','labs'].map(key=>[key,sha256(key)])),
    files:releaseFileNames('0.9.0-rc.6').map(name=>({name,sha256:sha256(name)}))};
  for(const file of manifest.files)await save(join(release,file.name),file.name);
  const manifestBytes=JSON.stringify(manifest),manifestHash=sha256(manifestBytes);
  await save(join(release,'release-manifest.json'),manifestBytes);
  await save(join(release,'SHA256SUMS.txt'),[...manifest.files,{name:'release-manifest.json',sha256:manifestHash}].map(file=>`${file.sha256}  ${file.name}\n`).join(''));
  const wheel=manifest.files.find(file=>file.name.endsWith('.whl'));
  const evidence={vesora_version:manifest.pythonVersion,module:join(env,'vesora','__init__.py'),installed_package:true,
    python:'3.14.6',platform:'Windows',profile:'isolated',latency_reference:true,wheel:join(release,wheel.name),wheel_sha256:wheel.sha256,
    verified_wheel_members:23,PySide6:'6.11.2',aiohttp:'3.14.3',anywidget:'0.11.0',jupyterlab:'4.6.4',ipykernel:'7.4.0'};
  await save(evidence.module,'installed package');
  const harnesses={};for(const path of requiredHarnesses){await save(join(root,path),path);harnesses[path]=sha256(path);}
  const seconds=phase==='full'?7200:30,retention=phase==='full'?100000:1000;
  const summary={status:'passed',version:manifest.version,archiveCommit:manifest.commit,manifestSha256:manifestHash,
    releaseDirectory:release,environment:env,phase,hosts,requestedSeconds:seconds,profile:'isolated',startedAt:iso(0),
    powerGuard:{pid:11,path:join(run,'power-guard.jsonl')},workspaceInitial:{head:manifest.commit,status:' M unrelated.md'},
    harnesses,shortReferences:[],jobs:{},resourceSamples:[],verifiedEnvironment:evidence,qualifiesTwoHourGate:phase==='full'&&hosts.length===3};
  const reports={},guard=[{atUtc:iso(-1),pid:11,event:'acquired',flags:'0x80000003'},
    {atUtc:iso(-0.5),pid:11,event:'child-started',childPid:12,ownedJobKillOnClose:true}];
  function report(host,reportSeconds=seconds,reportRetention=retention){
    if(host==='browser')return {status:'passed',version:manifest.version,manifestSha256:manifestHash,profile:'isolated',latencyReference:true,
      requestedSeconds:reportSeconds,runtimeHashes:manifest.runtime,qualifiesTwoHourGate:reportSeconds>=7200,
      archiveSha256:manifest.files[0].sha256,browserErrors:[],result:{errors:[],producerDurationSeconds:reportSeconds+0.1,
        accepted:2,covered:2,batches:2,pendingPresentations:0,acceptanceMs:[1,2],liveFrameLatencyMs:[1],frozenFrameLatencyMs:[2],
        exports:1,freezes:1,totalRows:200,states:Array.from({length:3},()=>({retained:reportRetention,nextSequence:reportRetention+200})),
        diagnostics:{sourceBytes:48*reportRetention,contextLost:false,pendingAppends:0,pendingExports:0,snapshotBytes:0},
        afterClose:{sourceBytes:0,pendingAppends:0,snapshotBytes:0},remainingCanvases:0,
        schedulerAfterClose:{worker:false,workerSourceBytes:0,pending:0,lineIndex:{fallback:{indexBytes:0,retainedBytes:0},worker:{indexBytes:0,retainedBytes:0}}}}};
    return {status:'passed',host,evidence:{...evidence},two_hour_duration_met:reportSeconds>=7200,exact_wheel_verified:true,
      requested_seconds:reportSeconds,actual_producer_seconds:reportSeconds+0.1,accepted_batches:2,next_sequence:reportRetention+200,
      live_presentation_latency:{count:1},presentation_across_freeze_latency:{count:1},acceptance_latency:{count:2},series:3,
      retention_per_series:reportRetention,base_batch_rows:100,requested_hz:20,errors:[],cycles:[{}],
      final_queues:[{transport_version:3,pending_records:0,pending_bytes:0,inflight:false,needs_snapshot:false,acknowledged:2,presented:2,frame:{mode:'live',revision:2}}],
      cleanup:{source_count:0,listener_count:0,host_views:0,host_exports:0,host_thread_alive:false,widget_views:0,widget_exports:0,transfer_timer:false},browser_errors:[]};
  }
  async function exportsFor(host,path,r){
    const folder=dirname(path),capture={source:'displayed',capturedAt:iso(3),frameId:1,snapshotId:'snapshot-1'};
    const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(10,16);png.writeUInt32BE(20,20);
    const pngPath=join(folder,'frozen-000.png');await save(pngPath,png);
    const pngRecord={path:pngPath,sha256:sha256(png),width:10,height:20};
    async function html(name,cap,range){
      const sources=Array.from({length:6},(_,i)=>({id:`data${i}`,dtype:'float64',shape:[retention],byteLength:retention*8}));
      const payload={capture:cap,snapshot:{figure:{inspection:{frameId:cap.frameId},layers:Array.from({length:3},(_,i)=>({kind:'line',data:{x:`data${i*2}`,y:`data${i*2+1}`}}))},sources},
        buffers:sources.map(source=>({id:source.id,base64:Buffer.alloc(source.byteLength).toString('base64')}))};
      // Includes a pre-existing CRLF to reproduce Windows Qt write_text's CRCRLF case.
      const original=`<!doctype html>\n<!-- runtime\r\n -->\n<script id="vesora-payload">${JSON.stringify(payload)}</script>\n`;
      await save(join(folder,name),host==='qt'?original.replace(/\n/g,'\r\n'):original);
      return {capture:cap,retained_range:range,sha256:sha256(host==='qt'?original:original.replace(/\r\n/g,'\n'))};
    }
    const frozen=await html('frozen-000.html',capture,[0,retention-1,retention]);
    r.cycles=[{held:{frameId:1,snapshotId:'snapshot-1'},capture}];
    if(host==='qt')Object.assign(r.cycles[0],{export:frozen,png:pngRecord});
    else r.validated_frozen_exports=[{...frozen,png:pngRecord}];
    r.final_export=await html('final-displayed.html',{source:'displayed',capturedAt:iso(4),frameId:2},[200,retention+199,retention]);
  }
  for(let index=0;index<hosts.length;index++){
    const host=hosts[index],offset=index*(seconds+5),pid=100+index;
    const rows=[];for(let elapsed=0;elapsed<=seconds;elapsed+=5)rows.push({host,at:iso(offset+elapsed+0.1),
      availableMemoryBytes:4*1024**3,totalMemoryBytes:32*1024**3,diskFreeBytes:100*1024**3,
      monotonicSeconds:1000+offset+elapsed,awakeSeconds:500+offset+elapsed,
      processes:elapsed?[{pid,name:'node',rss:1000000}]:[],...(elapsed?{ownedRssSumBytes:1000000}:{})});
    rows.push({...rows[0],at:iso(offset+seconds+2),monotonicSeconds:1000+offset+seconds+2,awakeSeconds:500+offset+seconds+2});
    summary.resourceSamples.push(...rows);
    const path=host==='browser'?join(run,host,'browser.json'):join(run,host,phase,host,`${host}-soak.json`),logPath=join(run,`${host}.log`);
    const r=report(host);if(host!=='browser')await exportsFor(host,path,r);reports[host]=r;
    await save(path,r);await save(logPath,'completed\n');
    summary.jobs[host]={status:'passed',pid,startedAt:iso(offset+0.5),completedAt:iso(offset+seconds+3),reportPath:path,logPath,
      preflight:rows[0],exit:{code:0,signal:null},actualProducerSeconds:seconds+0.1,acceptedBatches:2,coveredBatches:2,
      reportSha256:sha256(await readFile(path)),logSha256:sha256('completed\n')};
    if(phase==='full'){
      const short=join(root,'runs','prerequisite',host+'.json');await save(short,report(host,30,1000));
      summary.shortReferences.push({host,path:short,sha256:sha256(await readFile(short))});
    }
  }
  const end=(hosts.length-1)*(seconds+5)+seconds+4;summary.completedAt=iso(end);
  guard.push({atUtc:iso(end+0.1),pid:11,event:'child-exited',exitCode:0},{atUtc:iso(end+0.2),pid:11,event:'released',success:true});
  const flush=async()=>{await save(join(run,'summary.json'),summary);await save(join(run,'resources.jsonl'),jsonl(summary.resourceSamples));await save(join(run,'power-guard.jsonl'),jsonl(guard));};
  const changeReport=async(host)=>{await save(summary.jobs[host].reportPath,reports[host]);summary.jobs[host].reportSha256=sha256(await readFile(summary.jobs[host].reportPath));};
  await flush();
  return {root,release,run,summary,reports,guard,flush,changeReport,
    check:()=>checkSoakEvidence(release,run,{workspaceRoot:root,now:start+(end+1)*1000})};
}
const fails=(result,pattern)=>{assert.equal(result.status,'failed',JSON.stringify(result.reasons));assert.equal(result.qualifiesTwoHourGate,false);assert.match(JSON.stringify(result.reasons),pattern);};

test('completed short evidence verifies raw files and CRLF translation without qualifying two hours',async t=>{
  const f=await fixture(t),r=await f.check();assert.equal(r.status,'passed',JSON.stringify(r.reasons));assert.equal(r.qualifiesTwoHourGate,false);
  assert.equal(r.jobs.qt.exports.retainedFiles[0].reportHashMode,'crlf-to-lf');
  assert.equal(r.jobs.jupyter.exports.retainedFiles.length,3);assert.match(r.jobs.browser.exports.scope,/memory/);
  assert.equal(r.powerGuard.released,true);
});
test('only completed full evidence for all three hosts qualifies',async t=>{
  const f=await fixture(t,{phase:'full'}),r=await f.check();assert.equal(r.status,'passed',JSON.stringify(r.reasons));assert.equal(r.qualifiesTwoHourGate,true);
});
test('a full subset remains passed but cannot qualify the three-host gate',async t=>{
  const f=await fixture(t,{phase:'full',hosts:['browser']}),r=await f.check();assert.equal(r.status,'passed',JSON.stringify(r.reasons));assert.equal(r.qualifiesTwoHourGate,false);
  f.summary.qualifiesTwoHourGate=true;await f.flush();fails(await f.check(),/qualification/);
});
test('wrong phase duration and fabricated short qualification fail',async t=>{
  const f=await fixture(t,{hosts:['browser']});f.summary.requestedSeconds=7200;await f.flush();fails(await f.check(),/7200/);
  f.summary.requestedSeconds=30;f.summary.qualifiesTwoHourGate=true;await f.flush();fails(await f.check(),/qualification/);
});
test('fresh running evidence is not a completed qualification; stale evidence becomes incomplete',async t=>{
  const f=await fixture(t,{hosts:['browser']});f.summary.status='running';delete f.summary.completedAt;delete f.summary.qualifiesTwoHourGate;
  f.summary.jobs.browser.status='running';f.guard.splice(2);await f.flush();
  const r=await f.check();assert.equal(r.status,'running',JSON.stringify(r.reasons));assert.equal(r.qualifiesTwoHourGate,false);
  const stale=await checkSoakEvidence(f.release,f.run,{workspaceRoot:f.root,now:start+300000});
  assert.equal(stale.status,'incomplete');assert.match(JSON.stringify(stale.reasons),/stale/);
});
test('resources appended just ahead of a running summary form a valid prefix, including a partial next line',async t=>{
  const f=await fixture(t,{hosts:['browser']});f.summary.status='running';f.summary.jobs.browser.status='running';f.guard.splice(2);await f.flush();
  const next={...f.summary.resourceSamples.at(-1),at:iso(33),monotonicSeconds:1033,awakeSeconds:533};
  await save(join(f.run,'resources.jsonl'),jsonl([...f.summary.resourceSamples,next])+'{"host":');
  const r=await f.check();assert.equal(r.status,'running',JSON.stringify(r.reasons));assert.equal(r.resources.pendingPartialLine,true);
  next.awakeSeconds=1;await save(join(f.run,'resources.jsonl'),jsonl([...f.summary.resourceSamples,next]));fails(await f.check(),/backwards/);
});
test('completed missing host or unreleased native guard stays incomplete',async t=>{
  const f=await fixture(t);delete f.summary.jobs.jupyter;await f.flush();assert.equal((await f.check()).status,'incomplete');
  const g=await fixture(t,{hosts:['browser']});g.guard.pop();await g.flush();const r=await g.check();assert.equal(r.status,'incomplete');assert.match(JSON.stringify(r.reasons),/release/);
});
test('native child failure or failed power-request release is an explicit failure',async t=>{
  const f=await fixture(t,{hosts:['browser']});f.guard[2].exitCode=1;await f.flush();fails(await f.check(),/guarded child failed/);
  f.guard[2].exitCode=0;f.guard[3].success=false;await f.flush();fails(await f.check(),/not released/);
});
test('wrong archive, host environment, and harness identity fail',async t=>{
  const f=await fixture(t);f.summary.manifestSha256='b'.repeat(64);await f.flush();fails(await f.check(),/identity/);
  f.summary.manifestSha256=JSON.parse(await readFile(f.summary.jobs.browser.reportPath)).manifestSha256;
  f.reports.qt.evidence.python='different';await f.changeReport('qt');await f.flush();fails(await f.check(),/environment differs/);
  f.reports.qt.evidence.python=f.summary.verifiedEnvironment.python;await f.changeReport('qt');await f.flush();
  await save(join(f.root,requiredHarnesses[0]),'changed');fails(await f.check(),/SHA256 mismatch/);
});
test('changed report or log cannot silently inherit the recorded hash',async t=>{
  const f=await fixture(t,{hosts:['browser']});await save(f.summary.jobs.browser.reportPath,'{}');fails(await f.check(),/SHA256 mismatch/);
  await f.changeReport('browser');await f.flush();await save(f.summary.jobs.browser.logPath,'tampered');fails(await f.check(),/SHA256 mismatch/);
});
test('rehashing an undrained report does not bypass the existing report contract',async t=>{
  const f=await fixture(t,{hosts:['browser']});f.reports.browser.result.covered=1;f.reports.browser.result.liveFrameLatencyMs=[];
  await f.changeReport('browser');await f.flush();fails(await f.check(),/completed-frame coverage/);
});
test('completed resources require exact correspondence and uninterrupted clocks',async t=>{
  const f=await fixture(t,{hosts:['browser']});const rows=structuredClone(f.summary.resourceSamples);rows[1].availableMemoryBytes--;
  await save(join(f.run,'resources.jsonl'),jsonl(rows));fails(await f.check(),/prefix/);
  f.summary.resourceSamples[1].monotonicSeconds+=10;await f.flush();fails(await f.check(),/suspend detected/);
});
test('export hash, capture and missing source-bound buffers are checked',async t=>{
  const f=await fixture(t,{hosts:['qt']}),path=join(dirname(f.summary.jobs.qt.reportPath),'frozen-000.html');
  const original=await readFile(path,'utf8');await save(path,original+'changed');fails(await f.check(),/HTML SHA256 mismatch/);
  const changed=original.replace('"frameId":1','"frameId":900');await save(path,changed);
  f.reports.qt.cycles[0].export.sha256=sha256(changed.replace(/\r\n/g,'\n'));await f.changeReport('qt');await f.flush();fails(await f.check(),/capture differs/);
  const missing=original.replace('"id":"data5","base64"','"id":"wrong","base64"');await save(path,missing);
  f.reports.qt.cycles[0].export.sha256=sha256(missing.replace(/\r\n/g,'\n'));await f.changeReport('qt');await f.flush();fails(await f.check(),/source-bound buffers/);
});
test('PNG evidence references cannot escape their host export directory',async t=>{
  const f=await fixture(t,{hosts:['qt']});f.reports.qt.cycles[0].png.path=join(f.root,'outside.png');
  await save(f.reports.qt.cycles[0].png.path,Buffer.alloc(24));await f.changeReport('qt');await f.flush();fails(await f.check(),/Escaping evidence reference/);
});
test('realpath containment rejects a linked host evidence directory outside the run',async t=>{
  const f=await fixture(t,{hosts:['qt']}),hostPath=join(f.run,'qt'),outside=join(f.root,'elsewhere');
  await rename(hostPath,outside);await symlink(outside,hostPath,process.platform==='win32'?'junction':'dir');
  fails(await f.check(),/realpath escapes/);
});
test('malformed summary hosts and JSONL rows return failed reports instead of throwing',async t=>{
  const f=await fixture(t,{hosts:['browser']});f.summary.hosts='browser';f.summary.resourceSamples=[null];await f.flush();
  const r=await f.check();assert.equal(r.status,'failed');assert.ok(r.reasons.length>0);
});
