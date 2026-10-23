import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSoakReport,checkAwake} from '../../scripts/soak-sequential-contracts.mjs';

const manifest={version:'0.9.0-rc.6',pythonVersion:'0.9.0rc6',runtime:{index:'i',worker:'w',viewer:'v',labs:'l'},files:[{name:'vesora-core-0.9.0-rc.6.tgz',sha256:'core'},{name:'vesora-0.9.0rc6-py3-none-any.whl',sha256:'wheel'}]};
const parameters={seconds:30,retention:1000};
function browser(){return {status:'passed',manifestSha256:'manifest',version:manifest.version,profile:'isolated',latencyReference:true,requestedSeconds:30,runtimeHashes:manifest.runtime,qualifiesTwoHourGate:false,archiveSha256:'core',browserErrors:[],result:{errors:[],producerDurationSeconds:30.1,accepted:2,covered:2,batches:2,pendingPresentations:0,acceptanceMs:[1,2],liveFrameLatencyMs:[2],frozenFrameLatencyMs:[5],exports:1,freezes:1,totalRows:200,states:Array.from({length:3},()=>({retained:1000,nextSequence:1200})),diagnostics:{sourceBytes:48000,contextLost:false,pendingAppends:0,pendingExports:0,snapshotBytes:0},afterClose:{sourceBytes:0,pendingAppends:0,snapshotBytes:0},remainingCanvases:0,schedulerAfterClose:{worker:false,workerSourceBytes:0,pending:0,lineIndex:{fallback:{indexBytes:0,retainedBytes:0},worker:{indexBytes:0,retainedBytes:0}}}}};}
function host(kind='qt'){return {status:'passed',host:kind,two_hour_duration_met:false,exact_wheel_verified:true,requested_seconds:30,evidence:{profile:'isolated',latency_reference:true,vesora_version:manifest.pythonVersion,wheel_sha256:'wheel'},actual_producer_seconds:30.1,accepted_batches:2,live_presentation_latency:{count:1},presentation_across_freeze_latency:{count:1},acceptance_latency:{count:2},series:3,retention_per_series:1000,base_batch_rows:100,requested_hz:20,errors:[],cycles:[{}],final_queues:[{transport_version:3,pending_records:0,pending_bytes:0,inflight:false,needs_snapshot:false,acknowledged:2,presented:2,frame:{mode:'live',revision:2}}],cleanup:{source_count:0,listener_count:0,host_views:0,host_exports:0,host_thread_alive:false,widget_views:0,widget_exports:0,transfer_timer:false},browser_errors:[]};}

test('short success cannot satisfy a full two-hour request',()=>{
  assert.equal(validateSoakReport('browser',browser(),manifest,'manifest',parameters).coveredBatches,2);
  assert.throws(()=>validateSoakReport('browser',browser(),manifest,'manifest'));
  assert.throws(()=>validateSoakReport('qt',host(),manifest,'manifest'));
  const falselyQualified=browser();falselyQualified.qualifiesTwoHourGate=true;
  assert.throws(()=>validateSoakReport('browser',falselyQualified,manifest,'manifest',parameters));
  const insufficient=host();insufficient.actual_producer_seconds=29;
  assert.throws(()=>validateSoakReport('qt',insufficient,manifest,'manifest',parameters),/producer duration/);
});
test('every accepted batch needs live or freeze-crossing frame coverage',()=>{
  const report=browser();report.result.covered=1;report.result.liveFrameLatencyMs=[];
  assert.throws(()=>validateSoakReport('browser',report,manifest,'manifest',parameters),/completed-frame coverage/);
  const qt=host();qt.live_presentation_latency.count=0;
  assert.throws(()=>validateSoakReport('qt',qt,manifest,'manifest',parameters),/completed-frame coverage/);
});
test('changed archive or wheel identity cannot qualify',()=>{
  assert.throws(()=>validateSoakReport('browser',browser(),manifest,'another',parameters));
  const qt=host();qt.evidence.wheel_sha256='another';assert.throws(()=>validateSoakReport('qt',qt,manifest,'manifest',parameters));
});
test('undrained queues and missing cleanup are failures',()=>{
  const qt=host();qt.final_queues[0].pending_records=1;assert.throws(()=>validateSoakReport('qt',qt,manifest,'manifest',parameters));
  const notebook=host('jupyter');delete notebook.cleanup.transfer_timer;
  assert.throws(()=>validateSoakReport('jupyter',notebook,manifest,'manifest',parameters),/cleanup/);
});
test('isolated and concurrent evidence are not mislabeled',()=>{
  const report=browser();report.profile='concurrent-stress';assert.throws(()=>validateSoakReport('browser',report,manifest,'manifest',parameters));
});
test('Jupyter page errors remain failures',()=>{
  const report=host('jupyter');report.browser_errors=['renderer failed'];assert.throws(()=>validateSoakReport('jupyter',report,manifest,'manifest',parameters));
});
test('suspend time does not count as an uninterrupted producer run',()=>{
  const before={monotonicSeconds:10,awakeSeconds:10};
  assert.doesNotThrow(()=>checkAwake(before,{monotonicSeconds:40,awakeSeconds:40}));
  assert.throws(()=>checkAwake(before,{monotonicSeconds:400,awakeSeconds:40}),/suspend detected/);
  assert.throws(()=>checkAwake(before,{monotonicSeconds:9,awakeSeconds:40}),/backwards/);
  assert.throws(()=>checkAwake(undefined,{monotonicSeconds:40}),/Missing/);
});
