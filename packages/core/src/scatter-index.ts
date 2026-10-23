import {numericReader} from './data';
import {createNormalizer} from './scales';
import type {DataEntry,PointPlan,Query} from './types';

const CELLS=64,CHUNK=65_536,MIN_ROWS=4096,DEFAULT_BYTES=8*1024*1024;
interface Grid {
  xId:string;yId:string;length:number;bytes:number;indices:Uint32Array;offsets:Uint32Array;cursor?:Uint32Array;
  minimumX:number;maximumX:number;minimumY:number;maximumY:number;phase:'bounds'|'counts'|'indices'|'ready';position:number;
}
const cell=(value:number,low:number,high:number)=>high===low?0:Math.max(0,Math.min(CELLS-1,Math.floor((value-low)/(high-low)*CELLS)));
const owned=(entry:DataEntry)=>!!entry.chunks&&Object.isFrozen(entry.chunks)&&entry.chunks.every(chunk=>chunk.buffer instanceof ArrayBuffer);

/** Exact raw-coordinate bins, bounded independently from result/line caches.
 * Entries retain indices and scalar bounds, never source arrays. Mutable caller
 * storage is ineligible; workers explicitly opt in for their owned source copies.
 */
export class ScatterIndexCache {
  private grids=new Map<string,Grid>();
  private identities=new WeakMap<DataEntry,number>();private serial=0;private epoch=0;
  private observed=new WeakMap<DataEntry,WeakMap<DataEntry,string>>();
  private bytes=0;private builds=0;private buildRows=0;private warmQueries=0;private scanQueries=0;private candidateRows=0;
  private lastCandidateRows=0;private lastMode:'scan'|'cold-index'|'warm-index'='scan';
  constructor(private readonly maximumBytes=DEFAULT_BYTES){if(!Number.isSafeInteger(maximumBytes)||maximumBytes<0)throw new RangeError('Scatter index budget must be a nonnegative safe integer.');}
  diagnostics(){return {maximumBytes:this.maximumBytes,indexBytes:this.bytes,retainedBytes:0,entries:this.grids.size,builds:this.builds,buildRows:this.buildRows,warmQueries:this.warmQueries,scanQueries:this.scanQueries,candidateRows:this.candidateRows,lastCandidateRows:this.lastCandidateRows,lastMode:this.lastMode};}
  clear():void{this.epoch++;this.grids.clear();this.observed=new WeakMap();this.bytes=0;}
  release(id:string):void{this.epoch++;for(const [key,grid]of this.grids)if(grid.xId===id||grid.yId===id)this.remove(key);}
  private remove(key:string):void{const grid=this.grids.get(key);if(grid){this.bytes-=grid.bytes;this.grids.delete(key);}}
  private identity(entry:DataEntry):number{let id=this.identities.get(entry);if(id===undefined){id=++this.serial;this.identities.set(entry,id);}return id;}
  private scan():undefined{this.scanQueries++;this.lastMode='scan';this.lastCandidateRows=0;return undefined;}
  private reserve(key:string,x:DataEntry,y:DataEntry):boolean{
    const length=x.descriptor.shape[0],bytes=length*4+(CELLS*CELLS+1)*8+256+2*(key.length+x.descriptor.id.length+y.descriptor.id.length);
    if(bytes>this.maximumBytes)return false;
    while(this.bytes+bytes>this.maximumBytes&&this.grids.size)this.remove(this.grids.keys().next().value!);
    const grid:Grid={xId:x.descriptor.id,yId:y.descriptor.id,length,bytes,indices:new Uint32Array(length),offsets:new Uint32Array(CELLS*CELLS+1),cursor:new Uint32Array(CELLS*CELLS+1),minimumX:Infinity,maximumX:-Infinity,minimumY:Infinity,maximumY:-Infinity,phase:'bounds',position:0};
    this.grids.set(key,grid);this.bytes+=bytes;this.builds++;return true;
  }
  /** No grid reference crosses a cooperative yield, so an evicted build releases its arrays. */
  private build(key:string,x:ReturnType<typeof numericReader>,y:ReturnType<typeof numericReader>):boolean|undefined{
    const grid=this.grids.get(key);if(!grid)return;
    if(grid.phase==='ready')return true;
    const end=Math.min(grid.position+CHUNK,grid.length);this.buildRows+=end-grid.position;
    for(let i=grid.position;i<end;i++){
      const a=x.get(i),b=y.get(i);if(!Number.isFinite(a)||!Number.isFinite(b))continue;
      if(grid.phase==='bounds'){
        if(a<grid.minimumX)grid.minimumX=a;if(a>grid.maximumX)grid.maximumX=a;
        if(b<grid.minimumY)grid.minimumY=b;if(b>grid.maximumY)grid.maximumY=b;
      }else{
        const bin=cell(b,grid.minimumY,grid.maximumY)*CELLS+cell(a,grid.minimumX,grid.maximumX);
        if(grid.phase==='counts')grid.offsets[bin+1]++;
        else grid.indices[grid.cursor![bin]++]=i;
      }
    }
    grid.position=end;if(end<grid.length)return false;
    if(grid.phase==='bounds'){
      // Degenerate constant axes are valid. Extreme overflowing spans fall back to the original planner.
      if(!Number.isFinite(grid.maximumX-grid.minimumX)||!Number.isFinite(grid.maximumY-grid.minimumY)){this.remove(key);return;}
      grid.phase='counts';grid.position=0;return false;
    }
    if(grid.phase==='counts'){
      for(let i=1;i<grid.offsets.length;i++)grid.offsets[i]+=grid.offsets[i-1];
      grid.cursor!.set(grid.offsets);grid.phase='indices';grid.position=0;return false;
    }
    grid.phase='ready';this.bytes-=grid.cursor!.byteLength;grid.bytes-=grid.cursor!.byteLength;grid.cursor=undefined;return true;
  }
  private ranges(key:string,query:Query):{bins:number[];count:number}|undefined{
    const grid=this.grids.get(key);if(!grid||grid.phase!=='ready')return;
    // Include adjacent cells to preserve the baseline normalizer's rounding at viewport boundaries.
    const x0=Math.max(0,cell(query.bounds.x[0],grid.minimumX,grid.maximumX)-1),x1=Math.min(CELLS-1,cell(query.bounds.x[1],grid.minimumX,grid.maximumX)+1);
    const y0=Math.max(0,cell(query.bounds.y[0],grid.minimumY,grid.maximumY)-1),y1=Math.min(CELLS-1,cell(query.bounds.y[1],grid.minimumY,grid.maximumY)+1);
    const bins:number[]=[];let count=0;
    for(let row=y0;row<=y1;row++)for(let column=x0;column<=x1;column++){const bin=row*CELLS+column;bins.push(bin);count+=grid.offsets[bin+1]-grid.offsets[bin];}
    return {bins,count};
  }
  private visit(key:string,bins:number[],state:{bin:number;offset:number},callback:(index:number)=>void):boolean|undefined{
    const grid=this.grids.get(key);if(!grid||grid.phase!=='ready')return;
    let work=0;
    while(state.bin<bins.length&&work<CHUNK){
      const bin=bins[state.bin],end=grid.offsets[bin+1];
      if(state.offset<grid.offsets[bin])state.offset=grid.offsets[bin];
      while(state.offset<end&&work<CHUNK){callback(grid.indices[state.offset++]);work++;}
      if(state.offset===end){state.bin++;state.offset=0;}
    }
    return state.bin===bins.length;
  }
  *plan(x:DataEntry,y:DataEntry,query:Query,workerOwned=false):Generator<void,PointPlan|undefined>{
    const length=x.descriptor.shape[0],epoch=this.epoch;
    if(x.descriptor.shape.length!==1||y.descriptor.shape.length!==1||length!==y.descriptor.shape[0]||length<MIN_ROWS||length>0xffff_ffff||!workerOwned&&(!owned(x)||!owned(y)))return this.scan();
    const versions=`${x.descriptor.version}:${y.descriptor.version}`,key=`${this.identity(x)}:${this.identity(y)}:${versions}:${length}`;
    let seen=this.observed.get(x);if(!seen){seen=new WeakMap();this.observed.set(x,seen);}
    // One-off/full-scene queries keep the existing scan. Build only after this version pair is queried again.
    if(seen.get(y)!==versions){seen.set(y,versions);return this.scan();}
    const cold=!this.grids.has(key);if(cold&&!this.reserve(key,x,y))return this.scan();
    const xs=numericReader(x),ys=numericReader(y);
    if(this.grids.get(key)?.phase!=='ready')while(true){
      const ready=this.build(key,xs,ys);if(ready===undefined)return this.scan();if(ready)break;
      yield;if(epoch!==this.epoch)return this.scan();
    }
    const range=this.ranges(key,query);if(!range||range.count>length*.6)return this.scan();
    // Recency changes only once per query, not on each sampled source read.
    {const grid=this.grids.get(key)!;this.grids.delete(key);this.grids.set(key,grid);}
    const normalizeX=createNormalizer(query.bounds.x,query.xScale),normalizeY=createNormalizer(query.bounds.y,query.yScale);
    const columns=Math.max(1,Math.min(1024,Math.ceil(query.width/4))),rows=Math.max(1,Math.min(1024,Math.ceil(query.height/4))),counts=new Uint32Array(columns*rows);
    let count=0,max=0;const state={bin:0,offset:0};
    while(true){
      const done=this.visit(key,range.bins,state,index=>{
        const px=normalizeX(xs.get(index)),py=normalizeY(ys.get(index));if(!(px>=0&&px<=1&&py>=0&&py<=1))return;
        count++;const column=Math.min(columns-1,Math.floor(px*columns)),row=Math.min(rows-1,Math.floor(py*rows)),value=++counts[row*columns+column];if(value>max)max=value;
      });
      if(done===undefined)return this.scan();if(done)break;yield;if(epoch!==this.epoch)return this.scan();
    }
    const threshold=Math.max(1,Math.min(query.pointBudget,query.width*query.height/8));
    const density=query.mode==='density'||query.mode==='auto'&&(count>query.pointBudget||count>threshold*(query.previous==='density'?.6:1));
    let result:PointPlan;
    if(density){
      let occupied=0;for(const count of counts)if(count)occupied++;
      result={kind:'density',counts,columns,rows,max,bounds:{x:[...query.bounds.x],y:[...query.bounds.y]},info:{kind:'density',total:length,visible:count,rendered:occupied,exact:true,method:'count aggregation (screen-space cells; all visible samples counted)'}};
    }else{
      if(count>query.pointBudget)throw new RangeError(`Exact point rendering requires ${count} points, exceeding the point budget of ${query.pointBudget}. Use auto/density or raise the budget.`);
      const indices=new Uint32Array(count);let cursor=0;state.bin=0;state.offset=0;
      while(true){
        const done=this.visit(key,range.bins,state,index=>{const px=normalizeX(xs.get(index)),py=normalizeY(ys.get(index));if(px>=0&&px<=1&&py>=0&&py<=1)indices[cursor++]=index;});
        if(done===undefined)return this.scan();if(done)break;yield;if(epoch!==this.epoch)return this.scan();
      }
      indices.sort();result={kind:'points',indices,info:{kind:'points',total:length,visible:count,rendered:count,exact:true,method:'original points'}};
    }
    this.lastMode=cold?'cold-index':'warm-index';if(!cold)this.warmQueries++;
    this.lastCandidateRows=range.count;this.candidateRows+=range.count;return result;
  }
}
