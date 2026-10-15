import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {figure, subplots, PROTOCOL_VERSION} from '../packages/core/dist/index.js';
import {releaseIdentity} from './release-identity.mjs';

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
assert.equal(result.version,releaseIdentity(packageVersion).python);
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
const linkedCode=`import json,base64
import vesora as vs
fig=vs.subplots(1,3,title='Linked parity',width=1200,height=520)
a=fig.panel(0,0).scatter([0.,1.,2.,3.],[.1,.2,3.,.1])
b=fig.panel(0,1).scatter([.1,.2,.9,.3],[.1,.2,3.,.1])
h=fig.panel(0,2).hist([.1,.2,3.,.1],bins=[0.,1.,2.,4.])
link=fig.link_selection(scatter=[a,b],histogram=h)
s=fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']}}))
fig.close()
`;
const linkedResult=JSON.parse(execFileSync(python,['-X','utf8','-c',linkedCode],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const linked=subplots({rows:1,cols:3,title:'Linked parity',width:1200,height:520});
const la=linked.panel(0,0).scatter([0,1,2,3],[.1,.2,3,.1]);
const lb=linked.panel(0,1).scatter([.1,.2,.9,.3],[.1,.2,3,.1]);
const lh=linked.panel(0,2).hist([.1,.2,3,.1],{bins:[0,1,2,4]});
linked.linkSelection({scatter:[la,lb],histogram:lh});
const importedLinked=figure();
importedLinked.applySnapshot(linkedResult.snapshot,new Map(Object.entries(linkedResult.buffers).map(([id,value])=>{const b=Buffer.from(value,'base64');return [id,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)];})));
function normalizeLinked(fig){
  const scene=normalize(fig),ids=fig.spec.layers.map(layer=>layer.id),{id,...link}=scene.selectionLink;
  scene.selectionLink={...link,scatter:link.scatter.map(id=>ids.indexOf(id)),histogram:ids.indexOf(link.histogram)};
  return scene;
}
assert.equal(linkedResult.snapshot.figure.protocolVersion,4);
assert.deepEqual(normalizeLinked(importedLinked),normalizeLinked(linked),'Python and JavaScript linked scenes must agree');
linked.close();importedLinked.close();
const presentationCode=`import json,base64
import vesora as vs
fig=vs.subplots(1,2,sharex=True,theme='dark',title='Presentation parity',width=900,height=420)
for column in range(2):
    fig.panel(0,column).plot([0.,86400000.],[1.,2.],label='Revenue')
right=fig.panel(0,1)
right.set_axes(xscale='time')
right.set_axis_format('x',{'kind':'date','locale':'en-US','timeZone':'UTC','options':{'month':'short','day':'numeric'}})
fig.set_axis_format('y',{'kind':'currency','currency':'usd','locale':'en-US','options':{'maximumFractionDigits':2}})
fig.bookmark('Overview')
right.set_axes(xlim=(0.,43200000.))
fig.bookmark('Detail')
fig.restore_bookmark('Overview')
s=fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']}}))
fig.close()
`;
const presentationResult=JSON.parse(execFileSync(python,['-X','utf8','-c',presentationCode],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const presentation=subplots({rows:1,cols:2,shareX:true,theme:'dark',title:'Presentation parity',width:900,height:420});
for(let col=0;col<2;col++)presentation.panel(0,col).plot([0,86400000],[1,2],{label:'Revenue'});
const right=presentation.panel(0,1);right.setView({xScale:'time'});
right.setAxisFormat('x',{kind:'date',locale:'en-US',timeZone:'UTC',options:{month:'short',day:'numeric'}});
presentation.setAxisFormat('y',{kind:'currency',currency:'usd',locale:'en-US',options:{maximumFractionDigits:2}});
presentation.bookmark('Overview');right.setView({xDomain:[0,43200000]});presentation.bookmark('Detail');presentation.restoreBookmark('Overview');
const importedPresentation=figure();
importedPresentation.applySnapshot(presentationResult.snapshot,new Map(Object.entries(presentationResult.buffers).map(([id,value])=>{const bytes=Buffer.from(value,'base64');return [id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)];})));
assert.equal(presentationResult.snapshot.figure.protocolVersion,5);
assert.deepEqual(normalize(importedPresentation),normalize(presentation),'Python and JavaScript presentation scenes must agree');
presentation.close();importedPresentation.close();
const qualityCode=`import json,base64
from array import array
import vesora as vs
fig=vs.subplots(1,2,title='Quality parity',width=1000,height=480,theme={'titleFontSize':24,'labelFontSize':14,'tickFontSize':11,'legendFontSize':12})
left=fig.panel(0,0)
band=left.fill_between(array('d',[0.,86400000.,172800000.,259200000.]),array('f',[1.,2.,float('nan'),3.]),array('f',[3.,4.,float('nan'),6.]),color='#3569c8',label='Observed interval')
line=left.plot(array('d',[0.,86400000.,172800000.,259200000.]),array('f',[2.,3.,float('nan'),4.]),color='#3569c8',label='Mean')
band.set_data(lower=array('f',[.5,1.5,float('nan'),2.5]))
line.set_data(y=array('f',[2.25,3.25,float('nan'),4.25]))
left.set_axes(xscale='time',yscale='log',ylabel='Response')
left.set_axis_format('x',{'kind':'date','locale':'en-US','timeZone':'UTC','options':{'month':'short','day':'numeric'}})
right=fig.panel(0,1)
grid=right.heatmap([0.,1.],[0.,1.],[[1.,2.],[3.,4.]],colorbarLabel='Temperature / °C')
grid.set_style(colorbarLabel='Temperature / K')
fig.set_hover_mode('x')
before=fig.snapshot()
try:
    band.set_data(lower=[4.,1.5,float('nan'),2.5])
    raise AssertionError('Invalid band update unexpectedly succeeded')
except ValueError:
    pass
assert fig.snapshot()==before
try:
    line.set_data(x=[0.,0.,172800000.,259200000.])
    raise AssertionError('Invalid inspection update unexpectedly succeeded')
except ValueError:
    pass
assert fig.snapshot()==before
fig.bookmark('Overview')
left.set_axes(xlim=(0.,86400000.))
fig.bookmark('Detail')
fig.restore_bookmark('Overview')
fig.text(0.,2.,'Interval',font_size=12)
s=fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']}}))
fig.close()
`;
const qualityResult=JSON.parse(execFileSync(python,['-X','utf8','-c',qualityCode],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const quality=subplots({rows:1,cols:2,title:'Quality parity',width:1000,height:480,theme:{titleFontSize:24,labelFontSize:14,tickFontSize:11,legendFontSize:12}});
const qualityLeft=quality.panel(0,0);
const qualityBand=qualityLeft.fillBetween(new Float64Array([0,86400000,172800000,259200000]),new Float32Array([1,2,NaN,3]),new Float32Array([3,4,NaN,6]),{color:'#3569c8',label:'Observed interval'});
const qualityLine=qualityLeft.plot(new Float64Array([0,86400000,172800000,259200000]),new Float32Array([2,3,NaN,4]),{color:'#3569c8',label:'Mean'});
qualityBand.setData({lower:new Float32Array([.5,1.5,NaN,2.5])});qualityLine.setData({y:new Float32Array([2.25,3.25,NaN,4.25])});
qualityLeft.setView({xScale:'time',yScale:'log',yLabel:'Response'});
qualityLeft.setAxisFormat('x',{kind:'date',locale:'en-US',timeZone:'UTC',options:{month:'short',day:'numeric'}});
const qualityGrid=quality.panel(0,1).heatmap([0,1],[0,1],[[1,2],[3,4]],{colorbarLabel:'Temperature / °C'});
qualityGrid.setStyle({colorbarLabel:'Temperature / K'});quality.setHoverMode('x');
const beforeQuality=quality.snapshot();
assert.throws(()=>qualityBand.setData({lower:[4,1.5,NaN,2.5]}));assert.deepEqual(quality.snapshot(),beforeQuality);
assert.throws(()=>qualityLine.setData({x:[0,0,172800000,259200000]}));assert.deepEqual(quality.snapshot(),beforeQuality);
quality.bookmark('Overview');qualityLeft.setView({xDomain:[0,86400000]});quality.bookmark('Detail');quality.restoreBookmark('Overview');quality.text(0,2,'Interval',{fontSize:12});
const importedQuality=figure();
const qualityBuffers=new Map(Object.entries(qualityResult.buffers).map(([id,value])=>{const bytes=Buffer.from(value,'base64');return [id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)];}));
importedQuality.applySnapshot(qualityResult.snapshot,qualityBuffers);
assert.equal(qualityResult.snapshot.figure.protocolVersion,6);
assert.deepEqual(normalize(importedQuality),normalize(quality),'Python and JavaScript bands, inspection and presentation must agree');
const downgradedQuality=structuredClone(qualityResult.snapshot);downgradedQuality.figure.protocolVersion=5;
assert.throws(()=>importedQuality.applySnapshot(downgradedQuality,qualityBuffers),/version 6/);
assert.deepEqual(normalize(importedQuality),normalize(quality),'Rejected imports must leave protocol 6 scenes intact');
quality.close();importedQuality.close();
const streamingCode=`import json,base64
from array import array
import vesora as vs
fig=vs.figure(title='Streaming parity',width=800,height=500)
layers=[fig.plot(array('d',range(16)),array('f',(n*(series+1) for n in range(16))),label='Curve '+str(series)).enable_streaming(max_points=32) for series in range(3)]
for batch in range(6):
    points=range(16+batch*10,26+batch*10)
    for series,layer in enumerate(layers):
        layer.append_data(x=array('d',points),y=array('f',(n*(series+1) for n in points)))
s=fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']},'states':[{k:v for k,v in fig._streams[layer.id].items() if k!='streamId'} for layer in layers]}))
fig.close()
`;
const streamingResult=JSON.parse(execFileSync(python,['-X','utf8','-c',streamingCode],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const streaming=figure({title:'Streaming parity',width:800,height:500});
const streamLayers=Array.from({length:3},(_,series)=>streaming.plot(Float64Array.from({length:16},(_,n)=>n),Float32Array.from({length:16},(_,n)=>n*(series+1)),{label:`Curve ${series}`}).enableStreaming({maxPoints:32}));
for(let batch=0;batch<6;batch++)await Promise.all(streamLayers.map((layer,series)=>layer.appendData({x:Float64Array.from({length:10},(_,n)=>16+batch*10+n),y:Float32Array.from({length:10},(_,n)=>(16+batch*10+n)*(series+1))})));
const importedStream=figure();
importedStream.applySnapshot(streamingResult.snapshot,new Map(Object.entries(streamingResult.buffers).map(([id,value])=>{const bytes=Buffer.from(value,'base64');return [id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)];})));
assert.deepEqual(normalize(importedStream),normalize(streaming),'Retained streaming scenes must agree');
assert.deepEqual(streamLayers.map(layer=>{const {streamId,...state}=streaming.getStreamingState(layer.id);return state;}),streamingResult.states,'Stream state must agree across languages, excluding generated epoch IDs');
for(let i=0;i<streamLayers.length;i++)for(const channel of ['x','y']){
  const pythonSource=streamingResult.snapshot.figure.layers[i].data[channel],entry=streaming.registry.get(streamLayers[i].spec.data[channel]);
  assert.equal(Buffer.from(entry.values.buffer,entry.values.byteOffset,entry.values.byteLength).toString('base64'),streamingResult.buffers[pythonSource],`Retained ${channel} bytes differ for curve ${i}`);
}
streaming.close();importedStream.close();
const scienceCode=`import json,base64
import vesora as vs
fig=vs.subplots(2,2,kinds=[['3d','2d'],['2d','2d']],title='PRISM parity',width=1000,height=700)
left=fig.panel(0,0)
surface=left.surface([10.,20.,30.,40.],[-1.,0.,1.],[[0.,1.,2.,3.],[4.,float('nan'),6.,7.],[8.,9.,10.,11.]],values=[[12.,13.,14.,15.],[16.,17.,18.,19.],[20.,21.,22.,23.]],shading='smooth',wireframe=True,colorbarLabel='Temperature / K')
left.plot3d([10.,20.,float('nan'),40.],[-1.,0.,1.,1.],[0.,6.,8.,11.],values=[1.,2.,3.,4.],width=4,label='Path')
left.set_equal_aspect().fit_to_data()
column=fig.panel(0,1).slice(surface,axis='x',index=1,label='Column')
row=fig.panel(1,0).slice(surface,axis='y',index=1,label='Row')
surface.set_data(values=[[23.,22.,21.,20.],[19.,18.,17.,16.],[15.,14.,13.,12.]])
column.set_index(3)
row.set_index(2)
curves=[fig.panel(1,1).plot([0.,1.],[float(j),float(j+1)],label='Channel '+str(j)).enable_streaming(max_points=4) for j in range(3)]
fig.append_data_batch([(layer,{'x':[2.,3.,4.],'y':[float(j+2),float(j+3),float(j+4)]}) for j,layer in enumerate(curves)])
before=fig._frozen_transfer()
try:
    fig.append_data_batch([(curves[0],{'x':[5.],'y':[5.]}),(curves[2],{'x':[5.],'y':[9.,10.]})])
    raise AssertionError('Invalid final channel committed')
except ValueError:
    pass
assert fig._frozen_transfer()==before
fig.bookmark('Scientific view')
s=fig.snapshot()
print(json.dumps({'snapshot':s,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in s['sources']},'states':[{k:v for k,v in fig._streams[layer.id].items() if k!='streamId'} for layer in curves]}))
fig.close()
`;
const scienceResult=JSON.parse(execFileSync(python,['-X','utf8','-c',scienceCode],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8'}));
const science=subplots({rows:2,cols:2,kinds:[['3d','2d'],['2d','2d']],title:'PRISM parity',width:1000,height:700});
const scienceLeft=science.panel(0,0);
const surface=scienceLeft.surface([10,20,30,40],[-1,0,1],[[0,1,2,3],[4,NaN,6,7],[8,9,10,11]],{values:[[12,13,14,15],[16,17,18,19],[20,21,22,23]],shading:'smooth',wireframe:true,colorbarLabel:'Temperature / K'});
scienceLeft.plot3d([10,20,NaN,40],[-1,0,1,1],[0,6,8,11],{values:[1,2,3,4],width:4,label:'Path'});
scienceLeft.setEqualAspect().fitToData();
const column=science.panel(0,1).slice(surface,{axis:'x',index:1,label:'Column'}),row=science.panel(1,0).slice(surface,{axis:'y',index:1,label:'Row'});
surface.setData({color:[[23,22,21,20],[19,18,17,16],[15,14,13,12]]});column.setIndex(3);row.setIndex(2);
const curves=Array.from({length:3},(_,j)=>science.panel(1,1).plot([0,1],[j,j+1],{label:`Channel ${j}`}).enableStreaming({maxPoints:4}));
await science.appendDataBatch(curves.map((layer,j)=>({layer,data:{x:[2,3,4],y:[j+2,j+3,j+4]}})),{waitFor:'accepted'});
const beforeScience=science.snapshot();
await assert.rejects(science.appendDataBatch([{layer:curves[0],data:{x:[5],y:[5]}},{layer:curves[2],data:{x:[5],y:[9,10]}}],{waitFor:'accepted'}));
assert.deepEqual(science.snapshot(),beforeScience);
science.bookmark('Scientific view');
const importedScience=figure();
importedScience.applySnapshot(scienceResult.snapshot,new Map(Object.entries(scienceResult.buffers).map(([id,value])=>{const bytes=Buffer.from(value,'base64');return [id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)];})));
function normalizeScience(fig){const scene=normalize(fig),ids=fig.spec.layers.map(layer=>layer.id);scene.slices=scene.slices.map(relation=>({...relation,sourceLayerId:ids.indexOf(relation.sourceLayerId),targetLayerId:ids.indexOf(relation.targetLayerId)}));return scene;}
assert.equal(scienceResult.snapshot.figure.protocolVersion,7);
assert.deepEqual(normalizeScience(importedScience),normalizeScience(science),'Protocol 7 mixed scenes, scalar data, exact slices and NaN gaps must agree');
assert.deepEqual(curves.map(layer=>{const {streamId,...state}=science.getStreamingState(layer.id);return state;}),scienceResult.states,'Atomic retained sequence identity must agree across Python and JavaScript');
for(let index=0;index<science.spec.layers.length;index++)for(const channel of Object.keys(science.spec.layers[index].data)){
  const entry=science.registry.get(science.spec.layers[index].data[channel]),id=scienceResult.snapshot.figure.layers[index].data[channel];
  assert.equal(Buffer.from(entry.values.buffer,entry.values.byteOffset,entry.values.byteLength).toString('base64'),scienceResult.buffers[id],`Protocol 7 source bytes differ at layer ${index}, channel ${channel}`);
}
science.close();importedScience.close();
console.log('Python and JavaScript produce equivalent v1–v7 scenes, exact scientific source bytes, slices, scalar fields, atomic retained streams, statistical defaults and canonical release versions.');
