import {figure,Layer} from './figure';
import {decodeData} from './data';
import {setWorkerURL} from './scheduler';
import {mountViewer,type ViewerHandle} from './viewer';
import type {NumericArray,Snapshot} from './types';
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
  const viewerOptions={preserveTheme:true,theme:'dark' as const,live:false,exportHTML:true};
  let viewer:ViewerHandle|undefined;
  const viewId=globalThis.crypto?.randomUUID?.()??`view-${Date.now()}-${Math.random()}`;
  let binaryMode=false,transportVersion=2;
  fig.setInspectionEnabled(false);
  const revisions=new Map<number,number>();
  let displayedHostRevision:number|undefined,pendingCoreRevision:number|undefined;
  const trimRevisions=()=>{
    const displayed=fig.getInspectionState().displayedRevision,keys=[...revisions.keys()];
    const keep=new Set([keys.at(-1),keys.filter(key=>key<=displayed).at(-1),keys.filter(key=>pendingCoreRevision!==undefined&&key<=pendingCoreRevision).at(-1)]);
    for(const key of keys)if(!keep.has(key))revisions.delete(key);
  };
  const rememberRevision=(revision:number)=>{
    revisions.set(fig.getInspectionState().acceptedRevision,revision);
    trimRevisions();
  };
  const frameMetadata=()=>{
    const state=fig.getInspectionState();let covered:number|undefined;
    for(const [core,host]of revisions)if(core<=state.displayedRevision)covered=host;
    if(covered!==undefined)displayedHostRevision=covered;
    return {...state,revision:displayedHostRevision};
  };
  const reportFrame=()=>{if(transportVersion!==3)return;const state=frameMetadata();if(state.revision===undefined)return;model.send({type:'frame',viewId,revision:state.revision,frameId:state.frameId,mode:state.mode,snapshotId:state.snapshotId});};
  fig.on('frame',reportFrame);fig.on('inspectionchange',reportFrame);
  fig.on('framepending',state=>{pendingCoreRevision=state.displayedRevision;trimRevisions();});
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
      fig.applySnapshot(snapshot,buffers);appliedRevision=revision;if(!mounted){setWorkerURL(workerURL);try{viewer=mountViewer(fig,el,viewerOptions);mounted=true;}finally{setWorkerURL(undefined);}}await fig.ready();
      if(!disposed&&current===generation){applyingView=false;el.style.pointerEvents=originalPointerEvents;model.send({type:'ready',revision});}
    }catch(error){if(current!==generation||disposed)return;renderFailure=error;model.send({type:'event',event:'error',revision:model.get('revision'),payload:{message:String(error)}});}
  };
  // Change notifications may arrive together for binary buffers and the scene.
  let scheduled=false;
  const update=()=>{if(binaryMode)return;applyingView=true;el.style.pointerEvents='none';if(!scheduled){scheduled=true;queueMicrotask(()=>{scheduled=false;if(!disposed&&!binaryMode)applying=apply();});}};
  const bytes=(value:ArrayBuffer|DataView|Uint8Array)=>value instanceof ArrayBuffer?value:value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength) as ArrayBuffer;
  const applyTransfer=async(message:any,rawParts:Array<ArrayBuffer|DataView|Uint8Array>)=>{
    binaryMode=true;transportVersion=message.transportVersion===3?3:2;viewerOptions.live=transportVersion===3;fig.setInspectionEnabled(transportVersion===3);const current=++generation;renderFailure=undefined;
    try{
      const parts=rawParts.map(bytes);
      if(parts.length!==message.bufferLengths.length||parts.some((part,i)=>part.byteLength!==message.bufferLengths[i]))throw new Error('Invalid transfer buffers');
      if(message.type==='stream-snapshot'){
        applyingView=true;el.style.pointerEvents='none';
        const snapshot=message.snapshot as Snapshot;
        if(snapshot.sources.length!==parts.length)throw new Error('Snapshot sources do not match buffers');
        appliedRevision=message.revision;
        fig.applySnapshot(snapshot,new Map(snapshot.sources.map((source,i)=>[source.id,parts[i]])));
        fig.restoreStreaming(message.streams??{});
        if(!mounted){setWorkerURL(workerURL);try{viewer=mountViewer(fig,el,viewerOptions);mounted=true;}finally{setWorkerURL(undefined);}}
        rememberRevision(message.revision);
        if(transportVersion===2)await fig.ready();
      }else{
        if(message.baseRevision!==appliedRevision)throw new Error('Transfer revision mismatch');
        const versions=new Map<string,number>();
        // Decode and check every payload before the first canonical append.
        // A damaged later buffer must not partially apply an earlier update.
        const transactions=transportVersion===3?message.transactions:message.updates.map((update:any)=>({revision:message.revision,updates:[update]}));
        if(!Array.isArray(transactions))throw new Error('Invalid append transactions');
        let transactionRevision=message.baseRevision;
        const prepared=transactions.map((transaction:any)=>{
          if(!Array.isArray(transaction.updates)||!transaction.updates.length)throw new Error('Invalid append transaction');
          if(transportVersion===3&&(!Number.isSafeInteger(transaction.revision)||transaction.revision<=transactionRevision||transaction.revision>message.revision))throw new Error('Invalid transaction revision');
          transactionRevision=transaction.revision;
          const seen=new Set<string>();
          return {revision:transaction.revision,updates:transaction.updates.map((update:any)=>{
          if(seen.has(update.layerId))throw new Error('Duplicate layer in append transaction');seen.add(update.layerId);
          const layer=new Layer(fig,update.layerId),channels=Object.keys(layer.spec.data);
          const state=fig.getStreamingState(update.layerId);
          if(!state||state.streamId!==update.state.streamId)throw new Error('Stream epoch mismatch');
          if(update.channels.length!==channels.length||new Set(update.channels.map((item:any)=>item.channel)).size!==channels.length)throw new Error('Invalid append channels');
          const data:Record<string,NumericArray>={};
          for(const item of update.channels){
            if(layer.spec.data[item.channel]!==item.sourceId||item.descriptor.id!==item.sourceId)throw new Error('Append channel source mismatch');
            const source=fig.registry.get(item.sourceId).descriptor;
            const previous=versions.get(item.sourceId)??source.version;
            if(previous!==item.baseVersion||item.descriptor.version!==previous+1)throw new Error('Source revision mismatch');
            if(item.descriptor.dtype!==source.dtype||item.descriptor.shape.length!==1)throw new Error('Append dtype/shape mismatch');
            data[item.channel]=decodeData(item.descriptor,parts[item.bufferIndex]);
            versions.set(item.sourceId,item.descriptor.version);
          }
          if(channels.some(channel=>data[channel].length!==data.x.length))throw new Error('Append channel lengths differ');
          return {layer,data};
          })};
        });
        if(transportVersion===3&&transactionRevision!==message.revision)throw new Error('Incomplete append transaction revisions');
        const pending:Promise<void>[]=[];
        for(const transaction of prepared){
          if(transportVersion===3){await fig.appendDataBatch(transaction.updates,{waitFor:'accepted'});rememberRevision(transaction.revision);}
          else pending.push(fig.appendDataBatch(transaction.updates));
          if(pending.length===32){await Promise.all(pending);pending.length=0;}
        }
        await Promise.all(pending);
      }
      if(disposed||current!==generation)return;
      appliedRevision=message.revision;applyingView=false;el.style.pointerEvents=originalPointerEvents;
      model.send({type:'ack',viewId,transferId:message.transferId,revision:message.revision});
      reportFrame();
    }catch(error){
      if(disposed||current!==generation)return;
      if(message.type==='stream-snapshot'){
        renderFailure=error;model.send({type:'event',viewId,event:'error',revision:message.revision,payload:{message:String(error)}});
      }else model.send({type:'resync',viewId,message:String(error)});
    }
  };
  const custom=async(message:any,rawParts:Array<ArrayBuffer|DataView|Uint8Array>=[])=>{
    if(message.viewId&&message.viewId!==viewId)return;
    if(message.type==='stream-snapshot'||message.type==='stream-delta'){applying=applyTransfer(message,rawParts);return applying;}
    if(message.type==='stream-export'){
      try{
        await applying;
        const snapshot=message.snapshot as Snapshot,parts=rawParts.map(bytes);
        const blob=await fig.savefigSnapshot(snapshot,new Map(snapshot.sources.map((source,i)=>[source.id,parts[i]])),message.options);
        const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=reject;reader.readAsDataURL(blob);});
        model.send({type:'export',viewId,requestId:message.requestId,dataUrl});
      }catch(error){model.send({type:'export-error',viewId,requestId:message.requestId,message:String(error)});}
      return;
    }
    if(message.type!=='export')return;
    try{await Promise.resolve();let latest;do{latest=applying;await latest;}while(latest!==applying);if(renderFailure)throw renderFailure;const blob=await fig.savefig(message.options);const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=reject;reader.readAsDataURL(blob);});model.send({type:'export',requestId:message.requestId,dataUrl});}
    catch(error){model.send({type:'export-error',requestId:message.requestId,message:String(error)});}
  };
  for(const event of ['selection','click','viewchange','slicechange','representation','error'] as const)fig.on(event,payload=>{
    if(event==='viewchange'&&applyingView)return;
    const frame=transportVersion===3&&event!=='error'?frameMetadata():undefined;
    if(frame)reportFrame();
    model.send({type:'event',event,payload,viewId,revision:frame?.revision??appliedRevision,...(frame?{frameId:frame.frameId,snapshotId:frame.snapshotId}:{} )});
  });
  model.on('change:snapshot',update);model.on('change:buffers',update);model.on('change:revision',update);model.on('msg:custom',custom);update();
  model.send({type:'hello',transportVersion:2,supportedTransportVersions:[2,3],viewId});
  return ()=>{disposed=true;generation++;model.send({type:'dispose-view',viewId});model.off('change:snapshot',update);model.off('change:buffers',update);model.off('change:revision',update);model.off('msg:custom',custom);viewer?.dispose();fig.close();el.style.pointerEvents=originalPointerEvents;URL.revokeObjectURL(workerURL);setWorkerURL(undefined);};
}
export default {render};
