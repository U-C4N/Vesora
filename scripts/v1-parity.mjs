import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {Figure,Layer,createRunComparison,linkObservations} from '../packages/core/dist/runtime.js';
import * as core from '../packages/core/dist/runtime.js';
import {makeFigure} from '../skills/vesora/scripts/gallery.mjs';

const python=process.env.VESORA_PYTHON??(existsSync('.venv/Scripts/python.exe')?resolve('.venv/Scripts/python.exe'):existsSync('.venv/bin/python')?resolve('.venv/bin/python'):'python');
// One interpreter covers the real skill gallery, bounded streams, comparison and full pages.
const code=String.raw`
import base64,json,runpy
import vesora as vs
from vesora.observation import make_accepted_observation
def capture(fig):
    snapshot=fig.snapshot()
    return {'snapshot':snapshot,'buffers':{d['id']:base64.b64encode(fig._data_bytes(d['id'],d['version'])).decode() for d in snapshot['sources']}}
fig=runpy.run_path('skills/vesora/scripts/example_python.py')['make_figure']()
vs.Layer(fig,fig.snapshot()['figure']['layers'][0]['id']).set_semantics({'samples':{'unit':'ms','origin':{'datasetId':'synthetic-parity','field':'latency'}}})
fig.panel(0,0).ecdf([float('nan'),-0.0,0.0,2.0],label='Owned raw edge cases')
gallery=capture(fig)
stream=vs.Figure(title='Bounded spectral parity')
layer=stream.spectrogram([0,1,2],[10,20],[[0,1],[2,3],[4,5]],max_rows=2,value_scale='db')
layer.append_rows([3],[[float('nan'),-0.0]])
layer.set_semantics({'x':{'unit':'Hz'},'y':{'unit':'s'},'z':{'quantity':'power','transforms':[{'execution':'external','name':'stft','parameters':{'window':128,'hop':64}}]}})
stream_capture=capture(stream)
stream_capture['observation']=make_accepted_observation(stream_capture['snapshot']['figure'],stream_capture['snapshot']['sources'],stream._streams,'2026-11-05T00:00:00.000Z')
runs=[{'id':'a','x':[10,11,12,13],'y':[1,2,3,4],'eventOffset':10,'unit':'K'}, {'id':'b','x':[20,22,23],'y':[2,6,float('nan')],'eventOffset':20,'unit':'K'}]
comparisons=[]
for alignment,options in [('exact',{}),('nearest',{'tolerance':1}),('linear',{'max_gap':2})]:
    result=vs.create_run_comparison(runs,alignment=alignment,**options)
    comparisons.append({'rows':result['rows'],'lineage':result['lineage']})
ratio_zero=vs.create_run_comparison([{'id':'reference','x':[0,1,2,3,4],'y':[0,2,float('nan'),1e-308,-2]}, {'id':'candidate','x':[0,1,2,3,4],'y':[1,6,3,1e308,4]}])['rows']
query_samples=[3,1,2,2,float('nan'),float('inf'),-float('inf')]
ecdf_queries=[vs.query_ecdf(query_samples,**options) for options in ({},{'probability':0},{'probability':.5},{'probability':1},{'threshold':2},{'probability':.5,'threshold':1})]
ecdf_queries.append(vs.query_ecdf([],probability=.5,threshold=2))
ecdf_queries.append(vs.query_ecdf([float('nan'),float('inf')],threshold=2))
ecdf_queries.append(vs.query_ecdf([2]*12005,probability=.5))
linked=vs.Figure();count=12005
points=linked.scatter(range(count),range(count))
controller=linked.link_observations(dataset_id='synthetic-parity',row_ids=[f'r{i}' for i in range(count)],members=[points])
controller.set_predicate({'layerId':points.id,'ranges':{'x':[0,count],'y':[0,count]}})
first=controller.query(limit=10000);second=controller.query(offset=10000,limit=10000,revision=first['revision'])
pages=[{key:value for key,value in page.items() if key!='revision'} for page in (first,second)]
controller.dispose();linked.close();fig.close();stream.close()
print(json.dumps({'gallery':gallery,'stream':stream_capture,'comparisons':comparisons,'ratioZero':ratio_zero,'ecdfQueries':ecdf_queries,'pages':pages},allow_nan=False,separators=(',',':')))
`;
const result=JSON.parse(execFileSync(python,['-X','utf8','-c',code],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true}));
function importFigure(capture){
  const fig=new Figure();fig.applySnapshot(capture.snapshot,new Map(Object.entries(capture.buffers).map(([id,value])=>{const bytes=Buffer.from(value,'base64');return [id,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)];})));return fig;
}
function normalized(fig){
  const {id,semantics,observation,...scene}=fig.snapshot().figure;
  return {...scene,layers:scene.layers.map(({id,data,...layer})=>({...layer,data:Object.fromEntries(Object.entries(data).map(([channel,source])=>{
    const entry=fig.registry.get(source),bytes=Buffer.from(entry.values.buffer,entry.values.byteOffset,entry.values.byteLength);
    return [channel,{dtype:entry.descriptor.dtype,shape:entry.descriptor.shape,bytes:bytes.toString('base64'),...(semantics?.sources[source]?{semantics:semantics.sources[source]}:{})}];
  }))}))};
}
const js=makeFigure(core);new Layer(js,js.spec.layers[0].id).setSemantics({samples:{unit:'ms',origin:{datasetId:'synthetic-parity',field:'latency'}}});
js.panel(0,0).ecdf([NaN,-0,0,2],{label:'Owned raw edge cases'});
const imported=importFigure(result.gallery);assert.equal(imported.spec.protocolVersion,9);assert.deepEqual(normalized(imported),normalized(js),'All ten skill-gallery families must preserve matching raw source bytes, options, units and projections');
const stream=new Figure({title:'Bounded spectral parity'}),spectral=stream.spectrogram([0,1,2],[10,20],[[0,1],[2,3],[4,5]],{maxRows:2,valueScale:'db'});
await spectral.appendRows([3],[[NaN,-0]]);
spectral.setSemantics({x:{unit:'Hz'},y:{unit:'s'},z:{quantity:'power',transforms:[{execution:'external',name:'stft',parameters:{window:128,hop:64}}]}});
const importedStream=importFigure(result.stream);assert.deepEqual(normalized(importedStream),normalized(stream),'Spectrogram appends must retain matching logical rows and raw missing/signed-zero values');
const observation=result.stream.observation;assert.equal(observation.schemaVersion,2);assert.deepEqual(observation.streams[0].shape,[2,2]);assert.equal(observation.streams[0].kind,'spectrogram');assert.equal(observation.streams[0].sequenceStart,2);assert.equal(observation.streams[0].sequenceEndExclusive,4);
for(const {id,version} of observation.sourceVersions)assert.equal(version,result.stream.snapshot.sources.find(source=>source.id===id).version);
const captured=stream.captureExport('accepted');try{assert.equal(captured.observation.schemaVersion,2);const {streamId,...actual}=captured.observation.streams[0],{streamId:pyStream,layerId:pyLayer,...expected}=observation.streams[0];delete actual.layerId;assert.deepEqual(actual,expected);}finally{captured.release();}
const runs=[{id:'a',x:[10,11,12,13],y:[1,2,3,4],eventOffset:10,unit:'K'},{id:'b',x:[20,22,23],y:[2,6,NaN],eventOffset:20,unit:'K'}];
for(const [index,options] of [{alignment:'exact'},{alignment:'nearest',tolerance:1},{alignment:'linear',maxGap:2}].entries()){
  const {rows,lineage}=createRunComparison(runs,options);assert.deepEqual({rows,lineage},result.comparisons[index],`Run comparison ${options.alignment} must have matching alignment, missing values and source lineage`);
}
const ratioZero=createRunComparison([{id:'reference',x:[0,1,2,3,4],y:[0,2,NaN,1e-308,-2]},{id:'candidate',x:[0,1,2,3,4],y:[1,6,3,1e308,4]}]).rows;
assert.deepEqual(ratioZero,result.ratioZero,'Ratios must agree for zero references, missing values, finite negative values and overflow');
const querySamples=[3,1,2,2,NaN,Infinity,-Infinity],ecdfQueries=[{},{probability:0},{probability:.5},{probability:1},{threshold:2},{probability:.5,threshold:1}].map(options=>core.queryECDF(querySamples,options));
ecdfQueries.push(core.queryECDF([],{probability:.5,threshold:2}),core.queryECDF([NaN,Infinity],{threshold:2}),core.queryECDF(new Array(12005).fill(2),{probability:.5}));
assert.deepEqual(ecdfQueries,result.ecdfQueries,'Nearest-rank quantiles, strict exceedance, missing samples and bounded full-count tie previews must agree');
const linked=new Figure(),count=12005,values=Array.from({length:count},(_,i)=>i),points=linked.scatter(values,values),controller=linkObservations(linked,{datasetId:'synthetic-parity',rowIds:values.map(i=>`r${i}`),members:[{layer:points}]});
controller.selectBounds(points.id,{x:[0,count],y:[0,count]});const first=controller.query({limit:10000}),second=controller.query({offset:10000,limit:10000,revision:first.revision});
const pages=[first,second].map(({revision,...page})=>page);assert.deepEqual(pages,result.pages,'Full ID query pages must agree beyond the 10,000-row preview cap');controller.dispose();
for(const figure of [js,imported,stream,importedStream,linked])figure.close();
console.log(JSON.stringify({status:'passed',families:10,sourceByteParity:true,observationSchema:2,comparisonAlignments:3,ratioBoundaryParity:true,ecdfQueries:ecdfQueries.length,queriedIds:count,pythonProcesses:1}));
