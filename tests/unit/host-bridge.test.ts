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
  const fig={on:(event:string,callback:(value:unknown)=>void)=>events.set(event,callback),applySnapshot:()=>{},mount:()=>{},ready:()=>render.promise,close:()=>{}};
  let socket:any;
  class Socket{
    static OPEN=1;readyState=1;onmessage?:(message:any)=>void;
    constructor(){socket=this;}
    send(value:string){messages.push(JSON.parse(value));}
    close(){}
  }
  const source=readFileSync(new URL('../../python/vesora/_assets/host.js',import.meta.url),'utf8').replace(/^import .*;\s*/, '');
  runInNewContext(source,{figure:()=>fig,URL,AbortController,WebSocket:Socket,
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
