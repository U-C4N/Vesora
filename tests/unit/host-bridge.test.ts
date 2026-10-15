import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';

function deferred<T>(){
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));

it('desktop events use only the rendered snapshot revision while replacement data is loading',async()=>{
  const events=new Map<string,(value:unknown)=>void>(),messages:any[]=[],nodes={chart:{style:{pointerEvents:''}},status:{textContent:''}};
  let response=deferred<any>(),render=deferred<void>();
  const fig={on:(event:string,callback:(value:unknown)=>void)=>events.set(event,callback),setInspectionEnabled:()=>{},applySnapshot:()=>{},mount:()=>{},ready:()=>render.promise,close:()=>{}};
  let socket:any;
  class Socket{
    static OPEN=1;readyState=1;onmessage?:(message:any)=>void;
    constructor(){socket=this;}
    send(value:string){messages.push(JSON.parse(value));}
    close(){}
  }
  const source=readFileSync(new URL('../../python/vesora/_assets/host.js',import.meta.url),'utf8').replace(/^import .*;\s*/gm, '');
  runInNewContext(source,{figure:()=>fig,mountViewer:()=>({dispose:()=>{}}),URL,AbortController,WebSocket:Socket,
    location:{href:'http://127.0.0.1/viewer?token=test',protocol:'http:',host:'127.0.0.1'},
    document:{getElementById:(id:keyof typeof nodes)=>nodes[id]},window:{addEventListener:()=>{}},
    fetch:()=>response.promise,setTimeout:()=>0});
  const snapshot=(version:number)=>({figure:{title:'Fixture'},sources:[{id:'x',version}]});
  socket.onmessage({data:JSON.stringify({type:'snapshot',snapshot:snapshot(1),revision:1})});
  events.get('viewchange')!({xDomain:[8,9]});
  expect(messages).toEqual([]);
  expect(nodes.chart.style.pointerEvents).toBe('none');
  response.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
  await tick();
  events.get('viewchange')!({xDomain:[8,9]});
  expect(messages).toEqual([]);
  render.resolve();await tick();
  events.get('viewchange')!({xDomain:[1,2]});
  expect(messages.at(-1)).toMatchObject({event:'viewchange',revision:1,payload:{xDomain:[1,2]}});
  expect(nodes.chart.style.pointerEvents).toBe('');
  messages.length=0;response=deferred<any>();render=deferred<void>();
  socket.onmessage({data:JSON.stringify({type:'snapshot',snapshot:snapshot(2),revision:2})});
  events.get('viewchange')!({xDomain:[1,2]});
  expect(messages).toEqual([]);
  response.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});await tick();
  render.resolve();await tick();
  events.get('viewchange')!({xDomain:[3,4]});
  expect(messages.at(-1)).toMatchObject({event:'viewchange',revision:2,payload:{xDomain:[3,4]}});
});

it('v3 acknowledges acceptance independently and reports the exact captured frame during later transfers',async()=>{
  const events=new Map<string,(value:any)=>void>(),messages:any[]=[],enabled:boolean[]=[],batches:any[]=[];
  const nodes={chart:{style:{pointerEvents:''}},status:{textContent:''}};
  const timers:Array<()=>void>=[];
  let state:any={mode:'live',acceptedRevision:0,displayedRevision:0,frameId:0},readyCalls=0,socket:any;
  const sources=new Map(['a-x','a-y','b-x','b-y'].map(id=>[id,{descriptor:{id,dtype:'float64',version:1,shape:[1],byteLength:8}}]));
  const fig={
    on:(event:string,callback:(value:any)=>void)=>events.set(event,callback),
    setInspectionEnabled:(value:boolean)=>enabled.push(value),getInspectionState:()=>({...state}),
    applySnapshot:()=>{state.acceptedRevision++;},restoreStreaming:()=>{},mount:()=>{},close:()=>{},
    ready:()=>{readyCalls++;return new Promise(()=>{});},registry:{get:(id:string)=>sources.get(id)},
    getStreamingState:(id:string)=>({streamId:`stream-${id}`}),
    appendDataBatch:(updates:any[],options:any)=>{batches.push({updates,options});state.acceptedRevision++;return Promise.resolve();},
  };
  class Socket{static OPEN=1;readyState=1;onmessage?:(message:any)=>void;constructor(){socket=this;}send(value:string){messages.push(JSON.parse(value));}close(){}}
  class Layer{spec:any;constructor(_figure:any,id:string){this.spec={data:{x:`${id}-x`,y:`${id}-y`}};}}
  const source=readFileSync(new URL('../../python/vesora/_assets/host.js',import.meta.url),'utf8').replace(/^import .*;\s*/gm, '');
  runInNewContext(source,{figure:()=>fig,mountViewer:()=>({dispose:()=>{}}),Layer,decodeData:(_descriptor:any,buffer:ArrayBuffer)=>new Float64Array(buffer),
    URL,AbortController,ArrayBuffer,DataView,Uint8Array,TextDecoder,WebSocket:Socket,
    location:{href:'http://127.0.0.1/viewer?token=test',protocol:'http:',host:'127.0.0.1'},
    document:{getElementById:(id:keyof typeof nodes)=>nodes[id]},window:{addEventListener:()=>{}},setTimeout:(callback:()=>void)=>timers.push(callback)});
  const packet=(header:any,parts:ArrayBuffer[]=[])=>{
    const json=new TextEncoder().encode(JSON.stringify({...header,bufferLengths:parts.map(part=>part.byteLength)}));
    const bytes=new Uint8Array(4+json.length+parts.reduce((n,part)=>n+part.byteLength,0));
    new DataView(bytes.buffer).setUint32(0,json.length,true);bytes.set(json,4);let offset=4+json.length;
    for(const part of parts){bytes.set(new Uint8Array(part),offset);offset+=part.byteLength;}
    socket.onmessage({data:bytes.buffer});
  };
  const snapshot=(revision:number)=>packet({type:'stream-snapshot',transportVersion:3,transferId:`t${revision}`,revision,snapshot:{figure:{title:'v3'},sources:[]},streams:{}});
  snapshot(4);await tick();
  expect(readyCalls).toBe(0);expect(enabled.at(-1)).toBe(true);
  expect(messages).toContainEqual({type:'ack',transferId:'t4',revision:4});
  expect(messages.filter(message=>message.type==='frame')).toHaveLength(0);
  events.get('framepending')!({...state,displayedRevision:1});
  snapshot(5);await tick();
  state={...state,displayedRevision:1,frameId:1};events.get('frame')!(state);
  expect(messages.at(-1)).toMatchObject({type:'frame',revision:4,frameId:1});
  events.get('framepending')!({...state,displayedRevision:2});
  state={...state,displayedRevision:2,frameId:2,mode:'frozen',snapshotId:'held'};events.get('inspectionchange')!(state);
  snapshot(6);await tick();
  expect(messages.at(-1)).toMatchObject({type:'frame',revision:5,frameId:2,mode:'frozen',snapshotId:'held'});
  events.get('click')!({index:0});
  expect(messages.at(-1)).toMatchObject({type:'event',event:'click',revision:5,frameId:2,snapshotId:'held'});
  state={...state,frameId:3};events.get('selection')!({kind:'linked'});
  expect(messages.at(-2)).toMatchObject({type:'frame',frameId:3,snapshotId:'held'});
  expect(messages.at(-1)).toMatchObject({type:'event',event:'selection',frameId:3});
  const updates=['a','b'].map((id,layerIndex)=>({layerId:id,state:{streamId:`stream-${id}`},channels:['x','y'].map((channel,index)=>({channel,sourceId:`${id}-${channel}`,baseVersion:1,descriptor:{id:`${id}-${channel}`,dtype:'float64',version:2,shape:[1],byteLength:8},bufferIndex:layerIndex*2+index}))}));
  packet({type:'stream-delta',transportVersion:3,transferId:'t7',baseRevision:6,revision:7,transactions:[{revision:7,updates}]},[1,2,3,4].map(value=>new Float64Array([value]).buffer));
  await tick();
  expect(batches).toHaveLength(1);expect(batches[0].updates).toHaveLength(2);expect(batches[0].options).toEqual({waitFor:'accepted'});
  expect(messages).toContainEqual({type:'ack',transferId:'t7',revision:7});
  expect(messages.at(-1)).toMatchObject({type:'frame',revision:5,frameId:3,mode:'frozen'});
  socket.onclose();timers.shift()!();socket.onopen();
  expect(messages.at(-1)).toMatchObject({type:'hello',transportVersion:2,supportedTransportVersions:[2,3],heldFrame:{revision:5,frameId:3,snapshotId:'held'}});
  expect(messages.at(-1).viewId).toMatch(/^view-/);
});
