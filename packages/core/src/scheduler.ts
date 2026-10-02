import {DataRegistry} from './data';
import {lineSteps, runSteps, scatterSteps} from './planning';
import type {DataStore, LineResult, PointPlan, Query} from './types';
import type {WorkerRequest, WorkerResponse} from './worker';

type Plan = PointPlan | LineResult;
let defaultWorkerURL: string | URL | undefined;
/** Notebook hosts can supply a blob URL when the engine itself is an inline module. */
export function setWorkerURL(url: string | URL | undefined): void {defaultWorkerURL = url;}
interface Pending {
  key: string; requestId: number; xId: string; yId: string; cacheKey: string; cancelled: boolean;
  resolve: (result: Plan) => void; reject: (reason: Error) => void;
  fallback: () => void;
}
interface Cached {plan: Plan; bytes: number; ids: [string, string]}
export interface SchedulerOptions {
  /** null uses the cooperative main-thread path; useful where workers are blocked. */
  workerFactory?: (() => Worker) | null;
  maxCacheBytes?: number;
}

/** Owns worker copies by data version; viewport changes send only small query objects. */
export class QueryScheduler {
  private worker?: Worker;
  private disposed = false;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private keys = new Map<string, number>();
  private registered = new Map<string, number>();
  private cache = new Map<string, Cached>();
  private cacheBytes = 0;
  private maxCacheBytes: number;

  constructor(options: SchedulerOptions = {}) {
    this.maxCacheBytes = options.maxCacheBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxCacheBytes) || this.maxCacheBytes < 0) throw new RangeError('Cache budget must be a nonnegative integer.');
    try {
      if (options.workerFactory) this.worker = options.workerFactory();
      else if (options.workerFactory !== null && typeof Worker !== 'undefined') this.worker = new Worker(defaultWorkerURL ?? new URL('./worker.js', import.meta.url), {type: 'module'});
    } catch { /* Browser CSP or unavailable worker: cooperative fallback remains usable. */ }
    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data, task = this.pending.get(message.requestId);
        if (!task || task.cancelled) return;
        if (message.type === 'error') {
          const error = new Error(message.message); error.name = message.name;
          this.reject(task, error);
        } else this.complete(task, message.result);
      };
      this.worker.onerror = () => this.useFallback();
    }
  }

  get stats(): {cacheBytes: number; cacheEntries: number; pending: number; worker: boolean} {
    return {cacheBytes: this.cacheBytes, cacheEntries: this.cache.size, pending: this.pending.size, worker: !!this.worker};
  }

  query(key: string, kind: 'scatter' | 'line', xId: string, yId: string, query: Query, registry: DataRegistry | DataStore): Promise<Plan> {
    if (this.disposed) return Promise.reject(new Error('Query scheduler has been disposed.'));
    const store = registry instanceof DataRegistry ? registry.store : registry;
    const x = store.get(xId), y = store.get(yId);
    if (!x || !y) return Promise.reject(new Error(`Unknown data source: ${!x ? xId : yId}`));
    this.cancel(key);
    // Prune sources removed by the owner even if it did not explicitly call release().
    for (const id of this.registered.keys()) if (!store.has(id)) this.release(id);
    const cacheKey = JSON.stringify([kind, xId, x.descriptor.version, yId, y.descriptor.version, query]);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey); this.cache.set(cacheKey, cached);
      return Promise.resolve(cached.plan);
    }
    const requestId = ++this.sequence;
    return new Promise<Plan>((resolve, reject) => {
      const task: Pending = {key, requestId, xId, yId, cacheKey, cancelled: false, resolve, reject, fallback: () => {
        const steps = kind === 'line' ? lineSteps(x.values, y.values, query) : scatterSteps(x.values, y.values, query);
        void runSteps<Plan>(steps, () => task.cancelled || this.disposed)
          .then(result => this.complete(task, result), error => this.reject(task, error instanceof Error ? error : new Error(String(error))));
      }};
      this.pending.set(requestId, task); this.keys.set(key, requestId);
      if (this.worker) {
        try {
          for (const entry of [x, y]) {
            if (this.registered.get(entry.descriptor.id) === entry.descriptor.version) continue;
            this.invalidate(entry.descriptor.id);
            this.post({type: 'register', entry});
            this.registered.set(entry.descriptor.id, entry.descriptor.version);
          }
          this.post({type: 'query', requestId, key, kind, xId, yId, query});
        } catch {this.useFallback();}
      } else task.fallback();
    });
  }

  cancel(key: string): void {
    const requestId = this.keys.get(key);
    if (requestId === undefined) return;
    const task = this.pending.get(requestId);
    if (!task) return;
    task.cancelled = true;
    this.post({type: 'cancel', requestId});
    this.reject(task, new DOMException('Query superseded or cancelled.', 'AbortError'));
  }

  release(id: string): void {
    for (const task of [...this.pending.values()]) if (task.xId === id || task.yId === id) this.cancel(task.key);
    this.registered.delete(id); this.invalidate(id); this.post({type: 'release', id});
  }

  dispose(): void {
    if (this.disposed) return;
    for (const key of [...this.keys.keys()]) this.cancel(key);
    this.disposed = true; this.post({type: 'dispose'}); this.worker?.terminate(); this.worker = undefined;
    this.registered.clear(); this.cache.clear(); this.cacheBytes = 0;
  }

  private post(message: WorkerRequest): void {this.worker?.postMessage(message);}
  private useFallback(): void {
    if (!this.worker) return;
    this.worker.terminate(); this.worker = undefined; this.registered.clear();
    for (const task of [...this.pending.values()]) task.fallback();
  }
  private reject(task: Pending, error: Error): void {
    if (!this.pending.delete(task.requestId)) return;
    if (this.keys.get(task.key) === task.requestId) this.keys.delete(task.key);
    task.reject(error);
  }
  private complete(task: Pending, result: Plan): void {
    if (task.cancelled || this.disposed || this.keys.get(task.key) !== task.requestId) return;
    this.pending.delete(task.requestId); this.keys.delete(task.key);
    const bytes = 256 + (result.kind === 'points' ? result.indices.byteLength : result.kind === 'density' ? result.counts.byteLength : result.segments.reduce((sum, item) => sum + item.byteLength + 32, 0));
    if (bytes <= this.maxCacheBytes) {
      const previous = this.cache.get(task.cacheKey);
      if (previous) {this.cacheBytes -= previous.bytes; this.cache.delete(task.cacheKey);}
      while (this.cache.size && (this.cacheBytes + bytes > this.maxCacheBytes || this.cache.size >= 100)) {
        const oldest = this.cache.keys().next().value!;
        this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
      }
      this.cache.set(task.cacheKey, {plan: result, bytes, ids: [task.xId, task.yId]}); this.cacheBytes += bytes;
    }
    task.resolve(result);
  }
  private invalidate(id: string): void {
    for (const [key, item] of this.cache) if (item.ids.includes(id)) {this.cacheBytes -= item.bytes; this.cache.delete(key);}
  }
}
