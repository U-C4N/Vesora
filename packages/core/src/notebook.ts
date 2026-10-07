import {figure} from './figure';
import {setWorkerURL} from './scheduler';
import type {Snapshot} from './types';
declare const __VESORA_WORKER_SOURCE__:string;
interface WidgetModel {
  get(key:string):any;
  on(event:string,callback:(...args:any[])=>void):void;
  off(event:string,callback:(...args:any[])=>void):void;
  send(message:unknown):void;
}
export function render({model,el}:{model:WidgetModel;el:HTMLElement}):()=>void{
  const workerURL=URL.createObjectURL(new Blob([__VESORA_WORKER_SOURCE__],{type:'text/javascript'}));
  const fig=figure();let mounted=false,generation=0,disposed=false;
  let appliedRevision:number|undefined,applyingView=true;
  const originalPointerEvents=el.style.pointerEvents;
  let applying=Promise.resolve();
  let renderFailure:unknown;
  el.style.width='100%';
  const apply=async()=>{
    const current=++generation;
    renderFailure=undefined;applyingView=true;el.style.pointerEvents='none';
    try{
      const snapshot=model.get('snapshot') as Snapshot,raw=model.get('buffers') as Array<ArrayBuffer|DataView|Uint8Array>,revision=model.get('revision') as number|undefined;
      if(!snapshot?.figure||raw.length!==snapshot.sources.length)return;
      const buffers=new Map(snapshot.sources.map((source,i)=>{
        const item=raw[i];const data=item instanceof ArrayBuffer?item:item.buffer.slice(item.byteOffset,item.byteOffset+item.byteLength) as ArrayBuffer;
        return [source.id,data] as const;
      }));
      fig.applySnapshot(snapshot,buffers);appliedRevision=revision;if(!mounted){setWorkerURL(workerURL);try{fig.mount(el);mounted=true;}finally{setWorkerURL(undefined);}}await fig.ready();
      if(!disposed&&current===generation){applyingView=false;el.style.pointerEvents=originalPointerEvents;model.send({type:'ready',revision});}
    }catch(error){if(current!==generation||disposed)return;renderFailure=error;model.send({type:'event',event:'error',revision:model.get('revision'),payload:{message:String(error)}});}
  };
  // Change notifications may arrive together for binary buffers and the scene.
  let scheduled=false;
  const update=()=>{applyingView=true;el.style.pointerEvents='none';if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;if(!disposed)applying=apply();});}};
  const custom=async(message:{type:string;requestId:string})=>{
    if(message.type!=='export')return;
    try{await Promise.resolve();let latest;do{latest=applying;await latest;}while(latest!==applying);if(renderFailure)throw renderFailure;const blob=await fig.savefig();const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=reject;reader.readAsDataURL(blob);});model.send({type:'export',requestId:message.requestId,dataUrl});}
    catch(error){model.send({type:'export-error',requestId:message.requestId,message:String(error)});}
  };
  for(const event of ['selection','viewchange','representation','error'] as const)fig.on(event,payload=>{
    if(event==='viewchange'&&applyingView)return;
    model.send({type:'event',event,payload,revision:appliedRevision});
  });
  model.on('change:snapshot',update);model.on('change:buffers',update);model.on('change:revision',update);model.on('msg:custom',custom);update();
  return ()=>{disposed=true;generation++;model.off('change:snapshot',update);model.off('change:buffers',update);model.off('change:revision',update);model.off('msg:custom',custom);fig.close();el.style.pointerEvents=originalPointerEvents;URL.revokeObjectURL(workerURL);setWorkerURL(undefined);};
}
export default {render};
