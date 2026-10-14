import type {Bounds,NumericArray,ScaleKind} from './types';
import {normalize} from './scales';

export interface SelectionResult {kind:'selection';count:number;indices:Uint32Array;truncated:boolean}

/** Exact membership with a bounded preview; yielding also makes fallback selection cancellable. */
export function* selectionSteps(x:NumericArray,y:NumericArray,bounds:Bounds,color?:NumericArray):Generator<void,SelectionResult>{
  if(x.length!==y.length||color&&color.length!==x.length)throw new RangeError('Selection channels must have equal lengths');
  let count=0;const indices:number[]=[];
  for(let start=0;start<x.length;start+=65536){
    for(let i=start;i<Math.min(x.length,start+65536);i++)if(x[i]>=bounds.x[0]&&x[i]<=bounds.x[1]&&y[i]>=bounds.y[0]&&y[i]<=bounds.y[1]&&(!color||Number.isFinite(color[i]))){count++;if(indices.length<10000)indices.push(i);}
    yield;
  }
  return {kind:'selection',count,indices:Uint32Array.from(indices),truncated:count>indices.length};
}

export interface HoverIndex {columns:number;cells:Map<number,number[]>}
/** Screen cells bound pointer work to nearby rendered vertices, prepared cooperatively. */
export function* hoverIndexSteps(x:NumericArray,y:NumericArray,groups:readonly Uint32Array[],bounds:Bounds,width:number,height:number,xScale:ScaleKind,yScale:ScaleKind):Generator<void,HoverIndex>{
  const columns=Math.ceil((width+16)/16)+2,cells=new Map<number,number[]>();let visited=0;
  for(const group of groups)for(const index of group){
    const px=normalize(x[index],bounds.x,xScale)*width,py=(1-normalize(y[index],bounds.y,yScale))*height;
    if(Number.isFinite(px)&&Number.isFinite(py)&&px>=-8&&px<=width+8&&py>=-8&&py<=height+8){const key=Math.floor(px/16)+1+(Math.floor(py/16)+1)*columns;let cell=cells.get(key);if(!cell){cell=[];cells.set(key,cell);}cell.push(index);}
    if(++visited%8192===0)yield;
  }
  return {columns,cells};
}

export function hoverCandidates(index:HoverIndex,x:number,y:number):number[]{
  const col=Math.floor(x/16)+1,row=Math.floor(y/16)+1,result:number[]=[];
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const value of index.cells.get(col+dx+(row+dy)*index.columns)??[])result.push(value);
  return result;
}
