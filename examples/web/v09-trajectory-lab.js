import {subplots} from '../../packages/core/dist/index.js';
import {mountViewer} from '../../packages/core/dist/viewer.js';
import {createTrajectory} from '../../packages/core/dist/labs.js';
import {shell,liveControls,producerLoop} from './v09-common.js';

/** Opt-in Labs: bounded spatial acquisition order, frozen inspection and retained A/B exports. */
export async function mountTrajectoryLab(container){
  const ui=shell(container,'Labs · Synthetic Lorenz integration. Spatial x reverses freely; acquisition sequence is separate. Freeze inspection while ingestion continues, then pin and export the exact displayed window.');
  const figure=subplots({rows:1,cols:1,kinds:[['3d']],width:1100,height:600,title:'Bounded spatial trajectory',runtime:{maxSnapshotBytes:8*1024*1024}}),panel=figure.panel(0,0);
  panel.setView({xDomain:[-25,25],yDomain:[-35,35],zDomain:[0,55],xLabel:'x',yLabel:'y',zLabel:'z'});
  const trajectory=createTrajectory(panel,{maxPoints:6000,scalar:true,style:{width:2,label:'Lorenz trajectory'}});let x=.1,y=0,z=0;
  const batch=count=>{const xs=[],ys=[],zs=[],values=[];for(let i=0;i<count;i++){const dx=10*(y-x),dy=x*(28-z)-y,dz=x*y-8*z/3;x+=dx*.003;y+=dy*.003;z+=dz*.003;xs.push(x);ys.push(y);zs.push(z);values.push(Math.hypot(dx,dy,dz));}return {x:xs,y:ys,z:zs,values};};
  await trajectory.append(batch(1500),{waitFor:'accepted'});const viewer=mountViewer(figure,ui.chart,{theme:'dark',height:600,onError:error=>ui.status.textContent=error.message});await figure.ready();const controls=liveControls(figure,ui.controls,ui.status);
  const hover=figure.on('hover',hit=>{if(hit?.layerId!==trajectory.layer.id||hit.kind!=='segment3d')return;const version=hit.sourceVersions?.x,sequence=trajectory.sequenceAt(hit.indices[0],version);ui.status.textContent=`Segment begins at acquisition ${sequence??'unavailable'} · retained ${trajectory.getState().retained.toLocaleString()} / 6,000 points`;});
  const stop=producerLoop(async()=>{if(controls.paused)return;await trajectory.append(batch(40),{waitFor:'accepted'});const state=trajectory.getState();ui.status.textContent=`${figure.getInspectionState().mode==='frozen'?'Frozen inspection · ingestion continues':'Live inspection'} · acquired ${state.nextSequence.toLocaleString()} · retained ${state.retained.toLocaleString()} · evicted ${state.evicted.toLocaleString()}`;},80,error=>ui.status.textContent=error.message);
  return {figure,trajectory,dispose(){stop();hover();controls.close();trajectory.close();viewer.dispose();figure.close();ui.section.remove();}};
}
