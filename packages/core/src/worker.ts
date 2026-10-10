import {DataRegistry} from './data';
import {lineSteps, runSteps, scatterSteps} from './planning';
import {statisticsSteps} from './statistics';
import type {PreparedStatistics} from './statistics';
import type {DataEntry, DataStore, LayerSpec, LineResult, PointPlan, Query} from './types';

export type WorkerRequest =
  | {type: 'register'; entry: DataEntry}
  | {type: 'release'; id: string}
  | {type: 'query'; requestId: number; key: string; kind: 'scatter' | 'line'; xId: string; yId: string; query: Query}
  | {type: 'statistics'; requestId: number; key: string; layer: LayerSpec}
  | {type: 'cancel'; requestId: number}
  | {type: 'dispose'};
export type WorkerResponse =
  | {type: 'result'; requestId: number; result: PointPlan | LineResult | PreparedStatistics}
  | {type: 'error'; requestId: number; name: string; message: string};

const registry = new DataRegistry();
const requests = new Map<number, {cancelled: boolean; ids: string[]}>();
let disposed = false;
const scope = globalThis as unknown as {onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: WorkerResponse, transfer?: Transferable[]): void; close(): void};

scope.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data;
  if (message.type === 'register') {
    const old = registry.store.get(message.entry.descriptor.id);
    if (!old || old.descriptor.version < message.entry.descriptor.version) {
      const {descriptor, values} = message.entry;
      registry.set(descriptor.id, values, descriptor.shape, descriptor.version);
    }
    return;
  }
  if (message.type === 'release') {
    registry.release(message.id);
    for (const task of requests.values()) if (task.ids.includes(message.id)) task.cancelled = true;
    return;
  }
  if (message.type === 'cancel') {const task = requests.get(message.requestId); if (task) task.cancelled = true; return;}
  if (message.type === 'dispose') {
    disposed = true;
    for (const task of requests.values()) task.cancelled = true;
    registry.clear(); scope.close(); return;
  }
  const {requestId} = message;
  const task = {cancelled: false, ids: message.type === 'statistics' ? Object.values(message.layer.data) : [message.xId, message.yId]};
  requests.set(requestId, task);
  void (async () => {
    try {
      // Capture entries before the first cooperative yield. A later register
      // message can replace another group's source without changing this task's
      // immutable source/version snapshot.
      const captured: DataStore = new Map(task.ids.map(id => [id, registry.get(id)]));
      const steps = message.type === 'statistics' ? statisticsSteps(message.layer, captured)
        : message.kind === 'line' ? lineSteps(registry.get(message.xId).values, registry.get(message.yId).values, message.query)
          : scatterSteps(registry.get(message.xId).values, registry.get(message.yId).values, message.query);
      const result = await runSteps<PointPlan | LineResult | PreparedStatistics>(steps, () => task.cancelled || disposed);
      if (task.cancelled || disposed) return;
      const transfer: Transferable[] = 'marks' in result ? [] : result.kind === 'points' ? [result.indices.buffer] : result.kind === 'density' ? [result.counts.buffer] : result.segments.map(segment => segment.buffer);
      scope.postMessage({type: 'result', requestId, result}, transfer);
    } catch (error) {
      if (!task.cancelled && !disposed) scope.postMessage({type: 'error', requestId, name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error)});
    } finally {requests.delete(requestId);}
  })();
};
