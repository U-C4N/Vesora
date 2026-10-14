import {DataRegistry} from './data';
import {lineSteps, runSteps, scatterSteps} from './planning';
import {bandSteps} from './band';
import {statisticsBytes, statisticsSteps} from './statistics';
import {linkedSteps, maskedScatterSteps} from './linked';
import type {LinkedResult} from './linked';
import type {PreparedStatistics} from './statistics';
import type {BandResult, DataEntry, DataStore, LayerSpec, LineResult, PointPlan, Query, SelectionLinkSpec} from './types';
import type {WorkerRequest, WorkerResponse} from './worker';
import {selectionSteps} from './interaction';
import type {SelectionResult} from './interaction';
import type {Bounds} from './types';
import {ascending} from './source-metadata';

type Plan = PointPlan | LineResult;
type QueryResult = Plan | BandResult | PreparedStatistics | LinkedResult | SelectionResult;
let defaultWorkerURL: string | URL | undefined;
/** Notebook hosts can supply a blob URL when the engine itself is an inline module. */
export function setWorkerURL(url: string | URL | undefined): void {defaultWorkerURL = url;}
interface Pending {
  key: string; requestId: number; ids: string[]; cacheKey: string; cancelled: boolean;
  resolve: (result: QueryResult) => void; reject: (reason: Error) => void;
  fallback: () => void;
  updated: number;
}
interface Cached {plan: QueryResult; bytes: number; ids: string[]}
export interface SchedulerOptions {
  /** null uses the cooperative main-thread path; useful where workers are blocked. */
  workerFactory?: (() => Worker) | null;
  maxCacheBytes?: number;
  workerStartupTimeoutMs?: number;
  workerStallTimeoutMs?: number;
}

/** Owns worker copies by data version; viewport changes send only small query objects. */
export class QueryScheduler {
  private worker?: Worker;
  private disposed = false;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private keys = new Map<string, number>();
  private registered = new Map<string, number>();
  private registeredEntries = new Map<string, DataEntry>();
  private watchdog?:ReturnType<typeof setInterval>;
  private workerStarted=Date.now();
  private workerReady=false;
  private transferredBytes=0;
  private cache = new Map<string, Cached>();
  private cacheBytes = 0;
  private maxCacheBytes: number;
  private objectIds = new WeakMap<object, number>();
  private objectSequence = 0;

  constructor(options: SchedulerOptions = {}) {
    this.maxCacheBytes = options.maxCacheBytes ?? 32 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxCacheBytes) || this.maxCacheBytes < 0) throw new RangeError('Cache budget must be a nonnegative integer.');
    try {
      if (options.workerFactory) this.worker = options.workerFactory();
      else if (options.workerFactory !== null && typeof Worker !== 'undefined') this.worker = new Worker(defaultWorkerURL ?? new URL('./worker.js', import.meta.url), {type: 'module'});
    } catch { /* Browser CSP or unavailable worker: cooperative fallback remains usable. */ }
    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;this.workerReady=true;
        if(message.type==='ready')return;
        if(message.type==='sync-error'){this.useFallback();return;}
        const task = this.pending.get(message.requestId);
        if (!task || task.cancelled) return;
        task.updated=Date.now();
        if(message.type==='progress')return;
        if (message.type === 'error') {
          const error = new Error(message.message); error.name = message.name;
          this.reject(task, error);
        } else this.complete(task, message.result);
      };
      this.worker.onerror = () => this.useFallback();
      this.worker.onmessageerror=()=>this.useFallback();
      const startup=options.workerStartupTimeoutMs??5000,stall=options.workerStallTimeoutMs??15000;
      for(const value of [startup,stall])if(!Number.isFinite(value)||value<=0)throw new RangeError('Worker timeouts must be positive.');
      this.watchdog=setInterval(()=>{const now=Date.now();if(!this.workerReady&&now-this.workerStarted>=startup||[...this.pending.values()].some(task=>now-task.updated>=stall))this.useFallback();},Math.min(1000,startup,stall));
    }
  }

  get stats(): {cacheBytes: number; cacheEntries: number; pending: number; worker: boolean; transferredBytes:number;workerSourceBytes:number} {
    return {cacheBytes: this.cacheBytes, cacheEntries: this.cache.size, pending: this.pending.size, worker: !!this.worker,transferredBytes:this.transferredBytes,workerSourceBytes:[...this.registeredEntries.values()].reduce((sum,entry)=>sum+entry.descriptor.byteLength,0)};
  }

  query(key: string, kind: 'scatter' | 'line', xId: string, yId: string, query: Query, registry: DataRegistry | DataStore): Promise<Plan> {
    return this.submit<Plan>(key, [xId, yId], [kind, query], registry, store => {
      const x = store.get(xId)!.values, y = store.get(yId)!.values;
      return kind === 'line' ? lineSteps(x, y, query,ascending(store.get(xId)!)) : scatterSteps(x, y, query);
    }, requestId => ({type: 'query', requestId, key, kind, xId, yId, query}));
  }

  querySelection(key:string,xId:string,yId:string,bounds:Bounds,registry:DataRegistry|DataStore,colorId?:string):Promise<SelectionResult>{
    return this.submit(key,[xId,yId,...(colorId?[colorId]:[])],['selection',bounds,colorId],registry,
      store=>selectionSteps(store.get(xId)!.values,store.get(yId)!.values,bounds,colorId?store.get(colorId)!.values:undefined),
      requestId=>({type:'selection',requestId,key,xId,yId,bounds,colorId}),true);
  }

  queryBand(key: string, xId: string, lowerId: string, upperId: string, query: Query, registry: DataRegistry | DataStore): Promise<BandResult> {
    return this.submit<BandResult>(key, [xId, lowerId, upperId], ['band', query], registry,
      store => bandSteps(store.get(xId)!.values, store.get(lowerId)!.values, store.get(upperId)!.values, query),
      requestId => ({type: 'band', requestId, key, xId, lowerId, upperId, query}));
  }

  /** Statistics depend on source versions/options, never on the viewport. */
  queryStatistics(key: string, layer: LayerSpec, registry: DataRegistry | DataStore): Promise<PreparedStatistics> {
    const snapshot = structuredClone(layer), ids = Object.values(snapshot.data);
    return this.submit<PreparedStatistics>(key, ids, ['statistics', snapshot.kind, snapshot.id, snapshot.data, snapshot.options], registry,
      store => statisticsSteps(snapshot, store), requestId => ({type: 'statistics', requestId, key, layer: snapshot}));
  }

  /** A selection depends on fixed sources, the rectangle and all-data bin edges. */
  queryLinked(key: string, link: SelectionLinkSpec, layers: LayerSpec[], baseline: PreparedStatistics, registry: DataRegistry | DataStore): Promise<LinkedResult> {
    const snapshot = structuredClone(link), members = structuredClone(layers.filter(layer => snapshot.scatter.includes(layer.id) || layer.id === snapshot.histogram));
    const ids = members.flatMap(layer => Object.values(layer.data));
    return this.submit<LinkedResult>(key, ids, ['linked', snapshot, members, this.objectId(baseline)], registry,
      store => linkedSteps(snapshot, members, store, baseline), requestId => ({type: 'linked', requestId, key, link: snapshot, layers: members, baseline}));
  }

  /** Mask transport is bounded to ceil(rows/8) bytes, never a source-array copy. */
  querySelectedScatter(key: string, xId: string, yId: string, mask: Uint8Array, query: Query, registry: DataRegistry | DataStore): Promise<PointPlan> {
    const maskId = this.objectId(mask), snapshot = mask.slice();
    return this.submit<PointPlan>(key, [xId, yId], ['selected-scatter', maskId, query], registry,
      store => maskedScatterSteps(store.get(xId)!.values, store.get(yId)!.values, snapshot, query),
      requestId => ({type: 'selected-scatter', requestId, key, xId, yId, mask: snapshot, query}));
  }

  private objectId(value: object): number {
    let id = this.objectIds.get(value);
    if (id === undefined) {id = ++this.objectSequence; this.objectIds.set(value, id);}
    return id;
  }

  private submit<T extends QueryResult>(key: string, dependencies: string[], identity: unknown[], registry: DataRegistry | DataStore,
    steps: (store: DataStore) => Generator<void, T>, message: (requestId: number) => WorkerRequest,historical=false): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Query scheduler has been disposed.'));
    const store = registry instanceof DataRegistry ? registry.store : registry;
    const ids = [...new Set(dependencies)], captured: DataStore = new Map();
    for (const id of ids) {
      const entry = store.get(id);
      if (!entry) return Promise.reject(new Error(`Unknown data source: ${id}`));
      captured.set(id, entry);
    }
    this.cancel(key);
    // Prune sources removed by the owner even if it did not explicitly call release().
    if(!historical)for (const id of this.registered.keys()) if (!store.has(id)) this.release(id);
    const cacheKey = JSON.stringify([identity, ids.map(id => [id, captured.get(id)!.descriptor.version])]);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cache.delete(cacheKey); this.cache.set(cacheKey, cached);
      return Promise.resolve(cached.plan as T);
    }
    const requestId = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const task: Pending = {key, requestId, ids, cacheKey, cancelled: false, updated:Date.now(), resolve: value => resolve(value as T), reject, fallback: () => {
        try {
          void runSteps<T>(steps(captured), () => task.cancelled || this.disposed)
            .then(result => this.complete(task, result), error => this.reject(task, error instanceof Error ? error : new Error(String(error))));
        } catch (error) {this.reject(task, error instanceof Error ? error : new Error(String(error)));}
      }};
      this.pending.set(requestId, task); this.keys.set(key, requestId);
      // Interaction queries can describe the displayed frame while a newer frame
      // owns worker sources. Run those locally without regressing worker versions.
      if (this.worker&&(!historical||ids.every(id=>this.registered.get(id)===captured.get(id)!.descriptor.version))) {
        try {
          for (const entry of captured.values()) {
            if (this.registered.get(entry.descriptor.id) === entry.descriptor.version) continue;
            this.invalidate(entry.descriptor.id);
            this.register(entry);
            this.registered.set(entry.descriptor.id, entry.descriptor.version);
            this.registeredEntries.set(entry.descriptor.id,entry);
          }
          this.post(message(requestId));
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
    for (const task of [...this.pending.values()]) if (task.ids.includes(id)) this.cancel(task.key);
    this.registered.delete(id);this.registeredEntries.delete(id); this.invalidate(id); this.post({type: 'release', id});
  }

  dispose(): void {
    if (this.disposed) return;
    for (const key of [...this.keys.keys()]) this.cancel(key);
    this.disposed = true; this.post({type: 'dispose'}); this.worker?.terminate(); this.worker = undefined;
    clearInterval(this.watchdog);this.registered.clear();this.registeredEntries.clear(); this.cache.clear(); this.cacheBytes = 0;
  }

  /** Reuse immutable chunks already held by the worker; never serialize the lazy values getter. */
  private register(entry:DataEntry):void{
    const previous=this.registeredEntries.get(entry.descriptor.id);
    if(!entry.chunks){this.transferredBytes+=entry.descriptor.byteLength;this.post({type:'register',entry});return;}
    const old=previous?.chunks??[];
    const buffers=new Map<ArrayBufferLike,number[]>();old.forEach((chunk,index)=>{const indices=buffers.get(chunk.buffer)??[];indices.push(index);buffers.set(chunk.buffer,indices);});
    const parts=entry.chunks.map(chunk=>{
      const index=(buffers.get(chunk.buffer)??[]).find(index=>{const value=old[index];return value.byteOffset<=chunk.byteOffset&&value.byteOffset+value.byteLength>=chunk.byteOffset+chunk.byteLength;})??-1;
      if(index>=0)return {reuse:index,offset:(chunk.byteOffset-old[index].byteOffset)/chunk.BYTES_PER_ELEMENT,length:chunk.length};
      this.transferredBytes+=chunk.byteLength;return {values:chunk};
    });
    this.post({type:'register-chunks',descriptor:entry.descriptor,baseVersion:old.length?previous!.descriptor.version:undefined,parts});
  }

  private post(message: WorkerRequest): void {this.worker?.postMessage(message);}
  private useFallback(): void {
    if (!this.worker) return;
    this.worker.terminate(); this.worker = undefined;clearInterval(this.watchdog); this.registered.clear();this.registeredEntries.clear();
    for (const task of [...this.pending.values()]) task.fallback();
  }
  private reject(task: Pending, error: Error): void {
    if (!this.pending.delete(task.requestId)) return;
    if (this.keys.get(task.key) === task.requestId) this.keys.delete(task.key);
    task.reject(error);
  }
  private complete(task: Pending, result: QueryResult): void {
    if (task.cancelled || this.disposed || this.keys.get(task.key) !== task.requestId) return;
    this.pending.delete(task.requestId); this.keys.delete(task.key);
    const bytes = result.kind==='selection'?256+result.indices.byteLength:result.kind === 'linked' ? 256 + result.mask.byteLength + result.preview.byteLength + statisticsBytes(result.histogram)
      : 'marks' in result ? statisticsBytes(result) : 256 + (result.kind === 'points' ? result.indices.byteLength : result.kind === 'density' ? result.counts.byteLength : result.segments.reduce((sum, item) => sum + item.byteLength + 32, 0));
    if (bytes <= this.maxCacheBytes) {
      const previous = this.cache.get(task.cacheKey);
      if (previous) {this.cacheBytes -= previous.bytes; this.cache.delete(task.cacheKey);}
      while (this.cache.size && (this.cacheBytes + bytes > this.maxCacheBytes || this.cache.size >= 100)) {
        const oldest = this.cache.keys().next().value!;
        this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
      }
      this.cache.set(task.cacheKey, {plan: result, bytes, ids: task.ids}); this.cacheBytes += bytes;
    }
    task.resolve(result);
  }
  private invalidate(id: string): void {
    for (const [key, item] of this.cache) if (item.ids.includes(id)) {this.cacheBytes -= item.bytes; this.cache.delete(key);}
  }
}
