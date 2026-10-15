import {numericReader} from './data';
import type {DataRegistry} from './data';
import {entryExtent} from './source-metadata';
import {normalize, extent} from './scales';
import {parseColor, colorMap} from './color';
import type {Bounds, LayerSpec, NumericArray, PointPlan, LineResult, BandResult, ViewSpec, Domain} from './types';
import type {Geometry} from './renderer';

export function gridEdges(values: NumericArray, scale:import('./types').ScaleKind): Float64Array {
  const n=values.length,out=new Float64Array(n+1);
  if(!n)return out;
  for(let i=0;i<n;i++){
    if(!Number.isFinite(values[i])||(scale==='log'&&values[i]<=0))throw new Error('Grid coordinates must be finite and valid for the selected scale');
    if(i&&values[i]<=values[i-1])throw new Error('Grid coordinates must be strictly increasing');
  }
  if(n===1){const domain=extent(values,scale);out[0]=domain[0];out[1]=domain[1];return out;}
  if(scale!=='log'){
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
export function buildGeometry(layer:LayerSpec, registry:DataRegistry, bounds:Bounds, zDomain:Domain, view:ViewSpec, width:number,height:number,plan?:PointPlan|LineResult|BandResult):Geometry {
  const xe=registry.get(layer.data.x),ye=registry.get(layer.data.y??layer.data.lower),xr=numericReader(xe),yr=numericReader(ye);
  const x=xe.chunks?new Float64Array(0):xe.values,y=ye.chunks?new Float64Array(0):ye.values;
  const z=layer.data.z?registry.get(layer.data.z).values:undefined;
  const scalarEntry=layer.data.color?registry.get(layer.data.color):undefined,scalar=scalarEntry?numericReader(scalarEntry):undefined;
  const base=parseColor(layer.style.color,layer.style.opacity??1);
  // Avoid boxed number arrays and an additional full-size float32 conversion.
  // A per-layer cap bounds CPU and GPU geometry even for pathological topology.
  const vertexBudget=2_000_000;
  let capacity=1024,count=0,positions=new Float32Array(capacity*3),colors=new Float32Array(capacity*4);
  const scalarDomain=layer.style.colorDomain??(scalarEntry?entryExtent(scalarEntry,'linear')??[0,1]:extent(z??new Float64Array([0,1])));
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
  if(layer.kind==='band'&&plan?.kind==='band'){
    const upper=registry.get(layer.data.upper).values;
    for(const segment of plan.segments)for(let j=1;j<segment.length;j++){
      const a=segment[j-1],b=segment[j];
      let polygon:number[][]=[[nX(xr.get(a)),nY(yr.get(a))],[nX(xr.get(b)),nY(yr.get(b))],[nX(xr.get(b)),nY(upper[b])],[nX(xr.get(a)),nY(upper[a])]];
      if(polygon.some(p=>!p.every(Number.isFinite)))continue;
      // Clip the paired envelope as one polygon before converting to float32.
      for(const [axis,edge,sign] of [[0,-1,1],[0,1,-1],[1,-1,1],[1,1,-1]]){
        const next:number[][]=[];
        for(let k=0;k<polygon.length;k++){
          const from=polygon[k],to=polygon[(k+1)%polygon.length],inside=(from[axis]-edge)*sign>=0,nextInside=(to[axis]-edge)*sign>=0;
          if(inside)next.push(from);
          if(inside!==nextInside){
            const other=1-axis,magnitude=Math.max(1,...from.map(Math.abs),...to.map(Math.abs));
            const slope=(to[other]/magnitude-from[other]/magnitude)/(to[axis]/magnitude-from[axis]/magnitude);
            const point=[0,0];point[axis]=edge;point[other]=(from[other]/magnitude-from[axis]/magnitude*slope)*magnitude+edge*slope;next.push(point);
          }
        }polygon=next;if(!polygon.length)break;
      }
      for(let k=1;k+1<polygon.length;k++)for(const p of [polygon[0],polygon[k],polygon[k+1]])push(Math.max(-1,Math.min(1,p[0])),Math.max(-1,Math.min(1,p[1])),0,base);
    }
  }else if(plan?.kind==='density'){
    const domain:Domain=layer.style.colorDomain??[0,Math.max(1,plan.max)];
    for(let r=0;r<plan.rows;r++)for(let c=0;c<plan.columns;c++){
      const count=plan.counts[r*plan.columns+c];if(!count)continue;
      const rgba=colorMap(count,domain,layer.style.colormap);rgba[3]=layer.style.opacity??1;
      quad(c/plan.columns*2-1,r/plan.rows*2-1,(c+1)/plan.columns*2-1,(r+1)/plan.rows*2-1,rgba);
    }
  }else if(layer.kind==='line'&&plan?.kind==='line'){
    const half=(layer.style.width??1.5)/2;
    for(const segment of plan.segments)for(let j=1;j<segment.length;j++){
      const a=segment[j-1],b=segment[j],clipped=clipLine(nX(xr.get(a)),nY(yr.get(a)),nX(xr.get(b)),nY(yr.get(b)));if(!clipped)continue;
      if(scalar){let invalid=false;for(let i=a;i<=b;i++)if(!Number.isFinite(scalar.get(i))){invalid=true;break;}if(invalid)continue;}
      const [x0,y0,x1,y1,t0,t1]=clipped;
      const dx=(x1-x0)*width/2,dy=(y1-y0)*height/2,len=Math.hypot(dx,dy);if(!len)continue;
      const ox=-dy/len*half*2/width,oy=dx/len*half*2/height;
      const start=color(scalar?.get(a)),end=color(scalar?.get(b));
      const first=start.map((value,i)=>value+(end[i]-value)*t0),last=start.map((value,i)=>value+(end[i]-value)*t1);
      push(x0+ox,y0+oy,0,first);push(x0-ox,y0-oy,0,first);push(x1-ox,y1-oy,0,last);
      push(x0+ox,y0+oy,0,first);push(x1-ox,y1-oy,0,last);push(x1+ox,y1+oy,0,last);
    }
  }else if(layer.kind==='line3d'){
    const directions:number[]=[],sides:number[]=[],sources:number[]=[];
    for(let i=1;i<xr.length;i++){
      const a=i-1,b=i,p=[nX(xr.get(a)),nY(yr.get(a)),nZ(z![a])],q=[nX(xr.get(b)),nY(yr.get(b)),nZ(z![b])];
      if(![...p,...q].every(Number.isFinite)||scalar&&(!Number.isFinite(scalar.get(a))||!Number.isFinite(scalar.get(b))))continue;
      const direction=q.map((value,k)=>value-p[k]);if(!direction.some(value=>value!==0))continue;
      if(direction.some(value=>!Number.isFinite(value)||Math.abs(value)>3.4028234663852886e38))throw new RangeError('3D line direction exceeds float32 coordinates. Narrow the data domain.');
      for(const [end,side]of [[0,1],[0,-1],[1,-1],[0,1],[1,-1],[1,1]]){const v=end?q:p;push(v[0],v[1],v[2],color(scalar?.get(end?b:a)));directions.push(...direction);sides.push(side);}
      sources.push(a);
    }
    return {id:layer.id,positions:positions.subarray(0,count*3),colors:colors.subarray(0,count*4),primitive:'triangles',lineDirections:Float32Array.from(directions),lineSides:Float32Array.from(sides),width:layer.style.width??1.5,sourceIndices:Uint32Array.from(sources)};
  }else if(layer.kind==='heatmap'){
    const xe=gridEdges(x,view.xScale),ye=gridEdges(y,view.yScale);
    for(let r=0;r<yr.length;r++)for(let c=0;c<xr.length;c++){
      const v=z![r*xr.length+c];if(!Number.isFinite(v))continue;
      const x0=nX(xe[c]),x1=nX(xe[c+1]),y0=nY(ye[r]),y1=nY(ye[r+1]);
      if(x1< -1||x0>1||y1< -1||y0>1)continue;
      quad(Math.max(-1,x0),Math.max(-1,y0),Math.min(1,x1),Math.min(1,y1),color(v));
    }
  }else if(layer.kind==='surface'){
    const maximumIndices=(xr.length-1)*(yr.length-1)*6;
    if(maximumIndices>6_000_000)throw new RangeError('Surface exceeds the renderer index budget of 6,000,000 indices');
    const lookup=new Int32Array(z!.length).fill(-1),indexData=new Uint32Array(maximumIndices),sourceTriangles=new Uint32Array(maximumIndices/3);let indexCount=0;
    const vertex=(i:number)=>{
      if(lookup[i]<0){lookup[i]=count;push(nX(xr.get(i%xr.length)),nY(yr.get(Math.floor(i/xr.length))),nZ(z![i]),color(scalar?.get(i)??z![i]));}
      return lookup[i];
    };
    for(let r=0;r<yr.length-1;r++)for(let c=0;c<xr.length-1;c++){
      const indices=[r*xr.length+c,r*xr.length+c+1,(r+1)*xr.length+c+1,r*xr.length+c,(r+1)*xr.length+c+1,(r+1)*xr.length+c];
      for(let k=0;k<6;k+=3){
        const tri=indices.slice(k,k+3);
        if(tri.some(i=>![nX(xr.get(i%xr.length)),nY(yr.get(Math.floor(i/xr.length))),nZ(z![i])].every(Number.isFinite)||scalar&&!Number.isFinite(scalar.get(i))))continue;
        sourceTriangles[indexCount/3]=(r*(xr.length-1)+c)*2+k/3;
        for(const i of tri)indexData[indexCount++]=vertex(i);
      }
    }
    const indices=indexData.subarray(0,indexCount);let normals:Float32Array|undefined,wireframeIndices:Uint32Array|undefined;
    if(layer.style.shading==='smooth'){
      normals=new Float32Array(count*3);
      for(let i=0;i<indices.length;i+=3){const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,ux=positions[b]-positions[a],uy=positions[b+1]-positions[a+1],uz=positions[b+2]-positions[a+2],vx=positions[c]-positions[a],vy=positions[c+1]-positions[a+1],vz=positions[c+2]-positions[a+2],normal=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];for(const at of [a,b,c])for(let k=0;k<3;k++)normals[at+k]+=normal[k];}
      for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);if(length)for(let k=0;k<3;k++)normals[i+k]/=length;else normals[i+2]=1;}
    }
    if(layer.style.wireframe){const edges=new Set<number>(),wire:number[]=[];for(let i=0;i<indices.length;i+=3)for(const [a,b]of [[indices[i],indices[i+1]],[indices[i+1],indices[i+2]],[indices[i+2],indices[i]]]){const key=Math.min(a,b)*count+Math.max(a,b);if(!edges.has(key)){edges.add(key);wire.push(a,b);}}wireframeIndices=Uint32Array.from(wire);}
    return {id:layer.id,positions:positions.subarray(0,count*3),colors:colors.subarray(0,count*4),primitive:'triangles',indices,...(normals?{normals}:{}),...(wireframeIndices?{wireframeIndices}:{}),sourceIndices:sourceTriangles.subarray(0,indexCount/3)};
  }else{
    const sourceIndices:number[]=[];
    const indices=plan?.kind==='points'?plan.indices:undefined;
    for(let k=0;k<(indices?.length??xr.length);k++){
      const i=indices?indices[k]:k;
      const a=nX(xr.get(i)),b=nY(yr.get(i)),c=z?nZ(z[i]):0;
      if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||scalar&&!Number.isFinite(scalar.get(i)))continue;
      push(a,b,c,color(scalar?.get(i)));
      sourceIndices.push(i);
    }
    return {id:layer.id,positions:positions.subarray(0,count*3),colors:colors.subarray(0,count*4),primitive:'points',size:layer.style.size??5,sourceIndices:Uint32Array.from(sourceIndices)};
  }
  return {id:layer.id,positions:positions.subarray(0,count*3),colors:colors.subarray(0,count*4),primitive:'triangles',size:layer.style.size??5};
}
