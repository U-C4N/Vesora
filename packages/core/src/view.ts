import type {Figure} from './figure';
import {QueryScheduler} from './scheduler';
import {extent,normalize,denormalize,ticks,formatTick} from './scales';
import {colorMap} from './color';
import {buildGeometry,gridEdges} from './geometry';
import {prepareBars} from './statistics';
import type {PreparedStatistics,StatMark} from './statistics';
import {buildStatisticsGeometry} from './statistics-geometry';
import {WebGLRenderer,cameraMatrix,identity} from './renderer';
import type {Geometry,PlotRect} from './renderer';
import type {Bounds,Domain,LayerSpec,PointPlan,LineResult,Query,RepresentationInfo,Selection,ViewSpec} from './types';

type PanelInfo=RepresentationInfo&{layerId:string;panelId?:string};
interface PanelFrame {
  id:string;title:string;view:ViewSpec;layers:LayerSpec[];
  cell:PlotRect;rect:PlotRect;bounds:Bounds;zDomain:Domain;legendRows:number;statusHeight:number;
  colorLayer?:LayerSpec;colorDomain?:Domain;colorDensity?:boolean;
}
export class FigureView {
  private root:HTMLDivElement;
  private stage:HTMLDivElement;
  private overlay:HTMLCanvasElement;
  private renderer:WebGLRenderer;
  // One scheduler/worker and one GPU context are shared by every panel.
  private scheduler=new QueryScheduler();
  private observer:ResizeObserver;
  private width=800;private height=520;private dpr=1;
  private panels:PanelFrame[]=[];
  private plans=new Map<string,PointPlan|LineResult>();
  private geometries=new Map<string,{key:string;geometry:Geometry}>();
  private extents=new Map<string,{key:string;domain?:Domain}>();
  private statistics=new Map<string,PreparedStatistics>();
  private barCache=new Map<string,{key:string;prepared:Map<string,PreparedStatistics>}>();
  private statisticsRequests=new Set<string>();
  private sources=new Set<string>();
  private infos:PanelInfo[]=[];
  private previous=new Map<string,'points'|'density'>();
  private generation=0;private completed=0;private raf=0;private disposed=false;
  private failure?:Error;
  private waiters:Array<{resolve:()=>void;reject:(error:Error)=>void}>=[];
  private cleanup:Array<()=>void>=[];
  private drag?:{pointerId:number;panelId:string;x:number;y:number;lastX:number;lastY:number;select:boolean;pan:boolean;bounds:Bounds;rect:PlotRect};
  private box?:[number,number,number,number];
  private tooltip?:{x:number;y:number;text:string};
  constructor(private figure:Figure,container:HTMLElement){
    this.root=document.createElement('div');this.root.className='vesora-figure';this.root.style.cssText='position:relative;width:100%;overflow:auto;background:white;color:#0f172a;font-family:system-ui,sans-serif;';
    this.root.style.height=`${figure.spec.height}px`;this.root.setAttribute('role','img');this.root.setAttribute('aria-label',figure.spec.title||'Scientific visualization');
    this.stage=document.createElement('div');this.stage.style.cssText='position:relative;';
    const canvas=document.createElement('canvas');canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;';
    this.overlay=document.createElement('canvas');this.overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
    this.overlay.tabIndex=0;this.overlay.setAttribute('aria-label','Plot controls: drag to pan, wheel to zoom, Shift-drag to select, double-click to reset');
    this.stage.append(canvas,this.overlay);this.root.append(this.stage);container.appendChild(this.root);
    try{this.renderer=new WebGLRenderer(canvas,message=>this.fail(new Error(message)));}catch(error){this.root.remove();this.scheduler.dispose();throw error;}
    this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(this.root);
    this.listen('wheel',this.wheel as EventListener,{passive:false});
    this.listen('pointerdown',this.pointerDown as EventListener);this.listen('pointermove',this.pointerMove as EventListener);this.listen('pointerup',this.pointerUp as EventListener);
    this.listen('pointercancel',(()=>{this.clearInteraction();this.drawOverlay();}) as EventListener);
    this.listen('pointerleave',(()=>{if(!this.drag){this.tooltip=undefined;this.drawOverlay();}}) as EventListener);
    this.listen('dblclick',((event:MouseEvent)=>{
      const panel=this.panelAt(...this.location(event));if(!panel)return;
      this.figure.restorePanelView(panel.id,{...this.figure.panelView(panel.id),xDomain:undefined,yDomain:undefined,zDomain:undefined,camera:{azimuth:35,elevation:25,distance:3},pan3d:[0,0]});
    }) as EventListener);
  }
  /** A replacement snapshot owns a new source identity space, even if ids and
   * versions happen to match a previous producer's data. */
  invalidateData():void{
    if(this.disposed)return;
    this.generation++;this.failure=undefined;
    for(const key of this.statisticsRequests)this.scheduler.cancel(key);
    for(const source of this.sources)this.scheduler.release(source);
    this.sources.clear();this.statisticsRequests.clear();
    this.extents.clear();this.geometries.clear();this.plans.clear();this.statistics.clear();this.barCache.clear();this.previous.clear();
    this.clearInteraction();
  }
  clearInteraction():void{
    if(this.drag&&this.overlay.hasPointerCapture(this.drag.pointerId))this.overlay.releasePointerCapture(this.drag.pointerId);
    this.drag=undefined;this.box=undefined;this.tooltip=undefined;
  }
  private listen(name:string,callback:EventListener,options?:AddEventListenerOptions):void{this.overlay.addEventListener(name,callback,options);this.cleanup.push(()=>this.overlay.removeEventListener(name,callback,options));}
  schedule():void{
    if(this.disposed)return;this.generation++;this.failure=undefined;
    if(!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;void this.render(this.generation);});
  }
  ready():Promise<void>{if(this.failure)return Promise.reject(this.failure);if(this.completed===this.generation)return Promise.resolve();return new Promise((resolve,reject)=>this.waiters.push({resolve,reject}));}
  inspect():PanelInfo[]{return this.infos.map(info=>({...info}));}
  private panelMetadata(id:string):{panelId?:string}{return this.figure.spec.layout?{panelId:id}:{};}
  private sourceExtent(layer:LayerSpec,axis:'x'|'y'|'z',scale:'linear'|'log'):Domain|undefined{
    const source=layer.data[axis];if(!source)return undefined;
    const entry=this.figure.registry.get(source),cacheKey=`${source}:${entry.descriptor.version}:${scale}:${layer.kind}:${axis}`;
    const cached=this.extents.get(source);if(cached?.key===cacheKey)return cached.domain;
    const values=layer.kind==='heatmap'&&(axis==='x'||axis==='y')?gridEdges(entry.values,scale):entry.values;
    // Pad only after linked panels have been unioned, including constant series.
    let min=Infinity,max=-Infinity;
    for(const value of values)if(Number.isFinite(value)&&(scale!=='log'||value>0)){if(value<min)min=value;if(value>max)max=value;}
    const domain:Domain|undefined=min===Infinity?undefined:[min,max];this.extents.set(source,{key:cacheKey,domain});return domain;
  }
  private categories(axis:'x'|'y',panelId:string):string[]|undefined{
    const spec=this.figure.spec,shared=spec.layout?.[axis==='x'?'shareX':'shareY'];
    return spec.categories?.[`${axis}:${shared?'shared':panelId}`];
  }
  private axisValue(axis:'x'|'y',value:number,panelId:string):string|number{
    return this.categories(axis,panelId)?.[value]??value;
  }
  private axisTicks(axis:'x'|'y',panel:PanelFrame,maximum:number):number[]{
    const labels=this.categories(axis,panel.id),domain=panel.bounds[axis];
    if(!labels)return ticks(domain,panel.view[`${axis}Scale`],maximum);
    const first=Math.max(0,Math.ceil(domain[0])),last=Math.min(labels.length-1,Math.floor(domain[1]));
    const step=Math.max(1,Math.ceil((last-first+1)/maximum)),values:number[]=[];
    for(let index=Math.ceil(first/step)*step;index<=last;index+=step)values.push(index);
    return values;
  }
  private domain(axis:'x'|'y'|'z',panelId:string,view:ViewSpec,statistics:Map<string,PreparedStatistics>):Domain{
    const explicit=view[`${axis}Domain`];if(explicit)return explicit;
    const scale=view[`${axis}Scale`],layout=this.figure.spec.layout;
    const shared=axis==='x'?layout?.shareX:axis==='y'?layout?.shareY:false;
    const layers=(shared?this.figure.spec.layers:this.figure.panelLayers(panelId)).filter(l=>l.visible&&(l.data[axis]||axis!=='z'&&statistics.has(l.id)));
    if(axis!=='z'){
      const labels=this.categories(axis,panelId);
      if(labels){
        // Category identities keep their stable slots, but a wide bar/box can
        // extend beyond a half-slot. Include visible geometry across shared panels.
        let min=-.5,max=Math.max(.5,labels.length-.5);
        for(const layer of layers){
          const prepared=statistics.get(layer.id),domain=prepared?.marks.length?prepared.bounds[axis]:undefined;
          if(domain?.every(Number.isFinite)){min=Math.min(min,domain[0]);max=Math.max(max,domain[1]);}
        }
        return [min,max];
      }
    }
    let min=Infinity,max=-Infinity,heatmap=false;
    for(const layer of layers){const prepared=statistics.get(layer.id),d=prepared&&axis!=='z'?(prepared.marks.length?prepared.bounds[axis]:undefined):this.sourceExtent(layer,axis,scale);if(d&&d.every(Number.isFinite)){min=Math.min(min,d[0]);max=Math.max(max,d[1]);if(layer.kind==='heatmap')heatmap=true;}}
    if(min===Infinity)return scale==='log'?[1,10]:[0,1];
    const domain:Domain=min===max?extent([min,max],scale):[min,max];
    if(heatmap)return domain;
    const padded:Domain=[denormalize(-.035,domain,scale),denormalize(1.035,domain,scale)];
    return padded.every(Number.isFinite)&&padded[0]<padded[1]&&(scale!=='log'||padded[0]>0)?padded:domain;
  }
  private layout(statistics:Map<string,PreparedStatistics>):PanelFrame[]{
    const spec=this.figure.spec,grid=spec.layout,rows=grid?.rows??1,cols=grid?.cols??1;
    this.root.style.height=`${spec.height}px`;
    this.width=Math.max(grid?cols*360:200,Math.round(this.root.clientWidth||spec.width));
    const header=grid&&spec.title?40:0;
    this.height=grid?Math.max(spec.height,header+rows*260):spec.height;this.dpr=Math.min(2,window.devicePixelRatio||1);
    this.stage.style.width=`${this.width}px`;this.stage.style.height=`${this.height}px`;
    const measure=this.overlay.getContext('2d')!;measure.font='12px system-ui, sans-serif';
    return this.figure.panelEntries().map(entry=>{
      const view=structuredClone(entry.view),layers=structuredClone(this.figure.panelLayers(entry.id).filter(l=>l.visible));
      const cell:PlotRect={left:entry.col*this.width/cols,top:header+entry.row*(this.height-header)/rows,width:this.width/cols,height:(this.height-header)/rows};
      let legendRows=0,used=0;const legendWidth=cell.width-(grid?110:170);
      for(const layer of layers.filter(l=>l.style.label)){
        const size=Math.min(legendWidth,measure.measureText(layer.style.label!).width+42);
        if(!legendRows||used+size>legendWidth){legendRows++;used=0;}used+=size;
      }
      const statusHeight=grid&&layers.some(l=>l.kind==='scatter'&&l.style.representation!=='points')?18:0;
      const extra=grid?Math.max(0,legendRows-1)*18+statusHeight:0;
      const top=grid?(entry.title?37:28):(spec.title?48:28);
      const rect:PlotRect={left:cell.left+(grid?70:85),top:cell.top+top,width:Math.max(40,cell.width-(grid?155:170)),height:Math.max(40,cell.height-top-82-extra)};
      return {id:entry.id,title:entry.title,view,layers,cell,rect,bounds:{x:this.domain('x',entry.id,view,statistics),y:this.domain('y',entry.id,view,statistics)},zDomain:this.domain('z',entry.id,view,statistics),legendRows,statusHeight};
    });
  }
  private async prepareStatistics(generation:number):Promise<Map<string,PreparedStatistics>>{
    const prepared=new Map<string,PreparedStatistics>(),spec=this.figure.spec;
    const visible=spec.layers.filter(layer=>layer.visible&&(layer.kind==='hist'||layer.kind==='boxplot'));
    const requested=new Set(visible.map(layer=>layer.id));
    for(const id of this.statisticsRequests)if(!requested.has(id))this.scheduler.cancel(id);
    this.statisticsRequests=requested;
    const sources=new Set(Array.from(this.figure.registry.entries(),([source])=>source));
    for(const source of this.sources)if(!sources.has(source)){this.scheduler.release(source);this.extents.delete(source);}
    this.sources=sources;
    const panelIds=new Set<string>();
    for(const panel of this.figure.panelEntries()){
      panelIds.add(panel.id);
      const layers=this.figure.panelLayers(panel.id).filter(layer=>layer.kind==='bar');
      if(!layers.length){this.barCache.delete(panel.id);continue;}
      const mode=spec.barModes?.[panel.id]??'group';
      const key=JSON.stringify([mode,layers.map(layer=>[layer.id,layer.visible,layer.options,Object.values(layer.data).map(source=>[source,this.figure.registry.get(source).descriptor.version])])]);
      let cached=this.barCache.get(panel.id);
      if(cached?.key!==key){cached={key,prepared:prepareBars(layers,this.figure.registry,mode)};this.barCache.set(panel.id,cached);}
      for(const [id,value] of cached.prepared)prepared.set(id,value);
    }
    for(const id of this.barCache.keys())if(!panelIds.has(id))this.barCache.delete(id);
    await Promise.all(visible.map(async layer=>{
      const result=await this.scheduler.queryStatistics(layer.id,structuredClone(layer),this.figure.registry);
      if(!this.disposed&&generation===this.generation)prepared.set(layer.id,result);
    }));
    return prepared;
  }
  private async render(generation:number):Promise<void>{
    try{
      const spec=this.figure.spec;
      this.overlay.setAttribute('aria-label',spec.view.kind==='3d'
        ?'Plot controls: drag to orbit, wheel to zoom, Shift-drag to pan, double-click to reset'
        :'Plot controls: drag to pan, wheel to zoom, Shift-drag to select, double-click to reset');
      this.root.setAttribute('aria-label',spec.title||'Scientific visualization');
      // Prepare raw-data statistics and complete panel-local bar placement before
      // resolving automatic/shared extents. The committed frame stays untouched.
      const nextStatistics=await this.prepareStatistics(generation);
      if(this.disposed||generation!==this.generation)return;
      const panels=this.layout(nextStatistics),nextPlans=new Map<string,PointPlan|LineResult>(),nextGeometry=new Map<string,{key:string;geometry:Geometry}>();
      const panelResults=await Promise.all(panels.map(async panel=>{
        const {bounds,zDomain,view,rect}=panel;
        const results=await Promise.all(panel.layers.map(async layer=>{
          const versions=Object.values(layer.data).map(source=>`${source}:${this.figure.registry.get(source).descriptor.version}`);
          const key=JSON.stringify([versions,layer.options,layer.style,bounds,zDomain,view.xScale,view.yScale,view.zScale,rect.width,rect.height,layer.kind==='bar'?this.barCache.get(panel.id)?.key:undefined]);
          const cache=this.geometries.get(layer.id);let plan:PointPlan|LineResult|undefined,info:PanelInfo;
          const prepared=nextStatistics.get(layer.id);
          if(prepared){
            info=this.statisticsInfo(prepared,panel);
          }else if(layer.kind==='line'||layer.kind==='scatter'){
            const query:Query={bounds,width:Math.round(rect.width),height:Math.round(rect.height),xScale:view.xScale,yScale:view.yScale,pointBudget:250_000,mode:layer.style.representation??'auto',previous:this.previous.get(layer.id)};
            plan=await this.scheduler.query(layer.id,layer.kind==='line'?'line':'scatter',layer.data.x,layer.data.y,query,this.figure.registry);
            nextPlans.set(layer.id,plan);info={...plan.info,layerId:layer.id,...this.panelMetadata(panel.id)};
          }else{
            const count=this.figure.registry.get(layer.data.z??layer.data.x).values.length;
            if(count>1_000_000)throw new Error(`${layer.kind} exceeds the initial renderer budget of 1,000,000 values. Reduce the grid or use 2D density exploration.`);
            info={layerId:layer.id,...this.panelMetadata(panel.id),kind:layer.kind==='heatmap'?'grid':layer.kind==='surface'?'surface':'points',total:count,visible:count,rendered:count,exact:true,method:layer.kind==='surface'?'regular-grid triangulation':layer.kind==='heatmap'?'scalar grid':'raw points'};
          }
          if(this.disposed||generation!==this.generation)throw new DOMException('Superseded','AbortError');
          const geometry=cache?.key===key?cache.geometry:prepared
            ?buildStatisticsGeometry(prepared,bounds,view,rect.width,rect.height,layer.style)
            :buildGeometry(layer,this.figure.registry,bounds,zDomain,view,rect.width,rect.height,plan);
          if(geometry.primitive==='points'){
            info.rendered=geometry.positions.length/3;info.visible=info.rendered;
            if(layer.data.color)info.method+='; non-finite scalar colors omitted';
          }else if(layer.kind==='surface'){
            info.rendered=geometry.positions.length/9;info.method='regular-grid triangles; invalid vertices omitted';
            const xs=this.figure.registry.get(layer.data.x).values,ys=this.figure.registry.get(layer.data.y).values,zs=this.figure.registry.get(layer.data.z).values;
            let valid=0;for(let i=0;i<zs.length;i++)if(Number.isFinite(normalize(xs[i%xs.length],bounds.x,view.xScale))&&Number.isFinite(normalize(ys[Math.floor(i/xs.length)],bounds.y,view.yScale))&&Number.isFinite(normalize(zs[i],zDomain,view.zScale)))valid++;
            info.visible=valid;
          }else if(layer.kind==='heatmap'){info.rendered=geometry.positions.length/18;info.visible=info.rendered;}
          nextGeometry.set(layer.id,{key,geometry});return {geometry,info};
        }));
        panel.colorLayer=panel.layers.find(l=>l.kind==='heatmap'||l.kind==='surface'||l.data.color||nextPlans.get(l.id)?.kind==='density');
        if(panel.colorLayer){
          const layer=panel.colorLayer,plan=nextPlans.get(layer.id),density=plan?.kind==='density'?plan:undefined;
          panel.colorDensity=!!density;
          panel.colorDomain=layer.style.colorDomain??(density?[0,Math.max(1,density.max)] as Domain:extent(this.figure.registry.get(layer.data.color??layer.data.z).values));
        }
        const items=results.map(result=>result.geometry);if(view.kind==='3d')items.unshift(this.axes3d());
        return {panel,items,infos:results.map(result=>result.info)};
      }));
      if(this.disposed||generation!==this.generation)return;
      // Neither canvas changes until every panel's current query succeeds.
      const live=new Set(nextGeometry.keys());
      for(const key of this.geometries.keys())if(!live.has(key)){this.scheduler.cancel(key);this.previous.delete(key);}
      const sources=new Set(Array.from(this.figure.registry.entries(),([source])=>source));
      for(const source of this.extents.keys())if(!sources.has(source)){this.extents.delete(source);this.scheduler.release(source);}
      this.renderer.beginFrame(this.width,this.height,this.dpr);
      for(const {panel,items} of panelResults){
        const {view,rect}=panel,matrix=view.kind==='3d'?cameraMatrix(view.camera.azimuth,view.camera.elevation,view.camera.distance,rect.width/rect.height,view.pan3d??[0,0]):identity;
        this.renderer.drawPanel(items,rect,matrix,view.kind==='3d');
      }
      this.renderer.endFrame();
      this.panels=panels;this.geometries=nextGeometry;this.plans=nextPlans;this.statistics=nextStatistics;this.infos=panelResults.flatMap(result=>result.infos);
      for(const [id,plan] of nextPlans)if(plan.kind==='points'||plan.kind==='density')this.previous.set(id,plan.kind);
      this.drawOverlay();this.completed=generation;this.figure.emit('representation',this.inspect());
      // A representation listener may synchronously invalidate this frame.
      if(this.completed===this.generation)for(const waiter of this.waiters.splice(0))waiter.resolve();
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
  private fitText(ctx:CanvasRenderingContext2D,text:string,width:number):string{
    if(ctx.measureText(text).width<=width)return text;
    const characters=Array.from(text);let low=0,high=characters.length;
    while(low<high){const middle=Math.ceil((low+high)/2);if(ctx.measureText(characters.slice(0,middle).join('')+'…').width<=width)low=middle;else high=middle-1;}
    return characters.slice(0,low).join('')+'…';
  }
  private drawOverlay(error?:string):void{
    if(this.disposed)return;const ctx=this.ctx(),spec=this.figure.spec;ctx.clearRect(0,0,this.width,this.height);
    ctx.font='12px system-ui, sans-serif';ctx.fillStyle='#334155';ctx.strokeStyle='#cbd5e1';ctx.lineWidth=1;
    if(error){ctx.fillStyle='#fff';ctx.fillRect(0,0,this.width,this.height);ctx.fillStyle='#b91c1c';ctx.textAlign='left';ctx.fillText(error,15,35,this.width-30);return;}
    if(spec.title){
      const left=this.width<480?16:(this.panels[0]?.rect.left??85),available=this.width-left-16;let size=17;
      ctx.font=`600 ${size}px system-ui, sans-serif`;
      while(size>13&&ctx.measureText(spec.title).width>available)ctx.font=`600 ${--size}px system-ui, sans-serif`;
      ctx.textAlign='left';ctx.fillText(this.fitText(ctx,spec.title,available),left,25);
    }
    for(const panel of this.panels)this.drawPanelOverlay(ctx,panel);
    if(this.box){const [a,b,c,d]=this.box;ctx.fillStyle='#38bdf830';ctx.strokeStyle='#0284c7';ctx.fillRect(a,b,c-a,d-b);ctx.strokeRect(a,b,c-a,d-b);}
    if(this.tooltip){const t=this.tooltip;ctx.font='12px system-ui, sans-serif';const text=this.fitText(ctx,t.text,Math.max(1,this.width-34)),w=ctx.measureText(text).width+18,x=Math.max(0,Math.min(this.width-w,t.x+12)),y=Math.max(20,t.y-12);ctx.fillStyle='#0f172a';ctx.fillRect(x,y-18,w,27);ctx.fillStyle='#fff';ctx.textAlign='left';ctx.fillText(text,x+9,y);}
  }
  private drawPanelOverlay(ctx:CanvasRenderingContext2D,panel:PanelFrame):void{
    const {rect:r,cell,view,bounds,zDomain,layers}=panel,grid=!!this.figure.spec.layout,bottom=cell.top+cell.height;
    ctx.save();ctx.beginPath();ctx.rect(cell.left,cell.top,cell.width,cell.height);ctx.clip();
    ctx.font='12px system-ui, sans-serif';ctx.fillStyle='#334155';ctx.strokeStyle='#cbd5e1';ctx.lineWidth=1;
    if(grid&&panel.title){ctx.font='600 14px system-ui, sans-serif';ctx.textAlign='left';ctx.fillText(this.fitText(ctx,panel.title,cell.width-90),cell.left+70,cell.top+19);ctx.font='12px system-ui, sans-serif';}
    if(view.kind==='2d'){
      const xSpan=bounds.x[1]-bounds.x[0],ySpan=bounds.y[1]-bounds.y[0];
      const xLabels=this.categories('x',panel.id),yLabels=this.categories('y',panel.id);
      const xOffset=!xLabels&&view.xScale==='linear'&&Math.abs(bounds.x[0])/xSpan>1e5?bounds.x[0]:0;
      const yOffset=!yLabels&&view.yScale==='linear'&&Math.abs(bounds.y[0])/ySpan>1e5?bounds.y[0]:0;
      ctx.strokeRect(r.left,r.top,r.width,r.height);
      for(const value of this.axisTicks('x',panel,Math.max(2,Math.floor(r.width/100)))){
        const x=r.left+normalize(value,bounds.x,view.xScale)*r.width;ctx.strokeStyle='#e2e8f0';ctx.beginPath();ctx.moveTo(x,r.top);ctx.lineTo(x,r.top+r.height);ctx.stroke();
        ctx.fillStyle='#334155';ctx.textAlign='center';ctx.fillText(xLabels?this.fitText(ctx,xLabels[value],Math.max(20,Math.min(100,r.width/Math.max(1,Math.min(xLabels.length,r.width/100))))):formatTick(value-xOffset,xSpan),x,r.top+r.height+20);
      }
      for(const value of this.axisTicks('y',panel,Math.max(2,Math.floor(r.height/65)))){
        const y=r.top+(1-normalize(value,bounds.y,view.yScale))*r.height;ctx.strokeStyle='#e2e8f0';ctx.beginPath();ctx.moveTo(r.left,y);ctx.lineTo(r.left+r.width,y);ctx.stroke();
        ctx.textAlign='right';ctx.fillText(yLabels?this.fitText(ctx,yLabels[value],grid?45:65):formatTick(value-yOffset,ySpan),r.left-9,y+4,grid?45:65);
      }
      if(xOffset){ctx.textAlign='right';ctx.fillText(this.fitText(ctx,`offset ${xOffset>=0?'+':''}${xOffset}`,r.width),r.left+r.width,r.top+r.height+36);}
      if(yOffset){ctx.textAlign='left';ctx.fillText(this.fitText(ctx,`offset ${yOffset>=0?'+':''}${yOffset}`,r.width),r.left,r.top-8);}
      ctx.textAlign='center';ctx.fillText(this.fitText(ctx,view.xLabel,r.width),r.left+r.width/2,r.top+r.height+47);
      ctx.save();ctx.translate(cell.left+17,r.top+r.height/2);ctx.rotate(-Math.PI/2);ctx.fillText(this.fitText(ctx,view.yLabel,r.height),0,0);ctx.restore();
      this.drawAnnotations(ctx,panel);
    }else{
      const m=cameraMatrix(view.camera.azimuth,view.camera.elevation,view.camera.distance,r.width/r.height,view.pan3d??[0,0]);
      const pos=(x:number,y:number,z:number)=>[r.left+((m[0]*x+m[4]*y+m[8]*z+m[12])+1)/2*r.width,r.top+(1-(m[1]*x+m[5]*y+m[9]*z+m[13]))/2*r.height];
      for(const [axis,end,domain]of [['x',[1,-1,-1],bounds.x],['y',[-1,1,-1],bounds.y],['z',[-1,-1,1],zDomain]] as const){
        const p=pos(end[0],end[1],end[2]);ctx.textAlign='center';ctx.fillText(view[`${axis}Label`]||axis,p[0],p[1]-12);
        for(const value of ticks(domain,view[`${axis}Scale`],3)){const t=normalize(value,domain,view[`${axis}Scale`]);if(t<.12)continue;const vector=[-1,-1,-1];vector[{x:0,y:1,z:2}[axis]]=t*2-1;const q=pos(vector[0],vector[1],vector[2]);ctx.fillText(formatTick(value,domain[1]-domain[0]),q[0]+12,q[1]+12);}
      }
    }
    let legendX=r.left,legendY=bottom-13-panel.statusHeight-(grid?Math.max(0,panel.legendRows-1)*18:0);
    const legendRight=grid?cell.left+cell.width-40:Infinity;
    for(const layer of layers.filter(l=>l.style.label)){
      const label=this.fitText(ctx,layer.style.label!,Math.max(20,legendRight-r.left-42)),itemWidth=ctx.measureText(label).width+42;
      if(grid&&legendX>r.left&&legendX+itemWidth>legendRight){legendX=r.left;legendY+=18;}
      ctx.fillStyle=layer.style.color??'#38bdf8';ctx.fillRect(legendX,legendY-6,12,3);ctx.fillStyle='#475569';ctx.textAlign='left';ctx.fillText(label,legendX+18,legendY);legendX+=itemWidth;
    }
    const colorLayer=panel.colorLayer;
    if(colorLayer){
      const density=panel.colorDensity,domain=panel.colorDomain!;
      const x=r.left+r.width+16,h=Math.min(r.height,180);
      for(let i=0;i<h;i++){const c=colorMap(1-i/h,[0,1],colorLayer.style.colormap);ctx.fillStyle=`rgb(${c[0]*255},${c[1]*255},${c[2]*255})`;ctx.fillRect(x,r.top+i,12,1.5);}
      ctx.fillStyle='#475569';ctx.textAlign='left';const labelWidth=Math.max(24,cell.left+cell.width-x-22);ctx.fillText(formatTick(domain[1]),x+17,r.top+8,labelWidth);ctx.fillText(formatTick(domain[0]),x+17,r.top+h,labelWidth);
      if(density){ctx.save();ctx.translate(x+8,r.top+h+12);ctx.rotate(Math.PI/2);ctx.fillText('count / bin',0,0);ctx.restore();}
    }
    const density=this.infos.find(i=>i.kind==='density'&&layers.some(layer=>layer.id===i.layerId));
    if(density){ctx.fillStyle='#475569';ctx.textAlign='right';ctx.fillText(this.fitText(ctx,`Density · count · ${density.visible.toLocaleString()} records`,r.width),r.left+r.width,bottom-13);}
    ctx.restore();
  }
  private drawAnnotations(ctx:CanvasRenderingContext2D,panel:PanelFrame):void{
    const {rect:r,bounds,view}=panel;
    ctx.save();ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.clip();
    for(const annotation of this.figure.spec.annotations??[]){
      if((annotation.panelId??'main')!==panel.id)continue;
      const {style}=annotation;ctx.strokeStyle=ctx.fillStyle=style.color??'#475569';ctx.lineWidth=style.width??1;ctx.globalAlpha=style.opacity??1;
      const x=annotation.x===undefined?NaN:r.left+normalize(annotation.x,bounds.x,view.xScale)*r.width;
      const y=annotation.y===undefined?NaN:r.top+(1-normalize(annotation.y,bounds.y,view.yScale))*r.height;
      if(annotation.kind==='text'&&Number.isFinite(x)&&Number.isFinite(y)){
        const size=style.fontSize??12;ctx.font=`${size}px system-ui, sans-serif`;ctx.textAlign='left';
        for(const [i,line] of (annotation.text??'').split('\n').entries())ctx.fillText(line,x,y+i*size*1.2);
      }else if(annotation.kind==='hline'&&Number.isFinite(y)){ctx.beginPath();ctx.moveTo(r.left,y);ctx.lineTo(r.left+r.width,y);ctx.stroke();}
      else if(annotation.kind==='vline'&&Number.isFinite(x)){ctx.beginPath();ctx.moveTo(x,r.top);ctx.lineTo(x,r.top+r.height);ctx.stroke();}
    }
    ctx.restore();
  }
  private location(event:MouseEvent):[number,number]{const rect=this.overlay.getBoundingClientRect();return [event.clientX-rect.left,event.clientY-rect.top];}
  private panelAt(x:number,y:number):PanelFrame|undefined{return this.panels.find(({rect:r})=>x>=r.left&&x<=r.left+r.width&&y>=r.top&&y<=r.top+r.height);}
  private wheel=(event:WheelEvent):void=>{
    const [x,y]=this.location(event),panel=this.panelAt(x,y);if(!panel)return;event.preventDefault();
    const view=this.figure.panelView(panel.id),factor=Math.exp(Math.max(-1,Math.min(1,event.deltaY*.001))),r=panel.rect;
    if(view.kind==='3d'){this.figure.setPanelView(panel.id,{camera:{...view.camera,distance:Math.max(1,Math.min(20,view.camera.distance*factor))}});}
    else {const tx=(x-r.left)/r.width,ty=1-(y-r.top)/r.height;
      const zoom=(d:Domain,t:number,scale:'linear'|'log'):Domain=>[denormalize(t+(0-t)*factor,d,scale),denormalize(t+(1-t)*factor,d,scale)];
      const xd=zoom(panel.bounds.x,tx,view.xScale),yd=zoom(panel.bounds.y,ty,view.yScale);
      if([...xd,...yd].every(Number.isFinite)&&xd[0]<xd[1]&&yd[0]<yd[1])this.figure.setPanelView(panel.id,{xDomain:xd,yDomain:yd});
    }this.figure.emitViewChange(panel.id);
  };
  private pointerDown=(event:PointerEvent):void=>{
    const [x,y]=this.location(event),panel=this.panelAt(x,y);if(!panel||event.button!==0)return;
    this.overlay.setPointerCapture(event.pointerId);this.tooltip=undefined;
    this.drag={pointerId:event.pointerId,panelId:panel.id,x,y,lastX:x,lastY:y,select:event.shiftKey&&panel.view.kind==='2d',pan:event.shiftKey,bounds:structuredClone(panel.bounds),rect:{...panel.rect}};
  };
  private pointerMove=(event:PointerEvent):void=>{
    const [x,y]=this.location(event),d=this.drag;
    if(!d){this.hover(x,y);return;}
    const r=d.rect;
    if(d.select){this.box=[d.x,d.y,Math.max(r.left,Math.min(r.left+r.width,x)),Math.max(r.top,Math.min(r.top+r.height,y))];this.drawOverlay();return;}
    const view=this.figure.panelView(d.panelId);
    if(view.kind==='3d'){
      if(d.pan){const pan=view.pan3d??[0,0];this.figure.setPanelView(d.panelId,{pan3d:[pan[0]+(x-d.lastX)/r.width*2,pan[1]-(y-d.lastY)/r.height*2]});}
      else this.figure.setPanelView(d.panelId,{camera:{...view.camera,azimuth:view.camera.azimuth+(x-d.lastX)*.5,elevation:Math.max(-89,Math.min(89,view.camera.elevation+(y-d.lastY)*.5))}});
      d.lastX=x;d.lastY=y;
    }else{
      const dx=(d.x-x)/r.width,dy=(y-d.y)/r.height;
      const shifted=(domain:Domain,t:number,scale:'linear'|'log'):Domain=>[denormalize(t,domain,scale),denormalize(1+t,domain,scale)];
      const xd=shifted(d.bounds.x,dx,view.xScale),yd=shifted(d.bounds.y,dy,view.yScale);
      if([...xd,...yd].every(Number.isFinite)&&xd[0]<xd[1]&&yd[0]<yd[1])this.figure.setPanelView(d.panelId,{xDomain:xd,yDomain:yd});
    }
  };
  private pointerUp=(event:PointerEvent):void=>{
    const d=this.drag;if(!d)return;const panel=this.panels.find(panel=>panel.id===d.panelId);
    if(d.select&&this.box&&panel)this.select(this.box,panel);
    this.drag=undefined;this.box=undefined;if(this.overlay.hasPointerCapture(event.pointerId))this.overlay.releasePointerCapture(event.pointerId);
    this.drawOverlay();this.figure.emitViewChange(d.panelId);
  };
  private pointToData(x:number,y:number,panel:PanelFrame):[number,number]{const {rect:r,bounds,view}=panel;return [denormalize((x-r.left)/r.width,bounds.x,view.xScale),denormalize(1-(y-r.top)/r.height,bounds.y,view.yScale)];}
  private statisticsInfo(prepared:PreparedStatistics,panel:PanelFrame):PanelInfo{
    const drawn=new Set<number>(),bounds=panel.bounds;
    for(const mark of prepared.marks){
      const target=this.markBounds(mark);
      const x0=Math.max(target.x[0],bounds.x[0]),x1=Math.min(target.x[1],bounds.x[1]);
      const y0=Math.max(target.y[0],bounds.y[0]),y1=Math.min(target.y[1],bounds.y[1]);
      if(x0>x1||y0>y1)continue;
      if(mark.kind==='rect'&&mark.role!=='box'&&(x0===x1||y0===y1))continue;
      if(mark.kind==='segment'&&mark.x0===mark.x1&&mark.y0===mark.y1)continue;
      drawn.add(mark.itemIndex);
    }
    let visible=0;
    for(const index of drawn){const item=prepared.items[index];visible+=item.kind==='bar'?1:item.count;}
    const aggregate=prepared.kind==='hist'?'bins':prepared.kind==='boxplot'?'groups':undefined;
    return {...prepared.info,layerId:prepared.layerId,...this.panelMetadata(panel.id),visible,rendered:drawn.size,
      method:prepared.info.method+(aggregate?`; visible samples count whole intersecting ${aggregate}, not a raw-sample viewport filter`:'')};
  }
  private markBounds(mark:StatMark):Bounds{
    return mark.kind==='point'?{x:[mark.x,mark.x],y:[mark.y,mark.y]}:{x:[Math.min(mark.x0,mark.x1),Math.max(mark.x0,mark.x1)],y:[Math.min(mark.y0,mark.y1),Math.max(mark.y0,mark.y1)]};
  }
  private markDistance(mark:StatMark,x:number,y:number,panel:PanelFrame):number{
    const px=(value:number)=>panel.rect.left+normalize(value,panel.bounds.x,panel.view.xScale)*panel.rect.width;
    const py=(value:number)=>panel.rect.top+(1-normalize(value,panel.bounds.y,panel.view.yScale))*panel.rect.height;
    if(mark.kind==='point')return (px(mark.x)-x)**2+(py(mark.y)-y)**2;
    const x0=px(mark.x0),y0=py(mark.y0),x1=px(mark.x1),y1=py(mark.y1);
    if(mark.kind==='rect')return Math.max(Math.min(x0,x1)-x,0,x-Math.max(x0,x1))**2+Math.max(Math.min(y0,y1)-y,0,y-Math.max(y0,y1))**2;
    const dx=x1-x0,dy=y1-y0,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((x-x0)*dx+(y-y0)*dy)/length)):0;
    return (x0+t*dx-x)**2+(y0+t*dy-y)**2;
  }
  private statisticsHover(prepared:PreparedStatistics,layer:LayerSpec,x:number,y:number,panel:PanelFrame):boolean{
    let best=64,hit:StatMark|undefined;
    for(let index=prepared.marks.length-1;index>=0;index--){
      const mark=prepared.marks[index],distance=this.markDistance(mark,x,y,panel);
      if(distance<best){best=distance;hit=mark;}
    }
    if(!hit)return false;
    const item=prepared.items[hit.itemIndex];if(!item)return false;
    const metadata={layerId:layer.id,...this.panelMetadata(panel.id)},format=(value:number)=>formatTick(value);
    if(item.kind==='hist'){
      const rightClosed=item.binIndex===prepared.items.length-1;
      this.tooltip={x,y,text:`[${format(item.left)}, ${format(item.right)}${rightClosed?']':')'} · count=${item.count} · height=${format(item.height)}`};
      this.figure.emit('hover',{...item,...metadata,kind:'bin'});
    }else if(item.kind==='bar'){
      const axis=item.orientation==='horizontal'?'y':'x',position=this.axisValue(axis,item.position,panel.id);
      this.tooltip={x,y,text:`${position} · value=${format(item.value)} · start=${format(item.start)} · end=${format(item.end)}`};
      this.figure.emit('hover',{...item,...metadata,kind:'bar',category:position});
    }else{
      const axis=layer.options&&'orientation' in layer.options&&layer.options.orientation==='horizontal'?'y':'x',group=this.axisValue(axis,item.position,panel.id);
      if(hit.kind==='point'){
        this.tooltip={x,y,text:`${group} · outlier=${format(hit.value)} · sample=${hit.sourceIndex}`};
        this.figure.emit('hover',{...item,...metadata,kind:'outlier',group,sourceIndex:hit.sourceIndex,value:hit.value});
      }else{
        this.tooltip={x,y,text:`${group} · n=${item.count} · Q1=${format(item.q1)} · median=${format(item.median)} · Q3=${format(item.q3)} · whiskers=[${format(item.whiskerLow)}, ${format(item.whiskerHigh)}] · outliers=${item.outlierCount}`};
        this.figure.emit('hover',{...item,...metadata,kind:'box',group});
      }
    }
    return true;
  }
  private hover(x:number,y:number):void{
    this.tooltip=undefined;const panel=this.panelAt(x,y);if(!panel||panel.view.kind==='3d'||this.completed!==this.generation||this.failure){this.drawOverlay(this.failure?.message);return;}
    const {rect:r,view,bounds}=panel,metadata=this.panelMetadata(panel.id);
    for(const layer of [...panel.layers].reverse()){
      const prepared=this.statistics.get(layer.id);
      if(prepared){if(this.statisticsHover(prepared,layer,x,y,panel))break;continue;}
      const plan=this.plans.get(layer.id);
      if(plan?.kind==='density'){
        const c=Math.min(plan.columns-1,Math.floor((x-r.left)/r.width*plan.columns)),row=Math.min(plan.rows-1,Math.floor((1-(y-r.top)/r.height)*plan.rows)),count=plan.counts[row*plan.columns+c];
        this.tooltip={x,y,text:`${count.toLocaleString()} records / bin`};this.figure.emit('hover',{kind:'density',layerId:layer.id,...metadata,count,column:c,row});break;
      }
      const xs=this.figure.registry.get(layer.data.x).values,ys=this.figure.registry.get(layer.data.y).values;
      if(plan?.kind==='points'||plan?.kind==='line'){
        const groups=plan.kind==='points'?[plan.indices]:plan.segments;let best=64,index=-1;
        for(const group of groups)for(const i of group){const px=r.left+normalize(xs[i],bounds.x,view.xScale)*r.width,py=r.top+(1-normalize(ys[i],bounds.y,view.yScale))*r.height;const dist=(px-x)**2+(py-y)**2;if(dist<best){best=dist;index=i;}}
        if(index>=0){const xv=this.axisValue('x',xs[index],panel.id),yv=this.axisValue('y',ys[index],panel.id);this.tooltip={x,y,text:`x=${xv}  y=${yv}`};this.figure.emit('hover',{kind:'point',layerId:layer.id,...metadata,index,x:xv,y:yv,...(layer.categorical?{xCoordinate:xs[index],yCoordinate:ys[index]}:{})});break;}
      }else if(layer.kind==='heatmap'){
        const [vx,vy]=this.pointToData(x,y,panel),xe=gridEdges(xs,view.xScale),ye=gridEdges(ys,view.yScale);
        const col=xe.findIndex((v,i)=>i<xe.length-1&&vx>=v&&vx<xe[i+1]),row=ye.findIndex((v,i)=>i<ye.length-1&&vy>=v&&vy<ye[i+1]);
        if(col>=0&&row>=0){const value=this.figure.registry.get(layer.data.z).values[row*xs.length+col];this.tooltip={x,y,text:`value=${value}`};this.figure.emit('hover',{kind:'cell',layerId:layer.id,...metadata,row,column:col,value});break;}
      }
    }this.drawOverlay();
  }
  private select(box:[number,number,number,number],panel:PanelFrame):void{
    if(this.completed!==this.generation||this.failure)return;
    const a=this.pointToData(box[0],box[1],panel),b=this.pointToData(box[2],box[3],panel);const bounds:Bounds={x:[Math.min(a[0],b[0]),Math.max(a[0],b[0])],y:[Math.min(a[1],b[1]),Math.max(a[1],b[1])]};
    for(const layer of panel.layers){
      const prepared=this.statistics.get(layer.id);
      if(prepared){
        const selected=new Set<number>();
        for(const mark of prepared.marks){
          const target=this.markBounds(mark);
          if(target.x[0]<=bounds.x[1]&&target.x[1]>=bounds.x[0]&&target.y[0]<=bounds.y[1]&&target.y[1]>=bounds.y[0])selected.add(prepared.items[mark.itemIndex].index);
        }
        const indices=Array.from(selected).sort((a,b)=>a-b).slice(0,10000);
        const result:Selection={kind:prepared.kind==='hist'?'bins':prepared.kind==='bar'?'bars':'boxes',layerId:layer.id,...this.panelMetadata(panel.id),indices,count:selected.size,truncated:selected.size>indices.length};
        this.figure.emit('selection',result);continue;
      }
      if(layer.kind!=='scatter'&&layer.kind!=='line')continue;
      const xs=this.figure.registry.get(layer.data.x).values,ys=this.figure.registry.get(layer.data.y).values;
      const colors=layer.data.color?this.figure.registry.get(layer.data.color).values:undefined,density=this.plans.get(layer.id)?.kind==='density';
      let count=0;const indices:number[]=[];for(let i=0;i<xs.length;i++)if(xs[i]>=bounds.x[0]&&xs[i]<=bounds.x[1]&&ys[i]>=bounds.y[0]&&ys[i]<=bounds.y[1]&&(density||!colors||Number.isFinite(colors[i]))){count++;if(indices.length<10000)indices.push(i);}
      const metadata=this.panelMetadata(panel.id);
      const result:Selection=density?{kind:'density',layerId:layer.id,...metadata,bounds,count}:{kind:'points',layerId:layer.id,...metadata,indices,count,truncated:count>indices.length};this.figure.emit('selection',result);
    }
  }
  async exportPNG():Promise<Blob>{
    do{await this.ready();}while(this.completed!==this.generation);
    if(this.failure)throw this.failure;
    const canvas=document.createElement('canvas');canvas.width=this.renderer.canvas.width;canvas.height=this.renderer.canvas.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(this.renderer.canvas,0,0);ctx.drawImage(this.overlay,0,0);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding failed')),'image/png'));
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;if(this.raf)cancelAnimationFrame(this.raf);this.observer.disconnect();this.scheduler.dispose();this.renderer.dispose();
    for(const cleanup of this.cleanup)cleanup();this.root.remove();this.plans.clear();this.geometries.clear();this.extents.clear();this.statistics.clear();this.barCache.clear();this.statisticsRequests.clear();this.sources.clear();this.panels=[];
    for(const waiter of this.waiters.splice(0))waiter.reject(new Error('Figure view disposed'));
  }
}
