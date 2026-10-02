import type {DataRegistry} from './data';
import {normalize, extent} from './scales';
import {parseColor, colorMap} from './color';
import type {Bounds, LayerSpec, NumericArray, PointPlan, LineResult, ViewSpec, Domain} from './types';
import type {Geometry} from './renderer';

export function gridEdges(values: NumericArray, scale:'linear'|'log'): Float64Array {
  const n=values.length,out=new Float64Array(n+1);
  if(!n)return out;
  for(let i=0;i<n;i++){
    if(!Number.isFinite(values[i])||(scale==='log'&&values[i]<=0))throw new Error('Grid coordinates must be finite and valid for the selected scale');
    if(i&&values[i]<=values[i-1])throw new Error('Grid coordinates must be strictly increasing');
  }
  if(n===1){const domain=extent(values,scale);out[0]=domain[0];out[1]=domain[1];return out;}
  if(scale==='linear'){
    const halfGap=(a:number,b:number)=>Number.isFinite(b-a)?(b-a)/2:b/2-a/2;
    out[0]=Math.max(-Number.MAX_VALUE,values[0]-halfGap(values[0],values[1]));
    for(let i=1;i<n;i++)out[i]=values[i-1]+halfGap(values[i-1],values[i]);
    out[n]=Math.min(Number.MAX_VALUE,values[n-1]+halfGap(values[n-2],values[n-1]));
  }else{
    const between=(a:number,b:number,t:number)=>{
      const relative=(b-a)/a;
      const value=Number.isFinite(relative)?a+a*Math.expm1(t*Math.log1p(relative)):Math.exp((1-t)*Math.log(a)+t*Math.log(b));
      return Math.max(Number.MIN_VALUE,Math.min(Number.MAX_VALUE,value));
    };
    out[0]=between(values[0],values[1],-.5);
    for(let i=1;i<n;i++)out[i]=between(values[i-1],values[i],.5);
    out[n]=between(values[n-2],values[n-1],1.5);
  }
  return out;
}

/** Clip in CPU float64 coordinates before constructing GPU float32 geometry. */
function clipLine(ax:number,ay:number,bx:number,by:number):[number,number,number,number,number,number]|undefined{
  if(![ax,ay,bx,by].every(Number.isFinite))return undefined;
  let low=0,high=1,lowSide=-1,highSide=-1;
  const scale=Math.max(1,Math.abs(ax),Math.abs(ay),Math.abs(bx),Math.abs(by));
  const sx=ax/scale,sy=ay/scale,dx=bx/scale-sx,dy=by/scale-sy,edge=1/scale;
  const p=[-dx,dx,-dy,dy],q=[sx+edge,edge-sx,sy+edge,edge-sy];
  for(let i=0;i<4;i++){
    if(p[i]===0){if(q[i]<0)return undefined;continue;}
    const t=q[i]/p[i];
    if(p[i]<0&&t>low){low=t;lowSide=i;}else if(p[i]>0&&t<high){high=t;highSide=i;}
    if(low>high)return undefined;
  }
  const endpoint=(side:number,x:number,y:number):[number,number]=>{
    if(side<0)return [x,y];
    const boundary=side%2===0?-1:1;
    // Set the clipped axis exactly. Parametric interpolation alone collapses
    // both endpoints when a tiny viewport intersects an enormous segment.
    if(side<2){const slope=dy/dx;return [boundary,(sy-sx*slope)*scale+boundary*slope];}
    const slope=dx/dy;return [(sx-sy*slope)*scale+boundary*slope,boundary];
  };
  const coordinates=[...endpoint(lowSide,ax,ay),...endpoint(highSide,bx,by)].map(value=>Math.max(-1,Math.min(1,value)));
  return [...coordinates,low,high] as [number,number,number,number,number,number];
}
export function buildGeometry(layer:LayerSpec, registry:DataRegistry, bounds:Bounds, zDomain:Domain, view:ViewSpec, width:number,height:number,plan?:PointPlan|LineResult):Geometry {
  const x=registry.get(layer.data.x).values,y=registry.get(layer.data.y).values;
  const z=layer.data.z?registry.get(layer.data.z).values:undefined;
  const scalar=layer.data.color?registry.get(layer.data.color).values:undefined;
  const base=parseColor(layer.style.color,layer.style.opacity??1);
  // Avoid boxed number arrays and an additional full-size float32 conversion.
  // A per-layer cap bounds CPU and GPU geometry even for pathological topology.
  const vertexBudget=2_000_000;
  let capacity=1024,count=0,positions=new Float32Array(capacity*3),colors=new Float32Array(capacity*4);
  const scalarDomain=layer.style.colorDomain??extent(scalar??z??new Float64Array([0,1]));
  const nX=(v:number)=>normalize(v,bounds.x,view.xScale)*2-1;
  const nY=(v:number)=>normalize(v,bounds.y,view.yScale)*2-1;
  const nZ=(v:number)=>normalize(v,zDomain,view.zScale)*2-1;
  const color=(v?:number)=>v===undefined?base:colorMap(v,scalarDomain,layer.style.colormap).map((c,i)=>i===3?(layer.style.opacity??1):c);
  const push=(a:number,b:number,c:number,rgba:number[])=>{
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||Math.max(Math.abs(a),Math.abs(b),Math.abs(c))>3.4028234663852886e38)throw new RangeError('Geometry exceeds float32 coordinates after projection. Narrow the data domain.');
    if(count===vertexBudget)throw new RangeError('Layer exceeds the renderer geometry budget of 2,000,000 vertices. Reduce the grid or viewport.');
    if(count===capacity){capacity=Math.min(vertexBudget,capacity*2);const p=new Float32Array(capacity*3),c=new Float32Array(capacity*4);p.set(positions);c.set(colors);positions=p;colors=c;}
    positions[count*3]=a;positions[count*3+1]=b;positions[count*3+2]=c;colors.set(rgba,count*4);count++;
  };
  const quad=(x0:number,y0:number,x1:number,y1:number,rgba:number[])=>{
    push(x0,y0,0,rgba);push(x1,y0,0,rgba);push(x1,y1,0,rgba);push(x0,y0,0,rgba);push(x1,y1,0,rgba);push(x0,y1,0,rgba);
  };
  if(plan?.kind==='density'){
    const domain:Domain=layer.style.colorDomain??[0,Math.max(1,plan.max)];
    for(let r=0;r<plan.rows;r++)for(let c=0;c<plan.columns;c++){
      const count=plan.counts[r*plan.columns+c];if(!count)continue;
      const rgba=colorMap(count,domain,layer.style.colormap);rgba[3]=layer.style.opacity??1;
      quad(c/plan.columns*2-1,r/plan.rows*2-1,(c+1)/plan.columns*2-1,(r+1)/plan.rows*2-1,rgba);
    }
  }else if(layer.kind==='line'&&plan?.kind==='line'){
    const half=(layer.style.width??1.5)/2;
    for(const segment of plan.segments)for(let j=1;j<segment.length;j++){
      const a=segment[j-1],b=segment[j],clipped=clipLine(nX(x[a]),nY(y[a]),nX(x[b]),nY(y[b]));if(!clipped)continue;
      if(scalar){let invalid=false;for(let i=a;i<=b;i++)if(!Number.isFinite(scalar[i])){invalid=true;break;}if(invalid)continue;}
      const [x0,y0,x1,y1,t0,t1]=clipped;
      const dx=(x1-x0)*width/2,dy=(y1-y0)*height/2,len=Math.hypot(dx,dy);if(!len)continue;
      const ox=-dy/len*half*2/width,oy=dx/len*half*2/height;
      const start=color(scalar?.[a]),end=color(scalar?.[b]);
      const first=start.map((value,i)=>value+(end[i]-value)*t0),last=start.map((value,i)=>value+(end[i]-value)*t1);
      push(x0+ox,y0+oy,0,first);push(x0-ox,y0-oy,0,first);push(x1-ox,y1-oy,0,last);
      push(x0+ox,y0+oy,0,first);push(x1-ox,y1-oy,0,last);push(x1+ox,y1+oy,0,last);
    }
  }else if(layer.kind==='heatmap'){
    const xe=gridEdges(x,view.xScale),ye=gridEdges(y,view.yScale);
    for(let r=0;r<y.length;r++)for(let c=0;c<x.length;c++){
      const v=z![r*x.length+c];if(!Number.isFinite(v))continue;
      const x0=nX(xe[c]),x1=nX(xe[c+1]),y0=nY(ye[r]),y1=nY(ye[r+1]);
      if(x1< -1||x0>1||y1< -1||y0>1)continue;
      quad(Math.max(-1,x0),Math.max(-1,y0),Math.min(1,x1),Math.min(1,y1),color(v));
    }
  }else if(layer.kind==='surface'){
    for(let r=0;r<y.length-1;r++)for(let c=0;c<x.length-1;c++){
      const indices=[r*x.length+c,r*x.length+c+1,(r+1)*x.length+c+1,r*x.length+c,(r+1)*x.length+c+1,(r+1)*x.length+c];
      for(let k=0;k<6;k+=3){
        const tri=indices.slice(k,k+3);
        if(tri.some(i=>![nX(x[i%x.length]),nY(y[Math.floor(i/x.length)]),nZ(z![i])].every(Number.isFinite)))continue;
        for(const i of tri)push(nX(x[i%x.length]),nY(y[Math.floor(i/x.length)]),nZ(z![i]),color(z![i]));
      }
    }
  }else{
    const indices=plan?.kind==='points'?plan.indices:undefined;
    for(let k=0;k<(indices?.length??x.length);k++){
      const i=indices?indices[k]:k;
      const a=nX(x[i]),b=nY(y[i]),c=z?nZ(z[i]):0;
      if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||scalar&&!Number.isFinite(scalar[i]))continue;
      push(a,b,c,color(scalar?.[i]));
    }
  }
  return {id:layer.id,positions:positions.subarray(0,count*3),colors:colors.subarray(0,count*4),primitive:plan?.kind==='density'||layer.kind==='line'||layer.kind==='heatmap'||layer.kind==='surface'?'triangles':'points',size:layer.style.size??5};
}
