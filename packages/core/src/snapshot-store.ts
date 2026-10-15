import {DataRegistry, chunkEntry} from './data';
import type {DataEntry, NumericArray, Snapshot} from './types';

export const DEFAULT_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export interface SnapshotLease {
  snapshot: Snapshot;
  registry: DataRegistry;
  bytes: number;
  capturedAt: string;
  release(): void;
}

/** Source storage only. Geometry, worker copies and raster targets are separate budgets. */
export class SnapshotStore {
  private used = 0;
  copiedBytes = 0;
  private leases = new Set<SnapshotLease>();
  constructor(readonly maximum = DEFAULT_SNAPSHOT_BYTES) {
    if (!Number.isSafeInteger(maximum) || maximum < 0) throw new RangeError('maxSnapshotBytes must be a nonnegative safe integer');
  }
  get bytes(): number {return this.used;}
  get count(): number {return this.leases.size;}
  reserve(bytes: number): () => void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.used + bytes > this.maximum) {
      throw Object.assign(new RangeError(`Snapshot requires ${bytes} bytes; ${this.maximum - this.used} bytes remain in the source snapshot budget`), {code: 'SNAPSHOT_BUDGET_EXCEEDED', requiredBytes: bytes, availableBytes: this.maximum - this.used});
    }
    this.used += bytes;
    let released = false;
    return () => {if (!released) {released = true; this.used -= bytes;}};
  }
  capture(snapshot: Snapshot, source: DataRegistry): SnapshotLease {
    // Compute backing allocations before allocating or copying any source data.
    const backing = new Set<ArrayBufferLike>();
    let bytes = 0;
    for (const descriptor of snapshot.sources) {
      const entry = source.get(descriptor.id);
      if (entry.chunks) for (const chunk of entry.chunks) {
        if (!backing.has(chunk.buffer)) {backing.add(chunk.buffer); bytes += chunk.buffer.byteLength;}
      }
      else bytes += descriptor.byteLength;
    }
    const releaseReservation = this.reserve(bytes), registry = new DataRegistry(),materializations:Array<()=>void>=[];
    let materializedBytes=0,active=true;
    try {
      const owned = structuredClone(snapshot);
      for (const descriptor of owned.sources) {
        const entry = source.get(descriptor.id);
        if(entry.chunks){
          const chunks=chunkEntry(descriptor,entry.chunks),store=this;let reserved=false;
          registry.store.set(descriptor.id,{descriptor,chunks:chunks.chunks,get materializedByteLength(){return chunks.materializedByteLength;},get values(){
            if(!active)throw new Error('Snapshot source lease has been released');
            if(chunks.chunks!.length>1&&!reserved){
              const release=store.reserve(descriptor.byteLength);
              try{const values=chunks.values;materializations.push(release);materializedBytes+=descriptor.byteLength;store.copiedBytes+=descriptor.byteLength;reserved=true;return values;}
              catch(error){release();throw error;}
            }
            return chunks.values;
          }});
        }else registry.store.set(descriptor.id,{descriptor, values: entry.values.slice() as NumericArray});
        if(!entry.chunks)this.copiedBytes+=descriptor.byteLength;
      }
      const lease: SnapshotLease = {snapshot: owned, registry, get bytes(){return bytes+materializedBytes;}, capturedAt: new Date().toISOString(), release: () => {
        if (!this.leases.delete(lease)) return;
        active=false;
        registry.clear();for(const release of materializations)release();releaseReservation();
      }};
      this.leases.add(lease);
      return lease;
    } catch (error) {for(const release of materializations)release();releaseReservation(); throw error;}
  }
  dispose(): void {for (const lease of [...this.leases]) lease.release();}
}

/** Keep mutable caller arrays out of a completed frame, without recopying on orbit. */
export function ownFrameEntry(entry: DataEntry, cache: WeakMap<DataEntry, DataEntry>,onCopy?:(bytes:number)=>void): DataEntry {
  if (entry.chunks) return entry;
  let owned = cache.get(entry);
  if (!owned) {owned = {descriptor: structuredClone(entry.descriptor), values: entry.values.slice() as NumericArray}; cache.set(entry, owned);onCopy?.(entry.descriptor.byteLength);}
  return owned;
}
