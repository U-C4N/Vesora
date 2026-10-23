// Pure accounting checks for exact-archive isolated short/full runs.
import assert from 'node:assert/strict';

const count=(value,positive=false)=>assert.ok(Number.isSafeInteger(value)&&value>=(positive?1:0),'Invalid batch/count evidence');
const empty=value=>assert.deepEqual(value,[],'Reported workload errors must be empty');

export function validateSoakReport(host,report,manifest,manifestSha256,{seconds=7200,retention=100000}={}){
  assert.equal(report.status,'passed');
  let actualProducerSeconds,acceptedBatches,coveredBatches;
  if(host==='browser'){
    assert.equal(report.manifestSha256,manifestSha256);assert.equal(report.version,manifest.version);
    assert.equal(report.profile,'isolated');assert.equal(report.latencyReference,true);assert.equal(report.requestedSeconds,seconds);
    assert.deepEqual(report.runtimeHashes,manifest.runtime);assert.equal(report.qualifiesTwoHourGate,seconds>=7200);
    assert.equal(report.archiveSha256,manifest.files.find(file=>file.name===`vesora-core-${manifest.version}.tgz`).sha256);
    empty(report.browserErrors);const result=report.result;empty(result.errors);
    actualProducerSeconds=result.producerDurationSeconds;acceptedBatches=result.accepted;coveredBatches=result.covered;
    count(result.batches,true);assert.equal(acceptedBatches,result.batches);assert.equal(result.pendingPresentations,0);
    assert.equal(result.acceptanceMs.length,acceptedBatches);
    assert.equal(result.liveFrameLatencyMs.length+result.frozenFrameLatencyMs.length,coveredBatches);
    count(result.exports,true);count(result.freezes,true);count(result.totalRows,true);
    assert.equal(result.states.length,3);
    for(const state of result.states){assert.equal(state.retained,retention);assert.equal(state.nextSequence,retention+result.totalRows);}
    assert.equal(result.diagnostics.sourceBytes,3*2*retention*8);assert.equal(result.diagnostics.contextLost,false);
    for(const key of ['pendingAppends','pendingExports','snapshotBytes'])assert.equal(result.diagnostics[key],0);
    for(const key of ['sourceBytes','pendingAppends','snapshotBytes'])assert.equal(result.afterClose[key],0);
    assert.equal(result.remainingCanvases,0);assert.equal(result.schedulerAfterClose.worker,false);
    assert.equal(result.schedulerAfterClose.workerSourceBytes,0);assert.equal(result.schedulerAfterClose.pending,0);
    for(const backend of ['fallback','worker'])for(const key of ['indexBytes','retainedBytes'])assert.equal(result.schedulerAfterClose.lineIndex[backend][key],0);
  }else{
    assert.ok(host==='qt'||host==='jupyter');assert.equal(report.host,host);
    assert.equal(report.two_hour_duration_met,seconds>=7200);assert.equal(report.exact_wheel_verified,true);
    assert.equal(report.requested_seconds,seconds);assert.equal(report.evidence.profile,'isolated');assert.equal(report.evidence.latency_reference,true);
    assert.equal(report.evidence.vesora_version,manifest.pythonVersion);
    assert.equal(report.evidence.wheel_sha256,manifest.files.find(file=>file.name.endsWith('.whl')).sha256);
    actualProducerSeconds=report.actual_producer_seconds;acceptedBatches=report.accepted_batches;
    coveredBatches=report.live_presentation_latency.count+report.presentation_across_freeze_latency.count;
    assert.equal(report.series,3);assert.equal(report.retention_per_series,retention);
    assert.equal(report.base_batch_rows,100);assert.equal(report.requested_hz,20);
    assert.equal(report.acceptance_latency.count,acceptedBatches);empty(report.errors);
    assert.ok(report.cycles?.length>0,'Missing completed freeze/export cycle');
    assert.ok(report.final_queues?.length>0,'Missing final host queues');
    for(const queue of report.final_queues){
      assert.equal(queue.transport_version,3);assert.equal(queue.pending_records,0);assert.equal(queue.pending_bytes,0);
      assert.equal(queue.inflight,false);assert.equal(queue.needs_snapshot,false);
      count(queue.acknowledged);assert.equal(queue.presented,queue.acknowledged);
      assert.equal(queue.frame.mode,'live');assert.equal(queue.frame.revision,queue.acknowledged);
    }
    if(host==='jupyter')empty(report.browser_errors);
    const keys=host==='qt'?['source_count','listener_count','host_views','host_exports','host_thread_alive']:['source_count','listener_count','widget_views','widget_exports','transfer_timer'];
    for(const key of keys)assert.ok(report.cleanup?.[key]===0||report.cleanup?.[key]===false,`Unreleased or missing ${host} cleanup: ${key}`);
  }
  assert.ok(Number.isFinite(actualProducerSeconds)&&actualProducerSeconds>=seconds,'Insufficient actual producer duration');
  count(acceptedBatches,true);count(coveredBatches,true);assert.equal(acceptedBatches,coveredBatches,'Every accepted batch needs completed-frame coverage');
  return {actualProducerSeconds,acceptedBatches,coveredBatches};
}

export function checkAwake(previous,current){
  assert.ok(Number.isFinite(current.monotonicSeconds)&&Number.isFinite(current.awakeSeconds),'Missing awake/monotonic resource counters');
  if(!previous)return;
  assert.ok(Number.isFinite(previous.monotonicSeconds)&&Number.isFinite(previous.awakeSeconds),'Missing previous awake/monotonic counters');
  const wall=current.monotonicSeconds-previous.monotonicSeconds,awake=current.awakeSeconds-previous.awakeSeconds;
  assert.ok(wall>=0&&awake>=0,'Clock counters moved backwards');
  assert.ok(wall-awake<5,`Host suspend detected: ${Math.max(0,wall-awake).toFixed(2)} seconds outside awake time`);
}
