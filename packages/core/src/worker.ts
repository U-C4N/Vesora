import {DataRegistry} from './data';
import {lineSteps, runSteps, scatterSteps} from './planning';
import type {DataEntry, LineResult, PointPlan, Query} from './types';

export type WorkerRequest =
  | {type: 'register'; entry: DataEntry}
  | {type: 'release'; id: string}
  | {type: 'query'; requestId: number; key: string; kind: 'scatter' | 'line'; xId: string; yId: string; query: Query}
  | {type: 'cancel'; requestId: number}
  | {type: 'dispose'};
export type WorkerResponse =
  | {type: 'result'; requestId: number; result: PointPlan | LineResult}
  | {type: 'error'; requestId: number; name: string; message: string};

const registry = new DataRegistry();
const requests = new Map<number, {cancelled: boolean; xId: string; yId: string}>();
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
    for (const task of requests.values()) if (task.xId === message.id || task.yId === message.id) task.cancelled = true;
    return;
  }
  if (message.type === 'cancel') {const task = requests.get(message.requestId); if (task) task.cancelled = true; return;}
  if (message.type === 'dispose') {
    disposed = true;
    for (const task of requests.values()) task.cancelled = true;
    registry.clear(); scope.close(); return;
  }
  const {requestId, xId, yId} = message;
  const task = {cancelled: false, xId, yId};
  requests.set(requestId, task);
  void (async () => {
    try {
      const x = registry.get(xId).values, y = registry.get(yId).values;
      const steps = message.kind === 'line' ? lineSteps(x, y, message.query) : scatterSteps(x, y, message.query);
      const result = await runSteps<PointPlan | LineResult>(steps, () => task.cancelled || disposed);
      if (task.cancelled || disposed) return;
      const transfer: Transferable[] = result.kind === 'points' ? [result.indices.buffer] : result.kind === 'density' ? [result.counts.buffer] : result.segments.map(segment => segment.buffer);
      scope.postMessage({type: 'result', requestId, result}, transfer);
    } catch (error) {
      if (!task.cancelled && !disposed) scope.postMessage({type: 'error', requestId, name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error)});
    } finally {requests.delete(requestId);}
  })();
};
