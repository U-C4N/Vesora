import {describe, it, expect} from 'vitest';
import {DataRegistry, chunkEntry, describeData} from '../../packages/core/src/data';
import {SnapshotStore, ownFrameEntry} from '../../packages/core/src/snapshot-store';
import {figure} from '../../packages/core/src/figure';
import {encodeEntryBuffer} from '../../packages/core/src/html-export';

describe('snapshot source ownership', () => {
  it('reserves before copies, keeps a previous snapshot on failure, and releases once', () => {
    const f = figure(), input = new Float64Array([1, 2, 3]); f.plot(input, input);
    const store = new SnapshotStore(48), lease = store.capture(f.snapshot(), f.registry);
    input.fill(99);
    expect([...lease.registry.entries()].map(([, e]) => [...e.values])).toEqual([[1,2,3],[1,2,3]]);
    expect(() => store.capture(f.snapshot(), f.registry)).toThrow(/Snapshot requires/);
    expect(store.bytes).toBe(48); expect(lease.registry.size).toBe(2);
    lease.release(); lease.release(); expect(store.bytes).toBe(0);
  });
  it('charges full shared backing buffers and does not detach immutable chunks', () => {
    const f = figure(); f.plot([1,2], [3,4]); const sources = f.snapshot().sources;
    const backing = new Float64Array(64), source = new DataRegistry();
    for (const d of sources) source.store.set(d.id, chunkEntry(d, [backing.subarray(0, 2)]));
    expect(() => new SnapshotStore(32).capture(f.snapshot(), source)).toThrow(/Snapshot requires 512/);
    const store = new SnapshotStore(512), lease = store.capture(f.snapshot(), source);
    expect(lease.bytes).toBe(512); expect(backing.byteLength).toBe(512);
    store.dispose(); expect(store.bytes).toBe(0);
  });
  it('owns static displayed values once per entry version', () => {
    const values = new Float64Array([5]), entry = {descriptor: describeData('x', values), values};
    const cache = new WeakMap(), first = ownFrameEntry(entry, cache); values[0] = 8;
    expect(first.values[0]).toBe(5); expect(ownFrameEntry(entry, cache)).toBe(first);
  });
  it('encodes chunk boundaries without an unbudgeted contiguous source allocation',()=>{
    const f=figure(),line=f.plot([1,2,3],[4,5,6]),source=new DataRegistry();
    for(const descriptor of f.snapshot().sources){const values=f.registry.get(descriptor.id).values;source.store.set(descriptor.id,chunkEntry(descriptor,[values.slice(0,1),values.slice(1)]));}
    const store=new SnapshotStore(48),lease=store.capture(f.snapshot(),source),entry=lease.registry.get(line.spec.data.x);
    const encoded=encodeEntryBuffer(entry),decoded=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    expect([...new Float64Array(decoded.buffer)]).toEqual([1,2,3]);expect(entry.materializedByteLength).toBe(0);
    expect(()=>entry.values).toThrow(/Snapshot requires/);expect(entry.materializedByteLength).toBe(0);expect(store.bytes).toBe(48);
    lease.release();expect(store.bytes).toBe(0);
    const roomy=new SnapshotStore(96),owned=roomy.capture(f.snapshot(),source);expect([...owned.registry.get(line.spec.data.x).values]).toEqual([1,2,3]);expect(owned.bytes).toBe(72);owned.release();expect(roomy.bytes).toBe(0);
  });
});
