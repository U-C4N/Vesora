import type {DataRegistry} from './data';
import type {Geometry,PlotRect} from './renderer';
import type {Bounds,Domain,LayerSpec,ViewSpec} from './types';
import {denormalize} from './scales';

export interface Pick3DLayer {layer:LayerSpec;geometry:Geometry}
export interface Pick3DContext {bounds:Bounds;zDomain:Domain;view:ViewSpec}
export interface Pick3DHit {
  kind:'point3d'|'surface'|'segment3d';layerId:string;panelId?:string;
  x:number;y:number;z:number;value?:number;depth:number;
  index?:number;indices?:[number,number];t?:number;
  cell?:[number,number];triangle?:0|1;barycentric?:[number,number,number];
  interpolated:boolean;sourceVersions:Record<string,number>;
}
interface ProjectedIndex {
  columns:number;rows:number;heads:Int32Array;next:Int32Array;ids:Uint32Array;overflow:Uint32Array;
  projected:Float64Array;primitiveCount:number;line:boolean;bytes:number;
}
const projectedCache=new WeakMap<Geometry,{key:string;index:ProjectedIndex}>();
// Orthographic trigonometry and barycentric interpolation add double precision
// jitter to mathematically coplanar primitives; preserve their draw-order tie.
const DEPTH_TIE_EPSILON=1e-12;
export const picking3DStats={indexBuilds:0,queries:0,candidates:0,lastCandidates:0,lastPrimitiveCount:0,lastIndexBytes:0};

/** Project exactly the float32 geometry that WebGL receives, in CSS pixels. */
export function project3D(position:ArrayLike<number>,matrix:Float32Array,rect:PlotRect):[number,number,number]{
  const x=position[0],y=position[1],z=position[2],w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];
  return [rect.left+(1+(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w)*rect.width/2,
    rect.top+(1-(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w)*rect.height/2,
    (matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])/w];
}

/** Broad phase is rebuilt only when this immutable geometry, camera or viewport changes. */
function projectedIndex(g:Geometry,matrix:Float32Array,rect:PlotRect):ProjectedIndex{
  const key=`${Array.from(matrix)}|${rect.left},${rect.top},${rect.width},${rect.height}|${g.size},${g.width}`;
  const cached=projectedCache.get(g);if(cached?.key===key)return cached.index;
  const line=!!g.lineDirections,vertexCount=line?g.positions.length/9:g.positions.length/3,projected=new Float64Array(vertexCount*3);
  for(let i=0;i<vertexCount;i++){const source=line?Math.floor(i/2)*6+(i%2?2:0):i;projected.set(project3D(g.positions.subarray(source*3,source*3+3),matrix,rect),i*3);}
  const columns=Math.max(1,Math.min(256,Math.ceil(rect.width/32))),rows=Math.max(1,Math.min(256,Math.ceil(rect.height/32))),heads=new Int32Array(columns*rows).fill(-1);
  let next=new Int32Array(1024),ids=new Uint32Array(1024),used=0;const overflow:number[]=[];
  const add=(id:number,minX:number,minY:number,maxX:number,maxY:number)=>{
    if(maxX<rect.left||minX>rect.left+rect.width||maxY<rect.top||minY>rect.top+rect.height)return;
    const x0=Math.max(0,Math.floor((minX-rect.left)/rect.width*columns)),x1=Math.min(columns-1,Math.floor((maxX-rect.left)/rect.width*columns)),y0=Math.max(0,Math.floor((minY-rect.top)/rect.height*rows)),y1=Math.min(rows-1,Math.floor((maxY-rect.top)/rect.height*rows)),count=(x1-x0+1)*(y1-y0+1);
    // Large primitives cover many bins; one overflow entry bounds acceleration memory.
    if(count>64||used+count>8_000_000){overflow.push(id);return;}
    if(used+count>ids.length){const capacity=Math.min(8_000_000,Math.max(ids.length*2,used+count)),newIds=new Uint32Array(capacity),newNext=new Int32Array(capacity);newIds.set(ids);newNext.set(next);ids=newIds;next=newNext;}
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const bin=y*columns+x;ids[used]=id;next[used]=heads[bin];heads[bin]=used++;}
  };
  const primitiveCount=line?vertexCount/2:g.indices?g.indices.length/3:vertexCount;
  for(let i=0;i<primitiveCount;i++){
    if(g.indices){const a=g.indices[i*3]*3,b=g.indices[i*3+1]*3,c=g.indices[i*3+2]*3;if(Math.min(projected[a+2],projected[b+2],projected[c+2])>1||Math.max(projected[a+2],projected[b+2],projected[c+2])< -1)continue;add(i,Math.min(projected[a],projected[b],projected[c]),Math.min(projected[a+1],projected[b+1],projected[c+1]),Math.max(projected[a],projected[b],projected[c]),Math.max(projected[a+1],projected[b+1],projected[c+1]));}
    else if(line){const a=i*6,b=a+3,radius=(g.width??1.5)/2;if(Math.min(projected[a+2],projected[b+2])>1||Math.max(projected[a+2],projected[b+2])< -1)continue;add(i,Math.min(projected[a],projected[b])-radius,Math.min(projected[a+1],projected[b+1])-radius,Math.max(projected[a],projected[b])+radius,Math.max(projected[a+1],projected[b+1])+radius);}
    else{const a=i*3,radius=(g.size??5)/2;if(projected[a+2]< -1||projected[a+2]>1)continue;add(i,projected[a]-radius,projected[a+1]-radius,projected[a]+radius,projected[a+1]+radius);}
  }
  const extra=Uint32Array.from(overflow),index={columns,rows,heads,next:next.subarray(0,used),ids:ids.subarray(0,used),overflow:extra,projected,primitiveCount,line,bytes:heads.byteLength+next.byteLength+ids.byteLength+extra.byteLength+projected.byteLength};
  projectedCache.set(g,{key,index});picking3DStats.indexBuilds++;return index;
}
function* candidates(index:ProjectedIndex,rect:PlotRect,x:number,y:number):Generator<number>{
  const col=Math.min(index.columns-1,Math.floor((x-rect.left)/rect.width*index.columns)),row=Math.min(index.rows-1,Math.floor((y-rect.top)/rect.height*index.rows));
  for(let at=index.heads[row*index.columns+col];at>=0;at=index.next[at])yield index.ids[at];
  yield* index.overflow;
}

/**
 * CPU reference picking for committed, non-LOD geometry. The nearest depth wins,
 * just as DEPTH_TEST/LESS does in the renderer. No reads of mutable live data.
 */
export function pick3D(items:readonly Pick3DLayer[],registry:DataRegistry,matrix:Float32Array,rect:PlotRect,px:number,py:number,context?:Pick3DContext):Pick3DHit|undefined{
  if(px<rect.left||px>rect.left+rect.width||py<rect.top||py>rect.top+rect.height)return;
  picking3DStats.queries++;picking3DStats.lastCandidates=0;picking3DStats.lastPrimitiveCount=0;picking3DStats.lastIndexBytes=0;
  let best:Pick3DHit|undefined,bestOrder=Infinity;
  for(const {layer,geometry:g} of items){
    if(!layer.visible||(layer.style.opacity??1)===0||!['scatter3d','surface','line3d'].includes(layer.kind))continue;
    const index=projectedIndex(g,matrix,rect);picking3DStats.lastPrimitiveCount+=index.primitiveCount;picking3DStats.lastIndexBytes+=index.bytes;
    const projected=(vertex:number):[number,number,number]=>{const at=(index.line?Math.floor(vertex/6)*2+(vertex%6>=2&&vertex%6!==3?1:0):vertex)*3;return [index.projected[at],index.projected[at+1],index.projected[at+2]];};
    const nearby=()=>candidates(index,rect,px,py);
    let primitiveOrder=0;const counted=(order:number)=>{primitiveOrder=order;picking3DStats.candidates++;picking3DStats.lastCandidates++;};
    const xs=registry.get(layer.data.x).values,ys=registry.get(layer.data.y).values,zs=registry.get(layer.data.z).values,scalar=layer.data.color?registry.get(layer.data.color).values:undefined;
    const versions=()=>Object.fromEntries(Object.entries(layer.data).map(([key,id])=>[key,registry.get(id).descriptor.version]));
    const accept=(hit:Omit<Pick3DHit,'layerId'|'panelId'|'sourceVersions'>)=>{
      if(!Number.isFinite(hit.depth)||hit.depth< -1||hit.depth>1||best&&(hit.depth>best.depth+DEPTH_TIE_EPSILON||Math.abs(hit.depth-best.depth)<=DEPTH_TIE_EPSILON&&(best.layerId!==layer.id||primitiveOrder>=bestOrder)))return;
      best={...hit,layerId:layer.id,...(layer.panelId?{panelId:layer.panelId}:{}),sourceVersions:versions()};
      bestOrder=primitiveOrder;
    };
    const world=(indices:readonly number[],weights:readonly number[],geometryIndices:readonly number[],grid=false):[number,number,number]=>{
      if(context){return (['x','y','z'] as const).map((axis,k)=>{const v=geometryIndices.reduce((sum,i,j)=>sum+g.positions[i*3+k]*weights[j],0);return denormalize((v+1)/2,axis==='z'?context.zDomain:context.bounds[axis],context.view[`${axis}Scale`]);}) as [number,number,number];}
      return [indices.reduce((sum,i,j)=>sum+xs[grid?i%xs.length:i]*weights[j],0),indices.reduce((sum,i,j)=>sum+ys[grid?Math.floor(i/xs.length):i]*weights[j],0),indices.reduce((sum,i,j)=>sum+zs[i]*weights[j],0)];
    };
    if(layer.kind==='scatter3d'){
      const radius=(g.size??5)/2;
      for(const v of nearby()){
        counted(v);const [x,y,depth]=projected(v);if(x<rect.left||x>rect.left+rect.width||y<rect.top||y>rect.top+rect.height||(x-px)**2+(y-py)**2>radius*radius)continue;
        const index=g.sourceIndices?.[v]??v;accept({kind:'point3d',index,x:xs[index],y:ys[index],z:zs[index],...(scalar?{value:scalar[index]}:{}),depth,interpolated:false});
      }
    }else if(layer.kind==='surface'){
      const indices=g.indices;if(!indices)continue;
      for(const triangleIndex of nearby()){
        counted(triangleIndex);const at=triangleIndex*3,ids=[indices[at],indices[at+1],indices[at+2]],a=projected(ids[0]),b=projected(ids[1]),c=projected(ids[2]);
        const determinant=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(!Number.isFinite(determinant)||Math.abs(determinant)<1e-12)continue;
        const u=((b[1]-c[1])*(px-c[0])+(c[0]-b[0])*(py-c[1]))/determinant,v=((c[1]-a[1])*(px-c[0])+(a[0]-c[0])*(py-c[1]))/determinant,w=1-u-v;
        if(Math.min(u,v,w)<-1e-7)continue;
        const depth=u*a[2]+v*b[2]+w*c[2];if(best&&depth>best.depth+DEPTH_TIE_EPSILON)continue;
        const triangleId=g.sourceIndices?.[at/3]??at/3,cellId=Math.floor(triangleId/2),row=Math.floor(cellId/(xs.length-1)),column=cellId%(xs.length-1),first=row*xs.length+column,triangle=triangleId%2 as 0|1;
        const source=triangle===0?[first,first+1,first+xs.length+1]:[first,first+xs.length+1,first+xs.length],weights:[number,number,number]=[u,v,w],[x,y,z]=world(source,weights,ids,true);
        accept({kind:'surface',cell:[row,column],triangle,barycentric:weights,x,y,z,value:source.reduce((sum,i,j)=>sum+(scalar??zs)[i]*weights[j],0),depth,interpolated:true});
      }
    }else{
      const radius=(g.width??1.5)/2;
      for(const segment of nearby()){
        counted(segment);const first=segment*6,a=projected(first),b=projected(first+2),dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;if(!length)continue;
        const t=((px-a[0])*dx+(py-a[1])*dy)/length;if(t<0||t>1)continue;
        if((a[0]+t*dx-px)**2+(a[1]+t*dy-py)**2>radius*radius)continue;
        const index=g.sourceIndices?.[segment]??segment,[x,y,z]=world([index,index+1],[1-t,t],[first,first+2]);
        accept({kind:'segment3d',indices:[index,index+1],t,x,y,z,...(scalar?{value:scalar[index]*(1-t)+scalar[index+1]*t}:{}),depth:a[2]+(b[2]-a[2])*t,interpolated:true});
      }
    }
  }
  return best;
}
