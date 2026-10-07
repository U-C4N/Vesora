import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Figure} from '../../packages/core/src/figure';
import {toHTML} from '../../packages/core/src/html-export';

const template='<!doctype html><script id="vesora-payload" type="application/json">__VESORA_PAYLOAD_JSON__</script>';
beforeEach(()=>vi.stubGlobal('__VESORA_HTML_TEMPLATE__',template));
afterEach(()=>vi.unstubAllGlobals());
function payload(html:string):any{return JSON.parse(html.match(/application\/json">([\s\S]*)<\/script>/)![1]);}
function bytes(encoded:string):Uint8Array{return Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));}

describe('standalone HTML serialization',()=>{
  it('exports an unmounted figure with exact typed-array slices and IEEE values',()=>{
    const figure=new Figure();
    const backing=new Float64Array([99,1e12,1e12+.01,NaN,Infinity,-Infinity,88]);
    const values=backing.subarray(1,6);
    const layer=figure.scatter(values,new Float32Array([1,2,3,4,5]));
    figure.bookmark('Overview',{note:'Preserve precision'});
    const exported=payload(toHTML(figure));
    expect(exported.formatVersion).toBe(1);expect(exported.snapshot).toEqual(figure.snapshot());
    const buffer=exported.buffers.find((item:any)=>item.id===layer.spec.data.x);
    const decoded=new DataView(bytes(buffer.base64).buffer);
    expect(decoded.byteLength).toBe(values.byteLength);
    for(let i=0;i<values.length;i++)expect(decoded.getFloat64(i*8,true)).toBe(values[i]);
    expect([...backing]).toEqual([99,1e12,1e12+.01,NaN,Infinity,-Infinity,88]);
  });
  it('encodes large buffers across chunk boundaries without padding corruption',()=>{
    const figure=new Figure(),x=Uint8Array.from({length:100003},(_,i)=>i%251);
    const layer=figure.scatter(x,new Uint8Array(x.length));const exported=payload(toHTML(figure));
    const buffer=exported.buffers.find((item:any)=>item.id===layer.spec.data.x);
    expect(bytes(buffer.base64)).toEqual(x);
  });
  it('escapes script text while preserving Unicode and literal replacement tokens',()=>{
    const title='Ölçüm </script><script>alert("x")</script> & $& $` $\' \u2028\u2029';
    const figure=new Figure({title});figure.bookmark('日本語',{note:title});
    const html=toHTML(figure);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('\u2028');expect(html).not.toContain('\u2029');
    expect(payload(html).snapshot.figure.title).toBe(title);
    expect(payload(html).snapshot.figure.bookmarks[0].note).toBe(title);
  });
  it('supports empty arrays and reports unusable templates or closed figures',()=>{
    const figure=new Figure();figure.scatter([],[]);
    expect(payload(toHTML(figure)).buffers.map((item:any)=>item.base64)).toEqual(['','']);
    figure.close();expect(()=>toHTML(figure)).toThrow(/closed/);
    vi.stubGlobal('__VESORA_HTML_TEMPLATE__','no marker');expect(()=>toHTML(new Figure())).toThrow(/placeholder/);
  });
});
