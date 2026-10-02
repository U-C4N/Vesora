import type {Figure} from './figure';
import {QueryScheduler} from './scheduler';
import {extent,normalize,denormalize,ticks,formatTick} from './scales';
import {colorMap} from './color';
import {buildGeometry,gridEdges} from './geometry';
import {WebGLRenderer,cameraMatrix,identity} from './renderer';
import type {Geometry,PlotRect} from './renderer';
import type {Bounds,Domain,LayerSpec,PointPlan,LineResult,Query,RepresentationInfo,Selection} from './types';

export class FigureView {
  private root:HTMLDivElement;
  private overlay:HTMLCanvasElement;
  private renderer:WebGLRenderer;
  private scheduler=new QueryScheduler();
  private observer:ResizeObserver;
  private width=800;private height=520;private dpr=1;
  private rect:PlotRect={left:80,top:45,width:600,height:400};
  private bounds:Bounds={x:[0,1],y:[0,1]};private zDomain:Domain=[0,1];
  private plans=new Map<string,PointPlan|LineResult>();
  private geometries=new Map<string,{key:string;geometry:Geometry}>();
  private extents=new Map<string,{key:string;domain?:Domain}>();
  private infos:Array<RepresentationInfo&{layerId:string}>=[];
  private previous=new Map<string,'points'|'density'>();
  private generation=0;private completed=0;private raf=0;private disposed=false;
  private failure?:Error;
  private waiters:Array<{resolve:()=>void;reject:(error:Error)=>void}>=[];
  private cleanup:Array<()=>void>=[];
  private drag?:{x:number;y:number;lastX:number;lastY:number;select:boolean;pan:boolean;bounds:Bounds};
  private box?:[number,number,number,number];
  private tooltip?:{x:number;y:number;text:string};
  private pan3d:[number,number]=[0,0];
  constructor(private figure:Figure,container:HTMLElement){
    this.root=document.createElement('div');this.root.className='vesora-figure';this.root.style.cssText='position:relative;width:100%;overflow:hidden;background:white;color:#0f172a;font-family:system-ui,sans-serif;';
    this.root.style.height=`${figure.spec.height}px`;this.root.setAttribute('role','img');this.root.setAttribute('aria-label',figure.spec.title||'Scientific visualization');
    const canvas=document.createElement('canvas');canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;';
    this.overlay=document.createElement('canvas');this.overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
    this.overlay.tabIndex=0;this.overlay.setAttribute('aria-label','Plot controls: drag to pan, wheel to zoom, Shift-drag to select, double-click to reset');
    this.root.append(canvas,this.overlay);container.appendChild(this.root);
    try{this.renderer=new WebGLRenderer(canvas,message=>this.fail(new Error(message)));}catch(error){this.root.remove();throw error;}
    this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(this.root);
    this.listen('wheel',this.wheel as EventListener,{passive:false});
    this.listen('pointerdown',this.pointerDown as EventListener);this.listen('pointermove',this.pointerMove as EventListener);this.listen('pointerup',this.pointerUp as EventListener);
    this.listen('pointercancel',(()=>{this.drag=undefined;this.box=undefined;this.drawOverlay();}) as EventListener);
    this.listen('pointerleave',(()=>{if(!this.drag){this.tooltip=undefined;this.drawOverlay();}}) as EventListener);
    this.listen('dblclick',(()=>{this.pan3d=[0,0];this.figure.setView({xDomain:undefined,yDomain:undefined,zDomain:undefined,camera:{azimuth:35,elevation:25,distance:3}});}) as EventListener);
  }
  private listen(name:string,callback:EventListener,options?:AddEventListenerOptions):void{this.overlay.addEventListener(name,callback,options);this.cleanup.push(()=>this.overlay.removeEventListener(name,callback,options));}
  schedule():void{
    if(this.disposed)return;this.generation++;this.failure=undefined;
    if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;void this.render(this.generation);});
  }
  ready():Promise<void>{if(this.failure)return Promise.reject(this.failure);if(this.completed===this.generation)return Promise.resolve();return new Promise((resolve,reject)=>this.waiters.push({resolve,reject}));}
  inspect():Array<RepresentationInfo&{layerId:string}>{return this.infos.map(info=>({...info}));}
  private sourceExtent(layer:LayerSpec,key:string,scale:'linear'|'log'):Domain|undefined{
    const source=layer.data[key];if(!source)return undefined;
    const entry=this.figure.registry.get(source),cacheKey=`${source}:${entry.descriptor.version}:${scale}:${layer.kind}`;
    const cached=this.extents.get(source);if(cached?.key===cacheKey)return cached.domain;
    const values=layer.kind==='heatmap'&&(key==='x'||key==='y')?gridEdges(entry.values,scale):entry.values;
    const domain=values.some(v=>Number.isFinite(v)&&(scale!=='log'||v>0))?extent(values,scale):undefined;this.extents.set(source,{key:cacheKey,domain});return domain;
  }
  private domain(axis:'x'|'y'|'z'):Domain{
    const view=this.figure.spec.view,explicit=view[`${axis}Domain`];if(explicit)return explicit;
    const scale=view[`${axis}Scale`],layers=this.figure.spec.layers.filter(l=>l.visible&&l.data[axis]);
    if(!layers.length)return scale==='log'?[1,10]:[0,1];
    let min=Infinity,max=-Infinity;
    for(const layer of layers){const d=this.sourceExtent(layer,axis,scale);if(d){min=Math.min(min,d[0]);max=Math.max(max,d[1]);}}
    if(min===Infinity)return scale==='log'?[1,10]:[0,1];
    const domain:Domain=[min,max];
    if(layers.some(l=>l.kind==='heatmap'))return domain;
    const padded:Domain=[denormalize(-.035,domain,scale),denormalize(1.035,domain,scale)];
    return padded.every(Number.isFinite)&&padded[0]<padded[1]&&(scale!=='log'||padded[0]>0)?padded:domain;
  }
  private async render(generation:number):Promise<void>{
    try{
      const spec=this.figure.spec;
      this.width=Math.max(200,Math.round(this.root.clientWidth||spec.width));this.height=spec.height;this.dpr=Math.min(2,window.devicePixelRatio||1);
      this.root.style.height=`${this.height}px`;
      this.rect={left:85,top:spec.title?48:28,width:Math.max(40,this.width-170),height:Math.max(40,this.height-(spec.title?130:110))};
      this.bounds={x:this.domain('x'),y:this.domain('y')};this.zDomain=this.domain('z');
      const bounds=this.bounds,zDomain=this.zDomain,view=structuredClone(spec.view),rect={...this.rect};
      const layers=spec.layers.filter(l=>l.visible),nextPlans=new Map<string,PointPlan|LineResult>();
      const infos:Array<RepresentationInfo&{layerId:string}>=[];
      const items=await Promise.all(layers.map(async layer=>{
        const versions=Object.values(layer.data).map(source=>`${source}:${this.figure.registry.get(source).descriptor.version}`);
        const key=JSON.stringify([versions,layer.style,bounds,zDomain,view.xScale,view.yScale,view.zScale,rect.width,rect.height]);
        const cache=this.geometries.get(layer.id);
        let plan:PointPlan|LineResult|undefined;
        if(layer.kind==='line'||layer.kind==='scatter'){
          const query:Query={bounds,width:Math.round(rect.width),height:Math.round(rect.height),xScale:view.xScale,yScale:view.yScale,pointBudget:250_000,mode:layer.style.representation??'auto',previous:this.previous.get(layer.id)};
          plan=await this.scheduler.query(layer.id,layer.kind==='line'?'line':'scatter',layer.data.x,layer.data.y,query,this.figure.registry);
          nextPlans.set(layer.id,plan);
          if(plan.kind==='points'||plan.kind==='density')this.previous.set(layer.id,plan.kind);
          infos.push({...plan.info,layerId:layer.id});
        }else{
          const count=this.figure.registry.get(layer.data.z??layer.data.x).values.length;
          if(count>1_000_000)throw new Error(`${layer.kind} exceeds the initial renderer budget of 1,000,000 values. Reduce the grid or use 2D density exploration.`);
          infos.push({layerId:layer.id,kind:layer.kind==='heatmap'?'grid':layer.kind==='surface'?'surface':'points',total:count,visible:count,rendered:count,exact:true,method:layer.kind==='surface'?'regular-grid triangulation':layer.kind==='heatmap'?'scalar grid':'raw points'});
        }
        if(this.disposed||generation!==this.generation)throw new DOMException('Superseded','AbortError');
        const geometry=cache?.key===key?cache.geometry:buildGeometry(layer,this.figure.registry,bounds,zDomain,view,rect.width,rect.height,plan);
        const info=infos.find(info=>info.layerId===layer.id)!;
        if(geometry.primitive==='points'){
          info.rendered=geometry.positions.length/3;
          info.visible=info.rendered;
          if(layer.data.color)info.method+='; non-finite scalar colors omitted';
        }else if(layer.kind==='surface'){
          info.rendered=geometry.positions.length/9;info.method='regular-grid triangles; invalid vertices omitted';
          const xs=this.figure.registry.get(layer.data.x).values,ys=this.figure.registry.get(layer.data.y).values,zs=this.figure.registry.get(layer.data.z).values;
          let valid=0;for(let i=0;i<zs.length;i++)if(Number.isFinite(normalize(xs[i%xs.length],bounds.x,view.xScale))&&Number.isFinite(normalize(ys[Math.floor(i/xs.length)],bounds.y,view.yScale))&&Number.isFinite(normalize(zs[i],zDomain,view.zScale)))valid++;
          info.visible=valid;
        }else if(layer.kind==='heatmap'){info.rendered=geometry.positions.length/18;info.visible=info.rendered;}
        this.geometries.set(layer.id,{key,geometry});return geometry;
      }));
      if(this.disposed||generation!==this.generation)return;
      const live=new Set(layers.map(l=>l.id));for(const key of this.geometries.keys())if(!live.has(key)){this.geometries.delete(key);this.scheduler.cancel(key);this.previous.delete(key);}
      const sources=new Set(Object.keys(Object.fromEntries(this.figure.registry.entries())));for(const source of this.extents.keys())if(!sources.has(source)){this.extents.delete(source);this.scheduler.release(source);}
      this.plans=nextPlans;this.infos=infos;
      const matrix=view.kind==='3d'?cameraMatrix(view.camera.azimuth,view.camera.elevation,view.camera.distance,rect.width/rect.height,this.pan3d):identity;
      if(view.kind==='3d')items.unshift(this.axes3d());
      this.renderer.draw(items,rect,this.width,this.height,this.dpr,matrix,view.kind==='3d');
      this.drawOverlay();this.completed=generation;this.figure.emit('representation',this.inspect());
      for(const waiter of this.waiters.splice(0))waiter.resolve();
    }catch(error){if(generation!==this.generation||this.disposed)return;this.fail(error instanceof Error?error:new Error(String(error)));}
  }
  private fail(error:Error):void{this.failure=error;this.completed=this.generation;this.figure.emit('error',{message:error.message});this.drawOverlay(error.message);for(const waiter of this.waiters.splice(0))waiter.reject(error);}
  private axes3d():Geometry{
    return {id:'__axes3d',primitive:'lines',positions:new Float32Array([-1,-1,-1,1,-1,-1,-1,-1,-1,-1,1,-1,-1,-1,-1,-1,-1,1]),colors:new Float32Array([.3,.4,.5,1,.3,.4,.5,1,.3,.4,.5,1,.3,.4,.5,1,.3,.4,.5,1,.3,.4,.5,1])};
  }
  private ctx():CanvasRenderingContext2D{
    const w=Math.round(this.width*this.dpr),h=Math.round(this.height*this.dpr);
    if(this.overlay.width!==w||this.overlay.height!==h){this.overlay.width=w;this.overlay.height=h;}
    const ctx=this.overlay.getContext('2d')!;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);return ctx;
  }
  private drawOverlay(error?:string):void{
    if(this.disposed)return;const ctx=this.ctx(),r=this.rect,spec=this.figure.spec;ctx.clearRect(0,0,this.width,this.height);
    ctx.font='12px system-ui, sans-serif';ctx.fillStyle='#334155';ctx.strokeStyle='#cbd5e1';ctx.lineWidth=1;
    if(spec.title){ctx.font='600 17px system-ui, sans-serif';ctx.textAlign='left';ctx.fillText(spec.title,r.left,25);ctx.font='12px system-ui, sans-serif';}
    if(spec.view.kind==='2d'){
      const xSpan=this.bounds.x[1]-this.bounds.x[0],ySpan=this.bounds.y[1]-this.bounds.y[0];
      const xOffset=spec.view.xScale==='linear'&&Math.abs(this.bounds.x[0])/xSpan>1e5?this.bounds.x[0]:0;
      const yOffset=spec.view.yScale==='linear'&&Math.abs(this.bounds.y[0])/ySpan>1e5?this.bounds.y[0]:0;
      ctx.strokeRect(r.left,r.top,r.width,r.height);
      for(const value of ticks(this.bounds.x,spec.view.xScale,Math.max(2,Math.floor(r.width/100)))){
        const x=r.left+normalize(value,this.bounds.x,spec.view.xScale)*r.width;ctx.strokeStyle='#e2e8f0';ctx.beginPath();ctx.moveTo(x,r.top);ctx.lineTo(x,r.top+r.height);ctx.stroke();
        ctx.fillStyle='#334155';ctx.textAlign='center';ctx.fillText(formatTick(value-xOffset,xSpan),x,r.top+r.height+20);
      }
      for(const value of ticks(this.bounds.y,spec.view.yScale,Math.max(2,Math.floor(r.height/65)))){
        const y=r.top+(1-normalize(value,this.bounds.y,spec.view.yScale))*r.height;ctx.strokeStyle='#e2e8f0';ctx.beginPath();ctx.moveTo(r.left,y);ctx.lineTo(r.left+r.width,y);ctx.stroke();
        ctx.textAlign='right';ctx.fillText(formatTick(value-yOffset,ySpan),r.left-9,y+4);
      }
      if(xOffset){ctx.textAlign='right';ctx.fillText(`offset ${xOffset>=0?'+':''}${xOffset}`,r.left+r.width,r.top+r.height+36);}
      if(yOffset){ctx.textAlign='left';ctx.fillText(`offset ${yOffset>=0?'+':''}${yOffset}`,r.left,r.top-8);}
      ctx.textAlign='center';ctx.fillText(spec.view.xLabel,r.left+r.width/2,this.height-35);ctx.save();ctx.translate(17,r.top+r.height/2);ctx.rotate(-Math.PI/2);ctx.fillText(spec.view.yLabel,0,0);ctx.restore();
    }else{
      const m=cameraMatrix(spec.view.camera.azimuth,spec.view.camera.elevation,spec.view.camera.distance,r.width/r.height,this.pan3d);
      const pos=(x:number,y:number,z:number)=>[r.left+((m[0]*x+m[4]*y+m[8]*z+m[12])+1)/2*r.width,r.top+(1-(m[1]*x+m[5]*y+m[9]*z+m[13]))/2*r.height];
      for(const [axis,end,domain]of [['x',[1,-1,-1],this.bounds.x],['y',[-1,1,-1],this.bounds.y],['z',[-1,-1,1],this.zDomain]] as const){
        const p=pos(end[0],end[1],end[2]);ctx.textAlign='center';ctx.fillText(spec.view[`${axis}Label`]||axis,p[0],p[1]-12);
        for(const value of ticks(domain,spec.view[`${axis}Scale`],3)){const t=normalize(value,domain,spec.view[`${axis}Scale`]);if(t<.12)continue;const vector=[-1,-1,-1];vector[{x:0,y:1,z:2}[axis]]=t*2-1;const q=pos(vector[0],vector[1],vector[2]);ctx.fillText(formatTick(value,domain[1]-domain[0]),q[0]+12,q[1]+12);}
      }
    }
    let legendX=r.left;
    for(const layer of spec.layers.filter(l=>l.visible&&l.style.label)){
      ctx.fillStyle=layer.style.color??'#38bdf8';ctx.fillRect(legendX,this.height-19,12,3);ctx.fillStyle='#475569';ctx.textAlign='left';ctx.fillText(layer.style.label!,legendX+18,this.height-13);legendX+=ctx.measureText(layer.style.label!).width+42;
    }
    const colorLayer=spec.layers.find(l=>l.visible&&(l.kind==='heatmap'||l.kind==='surface'||l.data.color||this.plans.get(l.id)?.kind==='density'));
    if(colorLayer){
      const plan=this.plans.get(colorLayer.id),density=plan?.kind==='density'?plan:undefined;
      const values=colorLayer.data.color??colorLayer.data.z;
      const domain=colorLayer.style.colorDomain??(density?[0,Math.max(1,density.max)] as Domain:extent(this.figure.registry.get(values).values));
      const x=r.left+r.width+16,h=Math.min(r.height,180);
      for(let i=0;i<h;i++){const c=colorMap(1-i/h,[0,1],colorLayer.style.colormap);ctx.fillStyle=`rgb(${c[0]*255},${c[1]*255},${c[2]*255})`;ctx.fillRect(x,r.top+i,12,1.5);}
      ctx.fillStyle='#475569';ctx.textAlign='left';const labelWidth=Math.max(24,this.width-x-22);ctx.fillText(formatTick(domain[1]),x+17,r.top+8,labelWidth);ctx.fillText(formatTick(domain[0]),x+17,r.top+h,labelWidth);
      if(density){ctx.save();ctx.translate(x+8,r.top+h+12);ctx.rotate(Math.PI/2);ctx.fillText('count / bin',0,0);ctx.restore();}
    }
    const density=this.infos.find(i=>i.kind==='density');
    if(density){ctx.fillStyle='#475569';ctx.textAlign='right';ctx.fillText(`Density · count · ${density.visible.toLocaleString()} records`,r.left+r.width,this.height-13);}
    if(this.box){const [a,b,c,d]=this.box;ctx.fillStyle='#38bdf830';ctx.strokeStyle='#0284c7';ctx.fillRect(a,b,c-a,d-b);ctx.strokeRect(a,b,c-a,d-b);}
    if(this.tooltip){const t=this.tooltip;ctx.font='12px system-ui, sans-serif';const w=ctx.measureText(t.text).width+18,x=Math.max(0,Math.min(this.width-w,t.x+12)),y=Math.max(20,t.y-12);ctx.fillStyle='#0f172a';ctx.fillRect(x,y-18,w,27);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.fillText(t.text,x+9,y);}
    if(error){ctx.fillStyle='#fff';ctx.fillRect(0,0,this.width,this.height);ctx.fillStyle='#b91c1c';ctx.textAlign='left';ctx.fillText(error,15,35,this.width-30);}
  }
  private location(event:MouseEvent):[number,number]{const rect=this.overlay.getBoundingClientRect();return [event.clientX-rect.left,event.clientY-rect.top];}
  private inside(x:number,y:number):boolean{const r=this.rect;return x>=r.left&&x<=r.left+r.width&&y>=r.top&&y<=r.top+r.height;}
  private wheel=(event:WheelEvent):void=>{
    event.preventDefault();const [x,y]=this.location(event);if(!this.inside(x,y))return;
    const view=this.figure.spec.view,factor=Math.exp(Math.max(-1,Math.min(1,event.deltaY*.001)));
    if(view.kind==='3d'){this.figure.setView({camera:{...view.camera,distance:Math.max(1,Math.min(20,view.camera.distance*factor))}});}
    else {const tx=(x-this.rect.left)/this.rect.width,ty=1-(y-this.rect.top)/this.rect.height;
      const zoom=(d:Domain,t:number,scale:'linear'|'log'):Domain=>[denormalize(t+(0-t)*factor,d,scale),denormalize(t+(1-t)*factor,d,scale)];
      const xd=zoom(this.bounds.x,tx,view.xScale),yd=zoom(this.bounds.y,ty,view.yScale);
      if([...xd,...yd].every(Number.isFinite)&&xd[0]<xd[1]&&yd[0]<yd[1])this.figure.setView({xDomain:xd,yDomain:yd});
    }this.figure.emit('viewchange',structuredClone(this.figure.spec.view));
  };
  private pointerDown=(event:PointerEvent):void=>{
    const [x,y]=this.location(event);if(!this.inside(x,y)||event.button!==0)return;
    this.overlay.setPointerCapture(event.pointerId);this.tooltip=undefined;
    this.drag={x,y,lastX:x,lastY:y,select:event.shiftKey&&this.figure.spec.view.kind==='2d',pan:event.shiftKey,bounds:structuredClone(this.bounds)};
  };
  private pointerMove=(event:PointerEvent):void=>{
    const [x,y]=this.location(event),d=this.drag;
    if(!d){this.hover(x,y);return;}
    if(d.select){this.box=[d.x,d.y,Math.max(this.rect.left,Math.min(this.rect.left+this.rect.width,x)),Math.max(this.rect.top,Math.min(this.rect.top+this.rect.height,y))];this.drawOverlay();return;}
    const view=this.figure.spec.view;
    if(view.kind==='3d'){
      if(d.pan){this.pan3d=[this.pan3d[0]+(x-d.lastX)/this.rect.width*2,this.pan3d[1]-(y-d.lastY)/this.rect.height*2];this.schedule();}
      else this.figure.setView({camera:{...view.camera,azimuth:view.camera.azimuth+(x-d.lastX)*.5,elevation:Math.max(-89,Math.min(89,view.camera.elevation+(y-d.lastY)*.5))}});
      d.lastX=x;d.lastY=y;
    }else{
      const dx=(d.x-x)/this.rect.width,dy=(y-d.y)/this.rect.height;
      const shifted=(domain:Domain,t:number,scale:'linear'|'log'):Domain=>[denormalize(t,domain,scale),denormalize(1+t,domain,scale)];
      const xd=shifted(d.bounds.x,dx,view.xScale),yd=shifted(d.bounds.y,dy,view.yScale);
      if([...xd,...yd].every(Number.isFinite)&&xd[0]<xd[1]&&yd[0]<yd[1])this.figure.setView({xDomain:xd,yDomain:yd});
    }
  };
  private pointerUp=(event:PointerEvent):void=>{
    if(!this.drag)return;if(this.drag.select&&this.box)this.select(this.box);
    this.drag=undefined;this.box=undefined;if(this.overlay.hasPointerCapture(event.pointerId))this.overlay.releasePointerCapture(event.pointerId);
    this.drawOverlay();this.figure.emit('viewchange',structuredClone(this.figure.spec.view));
  };
  private pointToData(x:number,y:number):[number,number]{return [denormalize((x-this.rect.left)/this.rect.width,this.bounds.x,this.figure.spec.view.xScale),denormalize(1-(y-this.rect.top)/this.rect.height,this.bounds.y,this.figure.spec.view.yScale)];}
  private hover(x:number,y:number):void{
    this.tooltip=undefined;if(!this.inside(x,y)||this.figure.spec.view.kind==='3d'){this.drawOverlay();return;}
    const r=this.rect,view=this.figure.spec.view;
    for(const layer of this.figure.spec.layers.filter(l=>l.visible)){
      const plan=this.plans.get(layer.id);
      if(plan?.kind==='density'){
        const c=Math.min(plan.columns-1,Math.floor((x-r.left)/r.width*plan.columns)),row=Math.min(plan.rows-1,Math.floor((1-(y-r.top)/r.height)*plan.rows)),count=plan.counts[row*plan.columns+c];
        this.tooltip={x,y,text:`${count.toLocaleString()} records / bin`};this.figure.emit('hover',{kind:'density',layerId:layer.id,count,column:c,row});break;
      }
      const xs=this.figure.registry.get(layer.data.x).values,ys=this.figure.registry.get(layer.data.y).values;
      if(plan?.kind==='points'||plan?.kind==='line'){
        const groups=plan.kind==='points'?[plan.indices]:plan.segments;let best=64,index=-1;
        for(const group of groups)for(const i of group){const px=r.left+normalize(xs[i],this.bounds.x,view.xScale)*r.width,py=r.top+(1-normalize(ys[i],this.bounds.y,view.yScale))*r.height;const dist=(px-x)**2+(py-y)**2;if(dist<best){best=dist;index=i;}}
        if(index>=0){this.tooltip={x,y,text:`x=${xs[index]}  y=${ys[index]}`};this.figure.emit('hover',{kind:'point',layerId:layer.id,index,x:xs[index],y:ys[index]});break;}
      }else if(layer.kind==='heatmap'){
        const [vx,vy]=this.pointToData(x,y),xe=gridEdges(xs,view.xScale),ye=gridEdges(ys,view.yScale);
        const col=xe.findIndex((v,i)=>i<xe.length-1&&vx>=v&&vx<xe[i+1]),row=ye.findIndex((v,i)=>i<ye.length-1&&vy>=v&&vy<ye[i+1]);
        if(col>=0&&row>=0){const value=this.figure.registry.get(layer.data.z).values[row*xs.length+col];this.tooltip={x,y,text:`value=${value}`};this.figure.emit('hover',{kind:'cell',layerId:layer.id,row,column:col,value});break;}
      }
    }this.drawOverlay();
  }
  private select(box:[number,number,number,number]):void{
    const a=this.pointToData(box[0],box[1]),b=this.pointToData(box[2],box[3]);const bounds:Bounds={x:[Math.min(a[0],b[0]),Math.max(a[0],b[0])],y:[Math.min(a[1],b[1]),Math.max(a[1],b[1])]};
    for(const layer of this.figure.spec.layers.filter(l=>l.visible&&(l.kind==='scatter'||l.kind==='line'))){
      const xs=this.figure.registry.get(layer.data.x).values,ys=this.figure.registry.get(layer.data.y).values;
      const colors=layer.data.color?this.figure.registry.get(layer.data.color).values:undefined,density=this.plans.get(layer.id)?.kind==='density';
      let count=0;const indices:number[]=[];for(let i=0;i<xs.length;i++)if(xs[i]>=bounds.x[0]&&xs[i]<=bounds.x[1]&&ys[i]>=bounds.y[0]&&ys[i]<=bounds.y[1]&&(density||!colors||Number.isFinite(colors[i]))){count++;if(indices.length<10000)indices.push(i);}
      const result:Selection=this.plans.get(layer.id)?.kind==='density'?{kind:'density',layerId:layer.id,bounds,count}:{kind:'points',layerId:layer.id,indices,count,truncated:count>indices.length};this.figure.emit('selection',result);
    }
  }
  async exportPNG():Promise<Blob>{
    await this.ready();const canvas=document.createElement('canvas');canvas.width=this.renderer.canvas.width;canvas.height=this.renderer.canvas.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(this.renderer.canvas,0,0);ctx.drawImage(this.overlay,0,0);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding failed')),'image/png'));
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;if(this.raf)cancelAnimationFrame(this.raf);this.observer.disconnect();this.scheduler.dispose();this.renderer.dispose();
    for(const cleanup of this.cleanup)cleanup();this.root.remove();this.plans.clear();this.geometries.clear();this.extents.clear();
    for(const waiter of this.waiters.splice(0))waiter.reject(new Error('Figure view disposed'));
  }
}
