import type {StreamState} from '@vesora/core';

type Window = Record<string, StreamState>;
interface Chunk<Row> {first: number; rows: readonly Row[]}
interface Epoch<Row> {ids: Set<string>; chunks: Chunk<Row>[]}

/** Application row identity follows retained, rendering and displayed windows,
 * rather than whichever producer state happens to be newest at hover time. */
export class RetainedRows<Row extends object> {
  private epochs: Epoch<Row>[] = [];
  private windows: Record<'live'|'pending'|'displayed', Window> = {live:{},pending:{},displayed:{}};

  replace(rows:readonly Row[], streams:Window):void {
    const state=Object.values(streams)[0];
    if(state)this.epochs.push({ids:new Set(Object.values(streams).map(stream=>stream.streamId)),chunks:[{first:state.nextSequence-state.retained,rows:rows.slice(-state.retained)}]});
    this.windows.live=streams;this.prune();
  }

  append(rows:readonly Row[], before:StreamState, streams:Window):void {
    const epoch=this.epochs.find(value=>value.ids.has(before.streamId));
    const after=Object.values(streams)[0];
    if(epoch&&after&&after.nextSequence>before.nextSequence){
      // Oversized batches may be accepted but immediately evicted. They never
      // need application row storage beyond the retained suffix.
      const retained=Math.min(rows.length,after.retained);
      if(retained)epoch.chunks.push({first:after.nextSequence-retained,rows:rows.slice(-retained)});
    }
    this.windows.live=streams;this.prune();
  }

  pin(kind:'pending'|'displayed',streams:Window):void {
    this.windows[kind]=streams;
    if(kind==='displayed')this.windows.pending={};
    this.prune();
  }

  row(streamId:string,sequence:number):Row|undefined {
    const epoch=this.epochs.find(value=>value.ids.has(streamId));if(!epoch)return;
    if(!Object.values(this.windows).some(window=>Object.values(window).some(state=>state.streamId===streamId&&sequence>=state.nextSequence-state.retained&&sequence<state.nextSequence)))return;
    let low=0,high=epoch.chunks.length;
    while(low<high){const mid=(low+high)>>>1;if(epoch.chunks[mid].first<=sequence)low=mid+1;else high=mid;}
    const chunk=epoch.chunks[low-1];return chunk?.rows[sequence-chunk.first];
  }

  liveRows():readonly Row[] {
    const state=Object.values(this.windows.live)[0];if(!state)return [];
    const epoch=this.epochs.find(value=>value.ids.has(state.streamId));if(!epoch)return [];
    const start=state.nextSequence-state.retained,end=state.nextSequence;
    return epoch.chunks.flatMap(chunk=>chunk.rows.slice(Math.max(0,start-chunk.first),Math.max(0,Math.min(chunk.rows.length,end-chunk.first))));
  }

  someLive(predicate:(row:Row)=>boolean):boolean {
    const state=Object.values(this.windows.live)[0];if(!state)return false;
    const epoch=this.epochs.find(value=>value.ids.has(state.streamId));if(!epoch)return false;
    const start=state.nextSequence-state.retained,end=state.nextSequence;
    for(const chunk of epoch.chunks)for(let index=Math.max(0,start-chunk.first);index<Math.min(chunk.rows.length,end-chunk.first);index++)if(predicate(chunk.rows[index]))return true;
    return false;
  }

  /** Number of retained references, for resource regression tests. */
  get retainedReferences():number{return this.epochs.reduce((sum,epoch)=>sum+epoch.chunks.reduce((count,chunk)=>count+chunk.rows.length,0),0);}
  clear():void{this.epochs=[];this.windows={live:{},pending:{},displayed:{}};}

  private prune():void {
    const states=Object.values(this.windows).flatMap(window=>Object.values(window));
    this.epochs=this.epochs.filter(epoch=>{
      const ranges=states.filter(state=>epoch.ids.has(state.streamId)&&state.retained).map(state=>[state.nextSequence-state.retained,state.nextSequence] as const);
      epoch.chunks=epoch.chunks.flatMap(chunk=>{
        const intersections=ranges.map(([first,end])=>[Math.max(first,chunk.first),Math.min(end,chunk.first+chunk.rows.length)] as [number,number]).filter(([first,end])=>first<end).sort((a,b)=>a[0]-b[0]);
        const merged:Array<[number,number]>=[];for(const range of intersections){const prior=merged.at(-1);if(prior&&prior[1]>=range[0])prior[1]=Math.max(prior[1],range[1]);else merged.push([...range]);}
        return merged.map(([first,end])=>first===chunk.first&&end===chunk.first+chunk.rows.length?chunk:{first,rows:chunk.rows.slice(first-chunk.first,end-chunk.first)});
      });
      return epoch.chunks.length>0||states.some(state=>epoch.ids.has(state.streamId));
    });
  }
}
