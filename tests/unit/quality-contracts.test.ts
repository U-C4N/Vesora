import {SnapshotStore} from '../../packages/core/src/snapshot-store';
import {describe, expect, it} from 'vitest';
import {Figure} from '../../packages/core/src/figure';
import {FigureView} from '../../packages/core/src/view';
import {buildXInspectionIndex, nearestWithinRun} from '../../packages/core/src/inspection';
import {LIGHT_THEME, resolveTheme} from '../../packages/core/src/presentation';
import {ticks} from '../../packages/core/src/scales';
import {validateExportPNGOptions, validateExportRaster} from '../../packages/core/src/export-options';

const arr = (values: number[]) => Float64Array.from(values);
const buffers = (figure: Figure) => new Map(Array.from(figure.registry.entries(), ([id, entry]) => [id, entry.values.buffer.slice(entry.values.byteOffset, entry.values.byteOffset + entry.values.byteLength) as ArrayBuffer]));

describe('source-based x inspection', () => {
  it('returns original indices, breaks missing runs and never extrapolates', () => {
    const index = buildXInspectionIndex(arr([0, 1, 2, 3, 4]), {y: arr([0, 2, NaN, 6, 8])}, {xScale: 'linear', yScale: 'linear'});
    expect(nearestWithinRun(index, .5)).toBe(0);
    expect(nearestWithinRun(index, .9)).toBe(1);
    expect(nearestWithinRun(index, 1.1)).toBeNull(); expect(nearestWithinRun(index, 2.9)).toBeNull();
    expect(nearestWithinRun(index, 3)).toBe(3);
    for (const target of [-1, 2, 5, NaN, Infinity]) expect(nearestWithinRun(index, target)).toBeNull();
    const singleton = buildXInspectionIndex(arr([7]), {y: arr([3])}, {xScale: 'linear', yScale: 'linear'});
    expect(nearestWithinRun(singleton, 7)).toBe(0); expect(nearestWithinRun(singleton, 7.01)).toBeNull();
  });

  it('respects log-invalid gaps, log screen distance and extreme finite coordinates', () => {
    const index = buildXInspectionIndex(arr([1, 10, 100, 1000]), {y: arr([1, 2, -1, 2])}, {xScale: 'log', yScale: 'log'});
    expect(nearestWithinRun(index, 4)).toBe(1); expect(nearestWithinRun(index, Math.sqrt(10))).toBe(0); expect(nearestWithinRun(index, 20)).toBeNull();
    const large = buildXInspectionIndex(arr([-1e308, 1e308]), {y: arr([1, 2])}, {xScale: 'linear', yScale: 'linear'});
    expect(nearestWithinRun(large, 0)).toBe(0); expect(nearestWithinRun(large, 9e307)).toBe(1);
    const logarithmic = buildXInspectionIndex(arr([Number.MIN_VALUE, 1e308]), {y: arr([1, 2])}, {xScale: 'log', yScale: 'linear'});
    expect(nearestWithinRun(logarithmic, 1e-5)).toBe(1);
  });

  it('validates x mode before mutations, including showing an ineligible hidden line', () => {
    const figure = new Figure(), bad = figure.plot([1, 0], [2, 3]);
    let before = figure.snapshot(); expect(() => figure.setHoverMode('x')).toThrow(/increasing/); expect(figure.snapshot()).toEqual(before);
    bad.setVisible(false); figure.setHoverMode('x'); before = figure.snapshot();
    expect(() => bad.setVisible(true)).toThrow(/increasing/); expect(figure.snapshot()).toEqual(before);
    bad.setData({x: [0, 1]}); bad.setVisible(true); before = figure.snapshot();
    expect(() => bad.setData({x: [0, 0]})).toThrow(/increasing/); expect(figure.snapshot()).toEqual(before);
    expect(() => figure.plot([0, NaN], [1, 2])).toThrow(/increasing/); expect(figure.snapshot()).toEqual(before);
    expect(() => figure.setHoverMode(undefined as any)).toThrow(/mode/);
    const imported = new Figure(); imported.applySnapshot(figure.snapshot(), buffers(figure)); expect(imported.spec.hoverMode).toBe('x');
    const downgraded = figure.snapshot(); downgraded.figure.protocolVersion = 5;
    expect(() => imported.applySnapshot(downgraded, buffers(figure))).toThrow(/version 6/);
    const categorical = new Figure(); categorical.plot(['a', 'b'], [1, 2]); expect(() => categorical.setHoverMode('x')).toThrow(/numeric/);
    const categoricalY = new Figure(); categoricalY.plot([0, 1], ['a', 'b']); expect(() => categoricalY.setHoverMode('x')).toThrow(/numeric/);
    figure.close(); imported.close(); categorical.close(); categoricalY.close();
  });
});

describe('versioned presentation quality', () => {
  it('preserves legacy theme snapshots and promotes only explicitly requested role fonts', () => {
    const legacy = new Figure({theme: 'light'}); expect(legacy.spec.theme).toEqual(LIGHT_THEME); expect(legacy.spec.protocolVersion).toBe(5);
    const imported = new Figure(); imported.applySnapshot(legacy.snapshot(), buffers(legacy)); expect(imported.snapshot()).toEqual(legacy.snapshot());
    expect(resolveTheme('dark')).not.toHaveProperty('tickFontSize');
    legacy.setTheme({fontSize: 13, titleFontSize: 24, tickFontSize: 11}); expect(legacy.spec.protocolVersion).toBe(6);
    expect(legacy.spec.theme).toMatchObject({titleFontSize: 24, tickFontSize: 11}); expect(legacy.spec.theme).not.toHaveProperty('labelFontSize');
    imported.applySnapshot(legacy.snapshot(), buffers(legacy)); expect(imported.snapshot()).toEqual(legacy.snapshot());
    const before = legacy.snapshot(); expect(() => legacy.setTheme({legendFontSize: 100})).toThrow(); expect(legacy.snapshot()).toEqual(before);
    const invalid = legacy.snapshot(); invalid.figure.protocolVersion = 5;
    expect(() => imported.applySnapshot(invalid, buffers(legacy))).toThrow(/version 6/);
    legacy.setTheme('dark'); expect(legacy.spec.protocolVersion).toBe(6);
    legacy.close(); imported.close();
  });

  it('serializes colorbar labels and retains older protocol numbers otherwise', () => {
    const figure = new Figure(), layer = figure.heatmap([0, 1], [0, 1], [[1, 2], [3, 4]]);
    expect(figure.spec.protocolVersion).toBe(1);
    layer.setStyle({colorbarLabel: 'Temperature / °C'}); expect(figure.spec.protocolVersion).toBe(6);
    const before = figure.snapshot(); expect(() => layer.setStyle({colorbarLabel: 7} as any)).toThrow(/string/); expect(figure.snapshot()).toEqual(before);
    const imported = new Figure(); imported.applySnapshot(before, buffers(figure)); expect(imported.snapshot()).toEqual(before);
    figure.close(); imported.close();
  });

  it('uses meaningful log labels inside padded scientific domains', () => {
    expect(ticks([.221, 4.366], 'log', 5)).toEqual([.5, 1, 2]);
    expect(ticks([1, 10], 'log', 6)).toEqual([1, 2, 5, 10]);
    expect(ticks([1, 1000], 'log')).toEqual([1, 10, 100, 1000]);
    for (const domain of [[.81, 1.21], [2.1, 2.9], [1e-300, 4e-300]] as [number, number][]) {
      const values = ticks(domain, 'log', 5);
      expect(values.length).toBeGreaterThanOrEqual(2);
      expect(values.every((value, index) => Number.isFinite(value) && value >= domain[0] && value <= domain[1] && (!index || value > values[index - 1]))).toBe(true);
    }
  });
});

describe('controlled PNG request contracts', () => {
  it('rejects disposal while an owned snapshot is queued instead of exporting a replacement view', async () => {
    for(const action of ['close','unmount'] as const){
      const figure=new Figure();let settle!:()=>void;
      const ready=new Promise<void>(resolve=>{settle=resolve;});
      const view=Object.create(FigureView.prototype);
      Object.assign(view,{snapshotStore:new SnapshotStore(),retiredSnapshots:new Set(),frameCopies:new WeakMap(),figure,exportQueue:ready,exportReservations:new Set(),width:800,height:520,dpr:1,renderer:{validateRasterSize(){}},completed:0,generation:0,disposed:false,dispose(){this.disposed=true;}});
      (figure as any).view=view;
      const pending=figure.savefig({scale:2});
      figure[action]();
      let replacementCalled=false;
      if(action==='unmount')(figure as any).view={dispose(){},exportPNG(){replacementCalled=true;return Promise.resolve(new Blob());}};
      settle();
      await expect(pending).rejects.toThrow('Figure view disposed during PNG export');
      expect(replacementCalled).toBe(false);figure.close();
    }
  });
  it('bounds both PNG entry points before source capture and releases reservations on cancellation', async () => {
    const figure=new Figure();figure.plot([0,1],[2,3]);let settle!:()=>void,reads=0,clones=0;
    const blocked=new Promise<void>(resolve=>{settle=resolve;}),view=Object.create(FigureView.prototype);
    Object.assign(view,{snapshotStore:new SnapshotStore(),retiredSnapshots:new Set(),frameCopies:new WeakMap(),figure,exportQueue:blocked,exportReservations:new Set(),width:800,height:520,dpr:1,renderer:{validateRasterSize(){}}});
    const snapshot=figure.snapshot(),input=new Map<string,ArrayBuffer>();
    for(const [id,entry]of figure.registry.entries()){
      const values=entry.values,buffer=values.buffer.slice(values.byteOffset,values.byteOffset+values.byteLength) as ArrayBuffer;
      Object.defineProperty(buffer,'slice',{value:()=>{clones++;return ArrayBuffer.prototype.slice.call(buffer,0);}});input.set(id,buffer);
      figure.registry.store.set(id,{descriptor:entry.descriptor,get values(){reads++;return values;}});
    }
    const pending=Array.from({length:8},(_,i)=>i%2?view.exportSnapshotPNG(snapshot,input):view.exportPNG());
    const settled=Promise.allSettled(pending);expect(view.exportReservations.size).toBe(8);expect(reads).toBe(8);expect(clones).toBe(8);
    await expect(view.exportPNG()).rejects.toMatchObject({code:'EXPORT_BACKPRESSURE'});
    await expect(view.exportSnapshotPNG(snapshot,input)).rejects.toMatchObject({code:'EXPORT_BACKPRESSURE'});
    expect(reads).toBe(8);expect(clones).toBe(8);
    // Exercise real disposal before the blocked render queue can begin.
    Object.assign(view,{observer:{disconnect(){}},scheduler:{dispose(){}},renderer:{dispose(){}},root:{remove(){}},cleanup:[],plans:new Map(),geometries:new Map(),extents:new Map(),statistics:new Map(),barCache:new Map(),statisticsRequests:new Set(),sources:new Set(),selectedPlans:new Map(),hoverIndices:new Map(),waiters:[]});
    view.dispose();expect(view.exportReservations.size).toBe(0);
    const results=await settled;expect(results.every(result=>result.status==='rejected'&&result.reason.message==='Figure view disposed during PNG export')).toBe(true);
    settle();await view.exportQueue;figure.close();
  });
  it('releases a PNG reservation after snapshot validation fails',async()=>{
    const figure=new Figure(),view=Object.create(FigureView.prototype);
    Object.assign(view,{snapshotStore:new SnapshotStore(),retiredSnapshots:new Set(),frameCopies:new WeakMap(),figure,exportQueue:Promise.resolve(),exportReservations:new Set(),width:800,height:520,dpr:1,renderer:{validateRasterSize(){throw new Error('Raster budget exceeded');}}});
    await expect(view.exportPNG()).rejects.toThrow('Raster budget exceeded');expect(view.exportReservations.size).toBe(0);figure.close();
  });
  it('keeps caller options isolated, accepts downscale and computes exact raster dimensions', () => {
    const input = {width: 1000, height: 625, scale: 2}, output = validateExportPNGOptions(input); input.width = 2000;
    expect(output).toEqual({width: 1000, height: 625, scale: 2});
    expect(validateExportRaster(output.width!, output.height!, output.scale!)).toEqual({width: 2000, height: 1250});
    expect(validateExportPNGOptions({scale: .5})).toEqual({scale: .5});
    expect(validateExportRaster(1000, 625, .5)).toEqual({width: 500, height: 313});
    expect(validateExportPNGOptions()).toEqual({});
  });
  it('rejects ambiguous dimensions, invalid options and unsafe raster allocations', () => {
    for (const options of [{width: 1000}, {width: 1000, height: 625.5}, {width: 199, height: 200}, {scale: 0}, {scale: Infinity}, {dpi: 300}, null]) expect(() => validateExportPNGOptions(options as any)).toThrow();
    expect(() => validateExportPNGOptions({width: 10000, height: 10000, scale: 1})).toThrow(/32000000/);
    expect(() => validateExportRaster(800, 520, Number.MIN_VALUE)).toThrow(/positive/);
  });
});
