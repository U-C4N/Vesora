import {describe, expect, it} from 'vitest';
import {Figure, SelectionLink, subplots} from '../../packages/core/src/figure';
import type {Snapshot} from '../../packages/core/src/types';

function fixture() {
  const fig = subplots({rows: 1, cols: 3, width: 1100, height: 450});
  const a = fig.panel(0, 0).scatter([0, 1, 2], [1, 2, 3]), b = fig.panel(0, 1).scatter([2, 1, 0], [3, 2, 1]);
  const h = fig.panel(0, 2).hist([0, 1, 2], {bins: [0, 1, 3]});
  return {fig, a, b, h};
}
function buffers(fig: Figure): Map<string, ArrayBuffer> {
  return new Map(Array.from(fig.registry.entries(), ([id, entry]) => [id, entry.values.buffer.slice(entry.values.byteOffset, entry.values.byteOffset + entry.values.byteLength) as ArrayBuffer]));
}

describe('public linked-selection API', () => {
  it('promotes the scene and stores only the fixed relation and rectangle', () => {
    const {fig, a, b, h} = fixture(), link = fig.linkSelection({scatter: [a, b], histogram: h});
    expect(link).toBeInstanceOf(SelectionLink);
    expect(fig.snapshot().figure).toMatchObject({protocolVersion: 4, selectionLink: {id: link.id, scatter: [a.id, b.id], histogram: h.id, generation: 1, sequence: 0}});
    expect(fig.spec.selectionLink).not.toHaveProperty('mask');
    expect(fig.spec.selectionLink).not.toHaveProperty('indices');
    expect(() => fig.linkSelection({scatter: [a, b], histogram: h})).toThrow(/one selection link/);
    const before = fig.snapshot(); link.clear(); expect(fig.snapshot()).toEqual(before);
    fig.close(); expect(() => link.clear()).toThrow(/closed/);
  });

  it('keeps linked source values and calculation options fixed with atomic failures', () => {
    const {fig, a, b, h} = fixture(), link = fig.linkSelection({scatter: [a, b], histogram: h});
    const before = fig.snapshot(), bytes = buffers(fig);
    for (const operation of [() => a.setData({x: [3, 4, 5]}), () => b.setData({y: [4, 5, 6]}), () => h.setData({samples: [1, 1, 1]}), () => h.setOptions({bins: 10})]) {
      expect(operation).toThrow(/fixed/); expect(fig.snapshot()).toEqual(before); expect(buffers(fig)).toEqual(bytes);
    }
    a.setStyle({color: '#ef4444'}); b.setVisible(false); fig.panel(0, 0).setView({xScale: 'log', xDomain: [1, 10]});
    expect(fig.spec.selectionLink).toEqual(before.figure.selectionLink);
    link.remove(); expect(fig.spec.selectionLink).toBeUndefined();
    a.setData({x: [3, 4, 5]}); h.setOptions({bins: 3}); expect([...fig.registry.get(a.spec.data.x).values]).toEqual([3, 4, 5]);
    expect(() => link.clear()).toThrow(/removed/); fig.close();
  });

  it('rejects foreign handles and incompatible groups before promoting the scene', () => {
    const {fig, a, b, h} = fixture(), foreign = new Figure(), alien = foreign.scatter([0, 1, 2], [1, 2, 3]), before = fig.snapshot();
    expect(() => fig.linkSelection({scatter: [a, alien], histogram: h})).toThrow(/belong/);
    expect(() => fig.linkSelection({scatter: [a, a], histogram: h})).toThrow(/distinct/);
    b.setData({x: [0, 1], y: [0, 1]});
    const mismatched = fig.snapshot(); expect(() => fig.linkSelection({scatter: [a, b], histogram: h})).toThrow(/aligned/);
    expect(fig.snapshot()).toEqual(mismatched); expect(fig.spec.protocolVersion).toBe(before.figure.protocolVersion);
    fig.close(); foreign.close();
  });

  it('removes the link when a member is removed and permits an aligned replacement group', () => {
    const {fig, a, b, h} = fixture(), original = fig.linkSelection({scatter: [a, b], histogram: h});
    a.remove(); expect(fig.spec.selectionLink).toBeUndefined(); expect(() => original.remove()).toThrow(/removed/);
    const replacement = fig.panel(0, 0).scatter([3, 2, 1], [1, 2, 3]);
    const current = fig.linkSelection({scatter: [replacement, b], histogram: h});
    expect(current.id).not.toBe(original.id); expect(fig.spec.selectionLink?.scatter).toEqual([replacement.id, b.id]); fig.close();
  });

  it('round-trips a committed raw predicate, preserves it on view/bookmark changes and clears it', () => {
    const {fig, a, b, h} = fixture(); fig.linkSelection({scatter: [a, b], histogram: h});
    const snapshot = fig.snapshot(); snapshot.figure.selectionLink!.selection = {originLayerId: a.id, bounds: {x: [-1, 1], y: [0, 3]}}; snapshot.figure.selectionLink!.sequence = 2;
    const copy = new Figure(); copy.applySnapshot(snapshot, buffers(fig)); expect(copy.snapshot()).toEqual(snapshot);
    const predicate = structuredClone(copy.spec.selectionLink!.selection);
    copy.bookmark('Overview'); copy.panel(0, 0).setView({xScale: 'log', xDomain: [1, 10]}); copy.restoreBookmark('Overview');
    expect(copy.spec.selectionLink!.selection).toEqual(predicate);
    const handle = new SelectionLink(copy, copy.spec.selectionLink!.id); handle.clear();
    expect(copy.spec.selectionLink!.selection).toBeUndefined(); expect(copy.spec.selectionLink!.sequence).toBe(3);
    const cleared = copy.snapshot(); handle.clear(); expect(copy.snapshot()).toEqual(cleared); fig.close(); copy.close();
  });

  it('rolls back invalid protocol/predicate imports and continues to read v1/v2/v3', () => {
    const {fig, a, b, h} = fixture(); fig.linkSelection({scatter: [a, b], histogram: h});
    const copy = new Figure(), snapshot = fig.snapshot(), data = buffers(fig); copy.applySnapshot(snapshot, data);
    for (const mutate of [
      (value: Snapshot) => {value.figure.protocolVersion = 3;},
      (value: Snapshot) => {value.figure.selectionLink!.selection = {originLayerId: h.id, bounds: {x: [0, 1], y: [0, 1]}};},
      (value: Snapshot) => {value.figure.selectionLink!.scatter[1] = a.id;},
      (value: Snapshot) => {value.figure.selectionLink!.sequence = -1;},
    ]) {
      const invalid = structuredClone(snapshot); mutate(invalid); expect(() => copy.applySnapshot(invalid, data)).toThrow(); expect(copy.snapshot()).toEqual(snapshot);
    }
    const v1 = new Figure(); v1.scatter([1], [2]);
    const v2 = subplots({rows: 1, cols: 2}); v2.panel(0, 1).scatter([1], [2]);
    const v3 = new Figure(); v3.hist([1, 2], {bins: 2});
    for (const [index, legacy] of [v1, v2, v3].entries()) {
      expect(legacy.spec.protocolVersion).toBe(index + 1); copy.applySnapshot(legacy.snapshot(), buffers(legacy)); expect(copy.snapshot()).toEqual(legacy.snapshot()); legacy.close();
    }
    fig.close(); copy.close();
  });

  it('does not corrupt an imported selection when its sequence is exhausted', () => {
    const {fig, a, b, h} = fixture(); const link=fig.linkSelection({scatter:[a,b],histogram:h});
    const snapshot=fig.snapshot(); snapshot.figure.selectionLink!.sequence=Number.MAX_SAFE_INTEGER;
    snapshot.figure.selectionLink!.selection={originLayerId:a.id,bounds:{x:[0,1],y:[0,3]}};
    fig.applySnapshot(snapshot,buffers(fig));
    expect(()=>link.clear()).toThrow(/sequence/);expect(fig.snapshot()).toEqual(snapshot);
    link.remove();expect(fig.spec.selectionLink).toBeUndefined();fig.close();
  });

  it('retains fixed linked values when caller arrays or imported buffers change', () => {
    const fig=subplots({rows:1,cols:3}),x=Float64Array.of(0,1,2),y=Float32Array.of(2,1,0),samples=Int32Array.of(0,1,2);
    const a=fig.panel(0,0).scatter(x,y),b=fig.panel(0,1).scatter(x,y),h=fig.panel(0,2).hist(samples,{bins:[0,1,3]});
    const descriptors=fig.snapshot().sources;fig.linkSelection({scatter:[a,b],histogram:h});
    const snapshot=fig.snapshot(),data=buffers(fig);x.fill(99);y.fill(99);samples.fill(99);
    expect([...fig.registry.get(a.spec.data.x).values]).toEqual([0,1,2]);
    expect([...fig.registry.get(b.spec.data.y).values]).toEqual([2,1,0]);
    expect([...fig.registry.get(h.spec.data.samples).values]).toEqual([0,1,2]);
    expect(fig.snapshot().sources).toEqual(descriptors);
    const copy=new Figure();copy.applySnapshot(snapshot,data);
    for(const buffer of data.values())new Uint8Array(buffer).fill(0);
    expect(buffers(copy)).toEqual(buffers(fig));expect(copy.snapshot()).toEqual(snapshot);
    fig.close();copy.close();
  });
});
