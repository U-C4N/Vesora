import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Figure} from '../../packages/core/src/figure';
import {toHTMLAsync} from '../../packages/core/src/html-export-async';
import {toHTML} from '../../packages/core/src/html-export';
import type {ExportHTMLOptions} from '../../packages/core/src/html-export';

const template='<!doctype html><script id="vesora-payload" type="application/json">__VESORA_PAYLOAD_JSON__</script>';
const payload=(html:string)=>JSON.parse(html.match(/application\/json">([\s\S]*)<\/script>/)![1]);
beforeEach(()=>vi.stubGlobal('__VESORA_HTML_TEMPLATE__',template));
afterEach(()=>vi.unstubAllGlobals());

describe('on-demand HTML export',()=>{
  it('captures source versions, semantics and bytes before the first await',async()=>{
    const figure=new Figure({title:'Captured'}),layer=figure.plot([1,2],[3,4]);
    layer.setSemantics({y:{name:'Height',unit:'m'}});
    const options:ExportHTMLOptions={source:'accepted',observation:true};
    const exported=toHTMLAsync(figure,options);
    expect(figure.diagnostics().snapshotBytes).toBeGreaterThan(0);
    layer.setData({x:[9],y:[10]});layer.setSemantics({y:{name:'Changed',unit:'mm'}});
    figure.spec.title='Later';options.observation=false;options.source='displayed';
    const document=payload(await exported),record=document.snapshot.figure.observation;
    expect(document.snapshot.figure.title).toBe('Captured');
    expect(document.snapshot.sources.map((source:any)=>source.shape[0])).toEqual([2,2]);
    expect(record.source).toBe('accepted');
    expect(record.sourceVersions).toEqual(document.snapshot.sources.map(({id,version}:any)=>({id,version})));
    expect(Object.values(document.snapshot.figure.semantics.sources)).toContainEqual({name:'Height',unit:'m'});
    const bytes=Uint8Array.from(atob(document.buffers[0].base64),(c:string)=>c.charCodeAt(0));
    expect([...new Float64Array(bytes.buffer)]).toEqual([1,2]);
    expect(figure.diagnostics().snapshotBytes).toBe(0);figure.close();
  });

  it('preserves synchronous compatibility payloads except their capture timestamp',async()=>{
    const figure=new Figure({title:'Ω </script>'});figure.scatter([1,2],[3,4]);
    const sync=payload(toHTML(figure,{observation:true})),async=payload(await toHTMLAsync(figure,{observation:true}));
    sync.capture.capturedAt=async.capture.capturedAt;
    sync.snapshot.figure.observation.capturedAt=async.snapshot.figure.observation.capturedAt;
    expect(async).toEqual(sync);figure.close();
  });

  it('releases captures when lazy template loading or serialization fails',async()=>{
    const figure=new Figure();figure.plot([1],[2]);
    vi.unstubAllGlobals();
    await expect(toHTMLAsync(figure)).rejects.toThrow(/not bundled/);
    expect(figure.diagnostics().snapshotBytes).toBe(0);
    vi.stubGlobal('__VESORA_HTML_TEMPLATE__','invalid');
    await expect(toHTMLAsync(figure)).rejects.toThrow(/placeholder/);
    expect(figure.diagnostics().snapshotBytes).toBe(0);
    await expect(toHTMLAsync(figure,{observation:'yes' as any})).rejects.toThrow(/boolean/);
    expect(figure.diagnostics().snapshotBytes).toBe(0);figure.close();
  });
});
