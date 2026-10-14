import {figure,downloadHTML} from '../../packages/core/dist/index.js';

const fig=figure({height:480,title:'Synthetic training telemetry'});
const colors=['#3569c8','#137f8b','#d36a55'];
const layers=colors.map((color,i)=>fig.plot([],[],{label:`Model ${String.fromCharCode(65+i)}`,color}).enableStreaming({maxPoints:2000}));
fig.setView({xLabel:'Training step',yLabel:'Synthetic loss'});fig.setHoverMode('x');fig.mount(document.querySelector('#chart'));
let step=0,paused=false,closed=false;
const value=(x,series)=>(series+1)*.15+3*Math.exp(-x/2000)+.08*Math.sin(x*.07+series);
const status=document.querySelector('#status');
const updateStatus=()=>{const state=fig.getStreamingState(layers[0].id);status.textContent=`${paused?'Paused':'Live'} · ${state.retained.toLocaleString()} retained samples per model · ${state.nextSequence.toLocaleString()} received`;};
const pause=document.querySelector('#pause');
pause.onclick=()=>{
  // Resume follows current data rather than leaving an inspected range behind.
  if(paused)fig.setView({xDomain:undefined,yDomain:undefined});
  paused=!paused;pause.textContent=paused?'Resume':'Pause';updateStatus();
};
const pauseForInspection=()=>{
  if(paused||closed)return;
  paused=true;pause.textContent='Resume';updateStatus();
};
const chart=document.querySelector('#chart');
// Freeze the retained window before the renderer starts a gesture. Pausing only
// on pointerup lets a long drag evict the samples the user is inspecting.
chart.addEventListener('pointerdown',event=>{if(event.button===0)pauseForInspection();},true);
chart.addEventListener('wheel',pauseForInspection,{capture:true,passive:true});
chart.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))pauseForInspection();},true);
document.querySelector('#reset').onclick=()=>fig.setView({xDomain:undefined,yDomain:undefined});
document.querySelector('#html').onclick=()=>downloadHTML(fig,'telemetry-snapshot.html');
document.querySelector('#png').onclick=async()=>{try{const blob=await fig.savefig({width:1100,height:600,scale:2}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='telemetry.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){status.textContent=error.message;}};
async function run(){
  while(!closed){
    if(!paused){
      const x=Array.from({length:100},()=>step++);
      try{await fig.appendDataBatch(layers.map((layer,i)=>({layer,data:{x,y:x.map(t=>value(t,i))}})));
        updateStatus();
      }catch(error){if(!closed){status.textContent=error.message;paused=true;pause.textContent='Resume';}}
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
}
window.addEventListener('pagehide',event=>{
  // Cached documents keep their figure and suspended producer for history restore.
  if(event.persisted)return;
  closed=true;fig.close();
});
void run();
