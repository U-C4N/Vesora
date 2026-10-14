import { figure, Layer, decodeData } from '/assets/index.js';

const token=new URL(location.href).searchParams.get('token');
const status=document.getElementById('status');
const chart=document.getElementById('chart');
const fig=figure();
window.vesoraFigure=fig;
let socket, generation=0, mounted=false, reconnects=0, controller;
let buffers=new Map();
let applying=Promise.resolve();
let currentRevision=0, renderFailure=null, applyingView=true;
let binaryMode=false;
const endpoint=(path)=>`${path}${path.includes('?')?'&':'?'}token=${encodeURIComponent(token??'')}`;
const send=(message)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
for(const event of ['selection','click','viewchange','representation','error'])fig.on(event,payload=>{
  if(event==='viewchange'&&applyingView)return;
  send({type:'event',event,payload,revision:currentRevision});
});
async function apply(snapshot,revision=0){
  renderFailure=null;applyingView=true;chart.style.pointerEvents='none';
  const version=++generation;controller?.abort();controller=new AbortController();const signal=controller.signal;
  try{
    const next=new Map();
    // Bound simultaneous downloads; the source registry is swapped only once complete.
    for(let offset=0;offset<snapshot.sources.length;offset+=4){
      await Promise.all(snapshot.sources.slice(offset,offset+4).map(async source=>{
        const cached=buffers.get(source.id);
        if(cached?.version===source.version){next.set(source.id,cached);return;}
        const response=await fetch(endpoint(`/data/${encodeURIComponent(source.id)}?version=${source.version}`),{signal});
        if(!response.ok)throw new Error(`Data transfer failed (${response.status})`);
        next.set(source.id,{version:source.version,buffer:await response.arrayBuffer()});
      }));
    }
    if(version!==generation)return;
    fig.applySnapshot(snapshot,new Map([...next].map(([id,data])=>[id,data.buffer])));buffers=next;currentRevision=revision;
    if(!mounted){fig.mount(chart);mounted=true;}
    await fig.ready();if(version!==generation)return;
    applyingView=false;chart.style.pointerEvents='';
    status.textContent='';document.title=snapshot.figure.title||'Vesora';send({type:'ready',revision});
  }catch(error){if(error.name==='AbortError'||version!==generation)return;renderFailure=error;status.textContent=error.message;send({type:'event',event:'error',payload:{message:error.message},revision});}
}
async function exportFigure(requestId,options){
  try{let latest;do{latest=applying;await latest;}while(latest!==applying);if(renderFailure)throw renderFailure;const blob=await fig.savefig(options);const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});send({type:'export',requestId,dataUrl});}
  catch(error){send({type:'export-error',requestId,message:error.message});}
}
function unpack(packet){
  if(!(packet instanceof ArrayBuffer)||packet.byteLength<4)throw new Error('Invalid binary transfer');
  const length=new DataView(packet).getUint32(0,true);
  if(length>packet.byteLength-4)throw new Error('Invalid transfer metadata length');
  const header=JSON.parse(new TextDecoder().decode(new Uint8Array(packet,4,length))),parts=[];
  let offset=4+length;
  for(const size of header.bufferLengths??[]){
    if(!Number.isSafeInteger(size)||size<0||size>packet.byteLength-offset)throw new Error('Invalid transfer buffer length');
    parts.push(packet.slice(offset,offset+size));offset+=size;
  }
  if(offset!==packet.byteLength)throw new Error('Unexpected binary transfer data');
  return {header,parts};
}
async function applyTransfer(header,parts){
  binaryMode=true;const version=++generation;controller?.abort();renderFailure=null;
  try{
    if(header.type==='stream-snapshot'){
      applyingView=true;chart.style.pointerEvents='none';
      if(parts.length!==header.snapshot.sources.length)throw new Error('Snapshot buffers do not match sources');
      currentRevision=header.revision;
      fig.applySnapshot(header.snapshot,new Map(header.snapshot.sources.map((source,i)=>[source.id,parts[i]])));
      fig.restoreStreaming(header.streams??{});
      if(!mounted){fig.mount(chart);mounted=true;}
      await fig.ready();
    }else{
      if(header.baseRevision!==currentRevision)throw new Error('Transfer revision mismatch');
      const versions=new Map();
      // Check the complete packet before committing its first append.
      const prepared=header.updates.map(update=>{
        const layer=new Layer(fig,update.layerId),channels=Object.keys(layer.spec.data);
        const state=fig.getStreamingState(update.layerId);
        if(!state||state.streamId!==update.state.streamId)throw new Error('Stream epoch mismatch');
        if(update.channels.length!==channels.length||new Set(update.channels.map(item=>item.channel)).size!==channels.length)throw new Error('Invalid append channels');
        const data={};
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
      });
      const pending=[];
      for(const update of prepared){
        pending.push(fig.appendDataBatch([update]));
        if(pending.length===32){await Promise.all(pending);pending.length=0;}
      }
      await Promise.all(pending);
    }
    if(version!==generation)return;
    currentRevision=header.revision;applyingView=false;chart.style.pointerEvents='';status.textContent='';
    send({type:'ack',transferId:header.transferId,revision:header.revision});
  }catch(error){
    if(version!==generation)return;
    if(header.type==='stream-snapshot'){
      renderFailure=error;status.textContent=String(error.message??error);
      send({type:'event',event:'error',payload:{message:String(error.message??error)},revision:header.revision});
      return;
    }
    status.textContent='Synchronizing the latest retained data…';
    send({type:'resync',revision:currentRevision,message:String(error)});
  }
}
async function exportSnapshot(header,parts){
  try{
    await applying;
    const source=new Map(header.snapshot.sources.map((item,i)=>[item.id,parts[i]]));
    const blob=await fig.savefigSnapshot(header.snapshot,source,header.options);
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
    send({type:'export',requestId:header.requestId,dataUrl});
  }catch(error){send({type:'export-error',requestId:header.requestId,message:String(error)});}
}
function connect(){
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}${endpoint('/ws')}`);
  socket.binaryType='arraybuffer';
  socket.onopen=()=>{reconnects=0;send({type:'hello',transportVersion:2});};
  socket.onmessage=event=>{
    if(event.data instanceof ArrayBuffer){
      try{const {header,parts}=unpack(event.data);if(header.type==='stream-export')void exportSnapshot(header,parts);else applying=applyTransfer(header,parts);}
      catch(error){send({type:'resync',message:String(error)});}return;
    }
    const message=JSON.parse(event.data);
    if(message.type==='snapshot'&&!binaryMode)applying=apply(message.snapshot,message.revision);
    else if(message.type==='export')void exportFigure(message.requestId,message.options);
  };
  socket.onclose=()=>{status.textContent='Python connection closed.';if(reconnects++<3)setTimeout(connect,1000*reconnects);};
  socket.onerror=()=>{status.textContent='Unable to connect to the Python figure.';};
}
window.addEventListener('beforeunload',()=>{controller?.abort();socket?.close();fig.close();});
connect();
