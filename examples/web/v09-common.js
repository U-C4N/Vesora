import {createABPins} from '../../packages/core/dist/labs.js';

export function shell(container,description){
  const section=document.createElement('section'),copy=document.createElement('p'),controls=document.createElement('div'),chart=document.createElement('div'),status=document.createElement('p');
  copy.className='demo-copy';copy.textContent=description;controls.className='demo-controls';status.className='demo-status';status.setAttribute('role','status');section.append(copy,controls,chart,status);container.append(section);
  return {section,controls,chart,status};
}
export function button(container,label,action){const node=document.createElement('button');node.type='button';node.textContent=label;node.addEventListener('click',()=>Promise.resolve().then(()=>action(node)).catch(error=>{const status=container.parentElement.querySelector('.demo-status');if(status)status.textContent=error.message;}));container.append(node);return node;}
export function downloadHTML(html,name){const url=URL.createObjectURL(new Blob([html],{type:'text/html'})),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
/** The producer and the displayed frame have deliberately separate controls. */
export function liveControls(figure,controls,status){
  let paused=false;const pins=createABPins(figure),labels=new Map();
  const producer=button(controls,'Pause producer',node=>{paused=!paused;node.textContent=paused?'Run producer':'Pause producer';});
  const inspection=button(controls,'Freeze inspection',async node=>{node.disabled=true;try{if(figure.getInspectionState().mode==='frozen'){await figure.resumeLive();node.textContent='Freeze inspection';}else{figure.freezeInspection();node.textContent='Resume inspection';}}finally{node.disabled=false;}});
  for(const slot of ['A','B']){
    const capture=button(controls,`Pin ${slot}`,()=>{const pin=pins.pin(slot,'displayed');labels.set(slot,`${slot}: ${pin.snapshot.figure.layers.length} layers, ${pin.bytes.toLocaleString()} bytes`);status.textContent=[...labels.values()].join(' · ');save.disabled=false;});
    const save=button(controls,`Save ${slot} HTML`,()=>downloadHTML(pins.get(slot).toHTML(),`vesora-${slot.toLowerCase()}.html`));save.disabled=true;capture.title='Retain the displayed data and camera within the shared snapshot budget';
  }
  return {get paused(){return paused;},close(){producer.disabled=inspection.disabled=true;pins.close();}};
}
/** Bounded, non-overlapping synthetic producer; disposing cancels future work. */
export function producerLoop(step,interval,onError){let disposed=false,timer;const run=async()=>{try{if(!disposed)await step();}catch(error){if(!disposed)onError(error);disposed=true;}finally{if(!disposed)timer=setTimeout(run,interval);}};timer=setTimeout(run,interval);return ()=>{disposed=true;clearTimeout(timer);};}
