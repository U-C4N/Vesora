import {describe,expect,it} from 'vitest';
import {selectBufferUpload} from '../../packages/core/src/renderer';

describe('known dirty-span uploads',()=>{
  const previous=Float32Array.from({length:10},(_,i)=>i),data=previous.slice();
  it('uploads a narrow known span without scanning',()=>{
    data[7]=99;
    expect(selectBufferUpload(data,previous,{start:7,end:8})).toEqual({kind:'partial',start:7,end:8});
  });
  it('keeps a full allocation when the known span is at least three quarters of the buffer',()=>{
    expect(selectBufferUpload(data,previous,{start:2,end:10})).toEqual({kind:'full'});
    expect(selectBufferUpload(data,previous,{start:3,end:10})).toEqual({kind:'partial',start:3,end:10});
  });
  it('replaces the buffer when the length or constructor changes',()=>{
    expect(selectBufferUpload(new Float32Array(11),previous,{start:10,end:11})).toEqual({kind:'full'});
    expect(selectBufferUpload(new Uint32Array(previous),new Float32Array(previous),{start:0,end:1})).toEqual({kind:'full'});
  });
  it('skips an empty dirty span and identical buffers',()=>{
    expect(selectBufferUpload(data,previous,{start:4,end:4})).toEqual({kind:'skip'});
    expect(selectBufferUpload(previous.slice(),previous)).toEqual({kind:'skip'});
  });
  it('falls back to the endpoint scan when the dirty span is not usable',()=>{
    const edited=previous.slice();edited[2]=50;edited[3]=51;
    expect(selectBufferUpload(edited,previous,{start:-1,end:2})).toEqual({kind:'partial',start:2,end:4});
    expect(selectBufferUpload(edited,previous)).toEqual({kind:'partial',start:2,end:4});
  });
});
