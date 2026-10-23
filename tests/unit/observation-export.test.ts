import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Figure,Layer} from '../../packages/core/src/figure';
import {encodeHTMLSnapshot,toHTML} from '../../packages/core/src/html-export';
import {captureObservation,SnapshotStore} from '../../packages/core/src/snapshot-store';

beforeEach(()=>vi.stubGlobal('__VESORA_HTML_TEMPLATE__','<script type="application/json">__VESORA_PAYLOAD_JSON__</script>'));
afterEach(()=>vi.unstubAllGlobals());
const payload=(html:string)=>JSON.parse(html.match(/application\/json">([\s\S]*)<\/script>/)![1]);

describe('atomic observation export',()=>{
  it('round-trips the shared Python Float32 streaming fixture through HTML and scene import',async()=>{
    const fixture=JSON.parse(readFileSync(new URL('../fixtures/observation-v1/temperature.json',import.meta.url),'utf8'));
    const fig=new Figure(),copy=new Figure();
    try{
      const line=fig.plot(new Float32Array(fixture.x),new Float32Array(fixture.y)).enableStreaming({maxPoints:fixture.maxPoints});
      line.setSemantics(fixture.channelSemantics);
      await line.appendData({x:new Float32Array(fixture.append.x),y:new Float32Array(fixture.append.y)});
      const html=toHTML(fig,{observation:true}),exported=payload(html);
      expect(html).not.toContain('Temperature İ 🌡 </script>&');
      const buffers=new Map<string,ArrayBuffer>(exported.buffers.map(({id,base64}:any)=>[id,Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer]));
      copy.applySnapshot(exported.snapshot,buffers);
      const imported=new Layer(copy,line.id),record=copy.getObservation()!;
      expect(copy.spec.protocolVersion).toBe(8);expect(imported.getSemantics()).toEqual(fixture.channelSemantics);
      expect(record).toEqual(exported.snapshot.figure.observation);
      expect(record).toMatchObject({source:'accepted',representation:{status:'not-evaluated'},streams:[{layerId:line.id,revision:fixture.expected.revision,sequenceStart:fixture.expected.sequenceStart,sequenceEndExclusive:fixture.expected.sequenceEndExclusive}]});
      expect(record.sourceVersions).toEqual(exported.snapshot.sources.map(({id,version}:any)=>({id,version})));
      for(const channel of ['x','y']){
        const source=copy.registry.get(imported.spec.data[channel]);
        expect(source.descriptor.dtype).toBe(fixture.dtype);expect(source.values).toBeInstanceOf(Float32Array);
        expect([...source.values]).toEqual(fixture.expected[channel]);
        expect([...new Uint8Array(source.values.buffer,source.values.byteOffset,source.values.byteLength)]).toEqual([...new Uint8Array(new Float32Array(fixture.expected[channel]).buffer)]);
      }
      const parameters=imported.getSemantics().y.transforms![0].parameters!;
      expect(Object.hasOwn(parameters,'__proto__')).toBe(true);expect(parameters.__proto__).toBe('inert');
      expect(fig.diagnostics().snapshotBytes).toBe(0);
    }finally{copy.close();fig.close();}
  });
  it('records exact retained stream ranges and semantics without evaluating a renderer',async()=>{
    const fig=new Figure(),line=fig.plot([0,1],[10,11]).enableStreaming({maxPoints:3});
    line.setSemantics({x:{unit:'s'},y:{quantity:'temperature',unit:'K'}});
    await line.appendData({x:[2,3,4],y:[12,13,14]});
    const exported=payload(toHTML(fig,{observation:true})),record=exported.snapshot.figure.observation;
    expect(record).toMatchObject({schemaVersion:1,source:'accepted',representation:{status:'not-evaluated'},streams:[{layerId:line.id,revision:1,sequenceStart:2,sequenceEndExclusive:5}]});
    expect(record.sourceVersions).toEqual(exported.snapshot.sources.map(({id,version}:any)=>({id,version})));
    expect(exported.snapshot.figure.semantics.sources[line.spec.data.y]).toEqual({quantity:'temperature',unit:'K'});
    const encoded=exported.buffers.find(({id}:any)=>id===line.spec.data.x).base64;
    expect([...new Float64Array(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)).buffer)]).toEqual([2,3,4]);
    expect(fig.getObservation()).toBeUndefined();expect(fig.diagnostics().snapshotBytes).toBe(0);fig.close();
  });
  it('strips imported evidence by default and creates fresh accepted evidence only on request',()=>{
    const original=new Figure();original.plot([0,1],[2,3]);
    const exported=payload(toHTML(original,{observation:true})),copy=new Figure();
    const buffers=new Map<string,ArrayBuffer>(exported.buffers.map(({id,base64}:any)=>[id,Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer]));
    copy.applySnapshot(exported.snapshot,buffers);const imported=copy.getObservation();
    expect(payload(toHTML(copy)).snapshot.figure.observation).toBeUndefined();expect(copy.getObservation()).toEqual(imported);
    const pinned=copy.captureExport('accepted');
    expect(payload(encodeHTMLSnapshot(pinned.snapshot,pinned.registry)).snapshot.figure.observation).toBeUndefined();
    expect(pinned.snapshot.figure.observation).toEqual(imported);pinned.release();
    expect(payload(toHTML(copy,{observation:true})).snapshot.figure.observation.representation).toEqual({status:'not-evaluated'});
    expect(()=>toHTML(copy,{observation:'yes' as any})).toThrow(/boolean/);
    original.close();copy.close();
  });
  it('uses owned frame metadata even if the live figure advances after capture',()=>{
    const fig=new Figure(),line=fig.plot([0,1],[2,3]).enableStreaming({maxPoints:2}),store=new SnapshotStore();
    const lease=store.capture(fig.snapshot(),fig.registry),layers=[{layerId:line.id,kind:'line' as const,total:2,visible:2,rendered:2,exact:true,method:'raw'}];
    captureObservation(lease,'displayed',fig.streams,{status:'rendered',frameId:7,snapshotId:'held-frame',layers});
    line.setData({x:[100],y:[200]});layers[0].total=999;
    vi.spyOn(fig,'captureExport').mockReturnValueOnce(lease);
    vi.spyOn(fig,'getInspectionState').mockImplementation(()=>{throw new Error('live state must not be read');});
    const exported=payload(toHTML(fig,{source:'displayed',observation:true}));
    expect(exported.capture).toMatchObject({source:'displayed',frameId:7,snapshotId:'held-frame'});
    expect(exported.snapshot.figure.observation.representation).toMatchObject({frameId:7,layers:[{total:2}]});
    expect(exported.snapshot.figure.observation.streams[0]).toMatchObject({sequenceStart:0,sequenceEndExclusive:2,revision:0});
    expect(store.bytes).toBe(0);fig.close();
  });
  it('releases snapshot reservations when validation or encoding fails',()=>{
    const fig=new Figure();fig.plot([0],[1]);
    vi.stubGlobal('__VESORA_HTML_TEMPLATE__','missing payload marker');
    expect(()=>toHTML(fig,{observation:true})).toThrow(/placeholder/);expect(fig.diagnostics().snapshotBytes).toBe(0);fig.close();
  });
});
