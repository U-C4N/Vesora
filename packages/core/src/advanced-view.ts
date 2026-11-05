import {normalize} from './scales';
import type {PreparedAdvanced} from './advanced';
import type {Bounds, HoverEvent, LayerSpec, ViewSpec} from './types';

export interface AdvancedViewport {left:number;top:number;width:number;height:number}
type Mark=PreparedAdvanced['marks'][number];

export function advancedMarkBounds(mark:Mark):Bounds{
  if(mark.kind==='point')return {x:[mark.x,mark.x],y:[mark.y,mark.y]};
  if(mark.kind==='polygon')return {x:[Math.min(...mark.points.map(p=>p[0])),Math.max(...mark.points.map(p=>p[0]))],y:[Math.min(...mark.points.map(p=>p[1])),Math.max(...mark.points.map(p=>p[1]))]};
  return {x:[Math.min(mark.x0,mark.x1),Math.max(mark.x0,mark.x1)],y:[Math.min(mark.y0,mark.y1),Math.max(mark.y0,mark.y1)]};
}
function distanceToSegment(x:number,y:number,a:[number,number],b:[number,number]):number{
  const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy,t=den?Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/den)):0;
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
}
function insidePolygon(x:number,y:number,points:[number,number][]):boolean{
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const [a,b]=[points[i],points[j]];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;
}

/** Picking is performed against the completed frame's owned prepared marks. */
export function pickAdvanced(prepared:PreparedAdvanced,layer:LayerSpec,bounds:Bounds,view:ViewSpec,r:AdvancedViewport,x:number,y:number):Omit<HoverEvent,'pointerPosition'>|undefined{
  const point=(a:number,b:number):[number,number]=>[r.left+normalize(a,bounds.x,view.xScale)*r.width,r.top+(1-normalize(b,bounds.y,view.yScale))*r.height];
  let best=8,bestPriority=Infinity,bestMark:Mark|undefined;
  for(const mark of prepared.marks){
    let distance=Infinity;
    if(mark.kind==='point'){const p=point(mark.x,mark.y);distance=Math.max(0,Math.hypot(p[0]-x,p[1]-y)-(layer.style.size??5)/2);}
    else if(mark.kind==='segment')distance=distanceToSegment(x,y,point(mark.x0,mark.y0),point(mark.x1,mark.y1));
    else if(mark.kind==='rect'){
      const a=point(mark.x0,mark.y0),b=point(mark.x1,mark.y1),left=Math.min(a[0],b[0]),right=Math.max(a[0],b[0]),top=Math.min(a[1],b[1]),bottom=Math.max(a[1],b[1]);
      distance=Math.hypot(Math.max(left-x,0,x-right),Math.max(top-y,0,y-bottom));
    }else{const polygon=mark.points.map(p=>point(p[0],p[1]));if(insidePolygon(x,y,polygon))distance=0;}
    const priority=mark.kind==='point'?0:mark.kind==='segment'?1:2;
    if(distance<=8&&(distance<best-1e-7||Math.abs(distance-best)<=1e-7&&priority<bestPriority)){best=distance;bestPriority=priority;bestMark=mark;}
  }
  if(!bestMark)return;
  const item=prepared.items[bestMark.itemIndex]??{},cell=layer.kind==='contour',metadata={...item};
  if(Array.isArray(metadata.sourceIndices)){const indices=metadata.sourceIndices;metadata.sourceIndices=indices.slice(0,10000);metadata.sourceCount=indices.length;metadata.truncated=indices.length>10000;}
  return {kind:cell?'cell':'point',layerId:layer.id,...metadata,index:typeof item.index==='number'?item.index:bestMark.sourceIndex,sourceIndex:bestMark.sourceIndex,chartKind:layer.kind,sourceKind:cell?'cell':Array.isArray(item.sourceIndices)||Array.isArray(item.indices)?'aggregate':'sample',...(bestMark.scalar===undefined?{}:{value:bestMark.scalar})};
}

export function selectAdvanced(prepared:PreparedAdvanced,bounds:Bounds):number[]{
  const selected=new Set<number>();
  for(const mark of prepared.marks){
    const b=advancedMarkBounds(mark);
    if(b.x[0]>bounds.x[1]||b.x[1]<bounds.x[0]||b.y[0]>bounds.y[1]||b.y[1]<bounds.y[0])continue;
    const item=prepared.items[mark.itemIndex];
    const indices=Array.isArray(item?.sourceIndices)?item.sourceIndices:Array.isArray(item?.indices)?item.indices:typeof mark.sourceIndex==='number'?[mark.sourceIndex]:typeof item?.index==='number'?[item.index]:[];
    for(const index of indices)if(typeof index==='number')selected.add(index);
  }return [...selected].sort((a,b)=>a-b);
}

/** Filter mark membership, retaining the original item and source identity space. */
export function highlightAdvanced(prepared:PreparedAdvanced,rows:ReadonlySet<number>):PreparedAdvanced{
  return {...prepared,marks:prepared.marks.filter(mark=>{
    const item=prepared.items[mark.itemIndex];
    const indices=Array.isArray(item?.sourceIndices)?item.sourceIndices:item?.indices;
    return Array.isArray(indices)?indices.some(index=>typeof index==='number'&&rows.has(index)):typeof mark.sourceIndex==='number'?rows.has(mark.sourceIndex):typeof item?.index==='number'&&rows.has(item.index);
  })};
}

export function advancedTooltip(hit:Omit<HoverEvent,'pointerPosition'>):string{
  const hidden=new Set(['kind','layerId','panelId','index','sourceIndex','indices','rowIds','sourceKind','chartKind']);
  const values=Object.entries(hit).filter(([key,value])=>!hidden.has(key)&&value!==undefined&&typeof value!=='object').map(([key,value])=>`${key}: ${typeof value==='number'?Number(value.toPrecision(7)):value}`);
  return `${String(hit.chartKind)} · ${values.slice(0,8).join(' · ')}`;
}
