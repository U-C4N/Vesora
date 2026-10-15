import {describe,expect,it} from 'vitest';
import {Figure,Layer} from '../../packages/core/src/figure';
import type {HoverEvent,Snapshot} from '../../packages/core/src/types';

function captured(figure:Figure,layer:Layer,selection:Partial<HoverEvent>={}):{snapshot:Snapshot;buffers:Map<string,ArrayBuffer>}{
  const snapshot=figure.snapshot();snapshot.figure.protocolVersion=7;
  snapshot.figure.inspection={capturedAt:'2025-01-02T03:04:05.000Z',frameId:12,snapshotId:'imported-12',selection:{kind:'point',layerId:layer.id,x:1,y:3,pointerPosition:{x:0,y:0,clientX:0,clientY:0},...selection}};
  return {snapshot,buffers:new Map([...figure.registry.entries()].map(([id,entry])=>[id,entry.values.slice().buffer as ArrayBuffer]))};
}

describe('imported displayed-capture ownership',()=>{
  it('preserves unchanged imports and presentation edits, then drops capture identity on accepted data replacement',()=>{
    const source=new Figure(),line=source.plot([0,1],[2,3]),capture=captured(source,line),copy=new Figure();
    copy.applySnapshot(capture.snapshot,capture.buffers);expect(copy.snapshot()).toEqual(capture.snapshot);
    const imported=new Layer(copy,line.id);
    imported.setStyle({color:'#ef4444',width:4});copy.setView({xDomain:[0,2],yDomain:[0,6]});copy.setTitle('Edited title');copy.setTheme('dark');
    expect(copy.snapshot().figure.inspection).toEqual(capture.snapshot.figure.inspection);
    imported.setData({y:[20,30]});
    const lease=copy.captureExport('accepted');
    expect(lease.snapshot.figure.inspection).toBeUndefined();expect([...lease.registry.get(imported.spec.data.y).values]).toEqual([20,30]);
    expect(lease.capturedAt).not.toBe(capture.snapshot.figure.inspection!.capturedAt);lease.release();
    expect(capture.snapshot.figure.inspection?.selection?.y).toBe(3);
    source.close();copy.close();
  });

  it('invalidates independent surface scalar versions but keeps camera and shading edits',()=>{
    const source=new Figure(),surface=source.surface([0,1],[0,1],[[1,2],[3,4]],{values:[[10,20],[30,40]]});
    const capture=captured(source,surface,{kind:'surface',x:.5,y:.5,z:2.5,value:25,cell:[0,0],triangle:0}),copy=new Figure();
    copy.applySnapshot(capture.snapshot,capture.buffers);const imported=new Layer(copy,surface.id),zVersion=copy.registry.get(imported.spec.data.z).descriptor.version;
    copy.setView({camera:{azimuth:80,elevation:20,distance:4},pan3d:[.2,-.1]});imported.setStyle({shading:'smooth',wireframe:true});
    expect(copy.spec.inspection).toEqual(capture.snapshot.figure.inspection);
    imported.setData({color:[[100,200],[300,400]]});
    expect(copy.spec.inspection).toBeUndefined();expect(copy.registry.get(imported.spec.data.z).descriptor.version).toBe(zVersion);
    source.close();copy.close();
  });

  it('retains valid captures across rejected import/data/budget transactions and empty appends',async()=>{
    const source=new Figure(),a=source.plot([0,1],[2,3]).enableStreaming({maxPoints:3}),b=source.plot([0,1],[4,5]).enableStreaming({maxPoints:3});
    const capture=captured(source,a),copy=new Figure({runtime:{maxSourceBytes:64}});
    copy.applySnapshot(capture.snapshot,capture.buffers);copy.restoreStreaming(Object.fromEntries(source.streams));
    const aa=new Layer(copy,a.id),bb=new Layer(copy,b.id),before=copy.snapshot();
    expect(()=>copy.applySnapshot(capture.snapshot,new Map())).toThrow(/Missing buffer/);
    expect(()=>aa.setData({y:[1]})).toThrow(/equal lengths/);
    await expect(copy.appendDataBatch([{layer:aa,data:{x:[2],y:[6]}},{layer:bb,data:{x:[2],y:[]}}],{waitFor:'accepted'})).rejects.toThrow(/equal lengths/);
    await expect(copy.appendDataBatch([{layer:aa,data:{x:[2],y:[6]}},{layer:bb,data:{x:[2],y:[7]}}],{waitFor:'accepted'})).rejects.toMatchObject({code:'SOURCE_BUDGET_EXCEEDED'});
    await aa.appendData({x:[],y:[]},{waitFor:'accepted'});
    expect(copy.snapshot()).toEqual(before);expect(copy.spec.inspection).toEqual(capture.snapshot.figure.inspection);
    source.close();copy.close();
  });

  it('expires imported capture metadata after an accepted atomic append',async()=>{
    const source=new Figure(),a=source.plot([0,1],[2,3]).enableStreaming({maxPoints:2}),b=source.plot([0,1],[4,5]).enableStreaming({maxPoints:2});
    const capture=captured(source,a),copy=new Figure();copy.applySnapshot(capture.snapshot,capture.buffers);copy.restoreStreaming(Object.fromEntries(source.streams));
    expect(copy.spec.inspection).toEqual(capture.snapshot.figure.inspection);
    await copy.appendDataBatch([{layer:new Layer(copy,a.id),data:{x:[2],y:[6]}},{layer:new Layer(copy,b.id),data:{x:[2],y:[7]}}],{waitFor:'accepted'});
    expect(copy.spec.inspection).toBeUndefined();expect([...copy.registry.get(a.spec.data.y).values]).toEqual([3,6]);expect([...copy.registry.get(b.spec.data.y).values]).toEqual([5,7]);
    source.close();copy.close();
  });

  it('expires captured statistical observations when their options change without source writes',()=>{
    const source=new Figure(),hist=source.hist([0,1,2,3],{bins:2}),capture=captured(source,hist,{kind:'bin',count:2}),copy=new Figure();
    copy.applySnapshot(capture.snapshot,capture.buffers);const versions=copy.snapshot().sources;
    new Layer(copy,hist.id).setOptions({bins:4});
    expect(copy.snapshot().sources).toEqual(versions);expect(copy.spec.inspection).toBeUndefined();
    source.close();copy.close();
  });

  it('expires an imported scene capture when a layer is added or removed',()=>{
    const source=new Figure(),a=source.plot([0,1],[2,3]),capture=captured(source,a),copy=new Figure();
    copy.applySnapshot(capture.snapshot,capture.buffers);copy.scatter([0],[8]);expect(copy.spec.inspection).toBeUndefined();
    copy.applySnapshot(capture.snapshot,capture.buffers);new Layer(copy,a.id).remove();expect(copy.spec.inspection).toBeUndefined();
    source.close();copy.close();
  });
});
