import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {parseBudget, runProcess} from '../../scripts/v1-runner.mjs';

test('the verification budget cannot silently become an hours-long run', () => {
  assert.equal(parseBudget([]), 600000);
  assert.equal(parseBudget(['--budget-ms', '120000']), 120000);
  for (const value of ['NaN', '-1', '600001', '1.5']) assert.throws(() => parseBudget(['--budget-ms', value]));
  assert.throws(() => parseBudget(['--skip-hosts']));
});

test('an absent or failing required process never passes', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(3)'], {deadline: performance.now() + 5000}), /Process failed/);
  await assert.rejects(runProcess(process.execPath, ['-e', ''], {deadline: performance.now() - 1}), /exhausted/);
});

test('a timed-out child is terminated and reported as a failure', async () => {
  const began = performance.now();
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {deadline: began + 150}), /budget exceeded/);
  assert.ok(performance.now() - began < 5000, 'The timeout must terminate the child rather than waiting for its workload');
});
