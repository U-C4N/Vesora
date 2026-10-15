import assert from 'node:assert/strict';
import {figure,subplots,toHTML} from '../packages/core/dist/index.js';
import {OBSIDIAN_DARK} from '../packages/core/dist/viewer.js';
import {createRollingSurface,createTrajectory} from '../packages/core/dist/labs.js';

export const prismDemoNames=['vesora-prism-surface-demo.html','vesora-prism-telemetry-demo.html','vesora-prism-labs-demo.html'];
const values=(layer,role)=>layer.figure.registry.get(layer.spec.data[role]).values.slice();

/** Select the protocol7 viewer for accepted static scenes without inventing a displayed frame. */
function captureHTML(source){
  const snapshot=source.snapshot();snapshot.figure.protocolVersion=7;
  const buffers=new Map([...source.registry.entries()].map(([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength)])),captured=figure();
  try{captured.applySnapshot(snapshot,buffers);assert.equal(captured.streams.size,0);return toHTML(captured,{source:'accepted'});}finally{captured.close();}
}

export async function prismReleaseScenes(){
  const output=new Map(),surface=subplots({rows:2,cols:2,kinds:[['3d','2d'],['2d','2d']],width:1100,height:760,title:'PRISM · surface and exact slices',theme:OBSIDIAN_DARK});
  try{
    const x=Float64Array.from({length:49},(_,i)=>-3+i/8),y=Float64Array.from({length:33},(_,i)=>-2+i/8),z=new Float64Array(x.length*y.length),scalar=new Float64Array(z.length);
    for(let r=0;r<y.length;r++)for(let c=0;c<x.length;c++){const i=r*x.length+c,d=Math.hypot(x[c],y[r]);z[i]=Math.cos(d*2)*Math.exp(-d*.3);scalar[i]=Math.sin(x[c])*Math.cos(y[r]);}
    const layer=surface.panel(0,0).setTitle('Height + independent scalar').surface(x,y,z,{values:scalar,shading:'smooth',label:'Synthetic wave'});
    surface.panel(0,0).setView({xLabel:'x',yLabel:'y',zLabel:'height'});surface.panel(0,1).setTitle('Scalar field').heatmap(x,y,scalar,{colorbarLabel:'Scalar'});
    surface.panel(1,0).setTitle('Exact column: x[24]').slice(layer,{axis:'x',index:24,width:2,color:'#79b7ff'});surface.panel(1,0).setView({xLabel:'y',yLabel:'height'});
    surface.panel(1,1).setTitle('Exact row: y[16]').slice(layer,{axis:'y',index:16,width:2,color:'#c5f36b'});surface.panel(1,1).setView({xLabel:'x',yLabel:'height'});
    output.set(prismDemoNames[0],captureHTML(surface));
  }finally{surface.close();}
  const telemetry=figure({width:1100,height:540,title:'PRISM · captured synthetic telemetry',theme:OBSIDIAN_DARK});
  try{
    const layers=['#c5f36b','#79b7ff','#f2b182'].map((color,i)=>telemetry.plot([],[],{label:`Sensor ${i+1}`,color,width:2}).enableStreaming({maxPoints:600}));
    telemetry.setView({xLabel:'Acquisition time',yLabel:'Synthetic amplitude'});telemetry.setHoverMode('x');
    for(let start=0;start<1800;start+=100){const x=Float64Array.from({length:100},(_,i)=>(start+i)*.01);await telemetry.appendDataBatch(layers.map((layer,j)=>({layer,data:{x,y:Float64Array.from(x,t=>.4*j+Math.sin(t*(1+j*.15))+.08*Math.cos(t*17+j))}})),{waitFor:'accepted'});}
    assert.ok(layers.every(layer=>telemetry.getStreamingState(layer.id).retained===600));output.set(prismDemoNames[1],captureHTML(telemetry));
  }finally{telemetry.close();}
  const x=Float64Array.from({length:48},(_,i)=>i/8),wave=t=>Float64Array.from(x,f=>Math.exp(-Math.pow(f-3-Math.sin(t),2)*2)+.1*Math.cos(f*3+t*4));
  const rolling=createRollingSurface({x,y:[0,.1,.2,.3],z:[0,.1,.2,.3].map(t=>Array.from(wave(t))),maxRows:16}),spatial=subplots({rows:1,cols:1,kinds:[['3d']]}),trajectory=createTrajectory(spatial.panel(0,0),{maxPoints:400,scalar:true});
  const captured=subplots({rows:1,cols:3,kinds:[['3d','2d','3d']],width:1320,height:540,title:'PRISM Labs · retained static scenes',theme:OBSIDIAN_DARK});
  try{
    const rows=Array.from({length:24},(_,i)=>(i+4)*.1);await rolling.appendRows({y:rows,z:rows.map(t=>Array.from(wave(t)))},{waitFor:'accepted'});
    const t=Float64Array.from({length:700},(_,i)=>i*.03);await trajectory.append({x:Float64Array.from(t,t=>Math.cos(t)),y:Float64Array.from(t,t=>Math.sin(t)),z:Float64Array.from(t,t=>t*.1),values:t},{waitFor:'accepted'});
    captured.panel(0,0).setTitle('Rolling field · last 16 rows').surface(values(rolling.surface,'x'),values(rolling.surface,'y'),values(rolling.surface,'z'),{shading:'smooth'});
    captured.panel(0,1).setTitle('Same retained row window').heatmap(values(rolling.heatmap,'x'),values(rolling.heatmap,'y'),values(rolling.heatmap,'z'));
    captured.panel(0,2).setTitle('Spatial trajectory · last 400 samples').plot3d(values(trajectory.layer,'x'),values(trajectory.layer,'y'),values(trajectory.layer,'z'),{values:values(trajectory.layer,'color'),width:3,label:'Captured helix'});
    assert.equal(rolling.getState().retainedRows,16);assert.equal(trajectory.getState().retained,400);output.set(prismDemoNames[2],captureHTML(captured));
  }finally{captured.close();trajectory.close();spatial.close();rolling.close();}
  return output;
}
