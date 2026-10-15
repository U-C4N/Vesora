import {DataRegistry,validateDescriptor,chunkEntry} from './data';
import {selectionSteps} from './interaction';
import type {SelectionResult} from './interaction';
import type {Bounds} from './types';
import {ascending} from './source-metadata';
import {lineSteps, runSteps, scatterSteps} from './planning';
import {bandSteps} from './band';
import {statisticsSteps} from './statistics';
import {linkedSteps, maskedScatterSteps} from './linked';
import type {LinkedResult} from './linked';
import type {PreparedStatistics} from './statistics';
import type {BandResult, DataDescriptor,DataEntry, DataStore, LayerSpec, LineResult, NumericArray, PointPlan, Query, SelectionLinkSpec} from './types';

export type WorkerRequest =
  | {type: 'register'; entry: DataEntry}
  | {type:'register-chunks';descriptor:DataDescriptor;baseVersion?:number;parts:Array<{reuse:number;offset:number;length:number}|{values:NumericArray}>}
  | {type: 'release'; id: string}
  | {type: 'query'; requestId: number; key: string; kind: 'scatter' | 'line'; xId: string; yId: string; query: Query}
  | {type:'selection';requestId:number;key:string;xId:string;yId:string;bounds:Bounds;colorId?:string}
  | {type: 'band'; requestId: number; key: string; xId: string; lowerId: string; upperId: string; query: Query}
  | {type: 'statistics'; requestId: number; key: string; layer: LayerSpec}
  | {type: 'linked'; requestId: number; key: string; link: SelectionLinkSpec; layers: LayerSpec[]; baseline: PreparedStatistics}
  | {type: 'selected-scatter'; requestId: number; key: string; xId: string; yId: string; mask: Uint8Array; query: Query}
  | {type: 'cancel'; requestId: number}
  | {type: 'dispose'};
export type WorkerResponse =
  | {type:'ready'}
  | {type:'progress';requestId:number}
  | {type:'sync-error';message:string}
  | {type: 'result'; requestId: number; result: PointPlan | LineResult | BandResult | PreparedStatistics | LinkedResult | SelectionResult}
  | {type: 'error'; requestId: number; name: string; message: string};

const registry = new DataRegistry();
const requests = new Map<number, {cancelled: boolean; ids: string[]}>();
let disposed = false;
const scope = globalThis as unknown as {onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null; postMessage(message: WorkerResponse, transfer?: Transferable[]): void; close(): void};

scope.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data;
  if(message.type==='register-chunks'){
    try{
      validateDescriptor(message.descriptor);
      const old=registry.store.get(message.descriptor.id);
      if(message.baseVersion!==undefined&&old?.descriptor.version!==message.baseVersion)throw new Error('Worker source revision mismatch');
      const chunks=message.parts.map(part=>{
        if('values' in part)return part.values;
        const chunk=old?.chunks?.[part.reuse];if(!chunk||part.offset<0||part.length<0||part.offset+part.length>chunk.length)throw new Error('Invalid worker chunk reference');
        return chunk.subarray(part.offset,part.offset+part.length) as NumericArray;
      });
      if(chunks.reduce((sum,value)=>sum+value.byteLength,0)!==message.descriptor.byteLength)throw new Error('Worker chunk length mismatch');
      registry.store.set(message.descriptor.id,chunkEntry(message.descriptor,chunks));
    }catch(error){scope.postMessage({type:'sync-error',message:error instanceof Error?error.message:String(error)});}
    return;
  }
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
  const task = {cancelled: false, ids: message.type === 'statistics' ? Object.values(message.layer.data)
    : message.type === 'linked' ? [...new Set(message.layers.flatMap(layer => Object.values(layer.data)))] : message.type === 'band' ? [message.xId, message.lowerId, message.upperId] : message.type==='selection'?[message.xId,message.yId,...(message.colorId?[message.colorId]:[])]:[message.xId, message.yId]};
  requests.set(requestId, task);
  void (async () => {
    try {
      // Capture entries before the first cooperative yield. A later register
      // message can replace another group's source without changing this task's
      // immutable source/version snapshot.
      const captured: DataStore = new Map(task.ids.map(id => [id, registry.get(id)]));
      const steps = message.type==='selection'?selectionSteps(captured.get(message.xId)!.values,captured.get(message.yId)!.values,message.bounds,message.colorId?captured.get(message.colorId)!.values:undefined):message.type === 'statistics' ? statisticsSteps(message.layer, captured)
        : message.type === 'linked' ? linkedSteps(message.link, message.layers, captured, message.baseline)
          : message.type === 'band' ? bandSteps(captured.get(message.xId)!.values, captured.get(message.lowerId)!.values, captured.get(message.upperId)!.values, message.query)
          : message.type === 'selected-scatter' ? maskedScatterSteps(captured.get(message.xId)!.values, captured.get(message.yId)!.values, message.mask, message.query)
            : message.kind === 'line' ? lineSteps(captured.get(message.xId)!, captured.get(message.yId)!, message.query,ascending(captured.get(message.xId)!))
              : scatterSteps(captured.get(message.xId)!, captured.get(message.yId)!, message.query);
      function* progress():Generator<void,PointPlan | LineResult | BandResult | PreparedStatistics | LinkedResult | SelectionResult>{let last=Date.now();while(true){const step=steps.next();if(step.done)return step.value;if(Date.now()-last>=250){scope.postMessage({type:'progress',requestId});last=Date.now();}yield;}}
      const result = await runSteps<PointPlan | LineResult | BandResult | PreparedStatistics | LinkedResult | SelectionResult>(progress(), () => task.cancelled || disposed);
      if (task.cancelled || disposed) return;
      const transfer: Transferable[] = result.kind==='selection'?[result.indices.buffer]:result.kind === 'linked' ? [result.mask.buffer, result.preview.buffer]
        : 'marks' in result ? [] : result.kind === 'points' ? [result.indices.buffer] : result.kind === 'density' ? [result.counts.buffer] : result.segments.map(segment => segment.buffer);
      scope.postMessage({type: 'result', requestId, result}, transfer);
    } catch (error) {
      if (!task.cancelled && !disposed) scope.postMessage({type: 'error', requestId, name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error)});
    } finally {requests.delete(requestId);}
  })();
};
scope.postMessage({type:'ready'});
