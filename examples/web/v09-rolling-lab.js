import {mountViewer} from '../../packages/core/dist/viewer.js';
import {createRollingSurface} from '../../packages/core/dist/labs.js';
import {shell,liveControls,producerLoop} from './v09-common.js';

/** Opt-in Labs: fixed columns and whole-row eviction publish both panels atomically. */
export async function mountRollingLab(container){
  const ui=shell(container,'Labs · Synthetic telemetry spectrum. A fixed frequency grid feeds a rolling surface and heatmap in one atomic update. Both views retain the same 64-row window; exports contain the retained static samples.');
  const x=Float64Array.from({length:64},(_,i)=>i*10/63),row=t=>Float64Array.from(x,f=>Math.exp(-Math.pow(f-3-1.4*Math.sin(t*.8),2)*2)+.6*Math.exp(-Math.pow(f-7-.5*Math.cos(t),2)*4)+.08*Math.cos(f*3+t*4)),y=Float64Array.from({length:24},(_,i)=>i*.1),z=Array.from(y,t=>Array.from(row(t)));
  const rolling=createRollingSurface({x,y,z,maxRows:64,maxSnapshotBytes:8*1024*1024,title:'One telemetry window, two views'}),figure=rolling.figure;figure.panel(0,0).setView({xLabel:'frequency',yLabel:'time',zLabel:'amplitude'});figure.panel(0,1).setView({xLabel:'frequency',yLabel:'time'});
  const viewer=mountViewer(figure,ui.chart,{theme:'dark',height:600,onError:error=>ui.status.textContent=error.message});await figure.ready();const controls=liveControls(figure,ui.controls,ui.status);let sequence=y.length;
  const stop=producerLoop(async()=>{if(controls.paused)return;const t=sequence*.1;await rolling.appendRows({y:[t],z:row(t)},{waitFor:'accepted'});sequence++;const state=rolling.getState();ui.status.textContent=`${figure.getInspectionState().mode==='frozen'?'Frozen inspection · ingestion continues':'Live inspection'} · retained ${state.retainedRows} × ${state.columns} · acquired ${state.nextSequence} rows · evicted ${state.evictedRows}`;},180,error=>ui.status.textContent=error.message);
  return {figure,rolling,dispose(){stop();controls.close();viewer.dispose();rolling.close();ui.section.remove();}};
}
