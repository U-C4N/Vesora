import { figure } from '/assets/index.js';

const token=new URL(location.href).searchParams.get('token');
const status=document.getElementById('status');
const chart=document.getElementById('chart');
const fig=figure();
window.vesoraFigure=fig;
let socket, generation=0, mounted=false, reconnects=0, controller;
let buffers=new Map();
let applying=Promise.resolve();
let currentRevision=0, renderFailure=null, applyingView=true;
const endpoint=(path)=>`${path}${path.includes('?')?'&':'?'}token=${encodeURIComponent(token??'')}`;
const send=(message)=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));};
for(const event of ['selection','viewchange','representation','error'])fig.on(event,payload=>{
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
async function exportFigure(requestId){
  try{let latest;do{latest=applying;await latest;}while(latest!==applying);if(renderFailure)throw renderFailure;const blob=await fig.savefig();const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});send({type:'export',requestId,dataUrl});}
  catch(error){send({type:'export-error',requestId,message:error.message});}
}
function connect(){
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}${endpoint('/ws')}`);
  socket.onopen=()=>{reconnects=0;};
  socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.type==='snapshot')applying=apply(message.snapshot,message.revision);else if(message.type==='export')void exportFigure(message.requestId);};
  socket.onclose=()=>{status.textContent='Python connection closed.';if(reconnects++<3)setTimeout(connect,1000*reconnects);};
  socket.onerror=()=>{status.textContent='Unable to connect to the Python figure.';};
}
window.addEventListener('beforeunload',()=>{controller?.abort();socket?.close();fig.close();});
connect();
