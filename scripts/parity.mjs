import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {figure, subplots, PROTOCOL_VERSION} from '../packages/core/dist/index.js';

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
  return {...scene,...(scene.annotations?{annotations:scene.annotations.map(({id,...annotation})=>annotation)}:{}),layers:scene.layers.map(({id,data,...layer})=>({...layer,data:Object.fromEntries(Object.entries(data).map(([key,source])=>{const entry=f.registry.get(source);return [key,{dtype:entry.descriptor.dtype,shape:entry.descriptor.shape,values:Array.from(entry.values)}];}))}))};
}
assert.deepEqual(normalize(py),normalize(js));assert.equal(result.snapshot.figure.protocolVersion,PROTOCOL_VERSION);
const packageVersion=JSON.parse(execFileSync(process.execPath,['-p',"JSON.stringify(require('./packages/core/package.json'))"],{encoding:'utf8'})).version;
assert.equal(result.version,packageVersion);
js.close();py.close();
const gridCode=`import json,base64
import vesora as vs
fig=vs.subplots(2,2,sharex=True,sharey=True,title='Compare',width=900,height=700)
for row in range(2):
    for col in range(2):
        p=fig.panel(row,col)
        p.set_title('Panel '+str(row*2+col))
        p.plot([1.,2.,3.],[2.,3.,1.],label='Signal')
        p.set_axes(xlabel='Time',ylabel='Value')
        p.text(1.,2.,'Peak Ω',font_size=12,color='#3366ff')
        p.axhline(0.,color='#64748b',width=2)
fig.bookmark('Overview')
fig.panel(1,1).set_axes(xlim=(1,2),ylim=(1,3))
fig.bookmark('Detail',note='All panels')
fig.restore_bookmark('Overview')
s=fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']}}))
fig.close()
`;
const gridResult=JSON.parse(execFileSync(python,['-X','utf8','-c',gridCode],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const grid=subplots({rows:2,cols:2,shareX:true,shareY:true,title:'Compare',width:900,height:700});
for(let row=0;row<2;row++)for(let col=0;col<2;col++){
  const p=grid.panel(row,col);p.setTitle('Panel '+(row*2+col));
  p.plot([1,2,3],[2,3,1],{label:'Signal'});p.setView({xLabel:'Time',yLabel:'Value'});
  p.text(1,2,'Peak Ω',{fontSize:12,color:'#3366ff'});p.axhline(0,{color:'#64748b',width:2});
}
grid.bookmark('Overview');grid.panel(1,1).setView({xDomain:[1,2],yDomain:[1,3]});
grid.bookmark('Detail',{note:'All panels'});grid.restoreBookmark('Overview');
const imported=figure();imported.applySnapshot(gridResult.snapshot,new Map(Object.entries(gridResult.buffers).map(([id,value])=>{const b=Buffer.from(value,'base64');return [id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)];})));
assert.equal(gridResult.snapshot.figure.protocolVersion,2);
assert.deepEqual(normalize(imported),normalize(grid),'Python and JavaScript grid scenes must agree');
grid.close();imported.close();
const statisticsCode=`import json,base64
from array import array
import vesora as vs
fig=vs.subplots(2,3,title='Statistics parity',width=1200,height=800)
hist=fig.hist(array('f',[3,1,float('nan'),2,3]),bins=[0,2,4],density=True,cumulative=True,label='Distribution')
hist.set_data(samples=array('f',[3,1,float('nan'),2,4]))
bars=fig.panel(0,1)
bars.set_categories('x',['B','A'])
first=bars.bar(['B','A'],array('h',[2,-1]),label='First')
bars.bar(['A','C'],[3,4],label='Second')
first.set_data(y=[4,-2])
stack=fig.panel(0,2).set_bar_mode('stack')
stack.bar(['A','B'],[2,-3],label='One')
stack.bar(['B','A'],[-4,1],label='Two')
box=fig.panel(1,0).boxplot([array('f',[3,1,float('nan')]),array('h',[4,1])],labels=['G2','G1'])
box.set_data(groups=[array('f',[9,1,float('nan')]),array('h',[5,2,8])])
box.set_data(labels=['G1','G3'])
box.set_options(whis=2,showfliers=False,box_width=.5)
line=fig.panel(1,1).plot(['Low','High'],[1,2],label='Categorical signal')
line.set_data(y=[7,8])
before=fig.snapshot()
try:
    line.set_data(x=['Must not append'])
    raise AssertionError('Invalid update unexpectedly succeeded')
except ValueError:
    pass
assert fig.snapshot()==before
fig.panel(1,2).barh(['A','B'],[1,-2],left=[0,1],bar_width=.6)
fig.text(1,1,'v3 annotation Ω')
assert fig.snapshot()['figure']['protocolVersion']==3
fig.bookmark('Overview')
fig.set_axes(xlim=(1,3))
fig.bookmark('Detail',note='Statistical views retain their source data')
fig.restore_bookmark('Overview')
s=fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']}}))
fig.close()
`;
const statisticsResult=JSON.parse(execFileSync(python,['-X','utf8','-c',statisticsCode],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const statistics=subplots({rows:2,cols:3,title:'Statistics parity',width:1200,height:800});
const histogram=statistics.hist(new Float32Array([3,1,NaN,2,3]),{bins:[0,2,4],density:true,cumulative:true,label:'Distribution'});
histogram.setData({samples:new Float32Array([3,1,NaN,2,4])});
const bars=statistics.panel(0,1);bars.setCategories('x',['B','A']);
const first=bars.bar(['B','A'],new Int16Array([2,-1]),{label:'First'});
bars.bar(['A','C'],[3,4],{label:'Second'});first.setData({y:[4,-2]});
const stack=statistics.panel(0,2).setBarMode('stack');
stack.bar(['A','B'],[2,-3],{label:'One'});stack.bar(['B','A'],[-4,1],{label:'Two'});
const box=statistics.panel(1,0).boxplot([new Float32Array([3,1,NaN]),new Int16Array([4,1])],{labels:['G2','G1']});
box.setData({groups:[new Float32Array([9,1,NaN]),new Int16Array([5,2,8])]});box.setData({labels:['G1','G3']});
box.setOptions({whis:2,showfliers:false,boxWidth:.5});
const line=statistics.panel(1,1).plot(['Low','High'],[1,2],{label:'Categorical signal'});line.setData({y:[7,8]});
const before=statistics.snapshot();assert.throws(()=>line.setData({x:['Must not append']}));assert.deepEqual(statistics.snapshot(),before);
statistics.panel(1,2).barh(['A','B'],[1,-2],{left:[0,1],barWidth:.6});
statistics.text(1,1,'v3 annotation Ω');assert.equal(statistics.snapshot().figure.protocolVersion,3);
statistics.bookmark('Overview');statistics.setView({xDomain:[1,3]});statistics.bookmark('Detail',{note:'Statistical views retain their source data'});statistics.restoreBookmark('Overview');
const importedStatistics=figure();
importedStatistics.applySnapshot(statisticsResult.snapshot,new Map(Object.entries(statisticsResult.buffers).map(([id,value])=>{const b=Buffer.from(value,'base64');return [id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)];})));
assert.equal(statisticsResult.snapshot.figure.protocolVersion,3);
assert.deepEqual(normalize(importedStatistics),normalize(statistics),'Python and JavaScript statistical scenes must agree');
statistics.close();importedStatistics.close();
console.log('Python and JavaScript produce equivalent v1/v2/v3 scenes, categorical/statistical defaults, dtypes, raw buffers, updates and package versions.');
