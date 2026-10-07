import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {figure, PROTOCOL_VERSION} from '../packages/core/dist/index.js';

const python=process.env.VESORA_PYTHON??(existsSync('.venv/Scripts/python.exe')?resolve('.venv/Scripts/python.exe'):existsSync('.venv/bin/python')?resolve('.venv/bin/python'):'python');
const code=`import json, base64
from array import array
import vesora as vs
fig = vs.figure(title='Parity', width=640, height=420)
fig.set_axes(xlabel='Time', ylabel='Value', xlim=(0, 4), ylim=(0, 8))
fig.plot(array('d', [0, 1, 2, 3]), array('f', [1, 4, 2, 6]), color='#3366ff', label='signal')
fig.scatter([1, 2], [2, 4], size=7)
fig.bookmark('Overview', note='Shared view')
fig.set_axes(xlim=(1, 3))
fig.bookmark('Detail')
fig.restore_bookmark('Overview')
s = fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']},'version':vs.__version__}))
fig.close()
`;
const result=JSON.parse(execFileSync(python,['-c',code],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const js=figure({title:'Parity',width:640,height:420});js.setView({xLabel:'Time',yLabel:'Value',xDomain:[0,4],yDomain:[0,8]});
js.plot(new Float64Array([0,1,2,3]),new Float32Array([1,4,2,6]),{color:'#3366ff',label:'signal'});
js.scatter(new Float64Array([1,2]),new Float64Array([2,4]),{size:7});
js.bookmark('Overview',{note:'Shared view'});js.setView({xDomain:[1,3]});js.bookmark('Detail');js.restoreBookmark('Overview');
const py=figure();py.applySnapshot(result.snapshot,new Map(Object.entries(result.buffers).map(([id,base64])=>{const b=Buffer.from(base64,'base64');return [id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)];})));
function normalize(f){
  const {id,...scene}=f.snapshot().figure;
  return {...scene,layers:scene.layers.map(({id,data,...layer})=>({...layer,data:Object.fromEntries(Object.entries(data).map(([key,source])=>{const entry=f.registry.get(source);return [key,{dtype:entry.descriptor.dtype,shape:entry.descriptor.shape,values:Array.from(entry.values)}];}))}))};
}
assert.deepEqual(normalize(py),normalize(js));assert.equal(result.snapshot.figure.protocolVersion,PROTOCOL_VERSION);
const packageVersion=JSON.parse(execFileSync(process.execPath,['-p',"JSON.stringify(require('./packages/core/package.json'))"],{encoding:'utf8'})).version;
assert.equal(result.version,packageVersion);
js.close();py.close();
console.log('Python and JavaScript produce equivalent scenes, dtypes, buffers, defaults and package/protocol versions.');
