import {validateDescriptor} from './data';
import {createNormalizer, validateDomain} from './scales';
import type {DataEntry, LineResult, NumericArray, Query} from './types';

const LEAF_ROWS=8, BUILD_ROWS=65_536, ENTRY_BYTES=192;
const METHOD='ordered first/min/max/last per consecutive pixel column; gaps and crossing segments preserved';
const BUDGET_ERROR='Line topology exceeds the vertex budget after extrema-preserving reduction. Increase pointBudget or query a smaller viewport.';
interface Tree {
  minimum:Float64Array; maximum:Float64Array; base:number; builtRows:number;
  complete:boolean; finite:boolean; bytes:number;
}
interface Bounds {minimum:number;maximum:number}

function treeSize(length:number):{base:number;bytes:number} {
  let base=1;while(base<Math.ceil(length/LEAF_ROWS))base*=2;
  return {base,bytes:base*32+ENTRY_BYTES};
}

/** Only the immutable, owned chunk contract is eligible; ordinary mutable arrays are not cached. */
function validChunks(entry:DataEntry):readonly NumericArray[]|undefined {
  const chunks=entry.chunks;
  if(!chunks||!Object.isFrozen(chunks)||entry.descriptor.shape.length!==1)return;
  validateDescriptor(entry.descriptor);
  let length=0;
  for(const chunk of chunks){
    if(!(chunk.buffer instanceof ArrayBuffer))return;
    length+=chunk.length;
  }
  if(length!==entry.descriptor.shape[0])return;
  return chunks;
}

/**
 * Exact fully-visible sorted-line queries over immutable stream chunks.
 * The LRU owns all tree references, including incomplete builds. A suspended
 * generator retains source chunks and output indices, never an evicted tree.
 */
export class LineIndexCache {
  private readonly trees=new Map<NumericArray,Tree>();
  private readonly buffers=new Map<ArrayBuffer,{references:number;bytes:number}>();
  private indexBytes=0;private retainedBytes=0;private builds=0;private hits=0;private epoch=0;
  constructor(private readonly maxBytes=8*1024*1024){
    if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new RangeError('Line index budget must be a nonnegative safe integer.');
  }
  clear():void{this.epoch++;this.trees.clear();this.buffers.clear();this.indexBytes=0;this.retainedBytes=0;}
  diagnostics():{indexBytes:number;retainedBytes:number;builds:number;hits:number}{
    return {indexBytes:this.indexBytes,retainedBytes:this.retainedBytes,builds:this.builds,hits:this.hits};
  }
  private remove(chunk:NumericArray):void {
    const tree=this.trees.get(chunk);if(!tree)return;
    this.trees.delete(chunk);this.indexBytes-=tree.bytes;
    const buffer=chunk.buffer as ArrayBuffer,owned=this.buffers.get(buffer)!;
    if(--owned.references===0){this.retainedBytes-=owned.bytes;this.buffers.delete(buffer);}
  }
  /** Recency is per prepared source chunk, not per pixel-bucket tree read. */
  private touch(chunk:NumericArray):Tree|undefined {
    const tree=this.trees.get(chunk);
    if(tree){this.trees.delete(chunk);this.trees.set(chunk,tree);}
    return tree;
  }
  private reserve(chunk:NumericArray):boolean {
    if(this.touch(chunk))return true;
    const {base,bytes}=treeSize(chunk.length),buffer=chunk.buffer as ArrayBuffer;
    if(bytes+buffer.byteLength>this.maxBytes)return false;
    while(this.indexBytes+this.retainedBytes+bytes+(this.buffers.has(buffer)?0:buffer.byteLength)>this.maxBytes){
      const oldest=this.trees.keys().next();if(oldest.done)return false;this.remove(oldest.value);
    }
    // Charge both index storage and the complete retained backing before allocation.
    this.indexBytes+=bytes;
    const previous=this.buffers.get(buffer);
    if(previous)previous.references++;
    else{this.buffers.set(buffer,{references:1,bytes:buffer.byteLength});this.retainedBytes+=buffer.byteLength;}
    try{
      const minimum=new Float64Array(base*2),maximum=new Float64Array(base*2);
      minimum.fill(Infinity);maximum.fill(-Infinity);
      this.trees.set(chunk,{minimum,maximum,base,builtRows:0,complete:false,finite:true,bytes});this.builds++;
      return true;
    }catch(error){
      this.indexBytes-=bytes;const owned=this.buffers.get(buffer)!;
      if(--owned.references===0){this.buffers.delete(buffer);this.retainedBytes-=owned.bytes;}
      throw error;
    }
  }
  /** Synchronous bounded work; the caller receives no tree reference. */
  private build(chunk:NumericArray,rows:number):{rows:number;complete:boolean}|undefined {
    const tree=this.trees.get(chunk);if(!tree)return;
    if(tree.complete){this.hits++;return {rows:0,complete:true};}
    const end=Math.min(chunk.length,tree.builtRows+rows),start=tree.builtRows;
    for(let i=start;i<end;i++){
      const value=chunk[i],leaf=tree.base+Math.floor(i/LEAF_ROWS);
      if(!Number.isFinite(value)){tree.finite=false;continue;}
      if(value<tree.minimum[leaf])tree.minimum[leaf]=value;
      if(value>tree.maximum[leaf])tree.maximum[leaf]=value;
    }
    tree.builtRows=end;
    if(end===chunk.length){
      for(let node=tree.base-1;node>0;node--){tree.minimum[node]=Math.min(tree.minimum[node*2],tree.minimum[node*2+1]);tree.maximum[node]=Math.max(tree.maximum[node*2],tree.maximum[node*2+1]);}
      tree.complete=true;
    }
    return {rows:end-start,complete:tree.complete};
  }
  private visible(chunk:NumericArray,query:Query):boolean {
    const tree=this.trees.get(chunk);
    return !!tree?.complete&&tree.finite&&tree.minimum[1]>=query.bounds.y[0]&&tree.maximum[1]<=query.bounds.y[1];
  }
  private bounds(chunk:NumericArray,start:number,end:number):Bounds|undefined {
    const tree=this.trees.get(chunk);if(!tree?.complete)return;
    let minimum=Infinity,maximum=-Infinity;
    // At most seven values on either boundary; the interior uses complete leaves.
    while(start<end&&start%LEAF_ROWS){const value=chunk[start++];minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
    while(start<end&&end%LEAF_ROWS){const value=chunk[--end];minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);}
    let left=tree.base+start/LEAF_ROWS,right=tree.base+end/LEAF_ROWS;
    while(left<right){
      if(left%2){minimum=Math.min(minimum,tree.minimum[left]);maximum=Math.max(maximum,tree.maximum[left++]);}
      if(right%2){--right;minimum=Math.min(minimum,tree.minimum[right]);maximum=Math.max(maximum,tree.maximum[right]);}
      left=Math.floor(left/2);right=Math.floor(right/2);
    }
    return {minimum,maximum};
  }
  private firstEqual(chunk:NumericArray,start:number,end:number,target:number,minimum:boolean,normalize:(value:number)=>number):number {
    const tree=this.trees.get(chunk);if(!tree?.complete)return -1;
    const extrema=minimum?tree.minimum:tree.maximum;
    const visit=(node:number,low:number,high:number):number=>{
      if(high<=start||low>=end)return -1;
      // Only complete covered nodes can be pruned: outside values may be more extreme.
      if(start<=low&&high<=end&&normalize(extrema[node])!==target)return -1;
      if(node>=tree.base){for(let i=Math.max(low,start);i<Math.min(high,end);i++)if(normalize(chunk[i])===target)return i;return -1;}
      const middle=(low+high)/2,left=visit(node*2,low,middle);
      return left>=0?left:visit(node*2+1,middle,high);
    };
    return visit(1,0,tree.base*LEAF_ROWS);
  }
  private fits(chunks:readonly NumericArray[]):boolean {
    const seen=new Set<NumericArray>(),buffers=new Set<ArrayBuffer>();let bytes=0;
    for(const chunk of chunks){
      if(!chunk.length||seen.has(chunk))continue;seen.add(chunk);bytes+=treeSize(chunk.length).bytes;
      const buffer=chunk.buffer as ArrayBuffer;
      if(!buffers.has(buffer)){buffers.add(buffer);bytes+=buffer.byteLength;}
      if(bytes>this.maxBytes)return false;
    }
    return true;
  }
  *plan(x:DataEntry,y:DataEntry,query:Query,sorted:boolean):Generator<void,LineResult|undefined> {
    const epoch=this.epoch;
    validateDomain(query.bounds.x,query.xScale);validateDomain(query.bounds.y,query.yScale);
    if(!Number.isFinite(query.width)||!Number.isFinite(query.height)||query.width<=0||query.height<=0)throw new RangeError('Viewport dimensions must be positive.');
    if(!Number.isSafeInteger(query.pointBudget)||query.pointBudget<1)throw new RangeError('pointBudget must be a positive integer.');
    if(!['auto','points','density'].includes(query.mode))throw new RangeError('Unknown representation mode.');
    if(!sorted||query.xScale==='log'||query.yScale==='log'||query.width>8192)return;
    const xs=validChunks(x),ys=validChunks(y),length=x.descriptor.shape[0];
    if(!xs||!ys||length!==y.descriptor.shape[0]||length>0xffff_ffff||!length||length<query.width*4)return;
    // Ascending metadata guarantees finite ordered interiors. Verify endpoints and
    // storage coverage without rescanning immutable x chunks on every frame.
    let previous=-Infinity,first=NaN,last=NaN;
    for(const chunk of xs){
      if(!chunk.length)continue;
      const low=chunk[0],high=chunk[chunk.length-1];
      if(!Number.isFinite(low)||!Number.isFinite(high)||low<previous||low>high)return;
      if(Number.isNaN(first))first=low;last=high;previous=high;
    }
    if(first<query.bounds.x[0]||last>query.bounds.x[1]||!Number.isFinite(first)||!this.fits(ys))return;
    let work=0;
    for(const chunk of ys){
      if(!chunk.length)continue;
      if(!this.reserve(chunk))return;
      while(true){
        const step=this.build(chunk,BUILD_ROWS-work);if(!step)return;
        work+=step.rows;
        if(work===BUILD_ROWS){work=0;yield;if(epoch!==this.epoch)return;}
        if(step.complete)break;
      }
    }
    for(const chunk of ys)if(chunk.length&&!this.visible(chunk,query))return;
    const normalizeX=createNormalizer(query.bounds.x,query.xScale),normalizeY=createNormalizer(query.bounds.y,query.yScale);
    const column=(value:number)=>Math.floor(Math.max(-1,Math.min(query.width,normalizeX(value)*query.width)));
    const segment:number[]=[];
    let begin=0,xChunk=0,xStart=0,yChunk=0,yStart=0,buckets=0;
    while(begin<length){
      while(xStart+xs[xChunk].length<=begin)xStart+=xs[xChunk++].length;
      const current=column(xs[xChunk][begin-xStart]);let end=length;
      // Sorted chunks are visited only forward. Skip complete same-column chunks,
      // then binary-search the crossing chunk using the exact original column rule.
      let searchChunk=xChunk,searchStart=xStart,low=begin-xStart+1;
      while(searchChunk<xs.length){
        const chunk=xs[searchChunk];
        if(chunk.length&&column(chunk[chunk.length-1])>current){
          let high=chunk.length;
          while(low<high){const middle=low+Math.floor((high-low)/2);if(column(chunk[middle])<=current)low=middle+1;else high=middle;}
          end=searchStart+low;break;
        }
        searchStart+=chunk.length;searchChunk++;low=0;
      }
      xChunk=searchChunk;xStart=searchStart;
      while(yChunk<ys.length&&yStart+ys[yChunk].length<=begin)yStart+=ys[yChunk++].length;
      let chunkIndex=yChunk,chunkStart=yStart,minValue=Infinity,maxValue=-Infinity;
      while(chunkStart<end){
        const chunk=ys[chunkIndex++],finish=chunkStart+chunk.length;
        if(chunk.length){const bounds=this.bounds(chunk,Math.max(0,begin-chunkStart),Math.min(chunk.length,end-chunkStart));if(!bounds)return;minValue=Math.min(minValue,bounds.minimum);maxValue=Math.max(maxValue,bounds.maximum);}
        chunkStart=finish;
      }
      const minY=normalizeY(minValue),maxY=normalizeY(maxValue);let min=-1,max=-1;
      chunkIndex=yChunk;chunkStart=yStart;
      while(chunkStart<end&&(min<0||max<0)){
        const chunk=ys[chunkIndex++],finish=chunkStart+chunk.length,start=Math.max(0,begin-chunkStart),stop=Math.min(chunk.length,end-chunkStart);
        if(chunk.length){
          if(min<0){const index=this.firstEqual(chunk,start,stop,minY,true,normalizeY);if(index>=0)min=chunkStart+index;}
          if(max<0){const index=this.firstEqual(chunk,start,stop,maxY,false,normalizeY);if(index>=0)max=chunkStart+index;}
        }
        chunkStart=finish;
      }
      if(min<0||max<0)return;
      const retained=[begin,min,max,end-1].sort((a,b)=>a-b);
      for(const index of retained){
        if(segment[segment.length-1]===index)continue;
        if(segment.length>=query.pointBudget)throw new RangeError(BUDGET_ERROR);
        segment.push(index);
      }
      begin=end;
      if(++buckets%1024===0){yield;if(epoch!==this.epoch)return;}
    }
    return {kind:'line',segments:[Uint32Array.from(segment)],info:{kind:'line',total:length,visible:length,rendered:segment.length,exact:segment.length===length,method:METHOD}};
  }
}
