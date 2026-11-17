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
  matrix:Float32Array;rect:PlotRect;bounded:boolean;complete:boolean;size:number;width:number;
}
interface ProjectionBuild {
  key:string;matrix:Float32Array;rect:PlotRect;line:boolean;vertexCount:number;primitiveCount:number;
  projected:Float64Array;position:number;phase:'project'|'bin';columns:number;rows:number;
  heads:Int32Array;next:Int32Array;ids:Uint32Array;used:number;overflow:number[];bounded:boolean;complete:boolean;activeMs:number;
  size:number;width:number;
}
interface ProjectionCache {completedKey?:string;index?:ProjectedIndex;build?:ProjectionBuild}
interface PickRequest {
  items:readonly Pick3DLayer[];registry:DataRegistry;matrix:Float32Array;rect:PlotRect;
  px:number;py:number;context?:Pick3DContext;timer?:ReturnType<typeof setTimeout>;
}
const projectedCache=new WeakMap<Geometry,ProjectionCache>();
const SYNC_BUDGET=65_536;
let pending:PickRequest|undefined;
// Orthographic trigonometry and barycentric interpolation add double precision
// jitter to mathematically coplanar primitives; preserve their draw-order tie.
const DEPTH_TIE_EPSILON=1e-12;
export const picking3DStats={indexBuilds:0,indexBuildMs:0,lastIndexBuildMs:0,queries:0,candidates:0,lastCandidates:0,lastPrimitiveCount:0,lastIndexBytes:0};

/** Project exactly the float32 geometry that WebGL receives, in CSS pixels. */
export function project3D(position:ArrayLike<number>,matrix:Float32Array,rect:PlotRect):[number,number,number]{
  const x=position[0],y=position[1],z=position[2],w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];
  return [rect.left+(1+(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w)*rect.width/2,
    rect.top+(1-(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w)*rect.height/2,
    (matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])/w];
}
function cacheKey(g:Geometry,matrix:Float32Array,rect:PlotRect):string{
  return `${Array.from(matrix)}|${rect.left},${rect.top},${rect.width},${rect.height}|${g.size},${g.width}`;
}
function affine(matrix:Float32Array):boolean{return matrix[3]===0&&matrix[7]===0&&matrix[11]===0&&matrix[15]!==0;}
function createBuild(g:Geometry,key:string,matrix:Float32Array,rect:PlotRect):ProjectionBuild{
  const line=!!g.lineDirections,vertexCount=line?g.positions.length/9:g.positions.length/3;
  const columns=Math.max(1,Math.min(256,Math.ceil(rect.width/32))),rows=Math.max(1,Math.min(256,Math.ceil(rect.height/32)));
  return {key,matrix:Float32Array.from(matrix),rect:{...rect},line,vertexCount,primitiveCount:line?vertexCount/2:g.indices?g.indices.length/3:vertexCount,
    projected:new Float64Array(vertexCount*3),position:0,phase:'project',columns,rows,heads:new Int32Array(columns*rows).fill(-1),
    next:new Int32Array(1024),ids:new Uint32Array(1024),used:0,overflow:[],bounded:true,complete:true,activeMs:0,size:g.size??5,width:g.width??1.5};
}
function advance(g:Geometry,build:ProjectionBuild,budget:number):boolean{
  const started=performance.now();let work=0;
  const positions=g.positions,matrix=build.matrix,rect=build.rect,halfW=rect.width/2,halfH=rect.height/2,cx=rect.left+halfW,cy=rect.top+halfH;
  if(build.phase==='project'){
    while(build.position<build.vertexCount&&work<budget){
      const i=build.position++,at=(build.line?Math.floor(i/2)*6+(i%2?2:0):i)*3,out=i*3,x=positions[at],y=positions[at+1],z=positions[at+2];
      const w=matrix[3]*x+matrix[7]*y+matrix[11]*z+matrix[15];
      build.projected[out]=cx+(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w*halfW;
      build.projected[out+1]=cy-(matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w*halfH;
      build.projected[out+2]=(matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])/w;
      if(!(x>=-1.001&&x<=1.001&&y>=-1.001&&y<=1.001&&z>=-1.001&&z<=1.001))build.bounded=false;
      work++;
    }
    if(build.position>=build.vertexCount){build.phase='bin';build.position=0;}
  }
  if(build.phase==='bin'&&work<budget){
    const add=(id:number,minX:number,minY:number,maxX:number,maxY:number)=>{
      if(maxX<rect.left||minX>rect.left+rect.width||maxY<rect.top||minY>rect.top+rect.height){build.complete=false;return;}
      const x0=Math.max(0,Math.floor((minX-rect.left)/rect.width*build.columns)),x1=Math.min(build.columns-1,Math.floor((maxX-rect.left)/rect.width*build.columns));
      const y0=Math.max(0,Math.floor((minY-rect.top)/rect.height*build.rows)),y1=Math.min(build.rows-1,Math.floor((maxY-rect.top)/rect.height*build.rows)),count=(x1-x0+1)*(y1-y0+1);
      if(count>64||build.used+count>8_000_000){build.overflow.push(id);return;}
      if(build.used+count>build.ids.length){const capacity=Math.min(8_000_000,Math.max(build.ids.length*2,build.used+count)),newIds=new Uint32Array(capacity),newNext=new Int32Array(capacity);newIds.set(build.ids);newNext.set(build.next);build.ids=newIds;build.next=newNext;}
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const bin=y*build.columns+x;build.ids[build.used]=id;build.next[build.used]=build.heads[bin];build.heads[bin]=build.used++;}
    };
    const projected=build.projected;
    while(build.position<build.primitiveCount&&work<budget){
      const i=build.position++;work++;
      if(g.indices){const a=g.indices[i*3]*3,b=g.indices[i*3+1]*3,c=g.indices[i*3+2]*3;if(Math.min(projected[a+2],projected[b+2],projected[c+2])>1||Math.max(projected[a+2],projected[b+2],projected[c+2])< -1){build.complete=false;continue;}add(i,Math.min(projected[a],projected[b],projected[c]),Math.min(projected[a+1],projected[b+1],projected[c+1]),Math.max(projected[a],projected[b],projected[c]),Math.max(projected[a+1],projected[b+1],projected[c+1]));}
      else if(build.line){const a=i*6,b=a+3,radius=(g.width??1.5)/2;if(Math.min(projected[a+2],projected[b+2])>1||Math.max(projected[a+2],projected[b+2])< -1){build.complete=false;continue;}add(i,Math.min(projected[a],projected[b])-radius,Math.min(projected[a+1],projected[b+1])-radius,Math.max(projected[a],projected[b])+radius,Math.max(projected[a+1],projected[b+1])+radius);}
      else{const a=i*3,radius=(g.size??5)/2;if(projected[a+2]< -1||projected[a+2]>1){build.complete=false;continue;}add(i,projected[a]-radius,projected[a+1]-radius,projected[a]+radius,projected[a+1]+radius);}
    }
  }
  build.activeMs+=performance.now()-started;
  return build.phase==='bin'&&build.position>=build.primitiveCount;
}
function commit(entry:ProjectionCache):ProjectedIndex{
  const build=entry.build!,extra=Uint32Array.from(build.overflow);
  const index:ProjectedIndex={columns:build.columns,rows:build.rows,heads:build.heads,next:build.next.subarray(0,build.used),ids:build.ids.subarray(0,build.used),overflow:extra,
    projected:build.projected,primitiveCount:build.primitiveCount,line:build.line,bytes:build.heads.byteLength+build.next.byteLength+build.ids.byteLength+extra.byteLength+build.projected.byteLength,
    matrix:build.matrix,rect:build.rect,bounded:build.bounded,complete:build.complete,size:build.size,width:build.width};
  entry.index=index;entry.completedKey=build.key;entry.build=undefined;
  picking3DStats.indexBuilds++;picking3DStats.lastIndexBuildMs=build.activeMs;picking3DStats.indexBuildMs+=build.activeMs;return index;
}
function prepare(g:Geometry,matrix:Float32Array,rect:PlotRect):{index?:ProjectedIndex;exact:boolean}{
  const key=cacheKey(g,matrix,rect);let entry=projectedCache.get(g);
  if(entry?.index&&entry.completedKey===key){entry.build=undefined;return {index:entry.index,exact:true};}
  if(entry?.build?.key!==key){entry={completedKey:entry?.completedKey,index:entry?.index,build:createBuild(g,key,matrix,rect)};projectedCache.set(g,entry);}
  if(advance(g,entry.build!,SYNC_BUDGET))return {index:commit(entry),exact:true};
  return {index:entry.index,exact:false};
}
function* candidates(index:ProjectedIndex,rect:PlotRect,x:number,y:number):Generator<number>{
  const col=Math.min(index.columns-1,Math.floor((x-rect.left)/rect.width*index.columns)),row=Math.min(index.rows-1,Math.floor((y-rect.top)/rect.height*index.rows));
  for(let at=index.heads[row*index.columns+col];at>=0;at=index.next[at])yield index.ids[at];
  yield* index.overflow;
}
function coarseCandidates(index:ProjectedIndex,matrix:Float32Array,rect:PlotRect,px:number,py:number):number[]|undefined{
  if(!index.complete||!index.bounded||!affine(index.matrix)||!affine(matrix)||!Number.isFinite(index.rect.width)||!Number.isFinite(index.rect.height)||index.rect.width===0||index.rect.height===0)return;
  let shift=0;
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]){
    const before=project3D([x,y,z],index.matrix,index.rect),after=project3D([x,y,z],matrix,rect);
    const moved=Math.hypot(before[0]-after[0],before[1]-after[1]);if(!Number.isFinite(moved))return;if(moved>shift)shift=moved;
  }
  const reach=shift+Math.max(index.size,index.width)/2,cellW=index.rect.width/index.columns,cellH=index.rect.height/index.rows;
  const padX=Math.ceil(reach/cellW)+1,padY=Math.ceil(reach/cellH)+1;
  const col=Math.floor((px-index.rect.left)/index.rect.width*index.columns),row=Math.floor((py-index.rect.top)/index.rect.height*index.rows);
  const x0=Math.max(0,col-padX),x1=Math.min(index.columns-1,col+padX),y0=Math.max(0,row-padY),y1=Math.min(index.rows-1,row+padY);
  if(x0>x1||y0>y1)return;
  if((x1-x0+1)*(y1-y0+1)>48||index.overflow.length>4096)return;
  const seen=new Uint8Array(index.primitiveCount),ids:number[]=[];
  const take=(id:number)=>{if(id<0||id>=seen.length||seen[id])return true;if(ids.length===4096)return false;seen[id]=1;ids.push(id);return true;};
  for(const id of index.overflow)if(!take(id))return;
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(let at=index.heads[y*index.columns+x];at>=0;at=index.next[at])if(!take(index.ids[at]))return;
  return ids;
}
function livePoint(g:Geometry,line:boolean,vertex:number,matrix:Float32Array,rect:PlotRect):[number,number,number]{
  const endpoint=line?Math.floor(vertex/6)*2+(vertex%6>=2&&vertex%6!==3?1:0):vertex;
  const at=(line?Math.floor(endpoint/2)*6+(endpoint%2?2:0):endpoint)*3;
  return project3D(g.positions.subarray(at,at+3),matrix,rect);
}
function arm(request:PickRequest):void{
  if(pending?.timer!==undefined)clearTimeout(pending.timer);
  pending=request;request.timer=setTimeout(()=>{
    if(pending!==request)return;pending=undefined;
    pick3D(request.items,request.registry,request.matrix,request.rect,request.px,request.py,request.context);
  },0);
}
function disarm():void{if(pending?.timer!==undefined)clearTimeout(pending.timer);pending=undefined;}

/** Finish every cooperative projection for the pending pixel and return its exact hit. */
export function finishPicking3D():Pick3DHit|undefined{
  const request=pending;if(request?.timer!==undefined)clearTimeout(request.timer);pending=undefined;if(!request)return;
  for(const {geometry} of request.items){
    const entry=projectedCache.get(geometry);
    while(entry?.build){if(!advance(geometry,entry.build,Number.POSITIVE_INFINITY))break;commit(entry);}
  }
  return pick3D(request.items,request.registry,request.matrix,request.rect,request.px,request.py,request.context);
}

/**
 * CPU reference picking for committed, non-LOD geometry. The nearest depth wins,
 * just as DEPTH_TEST/LESS does in the renderer. No reads of mutable live data.
 * A camera change builds its projection in chunks. Until that index is ready, a
 * hit is returned only when the previous projection can prove the candidate set.
 */
export function pick3D(items:readonly Pick3DLayer[],registry:DataRegistry,matrix:Float32Array,rect:PlotRect,px:number,py:number,context?:Pick3DContext):Pick3DHit|undefined{
  if(px<rect.left||px>rect.left+rect.width||py<rect.top||py>rect.top+rect.height)return;
  picking3DStats.queries++;picking3DStats.lastCandidates=0;picking3DStats.lastPrimitiveCount=0;picking3DStats.lastIndexBytes=0;
  let best:Pick3DHit|undefined,bestOrder=Infinity,uncertain=false,waiting=false;
  for(const {layer,geometry:g} of items){
    if(!layer.visible||(layer.style.opacity??1)===0||!['scatter3d','surface','line3d'].includes(layer.kind))continue;
    const prepared=prepare(g,matrix,rect);if(!prepared.exact)waiting=true;
    const index=prepared.index;if(!index){uncertain=true;continue;}
    picking3DStats.lastPrimitiveCount+=index.primitiveCount;picking3DStats.lastIndexBytes+=index.bytes;
    let ids:Iterable<number>|undefined;
    const project=(vertex:number):[number,number,number]=>{
      if(prepared.exact){const at=(index.line?Math.floor(vertex/6)*2+(vertex%6>=2&&vertex%6!==3?1:0):vertex)*3;return [index.projected[at],index.projected[at+1],index.projected[at+2]];}
      return livePoint(g,index.line,vertex,matrix,rect);
    };
    if(prepared.exact)ids=candidates(index,rect,px,py);
    else if((g.size??5)!==index.size||(g.width??1.5)!==index.width)uncertain=true;
    else{ids=coarseCandidates(index,matrix,rect,px,py);if(!ids)uncertain=true;}
    if(!ids)continue;
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
      for(const v of ids){
        counted(v);const [x,y,depth]=project(v);if(x<rect.left||x>rect.left+rect.width||y<rect.top||y>rect.top+rect.height||(x-px)**2+(y-py)**2>radius*radius)continue;
        const index=g.sourceIndices?.[v]??v;accept({kind:'point3d',index,x:xs[index],y:ys[index],z:zs[index],...(scalar?{value:scalar[index]}:{}),depth,interpolated:false});
      }
    }else if(layer.kind==='surface'){
      const indices=g.indices;if(!indices)continue;
      for(const triangleIndex of ids){
        counted(triangleIndex);const at=triangleIndex*3,ids=[indices[at],indices[at+1],indices[at+2]],a=project(ids[0]),b=project(ids[1]),c=project(ids[2]);
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
      for(const segment of ids){
        counted(segment);const first=segment*6,a=project(first),b=project(first+2),dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;if(!length)continue;
        const t=((px-a[0])*dx+(py-a[1])*dy)/length;if(t<0||t>1)continue;
        if((a[0]+t*dx-px)**2+(a[1]+t*dy-py)**2>radius*radius)continue;
        const index=g.sourceIndices?.[segment]??segment,[x,y,z]=world([index,index+1],[1-t,t],[first,first+2]);
        accept({kind:'segment3d',indices:[index,index+1],t,x,y,z,...(scalar?{value:scalar[index]*(1-t)+scalar[index+1]*t}:{}),depth:a[2]+(b[2]-a[2])*t,interpolated:true});
      }
    }
  }
  if(waiting)arm({items,registry,matrix:Float32Array.from(matrix),rect:{...rect},px,py,context});else disarm();
  return uncertain?undefined:best;
}
