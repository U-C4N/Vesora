import {subplots} from '../../packages/core/dist/index.js';
import {mountViewer} from '../../packages/core/dist/viewer.js';
import {shell} from './v09-common.js';

/** Stable mixed scientific grid: one geometry field, one scalar field, two exact slices. */
export async function mountSurfaceLab(container){
  const ui=shell(container,'Stable · A synthetic wave surface uses independent scalar color. The lower panels are exact grid rows and columns; moving a slice does not interpolate new samples.');
  const x=Float64Array.from({length:65},(_,i)=>-3+i*6/64),y=Float64Array.from({length:49},(_,i)=>-2+i*4/48),z=new Float64Array(x.length*y.length),values=new Float64Array(z.length);
  for(let row=0;row<y.length;row++)for(let col=0;col<x.length;col++){const i=row*x.length+col,r=Math.hypot(x[col],y[row]);z[i]=Math.cos(2*r)*Math.exp(-r*.3);values[i]=Math.sin(x[col])*Math.cos(y[row]);}
  const figure=subplots({rows:2,cols:2,kinds:[['3d','2d'],['2d','2d']],width:1100,height:680,title:'Field and exact cross-sections'});
  const source=figure.panel(0,0).surface(x,y,z,{values,shading:'smooth',label:'Wave height; scalar color'});figure.panel(0,0).setTitle('Height + independent scalar').setView({xLabel:'x',yLabel:'y',zLabel:'height'});
  figure.panel(0,1).heatmap(x,y,values);figure.panel(0,1).setTitle('Independent scalar field').setView({xLabel:'x',yLabel:'y'});
  const column=figure.panel(1,0).slice(source,{axis:'x',index:32,color:'#79b7ff',width:2,label:'Exact column'}),row=figure.panel(1,1).slice(source,{axis:'y',index:24,color:'#c5f36b',width:2,label:'Exact row'});
  figure.panel(1,0).setTitle('x-column → z(y)').setView({xLabel:'y',yLabel:'height'});figure.panel(1,1).setTitle('y-row → z(x)').setView({xLabel:'x',yLabel:'height'});
  for(const [axis,coordinates,slice,index]of [['x',x,column,32],['y',y,row,24]]){
    const label=document.createElement('label'),input=document.createElement('input'),value=document.createElement('output');input.type='range';input.min='0';input.max=String(coordinates.length-1);input.value=String(index);input.setAttribute('aria-label',`${axis} slice index`);
    const update=()=>{slice.setIndex(Number(input.value));value.textContent=`${axis}[${input.value}] = ${coordinates[Number(input.value)].toFixed(3)}`;};label.append(`${axis} slice `,input,value);ui.controls.append(label);input.addEventListener('input',update);update();
  }
  const viewer=mountViewer(figure,ui.chart,{theme:'dark',height:680,onError:error=>ui.status.textContent=error.message});await figure.ready();ui.status.textContent='65 × 49 source vertices · exact slices · hover the surface for cell and interpolated coordinates';
  return {figure,advance(phase){
    const next=new Float64Array(z.length);
    for(let row=0;row<y.length;row++)for(let col=0;col<x.length;col++){
      const r=Math.hypot(x[col],y[row]);next[row*x.length+col]=Math.cos(2*r-phase)*Math.exp(-r*.3);
    }
    // The source and both exact profiles change in one surface transaction.
    // Independent scalar color and its heatmap remain the same measured field.
    source.setData({z:next});
  },dispose(){viewer.dispose();figure.close();ui.section.remove();}};
}
