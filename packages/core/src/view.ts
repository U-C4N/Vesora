import {Figure} from './figure';
import {DataRegistry} from './data';
import {SnapshotStore,ownFrameEntry} from './snapshot-store';
import type {SnapshotLease} from './snapshot-store';
import {streamError} from './streaming';
import type {DataEntry,InspectionState,StreamState} from './types';
import {validateExportPNGOptions,validateExportRaster} from './export-options';
import {buildXInspectionIndex,nearestWithinRun} from './inspection';
import {pick3D,picking3DStats} from './picking3d';
import type {XInspectionIndex} from './inspection';
import type {BandResult,ExportPNGOptions,XHoverEvent,ReadyOptions,Snapshot,NumericArray} from './types';
import {QueryScheduler} from './scheduler';
import {runSteps} from './planning';
import {hoverIndexSteps,hoverCandidates} from './interaction';
import type {HoverIndex} from './interaction';
import {entryExtent} from './source-metadata';
import type {LinkedResult} from './linked';
import type {SelectionLinkSpec,LinkedSelection} from './types';
import {extent,normalize,denormalize,ticks,formatTick} from './scales';
import {LIGHT_THEME,formatValue,formatTimeTick} from './presentation';
import {parseColor} from './color';
import type {ScaleKind,ThemeTokens,HoverEvent,PointerPosition} from './types';
import {colorMap} from './color';
import {buildGeometry,gridEdges} from './geometry';
import {prepareBars} from './statistics';
import type {PreparedStatistics,StatMark} from './statistics';
import {buildStatisticsGeometry} from './statistics-geometry';
import {WebGLRenderer,cameraMatrix,cameraPreset,scientificAspect,geometryByteLength,geometryVertexCount,identity} from './renderer';
import type {Geometry,PlotRect} from './renderer';
import type {Bounds,Domain,LayerSpec,PointPlan,LineResult,Query,RepresentationInfo,Selection,ViewSpec} from './types';

type PanelInfo=RepresentationInfo&{layerId:string;panelId?:string};
type AxisTick={value:number;label:string;position:number};
type RenderTarget={width:number;height:number;scale:number};
// A color channel is a separate measured quantity; z labels describe geometry.
const colorbarLabel=(layer:LayerSpec,density:boolean,view:ViewSpec):string=>layer.style.colorbarLabel??(density?'count / bin':layer.data.color?'value':view.zLabel);
interface PanelFrame {
  id:string;title:string;view:ViewSpec;layers:LayerSpec[];
  cell:PlotRect;rect:PlotRect;bounds:Bounds;zDomain:Domain;legendRows:number;statusHeight:number;
  colorLayer?:LayerSpec;colorDomain?:Domain;colorDensity?:boolean;
  reservedColor:boolean;reservedDensity:boolean;
  xTicks:AxisTick[];yTicks:AxisTick[];xOffset:number;yOffset:number;legendTop:number;labelY:number;
}
export class FigureView {
  private root:HTMLDivElement;
  private stage:HTMLDivElement;
  private overlay:HTMLCanvasElement;
  private renderer:WebGLRenderer;
  // One scheduler/worker and one GPU context are shared by every panel.
  private scheduler:QueryScheduler;
  private observer:ResizeObserver;
  private width=800;private height=520;private dpr=1;
  private renderingStacked=false;
  private displayedLayout?:{stacked:boolean;width:number;height:number};
  private panels:PanelFrame[]=[];
  private plans=new Map<string,PointPlan|LineResult|BandResult>();
  private geometries=new Map<string,{key:string;geometry:Geometry}>();
  private extents=new Map<string,{key:string;domain?:Domain}>();
  private statistics=new Map<string,PreparedStatistics>();
  private barCache=new Map<string,{key:string;prepared:Map<string,PreparedStatistics>}>();
  private statisticsRequests=new Set<string>();
  private sources=new Set<string>();
  private infos:PanelInfo[]=[];
  private previous=new Map<string,'points'|'density'>();
  private linkedResult?:LinkedResult;
  private linkedSpec?:SelectionLinkSpec;
  private selectedPlans=new Map<string,PointPlan>();
  private clearSelectionButton:HTMLButtonElement;
  private selectionStatus:HTMLSpanElement;
  private generation=0;private completed=0;private raf=0;private disposed=false;
  private requestedRevision=0;private committedRevision=0;private frameRevision=0;private rendering=false;
  private renderingFigure?:Figure;private committedFigure?:Figure;
  private frozenFigure?:Figure;private frozenLease?:SnapshotLease;private snapshotSerial=0;
  private snapshotId?:string;private frameCopies=new WeakMap<DataEntry,DataEntry>();
  private committedAt='';
  private deferredInvalidation=false;
  private snapshotStore:SnapshotStore;
  private ownsSnapshotStore:boolean;
  private retiredSnapshots=new Set<SnapshotLease>();
  private overlaySource?:Figure;
  private lastFrameMs=0;private frameStarted=0;private completedFrames=0;
  private committedGeometryBytes=0;
  private frameCopiedBytes=0;private exportCopiedBytes=0;
  private geometryBuilds=0;private geometryBuildMs=0;private lastPlanningMs=0;private lastDrawMs=0;
  private axesGeometry?:{color:string;geometry:Geometry};
  private hoverRaf=0;private pendingHover?:[number,number];private selectionSequence=0;
  private failure?:Error;
  private waiters:Array<{revision:number;resolve:()=>void;reject:(error:Error)=>void}>=[];
  private cleanup:Array<()=>void>=[];
  private drag?:{pointerId:number;panelId:string;x:number;y:number;lastX:number;lastY:number;select:boolean;pan:boolean;bounds:Bounds;rect:PlotRect;moved?:boolean};
  private box?:[number,number,number,number];
  private tooltip?:{x:number;y:number;text:string};
  private hoverHit?:HoverEvent;
  private selectedHit?:HoverEvent;
  private xHover?:XHoverEvent;
  private xPinned=false;
  private inspection=new Map<string,{key:string;index:XInspectionIndex}>();
  private hoverIndices=new Map<string,{plan:PointPlan|LineResult;index?:HoverIndex}>();
  private lastHover?:[number,number];
  private exportQueue:Promise<unknown>=Promise.resolve();
  private exportReservations=new Set<AbortController>();
  private pointerPosition:PointerPosition={x:0,y:0,clientX:0,clientY:0};
  private fontKey='';
  private fontReady:Promise<void>=Promise.resolve();
  /** A frame and its inspection callbacks must read the same immutable source versions. */
  private get source():Figure{return this.overlaySource??this.renderingFigure??this.committedFigure??this.figure;}
  private get displayedSource():Figure{return this.committedFigure??this.figure;}
  private get interactionFigure():Figure{return this.frozenFigure??this.figure;}
  private captureFigure(source=this.frozenFigure??this.figure,registry?:DataRegistry):Figure{
    const captured=Object.create(source) as Figure,owned=registry??new DataRegistry();
    if(!registry)for(const [id,entry]of source.registry.entries())owned.store.set(id,this.renderTarget||source===this.frozenFigure?entry:ownFrameEntry(entry,this.frameCopies,bytes=>{this.frameCopiedBytes+=bytes;}));
    Object.defineProperties(captured,{spec:{value:structuredClone(source.spec),writable:true},registry:{value:owned},presentation:{value:{...source.presentation}},streams:{value:new Map([...source.streams].map(([id,state])=>[id,{...state}]))},pendingLink:{value:structuredClone(source.selectionRequest()),writable:true},acceptedRevision:{value:source.acceptedRevision,writable:true},view:{value:undefined},changed:{value:()=>this.scheduleInspection()}});
    return captured;
  }
  private get theme():ThemeTokens{return this.source.spec.theme??LIGHT_THEME as ThemeTokens;}
  private get fonts(){const t=this.theme;return {title:t.titleFontSize??t.fontSize+4,label:t.labelFontSize??t.fontSize+1,tick:t.tickFontSize??t.fontSize,legend:t.legendFontSize??t.fontSize};}
  constructor(private figure:Figure,container:HTMLElement,private renderTarget?:RenderTarget,sharedGL?:WebGL2RenderingContext,private responsivePanels=false,snapshotStore?:SnapshotStore){
    this.snapshotStore=snapshotStore??new SnapshotStore(figure.runtime.maxSnapshotBytes);
    this.ownsSnapshotStore=!snapshotStore;
    this.scheduler=new QueryScheduler(figure.runtime);
    this.root=document.createElement('div');this.root.className='vesora-figure';this.root.style.cssText='position:relative;width:100%;overflow:auto;background:white;color:#0f172a;font-family:system-ui,sans-serif;';
    this.root.style.height=`${renderTarget?.height??figure.spec.height}px`;this.root.setAttribute('role','figure');this.root.setAttribute('aria-label',figure.spec.title||'Scientific visualization');
    this.stage=document.createElement('div');this.stage.style.cssText='position:relative;';
    const canvas=document.createElement('canvas');canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;';
    this.overlay=document.createElement('canvas');this.overlay.style.cssText='position:absolute;inset:0;width:100%;height:100%;touch-action:none;';
    this.overlay.tabIndex=0;this.overlay.setAttribute('role','group');this.overlay.setAttribute('aria-label','Plot controls: drag to pan, wheel to zoom, Shift-drag to select, double-click to reset');
    this.stage.append(canvas,this.overlay);this.root.append(this.stage);
    const controls=document.createElement('div');controls.dataset.vesoraSelection='';controls.style.cssText='position:absolute;right:18px;top:34px;z-index:1;display:flex;gap:12px;align-items:center;font:12px system-ui;';
    this.selectionStatus=document.createElement('span');this.selectionStatus.className='vesora-selection-summary';this.selectionStatus.setAttribute('role','status');this.selectionStatus.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
    this.clearSelectionButton=document.createElement('button');this.clearSelectionButton.className='vesora-clear-selection';this.clearSelectionButton.type='button';this.clearSelectionButton.textContent='Clear selection';this.clearSelectionButton.disabled=true;
    this.clearSelectionButton.addEventListener('click',()=>{const source=this.interactionFigure,link=source.selectionRequest();if(link)source.clearLinkedSelection(link.id);});
    controls.append(this.selectionStatus,this.clearSelectionButton);this.root.append(controls);container.appendChild(this.root);
    controls.hidden=!figure.spec.selectionLink;controls.style.display=figure.spec.selectionLink?'flex':'none';
    try{this.renderer=new WebGLRenderer(canvas,message=>this.fail(new Error(message)),sharedGL,()=>{this.geometries.clear();this.failure=undefined;this.schedule();});}catch(error){this.root.remove();this.scheduler.dispose();throw error;}
    this.observer=new ResizeObserver(()=>this.frozenFigure?this.scheduleInspection():this.schedule());this.observer.observe(this.root);
    this.listen('wheel',this.wheel as EventListener,{passive:false});
    this.listen('pointerdown',this.pointerDown as EventListener);this.listen('pointermove',this.pointerMove as EventListener);this.listen('pointerup',this.pointerUp as EventListener);
    this.listen('pointercancel',(()=>{this.clearInteraction();this.drawOverlay();}) as EventListener);
    this.listen('pointerleave',(()=>{if(!this.drag&&!this.xPinned){this.clearHover();this.drawOverlay();}}) as EventListener);
    this.listen('keydown',this.keyDown as EventListener);
    this.listen('dblclick',((event:MouseEvent)=>{
      const panel=this.panelAt(...this.location(event));if(!panel)return;
      this.interactionFigure.restorePanelView(panel.id,{...this.interactionFigure.panelView(panel.id),xDomain:undefined,yDomain:undefined,zDomain:undefined,camera:{azimuth:35,elevation:25,distance:3},pan3d:[0,0]});
    }) as EventListener);
  }
  /** A replacement snapshot owns a new source identity space, even if ids and
   * versions happen to match a previous producer's data. */
  invalidateData():void{
    if(this.disposed)return;
    if(this.frozenFigure){this.deferredInvalidation=true;return;}
    this.deferredInvalidation=false;
    this.generation++;this.failure=undefined;
    for(const key of this.statisticsRequests)this.scheduler.cancel(key);
    for(const source of this.sources)this.scheduler.release(source);
    this.sources.clear();this.statisticsRequests.clear();
    this.inspection.clear();this.hoverIndices.clear();this.extents.clear();this.geometries.clear();this.plans.clear();this.statistics.clear();this.barCache.clear();this.previous.clear();
    for(const id of this.linkedSpec?.scatter??[])this.scheduler.cancel(`${id}:selected`);
    this.linkedResult=undefined;this.linkedSpec=undefined;this.selectedPlans.clear();this.scheduler.cancel('__linked');
    this.clearInteraction();
  }
  clearInteraction():void{
    if(this.drag&&this.overlay.hasPointerCapture(this.drag.pointerId))this.overlay.releasePointerCapture(this.drag.pointerId);
    this.drag=undefined;this.box=undefined;this.clearHover();
  }
  private listen(name:string,callback:EventListener,options?:AddEventListenerOptions):void{this.overlay.addEventListener(name,callback,options);this.cleanup.push(()=>this.overlay.removeEventListener(name,callback,options));}
  schedule(streaming=false):void{
    if(this.frozenFigure)return;
    if(this.disposed)return;this.clearXHover();this.prepareFont();this.requestedRevision++;if(!streaming||!this.rendering)this.generation++;this.failure=undefined;
    const link=this.figure.selectionRequest(),controls=this.clearSelectionButton.parentElement!;
    this.scheduler.cancel('__linked');
    for(const id of new Set([...(this.linkedSpec?.scatter??[]),...(link?.scatter??[])]))this.scheduler.cancel(`${id}:selected`);
    controls.hidden=!link;controls.style.display=link?'flex':'none';controls.style.top=this.figure.spec.title?'34px':'8px';
    if(link){this.selectionStatus.textContent='Updating selection…';this.root.setAttribute('aria-busy','true');this.root.dispatchEvent(new Event('vesora-selection-pending',{bubbles:true}));}
    this.queueFrame();
  }
  private scheduleInspection():void{
    if(this.disposed)return;
    this.requestedRevision++;this.generation++;this.failure=undefined;this.clearHover();this.queueFrame();
  }
  getInspectionState():InspectionState{
    return {mode:this.frozenFigure?'frozen':'live',acceptedRevision:this.figure.acceptedRevision,displayedRevision:this.committedFigure?.acceptedRevision??0,frameId:this.completedFrames,snapshotId:this.snapshotId,capturedAt:this.frozenLease?.capturedAt,snapshotBytes:this.snapshotStore.bytes,maxSnapshotBytes:this.snapshotStore.maximum,displayedStreams:Object.fromEntries([...this.displayedSource.streams].map(([id,state])=>[id,{...state}]))};
  }
  getDisplayedStreamingState(layerId:string):StreamState|undefined{return this.displayedSource.getStreamingState(layerId);}
  freezeInspection():InspectionState{
    if(this.disposed)throw new Error('Figure view disposed');
    if(this.frozenFigure)return this.getInspectionState();
    if(!this.committedFigure)throw streamError('NOT_READY','A completed displayed frame is required before freezing inspection');
    const lease=this.snapshotStore.capture(this.committedFigure.snapshot(),this.committedFigure.registry);
    try{this.frozenFigure=this.captureFigure(this.committedFigure,lease.registry);}catch(error){lease.release();throw error;}
    this.frozenLease=lease;this.snapshotId=`snapshot-${++this.snapshotSerial}`;this.generation++;
    if(this.raf){cancelAnimationFrame(this.raf);this.raf=0;}
    this.requestedRevision=this.committedRevision;this.frameRevision=this.committedRevision;this.completed=this.generation;
    // Private inspection edits replace entries/spec in frozenFigure. Keep a
    // separate completed-frame map until its replacement actually commits.
    this.committedFigure=this.captureFigure(this.frozenFigure);
    for(const waiter of this.waiters.splice(0))waiter.reject(streamError('PRESENTATION_FROZEN','Live rendering was interrupted after data acceptance; inspection is frozen'));
    const state=this.getInspectionState();this.figure.emit('inspectionchange',state);return state;
  }
  async resumeLive():Promise<void>{
    if(this.disposed)throw new Error('Figure view disposed');
    if(!this.frozenFigure)return this.ready();
    // The committed source remains owned until the resumed frame replaces it.
    const lease=this.frozenLease;if(lease)this.retiredSnapshots.add(lease);this.frozenFigure=undefined;this.frozenLease=undefined;this.snapshotId=undefined;
    if(this.deferredInvalidation)this.invalidateData();
    this.schedule();const ready=this.ready();this.figure.emit('inspectionchange',this.getInspectionState());
    await ready;
  }
  getInspectionView(panelId='main'):ViewSpec{return structuredClone(this.interactionFigure.panelView(panelId));}
  getInspectionSnapshot():Snapshot{return this.displayedSource.snapshot();}
  getInspectionSelection():HoverEvent|undefined{return this.selectedHit?structuredClone(this.selectedHit):undefined;}
  setInspectionSlice(targetLayerId:string,index:number):void{this.interactionFigure.setSliceIndex(targetLayerId,index);this.figure.emit('slicechange',{targetLayerId,index,mode:this.frozenFigure?'frozen':'live',frameId:this.completedFrames,snapshotId:this.snapshotId});}
  setInspectionView(panelId:string,patch:Partial<ViewSpec>):void{this.interactionFigure.setPanelView(panelId,patch);this.emitInspectionViewChange(panelId);}
  resetInspectionView(panelId?:string):void{
    for(const panel of this.interactionFigure.panelEntries())if(panelId===undefined||panel.id===panelId)this.interactionFigure.restorePanelView(panel.id,{...panel.view,xDomain:undefined,yDomain:undefined,zDomain:undefined,camera:{azimuth:35,elevation:25,distance:3},pan3d:[0,0]});
    this.emitInspectionViewChange(panelId??'main');
  }
  focusInspectionSelection(panelId='main'):void{
    const hit=this.selectedHit,panel=this.panels.find(panel=>panel.id===panelId);
    if(!hit||!panel||(hit.panelId??'main')!==panelId||panel.view.kind!=='3d')throw streamError('NO_SELECTION','Select a 3D sample or surface before focusing');
    const domains:Partial<ViewSpec>={camera:{...panel.view.camera,distance:3},pan3d:[0,0]};
    for(const axis of ['x','y','z'] as const){const value=hit[axis];if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Selected coordinate is not finite');const domain=axis==='z'?panel.zDomain:panel.bounds[axis],scale=panel.view[`${axis}Scale`],t=normalize(value,domain,scale);domains[`${axis}Domain`]=[denormalize(t-.1,domain,scale),denormalize(t+.1,domain,scale)];}
    this.setInspectionView(panelId,domains);
  }
  private emitInspectionViewChange(panelId:string):void{
    if(this.frozenFigure){const view=this.frozenFigure.panelView(panelId);this.figure.emit('viewchange',{...structuredClone(view),xDomain:view.xDomain??null,yDomain:view.yDomain??null,zDomain:view.zDomain??null,panelId,mode:'frozen',snapshotId:this.snapshotId,frameId:this.completedFrames} as never);}
    else this.figure.emitViewChange(panelId);
  }
  captureExport(source:'accepted'|'displayed'='accepted'):SnapshotLease{
    if(source!=='accepted'&&source!=='displayed')throw new TypeError('Export source must be accepted or displayed');
    if(source==='displayed'&&!this.committedFigure)throw streamError('NOT_READY','No completed frame is available to export');
    const figure=source==='displayed'?this.displayedSource:this.figure;
    const lease=this.snapshotStore.capture(figure.snapshot(),figure.registry);
    if(source==='displayed'){
      lease.snapshot.figure.protocolVersion=Math.max(7,lease.snapshot.figure.protocolVersion);
      const displayed=this.displayedLayout,spec=lease.snapshot.figure;
      if(displayed){spec.width=displayed.width;spec.height=displayed.height;
        if(displayed.stacked&&spec.layout){const originalCols=spec.layout.cols;spec.layout={...spec.layout,rows:spec.layout.rows*originalCols,cols:1};for(const panel of spec.panels??[]){panel.row=panel.row*originalCols+panel.col;panel.col=0;}}
      }
      lease.snapshot.figure.inspection={capturedAt:this.frozenLease?.capturedAt??this.committedAt,frameId:this.completedFrames,snapshotId:this.snapshotId,...(this.selectedHit?{selection:structuredClone(this.selectedHit)}:{})};
    }
    return lease;
  }
  private queueFrame():void{
    if(this.disposed||this.rendering||this.raf)return;
    this.raf=requestAnimationFrame(()=>{
      this.raf=0;if(this.disposed)return;this.rendering=true;this.frameRevision=this.requestedRevision;this.frameStarted=performance.now();this.renderingFigure=this.captureFigure();
      this.figure.emit('framepending',{...this.getInspectionState(),displayedRevision:this.renderingFigure.acceptedRevision,displayedStreams:Object.fromEntries([...this.renderingFigure.streams].map(([id,state])=>[id,{...state}]))});
      void this.render(this.generation).finally(()=>{
        this.rendering=false;this.renderingFigure=undefined;
        if(!this.disposed&&this.requestedRevision>this.frameRevision){this.generation++;this.failure=undefined;this.queueFrame();}
      });
    });
  }
  ready(options:ReadyOptions={}):Promise<void>{
    if(options.target!==undefined&&!['live','displayed'].includes(options.target))return Promise.reject(new TypeError('Ready target must be live or displayed'));
    if(this.frozenFigure&&options.target!=='displayed')return Promise.reject(streamError('PRESENTATION_FROZEN','Live presentation is frozen; use ready({target: displayed}) or resumeLive()'));
    if(options.timeoutMs!==undefined&&(!Number.isFinite(options.timeoutMs)||options.timeoutMs<=0))return Promise.reject(new RangeError('ready timeoutMs must be positive'));
    if(options.signal?.aborted)return Promise.reject(new DOMException('Ready wait aborted','AbortError'));
    const revision=this.requestedRevision;
    return new Promise((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>|undefined,settled=false;
      const cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);const at=this.waiters.indexOf(waiter);if(at>=0)this.waiters.splice(at,1);};
      const finish=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
      const abort=()=>finish(new DOMException('Ready wait aborted','AbortError'));
      const waiter={revision,resolve:()=>finish(),reject:(error:Error)=>finish(error)};
      options.signal?.addEventListener('abort',abort,{once:true});
      if(options.timeoutMs!==undefined)timer=setTimeout(()=>finish(new DOMException('Ready wait timed out','TimeoutError')),options.timeoutMs);
      void (async()=>{let pending;do{pending=this.fontReady;await pending;}while(pending!==this.fontReady);if(settled)return;if(this.disposed)return finish(new Error('Figure view disposed'));if(this.frozenFigure&&options.target!=='displayed')return finish(streamError('PRESENTATION_FROZEN','Live presentation is frozen after data acceptance'));if(this.failure)return finish(this.failure);if(this.committedRevision>=revision&&this.completed===this.generation)return finish();this.waiters.push(waiter);})();
    });
  }
  diagnostics(){const sourceBytes=[...this.figure.registry.entries()].reduce((sum,[,entry])=>sum+entry.descriptor.byteLength,0),geometryBytes=this.committedGeometryBytes;return {backend:'WebGL2',frameCopiedBytes:this.frameCopiedBytes,exportCopiedBytes:this.exportCopiedBytes,snapshotCopiedBytes:this.snapshotStore.copiedBytes,materializedSourceBytes:[...this.figure.registry.entries()].reduce((n,[,entry])=>n+(entry.materializedByteLength??0),0),picking:{...picking3DStats},contextLost:this.renderer.gl.isContextLost(),sourceBytes,geometryBytes,estimatedGPUBytes:geometryBytes,pendingExports:this.exportReservations.size,lastFrameMs:this.lastFrameMs,planningMs:this.lastPlanningMs,drawMs:this.lastDrawMs,geometryBuilds:this.geometryBuilds,geometryBuildMs:this.geometryBuildMs,completedFrames:this.completedFrames,requestedRevision:this.requestedRevision,committedRevision:this.committedRevision,...this.scheduler.stats,...this.renderer.stats,...this.getInspectionState()};}
  private prepareFont():void{
    const theme=this.figure.spec.theme??LIGHT_THEME,key=`${theme.fontSize}px ${theme.fontFamily}`;if(key===this.fontKey)return;this.fontKey=key;
    if(!document.fonts)return;
    try{if(document.fonts.check(key))return;const load=document.fonts.load(key);let timer:ReturnType<typeof setTimeout>;
      this.fontReady=Promise.race([load,new Promise<void>(resolve=>{timer=setTimeout(resolve,2000);})]).then(()=>{clearTimeout(timer!);if(!this.disposed)this.schedule();},()=>{clearTimeout(timer!);});
    }catch{/* Invalid or unavailable host fonts fall back to the browser sans-serif. */}
  }
  inspect():PanelInfo[]{return this.infos.map(info=>({...info}));}
  private panelMetadata(id:string,source=this.source):{panelId?:string}{return source.spec.layout?{panelId:id}:{};}
  private sourceExtent(layer:LayerSpec,axis:'x'|'y'|'z',scale:ScaleKind):Domain|undefined{
    if(layer.kind==='band'&&axis!=='z'){
      const xs=this.source.registry.get(layer.data.x),lo=this.source.registry.get(layer.data.lower),hi=this.source.registry.get(layer.data.upper);
      const panel=this.source.panelView(layer.panelId??'main'),key=JSON.stringify([layer.data.x,xs.descriptor.version,layer.data.lower,lo.descriptor.version,layer.data.upper,hi.descriptor.version,panel.xScale,panel.yScale,axis]);
      const cacheId=`band:${layer.id}:${axis}`,cached=this.extents.get(cacheId);if(cached?.key===key)return cached.domain;
      let min=Infinity,max=-Infinity;
      for(let i=0;i<xs.values.length;i++)if(Number.isFinite(lo.values[i])&&Number.isFinite(hi.values[i])&&(panel.xScale!=='log'||xs.values[i]>0)&&(panel.yScale!=='log'||lo.values[i]>0&&hi.values[i]>0)){
        const a=axis==='x'?xs.values[i]:lo.values[i],b=axis==='x'?a:hi.values[i];min=Math.min(min,a);max=Math.max(max,b);
      }
      const domain:Domain|undefined=min===Infinity?undefined:[min,max];this.extents.set(cacheId,{key,domain});return domain;
    }
    const source=layer.data[axis];if(!source)return undefined;
    const entry=this.source.registry.get(source),cacheKey=`${source}:${entry.descriptor.version}:${scale}:${layer.kind}:${axis}`;
    const cached=this.extents.get(source);if(cached?.key===cacheKey)return cached.domain;
    if(layer.kind!=='heatmap'||axis==='z'){const domain=entryExtent(entry,scale);this.extents.set(source,{key:cacheKey,domain});return domain;}
    const values=layer.kind==='heatmap'&&(axis==='x'||axis==='y')?gridEdges(entry.values,scale):entry.values;
    // Pad only after linked panels have been unioned, including constant series.
    let min=Infinity,max=-Infinity;
    for(const value of values)if(Number.isFinite(value)&&(scale!=='log'||value>0)&&(scale!=='time'||Math.abs(value)<=8.64e15)){if(value<min)min=value;if(value>max)max=value;}
    const domain:Domain|undefined=min===Infinity?undefined:[min,max];this.extents.set(source,{key:cacheKey,domain});return domain;
  }
  private categories(axis:'x'|'y',panelId:string,source=this.source):string[]|undefined{
    const spec=source.spec,shared=spec.layout?.[axis==='x'?'shareX':'shareY'];
    return spec.categories?.[`${axis}:${shared?'shared':panelId}`];
  }
  private axisValue(axis:'x'|'y',value:number,panelId:string):string|number{
    return this.categories(axis,panelId,this.displayedSource)?.[value]??value;
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
    const scale=view[`${axis}Scale`],layout=this.source.spec.layout;
    const extentScale=axis!=='z'&&view[`${axis}Format`]?.kind==='date'&&scale==='linear'?'time':scale;
    const shared=axis==='x'?layout?.shareX:axis==='y'?layout?.shareY:false;
    const layers=(shared?this.source.spec.layers:this.source.panelLayers(panelId)).filter(l=>l.visible&&(l.data[axis]||axis==='y'&&l.kind==='band'||axis!=='z'&&statistics.has(l.id)));
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
    for(const layer of layers){const prepared=statistics.get(layer.id),d=prepared&&axis!=='z'?(prepared.marks.length?prepared.bounds[axis]:undefined):this.sourceExtent(layer,axis,extentScale);if(d&&d.every(Number.isFinite)){min=Math.min(min,d[0]);max=Math.max(max,d[1]);if(layer.kind==='heatmap')heatmap=true;}}
    if(min===Infinity)return scale==='log'?[1,10]:[0,1];
    const domain:Domain=min===max?extent([min,max],extentScale):[min,max];
    if(heatmap)return domain;
    const padded:Domain=[denormalize(-.035,domain,scale),denormalize(1.035,domain,scale)];
    if(extentScale==='time'){padded[0]=Math.max(-8.64e15,padded[0]);padded[1]=Math.min(8.64e15,padded[1]);}
    return padded.every(Number.isFinite)&&padded[0]<padded[1]&&(scale!=='log'||padded[0]>0)?padded:domain;
  }
  private layout(statistics:Map<string,PreparedStatistics>,resolvedPlans?:Map<string,PointPlan|LineResult|BandResult>):PanelFrame[]{
    const spec=this.source.spec,grid=spec.layout,f=this.fonts,availableWidth=Math.max(200,Math.round(this.root.clientWidth||spec.width));
    const stacked=!!grid&&this.responsivePanels&&!this.renderTarget&&availableWidth<grid.cols*360;
    const rows=stacked?grid!.rows*grid!.cols:grid?.rows??1,cols=stacked?1:grid?.cols??1;
    this.renderingStacked=stacked;
    this.root.style.height=`${this.renderTarget?.height??spec.height}px`;this.root.style.background=this.theme.background;this.root.style.color=this.theme.foreground;this.root.style.fontFamily=this.theme.fontFamily;this.root.style.fontSize=`${this.theme.fontSize}px`;
    this.clearSelectionButton.style.cssText=`color:${this.theme.foreground};background:${this.theme.background};border:1px solid ${this.theme.axis};font:inherit;`;
    this.width=this.renderTarget?.width??Math.max(grid&&!this.responsivePanels?cols*360:200,availableWidth);
    const header=spec.selectionLink?(spec.title?f.title+54:44):grid&&spec.title?f.title+24:0;
    this.height=this.renderTarget?.height??(grid?Math.max(spec.height,header+rows*260):spec.height);
    if(this.responsivePanels&&!this.renderTarget)this.root.style.height=`${this.height}px`;
    this.dpr=this.renderTarget?.scale??Math.min(2,window.devicePixelRatio||1);
    this.stage.style.width=`${this.width}px`;this.stage.style.height=`${this.height}px`;
    const measure=this.overlay.getContext('2d')!;
    const panels=this.source.panelEntries().map(entry=>{
      const view=structuredClone(entry.view),layers=structuredClone(this.source.panelLayers(entry.id).filter(l=>l.visible));
      if(spec.theme)for(const layer of layers)if(!layer.style.color)layer.style.color=this.theme.palette[spec.layers.findIndex(item=>item.id===layer.id)%this.theme.palette.length];
      const column=stacked?0:entry.col,row=stacked?entry.row*grid!.cols+entry.col:entry.row;
      const cell:PlotRect={left:column*this.width/cols,top:header+row*(this.height-header)/rows,width:this.width/cols,height:(this.height-header)/rows};
      const link=spec.selectionLink;if(link)for(const layer of layers)if(layer.id===link.histogram)layer.style.label='All observations';
      const linked=link&&layers.some(l=>link.scatter.includes(l.id)||link.histogram===l.id);
      const density=(l:LayerSpec)=>l.kind==='scatter'&&(resolvedPlans?.has(l.id)?resolvedPlans.get(l.id)?.kind==='density':l.style.representation==='density'||l.style.representation!=='points'&&(this.previous.has(l.id)?this.previous.get(l.id)==='density':this.source.registry.get(l.data.x).values.length>256));
      const possibleColor=layers.find(l=>l.kind==='heatmap'||l.kind==='surface'||l.data.color||density(l));
      const possibleDensity=!!possibleColor&&density(possibleColor);
      const statusHeight=linked?(layers.some(l=>l.id===link!.histogram)?90:44):possibleDensity?f.tick+10:0;
      const panel:PanelFrame={id:entry.id,title:entry.title,view,layers,cell,rect:{...cell},bounds:{x:this.domain('x',entry.id,view,statistics),y:this.domain('y',entry.id,view,statistics)},zDomain:this.domain('z',entry.id,view,statistics),legendRows:0,statusHeight,reservedColor:!!possibleColor,reservedDensity:possibleDensity,xTicks:[],yTicks:[],xOffset:0,yOffset:0,legendTop:0,labelY:0};
      const xSpan=panel.bounds.x[1]-panel.bounds.x[0],ySpan=panel.bounds.y[1]-panel.bounds.y[0];
      panel.xOffset=!this.categories('x',entry.id)&&!view.xFormat&&view.xScale==='linear'&&Math.abs(panel.bounds.x[0])/xSpan>1e5?panel.bounds.x[0]:0;
      panel.yOffset=!this.categories('y',entry.id)&&!view.yFormat&&view.yScale==='linear'&&Math.abs(panel.bounds.y[0])/ySpan>1e5?panel.bounds.y[0]:0;
      const top=(grid?(entry.title?f.title+22:16):spec.title?f.title+26:16)+(panel.yOffset?f.tick+6:0);
      let left=64,right=16;
      measure.font=`${f.tick}px ${this.theme.fontFamily}`;
      if(possibleColor){
        let domain=possibleColor.style.colorDomain;
        if(!domain&&!possibleDensity)domain=extent(this.source.registry.get(possibleColor.data.color??possibleColor.data.z).values);
        const labels=domain?ticks(domain,'linear',5).map(v=>formatTick(v,domain[1]-domain[0])):[String(this.source.registry.get(possibleColor.data.x).descriptor.shape[0])];
        right=42+Math.max(...labels.map(t=>measure.measureText(t).width))+(colorbarLabel(possibleColor,possibleDensity,view)?f.label+10:0);
      }
      for(let pass=0;pass<3;pass++){
        const plotWidth=Math.max(40,cell.width-left-right);
        measure.font=`${f.legend}px ${this.theme.fontFamily}`;
        let legendRows=0,used=0;
        if(this.source.presentation.legend||this.renderTarget)for(const l of layers.filter(l=>l.style.label)){
          const w=Math.min(plotWidth,measure.measureText(l.style.label!).width+36);
          if(!legendRows||used+w>plotWidth){legendRows++;used=0;}used+=w;
        }
        panel.legendRows=legendRows;
        const tickBlock=f.tick+14+(panel.xOffset?f.tick+6:0),labelBlock=view.xLabel?f.label+12:0;
        const footer=12+statusHeight+(legendRows?legendRows*(f.legend+8)+8:0);
        const plotHeight=Math.max(40,cell.height-top-tickBlock-labelBlock-footer);
        panel.rect={left:cell.left+left,top:cell.top+top,width:plotWidth,height:plotHeight};
        panel.labelY=panel.rect.top+plotHeight+tickBlock+f.label;
        panel.legendTop=panel.rect.top+plotHeight+tickBlock+labelBlock+f.legend+6;
        measure.font=`${f.tick}px ${this.theme.fontFamily}`;
        panel.xTicks=this.measuredTicks('x',panel,measure);panel.yTicks=this.measuredTicks('y',panel,measure);
        const yWidth=Math.max(0,...panel.yTicks.map(t=>measure.measureText(t.label).width));
        left=Math.min(cell.width-right-40,Math.ceil(yWidth+16+(view.yLabel?f.label+16:0)));
      }
      return panel;
    });
    return panels;
  }
  private measuredTicks(axis:'x'|'y',panel:PanelFrame,ctx:CanvasRenderingContext2D):AxisTick[]{
    const {rect:r,bounds,view}=panel,span=bounds[axis][1]-bounds[axis][0],offset=axis==='x'?panel.xOffset:panel.yOffset;
    const length=axis==='x'?r.width:r.height,categories=this.categories(axis,panel.id),size=this.fonts.tick;
    const count=Math.max(2,Math.floor(length/(axis==='x'?55:size+18)));
    const candidates=this.axisTicks(axis,panel,count).map(value=>({value,label:categories?categories[value]:this.axisLabel(axis,value-offset,panel,span),position:0}));
    const result:AxisTick[]=[];let end=-Infinity;
    if(axis==='y')candidates.reverse();
    for(const item of candidates){
      const coordinate=normalize(item.value,bounds[axis],view[`${axis}Scale`]);
      if(axis==='x'){
        item.label=this.fitText(ctx,item.label,Math.max(1,r.width));const width=ctx.measureText(item.label).width;
        item.position=Math.max(r.left+width/2,Math.min(r.left+r.width-width/2,r.left+coordinate*r.width));
        if(item.position-width/2<end+8)continue;end=item.position+width/2;
      }else{item.position=r.top+(1-coordinate)*r.height;if(item.position-size/2<end+6)continue;end=item.position+size/2;}
      result.push(item);
    }
    return result;
  }
  private async prepareStatistics(generation:number):Promise<Map<string,PreparedStatistics>>{
    const prepared=new Map<string,PreparedStatistics>(),spec=this.source.spec;
    const visible=spec.layers.filter(layer=>(layer.visible||layer.id===spec.selectionLink?.histogram)&&(layer.kind==='hist'||layer.kind==='boxplot'));
    const requested=new Set(visible.map(layer=>layer.id));
    for(const id of this.statisticsRequests)if(!requested.has(id))this.scheduler.cancel(id);
    this.statisticsRequests=requested;
    const sources=new Set(Array.from(this.source.registry.entries(),([source])=>source));
    for(const source of this.sources)if(!sources.has(source)){this.scheduler.release(source);this.extents.delete(source);}
    this.sources=sources;
    const panelIds=new Set<string>();
    for(const panel of this.source.panelEntries()){
      panelIds.add(panel.id);
      const layers=this.source.panelLayers(panel.id).filter(layer=>layer.kind==='bar');
      if(!layers.length){this.barCache.delete(panel.id);continue;}
      const mode=spec.barModes?.[panel.id]??'group';
      const key=JSON.stringify([mode,layers.map(layer=>[layer.id,layer.visible,layer.options,Object.values(layer.data).map(source=>[source,this.source.registry.get(source).descriptor.version])])]);
      let cached=this.barCache.get(panel.id);
      if(cached?.key!==key){cached={key,prepared:prepareBars(layers,this.source.registry,mode)};this.barCache.set(panel.id,cached);}
      for(const [id,value] of cached.prepared)prepared.set(id,value);
    }
    for(const id of this.barCache.keys())if(!panelIds.has(id))this.barCache.delete(id);
    await Promise.all(visible.map(async layer=>{
      const result=await this.scheduler.queryStatistics(layer.id,structuredClone(layer),this.source.registry);
      if(!this.disposed&&generation===this.generation)prepared.set(layer.id,result);
    }));
    return prepared;
  }
  private async render(generation:number,layoutPlans?:Map<string,PointPlan|LineResult|BandResult>):Promise<void>{
    try{
      const spec=this.source.spec;
      this.overlay.setAttribute('aria-label',spec.view.kind==='3d'
        ?'Plot controls: drag to orbit, wheel to zoom, Shift-drag to pan, double-click to reset'
        :this.source.spec.hoverMode==='x'?'Plot controls: Left/Right to inspect samples, tap to pin, Escape to clear; drag to pan, wheel to zoom, Shift-drag to select'
        :'Plot controls: drag to pan, wheel to zoom, Shift-drag to select, double-click to reset');
      this.root.setAttribute('aria-label',spec.title||'Scientific visualization');
      // Prepare raw-data statistics and complete panel-local bar placement before
      // resolving automatic/shared extents. The committed frame stays untouched.
      const nextStatistics=await this.prepareStatistics(generation);
      if(this.disposed||generation!==this.generation)return;
      const request=this.source.selectionRequest(),link=request?structuredClone(request):undefined;
      const linked=link?await this.scheduler.queryLinked('__linked',link,spec.layers,nextStatistics.get(link.histogram)!,this.source.registry):undefined;
      if(!link)this.scheduler.cancel('__linked');
      if(this.disposed||generation!==this.generation)return;
      const nextSelectedPlans=new Map<string,PointPlan>();
      const panels=this.layout(nextStatistics,layoutPlans),nextPlans=new Map<string,PointPlan|LineResult|BandResult>(),nextGeometry=new Map<string,{key:string;geometry:Geometry}>();
      const panelResults=await Promise.all(panels.map(async panel=>{
        const {bounds,zDomain,view,rect}=panel;
        const results=await Promise.all(panel.layers.map(async layer=>{
          const versions=Object.values(layer.data).map(source=>`${source}:${this.source.registry.get(source).descriptor.version}`);
          const member=!!link&&(link.scatter.includes(layer.id)||link.histogram===layer.id),active=member&&!!link?.selection;
          const baseStyle=active?{...layer.style,opacity:(layer.style.opacity??1)*.3}:layer.style;
          const key=JSON.stringify([versions,layer.options,baseStyle,bounds,zDomain,view.xScale,view.yScale,view.zScale,rect.width,rect.height,layer.kind==='bar'?this.barCache.get(panel.id)?.key:undefined]);
          const cache=this.geometries.get(layer.id);let plan:PointPlan|LineResult|BandResult|undefined,info:PanelInfo;
          const prepared=nextStatistics.get(layer.id);
          if(prepared){
            info=this.statisticsInfo(prepared,panel);
          }else if(layer.kind==='line'||layer.kind==='scatter'||layer.kind==='band'){
            const query:Query={bounds,width:Math.round(rect.width),height:Math.round(rect.height),xScale:view.xScale,yScale:view.yScale,pointBudget:250_000,mode:layer.style.representation??'auto',previous:this.previous.get(layer.id)};
            plan=layer.kind==='band'?await this.scheduler.queryBand(layer.id,layer.data.x,layer.data.lower,layer.data.upper,query,this.source.registry):await this.scheduler.query(layer.id,layer.kind==='line'?'line':'scatter',layer.data.x,layer.data.y,query,this.source.registry);
            nextPlans.set(layer.id,plan);info={...plan.info,layerId:layer.id,...this.panelMetadata(panel.id)};
          }else{
            const count=this.source.registry.get(layer.data.z??layer.data.x).values.length;
            if(count>1_000_000)throw new Error(`${layer.kind} exceeds the initial renderer budget of 1,000,000 values. Reduce the grid or use 2D density exploration.`);
            info={layerId:layer.id,...this.panelMetadata(panel.id),kind:layer.kind==='heatmap'?'grid':layer.kind==='surface'?'surface':'points',total:count,visible:count,rendered:count,exact:true,method:layer.kind==='surface'?'regular-grid triangulation':layer.kind==='heatmap'?'scalar grid':'raw points'};
          }
          if(this.disposed||generation!==this.generation)throw new DOMException('Superseded','AbortError');
          const geometryStarted=performance.now();
          const geometry=cache?.key===key?cache.geometry:prepared
            ?buildStatisticsGeometry(prepared,bounds,view,rect.width,rect.height,baseStyle)
            :buildGeometry({...layer,style:baseStyle},this.source.registry,bounds,zDomain,view,rect.width,rect.height,plan);
          if(cache?.geometry!==geometry){this.geometryBuilds++;this.geometryBuildMs+=performance.now()-geometryStarted;}
          if(geometry.primitive==='points'){
            info.rendered=geometry.positions.length/3;info.visible=info.rendered;
            if(layer.data.color)info.method+='; non-finite scalar colors omitted';
          }else if(layer.kind==='surface'){
            info.rendered=geometryVertexCount(geometry)/3;info.method='indexed regular-grid triangles; invalid coordinates/scalars omitted';
            info.visible=geometry.positions.length/3;info.valid=info.visible;info.omitted=info.total-info.visible;
            const shape=this.source.registry.get(layer.data.z).descriptor.shape;
            info.totalTriangles=2*(shape[0]-1)*(shape[1]-1);info.omittedTriangles=info.totalTriangles-info.rendered;
          }else if(layer.kind==='heatmap'){info.rendered=geometry.positions.length/18;info.visible=info.rendered;}
          const selected:Geometry[]=[];
          if(active&&linked&&link){
            if(layer.id===link.histogram){
              const highlight=buildStatisticsGeometry(linked.histogram,bounds,view,rect.width,rect.height,{...layer.style,color:this.theme.selection,opacity:1});
              highlight.id=`${layer.id}:selected`;selected.push(highlight);
            }else{
              const query:Query={bounds,width:Math.round(rect.width),height:Math.round(rect.height),xScale:view.xScale,yScale:view.yScale,pointBudget:250_000,mode:layer.style.representation??'auto'};
              const selectionPlan=await this.scheduler.querySelectedScatter(`${layer.id}:selected`,layer.data.x,layer.data.y,linked.mask,query,this.source.registry);
              nextSelectedPlans.set(layer.id,selectionPlan);
              const highlight=buildGeometry({...layer,id:`${layer.id}:selected`,data:{x:layer.data.x,y:layer.data.y},style:{...layer.style,color:this.theme.selection,opacity:1}},this.source.registry,bounds,zDomain,view,rect.width,rect.height,selectionPlan);
              if(selectionPlan.kind==='density'){
                let vertex=0;const divisor=Math.log1p(selectionPlan.max)||1;
                for(const count of selectionPlan.counts)if(count){const alpha=.15+.8*Math.log1p(count)/divisor;for(let i=0;i<6;i++,vertex++){highlight.colors.set([...parseColor(this.theme.selection).slice(0,3),alpha],vertex*4);}}
              }
              selected.push(highlight);
            }
          }
          if(this.disposed||generation!==this.generation)throw new DOMException('Superseded','AbortError');
          nextGeometry.set(layer.id,{key,geometry});return {geometry,selected,info};
        }));
        panel.colorLayer=panel.layers.find(l=>l.kind==='heatmap'||l.kind==='surface'||l.data.color||nextPlans.get(l.id)?.kind==='density');
        if(panel.colorLayer){
          const layer=panel.colorLayer,plan=nextPlans.get(layer.id),density=plan?.kind==='density'?plan:undefined;
          panel.colorDensity=!!density;
          panel.colorDomain=layer.style.colorDomain??(density?[0,Math.max(1,density.max)] as Domain:extent(this.source.registry.get(layer.data.color??layer.data.z).values));
        }
        const items=results.flatMap(result=>[result.geometry,...result.selected]);if(view.kind==='3d')items.unshift(this.axes3d());
        return {panel,items,infos:results.map(result=>result.info)};
      }));
      if(this.disposed||generation!==this.generation)return;
      // Representation is resolved from visible data. Reclaim the gutter when
      // sparse zooms use points; reserve it before committing a density frame.
      if(panels.some(panel=>panel.reservedColor!==!!panel.colorLayer||panel.reservedDensity!==!!panel.colorDensity))return await this.render(generation,nextPlans);
      const geometryBytes=panelResults.reduce((total,result)=>total+result.items.reduce((sum,item)=>sum+geometryByteLength(item),0),0);
      if(this.figure.runtime.maxGeometryBytes!==undefined&&geometryBytes>this.figure.runtime.maxGeometryBytes)throw new RangeError('Figure exceeds its geometry memory budget');
      // Neither canvas changes until every panel's current query succeeds.
      const live=new Set(nextGeometry.keys());for(const id of this.inspection.keys())if(!live.has(id))this.inspection.delete(id);for(const id of this.hoverIndices.keys())if(!live.has(id))this.hoverIndices.delete(id);
      for(const key of this.geometries.keys())if(!live.has(key)){this.scheduler.cancel(key);this.previous.delete(key);}
      const sources=new Set(Array.from(this.source.registry.entries(),([source])=>source));
      for(const source of this.extents.keys())if(source.startsWith('band:')?![...live].some(id=>source===`band:${id}:x`||source===`band:${id}:y`):!sources.has(source)){this.extents.delete(source);if(!source.startsWith('band:'))this.scheduler.release(source);}
      this.lastPlanningMs=performance.now()-this.frameStarted;const drawStarted=performance.now();
      this.renderer.beginFrame(this.width,this.height,this.dpr,parseColor(this.theme.background));
      for(const {panel,items} of panelResults){
        const {view,rect}=panel,matrix=view.kind==='3d'?cameraMatrix(view.camera.azimuth,view.camera.elevation,view.camera.distance,rect.width/rect.height,view.pan3d??[0,0],scientificAspect(view,panel.bounds,panel.zDomain)):identity;
        this.renderer.drawPanel(items,rect,matrix,view.kind==='3d',scientificAspect(view,panel.bounds,panel.zDomain));
      }
      this.renderer.endFrame();
      this.lastDrawMs=performance.now()-drawStarted;
      this.panels=panels;this.geometries=nextGeometry;this.plans=nextPlans;this.statistics=nextStatistics;this.infos=panelResults.flatMap(result=>result.infos);
      this.linkedResult=linked;this.linkedSpec=link;this.selectedPlans=nextSelectedPlans;
      for(const [id,plan] of nextPlans)if(plan.kind==='points'||plan.kind==='density')this.previous.set(id,plan.kind);
      const previousFigure=this.committedFigure;
      this.committedFigure=this.renderingFigure;this.committedRevision=this.frameRevision;this.lastFrameMs=performance.now()-this.frameStarted;this.completedFrames++;this.committedGeometryBytes=geometryBytes;
      this.displayedLayout={stacked:this.renderingStacked,width:this.width,height:this.height};
      // The completed frame must carry the predicate that produced its pixels.
      if(link)this.committedFigure!.commitLinkedSelection(link);
      this.committedAt=new Date().toISOString();
      // Imported capture metadata expires only when a new displayed scene
      // commits; accepted updates must not clear the held frozen selection.
      if(previousFigure?.spec.inspection&&!this.committedFigure?.spec.inspection)this.selectedHit=undefined;
      if(this.selectedHit){
        const layer=this.committedFigure!.spec.layers.find(layer=>layer.id===this.selectedHit!.layerId),previous=previousFigure?.spec.layers.find(layer=>layer.id===this.selectedHit!.layerId);
        if(!layer||!previous||Object.entries(layer.data).some(([key,id])=>previous.data[key]!==id||!previousFigure!.registry.has(id)||previousFigure!.registry.get(id)!==this.committedFigure!.registry.get(id)))this.selectedHit=undefined;
      }
      if(!previousFigure&&this.committedFigure?.spec.inspection?.selection)this.selectedHit=structuredClone(this.committedFigure.spec.inspection.selection);
      for(const lease of this.retiredSnapshots)lease.release();this.retiredSnapshots.clear();
      this.drawOverlay();this.completed=generation;
      // Establish frame ownership before hover/selection callbacks reference it.
      this.figure.emit('frame',this.getInspectionState());
      // Any hover created while planning belonged to the previously displayed rows.
      const hoverPosition=this.lastHover;
      this.clearHover();if(hoverPosition&&!this.drag)this.hover(...hoverPosition);else this.drawOverlay();
      this.root.setAttribute('aria-busy','false');
      this.clearSelectionButton.disabled=!link?.selection;
      this.selectionStatus.textContent=link&&linked?this.selectionSummary(linked,!!link.selection):'';
      if(link&&linked){
        const origin=link.selection?.originLayerId??link.scatter[0],layer=spec.layers.find(layer=>layer.id===origin)!;
        const event:LinkedSelection={kind:'linked',linkId:link.id,generation:link.generation,sequence:link.sequence,layerId:origin,...this.panelMetadata(layer.panelId??'main'),active:!!link.selection,count:linked.count,total:linked.total,fraction:linked.total?linked.count/linked.total:0,indices:Array.from(linked.preview),truncated:linked.truncated,...(link.selection?{bounds:structuredClone(link.selection.bounds)}:{})};
        this.interactionFigure.commitLinkedSelection(link,{...event,mode:this.frozenFigure?'frozen':'live',frameId:this.completedFrames,snapshotId:this.snapshotId,sourceRevision:this.committedFigure!.acceptedRevision});
      }
      this.figure.emit('representation',this.inspect());
      // A representation listener may synchronously invalidate this frame.
      if(this.completed===this.generation)for(const waiter of [...this.waiters])if(waiter.revision<=this.committedRevision)waiter.resolve();
    }catch(error){if(generation!==this.generation||this.disposed)return;this.fail(error instanceof Error?error:new Error(String(error)));}
  }
  private fail(error:Error):void{this.failure=error;this.completed=this.generation;this.figure.emit('error',{message:error.message});this.drawOverlay(error.message);for(const waiter of this.waiters.splice(0))waiter.reject(error);}
  private axes3d():Geometry{
    if(this.axesGeometry?.color!==this.theme.muted)this.axesGeometry={color:this.theme.muted,geometry:{id:'__axes3d',primitive:'lines',positions:new Float32Array([-1,-1,-1,1,-1,-1,-1,-1,-1,-1,1,-1,-1,-1,-1,-1,-1,1]),colors:Float32Array.from(Array.from({length:6},()=>parseColor(this.theme.muted)).flat())}};
    return this.axesGeometry.geometry;
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
  private drawOverlay(error?:string,target?:CanvasRenderingContext2D,exporting=false):void{
    const previous=this.overlaySource;this.overlaySource=this.displayedSource;
    try{this.paintOverlay(error,target,exporting);}finally{this.overlaySource=previous;}
  }
  private paintOverlay(error?:string,target?:CanvasRenderingContext2D,exporting=false):void{
    if(this.disposed)return;const ctx=target??this.ctx(),spec=this.source.spec;ctx.clearRect(0,0,this.width,this.height);
    ctx.font=`${this.theme.fontSize}px ${this.theme.fontFamily}`;ctx.fillStyle=this.theme.foreground;ctx.strokeStyle=this.theme.axis;ctx.lineWidth=1;
    if(error){ctx.fillStyle=this.theme.background;ctx.fillRect(0,0,this.width,this.height);ctx.fillStyle=this.theme.error;ctx.textAlign='left';ctx.fillText(error,15,35,this.width-30);return;}
    if(spec.title){
      const left=this.panels[0]?.rect.left??16,available=this.width-left-16;
      ctx.font=`600 ${this.fonts.title}px ${this.theme.fontFamily}`;
      ctx.textAlign='left';ctx.fillText(this.fitText(ctx,spec.title,available),left,this.fonts.title+9);
    }
    if(this.linkedSpec&&this.linkedResult){
      ctx.font=`${this.theme.fontSize}px ${this.theme.fontFamily}`;ctx.fillStyle=this.theme.foreground;ctx.textAlign='left';
      ctx.fillText(this.fitText(ctx,this.selectionSummary(this.linkedResult,!!this.linkedSpec.selection),Math.max(100,this.width-250)),70,spec.title?52:26);
    }
    for(const panel of this.panels)this.drawPanelOverlay(ctx,panel,exporting);
    if(this.xHover&&!exporting)this.drawXHover(ctx);
    if(this.box&&!exporting){const [a,b,c,d]=this.box;ctx.save();ctx.fillStyle=this.theme.selection;ctx.globalAlpha=.18;ctx.fillRect(a,b,c-a,d-b);ctx.restore();ctx.strokeStyle=this.theme.selection;ctx.strokeRect(a,b,c-a,d-b);}
    if(this.tooltip&&this.source.presentation.tooltip&&!exporting){const t=this.tooltip;ctx.font=`${this.theme.fontSize}px ${this.theme.fontFamily}`;const text=this.fitText(ctx,t.text,Math.max(1,this.width-34)),w=ctx.measureText(text).width+18,x=Math.max(0,Math.min(this.width-w,t.x+12)),y=Math.max(20,t.y-12);ctx.fillStyle=this.theme.tooltipBackground;ctx.fillRect(x,y-18,w,27);ctx.fillStyle=this.theme.tooltipForeground;ctx.textAlign='left';ctx.fillText(text,x+9,y);}
  }
  private selectionSummary(result:LinkedResult,active:boolean):string{
    if(!active)return 'Shift + drag in either scatter to compare observations';
    const percent=result.total?100*result.count/result.total:0;
    return `Selected ${result.count.toLocaleString('en-US')} / ${result.total.toLocaleString('en-US')} (${percent.toFixed(2)}%)${result.count===0?' · No observations in this selection':''}`;
  }
  private drawPanelOverlay(ctx:CanvasRenderingContext2D,panel:PanelFrame,exporting=false):void{
    const {rect:r,cell,view,bounds,zDomain,layers}=panel,grid=!!this.source.spec.layout,bottom=cell.top+cell.height;
    ctx.save();ctx.beginPath();ctx.rect(cell.left,cell.top,cell.width,cell.height);ctx.clip();
    const f=this.fonts;
    ctx.font=`${f.tick}px ${this.theme.fontFamily}`;ctx.fillStyle=this.theme.foreground;ctx.strokeStyle=this.theme.axis;ctx.lineWidth=1;
    if(grid&&panel.title){ctx.font=`600 ${f.title}px ${this.theme.fontFamily}`;ctx.textAlign='left';ctx.fillText(this.fitText(ctx,panel.title,cell.left+cell.width-r.left-12),r.left,cell.top+f.title+8);ctx.font=`${f.tick}px ${this.theme.fontFamily}`;}
    if(view.kind==='2d'){
      ctx.strokeRect(r.left,r.top,r.width,r.height);
      for(const item of panel.xTicks){
        const x=r.left+normalize(item.value,bounds.x,view.xScale)*r.width;ctx.strokeStyle=this.theme.grid;ctx.beginPath();ctx.moveTo(x,r.top);ctx.lineTo(x,r.top+r.height);ctx.stroke();
        ctx.fillStyle=this.theme.foreground;ctx.textAlign='center';ctx.fillText(item.label,item.position,r.top+r.height+f.tick+8);
      }
      for(const item of panel.yTicks){
        const y=item.position;ctx.strokeStyle=this.theme.grid;ctx.beginPath();ctx.moveTo(r.left,y);ctx.lineTo(r.left+r.width,y);ctx.stroke();
        ctx.fillStyle=this.theme.foreground;ctx.textAlign='right';ctx.fillText(item.label,r.left-9,y+f.tick*.35);
      }
      if(panel.xOffset){ctx.textAlign='right';ctx.fillText(this.fitText(ctx,`offset ${panel.xOffset>=0?'+':''}${panel.xOffset}`,r.width),r.left+r.width,r.top+r.height+2*f.tick+14);}
      if(panel.yOffset){ctx.textAlign='left';ctx.fillText(this.fitText(ctx,`offset ${panel.yOffset>=0?'+':''}${panel.yOffset}`,r.width),r.left,r.top-8);}
      ctx.font=`${f.label}px ${this.theme.fontFamily}`;
      ctx.textAlign='center';ctx.fillText(this.fitText(ctx,view.xLabel,r.width),r.left+r.width/2,panel.labelY);
      ctx.save();ctx.translate(cell.left+f.label+1,r.top+r.height/2);ctx.rotate(-Math.PI/2);ctx.fillText(this.fitText(ctx,view.yLabel,r.height),0,0);ctx.restore();
      this.drawAnnotations(ctx,panel);
    }else{
      const m=cameraMatrix(view.camera.azimuth,view.camera.elevation,view.camera.distance,r.width/r.height,view.pan3d??[0,0],scientificAspect(view,panel.bounds,panel.zDomain));
      const pos=(x:number,y:number,z:number)=>[r.left+((m[0]*x+m[4]*y+m[8]*z+m[12])+1)/2*r.width,r.top+(1-(m[1]*x+m[5]*y+m[9]*z+m[13]))/2*r.height];
      const origin=pos(-1,-1,-1);
      for(const [axis,end,domain]of [['x',[1,-1,-1],bounds.x],['y',[-1,1,-1],bounds.y],['z',[-1,-1,1],zDomain]] as const){
        const p=pos(end[0],end[1],end[2]);
        // An axis along the viewing direction has no readable screen extent.
        // Keep its geometry/data intact and omit only its coincident annotation.
        if(Math.hypot(p[0]-origin[0],p[1]-origin[1])<=1)continue;
        ctx.textAlign='center';ctx.fillText(view[`${axis}Label`]||axis,p[0],p[1]-12);
        for(const value of ticks(domain,view[`${axis}Scale`],3)){const t=normalize(value,domain,view[`${axis}Scale`]);if(t<.12)continue;const vector=[-1,-1,-1];vector[{x:0,y:1,z:2}[axis]]=t*2-1;const q=pos(vector[0],vector[1],vector[2]);ctx.fillText(formatTick(value,domain[1]-domain[0]),q[0]+12,q[1]+12);}
      }
    }
    ctx.font=`${f.legend}px ${this.theme.fontFamily}`;
    let legendX=r.left,legendY=panel.legendTop;
    const legendRight=r.left+r.width;
    for(const layer of layers.filter(l=>(this.source.presentation.legend||exporting)&&l.style.label)){
      const label=this.fitText(ctx,layer.style.label!,Math.max(1,r.width-36)),itemWidth=ctx.measureText(label).width+36;
      if(legendX>r.left&&legendX+itemWidth>legendRight){legendX=r.left;legendY+=f.legend+8;}
      ctx.fillStyle=layer.style.color??this.theme.palette[0];ctx.fillRect(legendX,legendY-6,12,layer.kind==='band'?6:3);ctx.fillStyle=this.theme.muted;ctx.textAlign='left';ctx.fillText(label,legendX+18,legendY);legendX+=itemWidth;
    }
    ctx.font=`${f.tick}px ${this.theme.fontFamily}`;
    const colorLayer=panel.colorLayer;
    if(colorLayer){
      const density=panel.colorDensity,domain=panel.colorDomain!,x=r.left+r.width+16,h=r.height;
      for(let i=0;i<h;i++){const c=colorMap(1-i/Math.max(1,h-1),[0,1],colorLayer.style.colormap);ctx.fillStyle=`rgb(${c[0]*255},${c[1]*255},${c[2]*255})`;ctx.fillRect(x,r.top+i,12,1.5);}
      ctx.fillStyle=this.theme.muted;ctx.textAlign='left';let end=-Infinity,maxWidth=0;
      const values=ticks(domain,'linear',Math.max(2,Math.min(5,Math.floor(h/(f.tick+16))))).filter(v=>!density||Number.isInteger(v)).reverse();
      for(const value of values){
        const y=r.top+(1-normalize(value,domain))*h,baseline=Math.max(r.top+f.tick,Math.min(r.top+h,y+f.tick*.35));
        if(baseline<end+f.tick+6)continue;end=baseline;
        const label=formatTick(value,domain[1]-domain[0]);ctx.fillText(label,x+18,baseline);maxWidth=Math.max(maxWidth,ctx.measureText(label).width);
      }
      const label=colorbarLabel(colorLayer,!!density,view);
      if(label){ctx.save();ctx.font=`${f.label}px ${this.theme.fontFamily}`;ctx.translate(x+25+maxWidth+f.label,r.top+h/2);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.fillText(this.fitText(ctx,label,h),0,0);ctx.restore();}
    }
    const density=this.infos.find(i=>i.kind==='density'&&layers.some(layer=>layer.id===i.layerId));
    if(density){ctx.fillStyle=this.theme.muted;ctx.textAlign='right';ctx.fillText(this.fitText(ctx,`${density.visible.toLocaleString()} visible / ${density.total.toLocaleString()} total`,r.width),r.left+r.width,bottom-10);}
    const link=this.linkedSpec,result=this.linkedResult;
    const linkedHistogram=link&&layers.find(layer=>layer.id===link.histogram);
    if(linkedHistogram){
      const baseline=this.statistics.get(linkedHistogram.id)!;
      ctx.fillStyle=this.theme.muted;ctx.textAlign='left';
      ctx.fillText(this.fitText(ctx,`All: ${baseline.info.omitted} non-finite`,r.width),r.left,bottom-58);
      ctx.fillText(this.fitText(ctx,`All: ${baseline.info.rangeExcluded} outside range`,r.width),r.left,bottom-43);
    }
    if(link?.selection&&result){
      const scatter=layers.find(layer=>link.scatter.includes(layer.id));
      if(scatter){ctx.fillStyle=this.theme.selection;ctx.textAlign='left';ctx.fillText(this.fitText(ctx,`Selected: ${this.selectedPlans.get(scatter.id)?.info.visible??0} visible / ${result.count} total`,r.width),r.left,bottom-31);}
      if(linkedHistogram){
        ctx.fillStyle=this.theme.selection;ctx.fillRect(r.left,bottom-83,12,4);ctx.textAlign='left';ctx.fillText('Selected observations',r.left+18,bottom-78);
        ctx.fillStyle=this.theme.muted;
        ctx.fillText(this.fitText(ctx,`Selected: ${result.histogram.info.omitted} non-finite`,r.width),r.left,bottom-28);
        ctx.fillText(this.fitText(ctx,`Selected: ${result.histogram.info.rangeExcluded} outside range`,r.width),r.left,bottom-13);
      }
    }
    ctx.restore();
  }
  private drawAnnotations(ctx:CanvasRenderingContext2D,panel:PanelFrame):void{
    const {rect:r,bounds,view}=panel;
    ctx.save();ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.clip();
    for(const annotation of this.source.spec.annotations??[]){
      if((annotation.panelId??'main')!==panel.id)continue;
      const {style}=annotation;ctx.strokeStyle=ctx.fillStyle=style.color??this.theme.muted;ctx.lineWidth=style.width??1;ctx.globalAlpha=style.opacity??1;
      const x=annotation.x===undefined?NaN:r.left+normalize(annotation.x,bounds.x,view.xScale)*r.width;
      const y=annotation.y===undefined?NaN:r.top+(1-normalize(annotation.y,bounds.y,view.yScale))*r.height;
      if(annotation.kind==='text'&&Number.isFinite(x)&&Number.isFinite(y)){
        const size=style.fontSize??12;ctx.font=`${size}px ${this.theme.fontFamily}`;ctx.textAlign='left';
        for(const [i,line] of (annotation.text??'').split('\n').entries())ctx.fillText(line,x,y+i*size*1.2);
      }else if(annotation.kind==='hline'&&Number.isFinite(y)){ctx.beginPath();ctx.moveTo(r.left,y);ctx.lineTo(r.left+r.width,y);ctx.stroke();}
      else if(annotation.kind==='vline'&&Number.isFinite(x)){ctx.beginPath();ctx.moveTo(x,r.top);ctx.lineTo(x,r.top+r.height);ctx.stroke();}
    }
    ctx.restore();
  }
  private location(event:MouseEvent):[number,number]{const rect=this.overlay.getBoundingClientRect();const x=event.clientX-rect.left,y=event.clientY-rect.top;this.pointerPosition={x,y,clientX:event.clientX,clientY:event.clientY};return [x,y];}
  private clearXHover():void{const had=!!this.xHover;this.xHover=undefined;this.xPinned=false;if(had)this.figure.emit('xhover',null);}
  private clearHover():void{this.lastHover=undefined;this.pendingHover=undefined;this.clearXHover();this.tooltip=undefined;const hadHit=this.hoverHit!==undefined;this.hoverHit=undefined;if(hadHit)this.figure.emit('hover',null);}
  private sourceInspection(layer:LayerSpec,panel:PanelFrame):XInspectionIndex{
    const x=this.displayedSource.registry.get(layer.data.x),y=this.displayedSource.registry.get(layer.data.y);
    const key=JSON.stringify([layer.data.x,x.descriptor.version,layer.data.y,y.descriptor.version,panel.view.xScale,panel.view.yScale]);
    let cached=this.inspection.get(layer.id);
    if(cached?.key!==key){cached={key,index:buildXInspectionIndex(x.values,{y:y.values},{xScale:panel.view.xScale,yScale:panel.view.yScale})};this.inspection.set(layer.id,cached);}
    return cached.index;
  }
  private inspectX(cursorX:number,panel:PanelFrame):void{
    this.tooltip=undefined;
    const items:XHoverEvent['items']=[];
    for(const layer of panel.layers.filter(l=>l.kind==='line')){
      const index=this.sourceInspection(layer,panel),at=nearestWithinRun(index,cursorX);
      if(at!==null)items.push({layerId:layer.id,index:at,x:index.x[at],y:this.displayedSource.registry.get(layer.data.y).values[at],...this.streamIdentity(layer.id,at)});
    }
    this.xHover={cursorX,frameId:this.completedFrames,snapshotId:this.snapshotId,dataRevision:this.displayedSource.acceptedRevision,pointerPosition:{...this.pointerPosition},...this.panelMetadata(panel.id,this.displayedSource),items};
    this.figure.emit('xhover',this.xHover);this.drawOverlay();
  }
  private keyDown=(event:KeyboardEvent):void=>{
    if(event.key==='Escape'){this.clearHover();this.drawOverlay();return;}
    const panel3d=this.panels.find(panel=>panel.view.kind==='3d'&&(!this.lastHover||this.panelAt(...this.lastHover)?.id===panel.id));
    if(panel3d&&['1','2','3','0','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','Home'].includes(event.key)){
      event.preventDefault();const view=this.interactionFigure.panelView(panel3d.id),camera={...view.camera};
      if(event.key==='Home')this.resetInspectionView(panel3d.id);
      else{if(['0','1','2','3'].includes(event.key))Object.assign(camera,cameraPreset(({0:'isometric',1:'xy',2:'xz',3:'yz'} as const)[event.key as '0'|'1'|'2'|'3']));
      else if(event.key==='ArrowLeft'||event.key==='ArrowRight')camera.azimuth+=event.key==='ArrowLeft'?-5:5;
      else if(event.key==='ArrowUp'||event.key==='ArrowDown')camera.elevation=Math.max(-90,Math.min(90,camera.elevation+(event.key==='ArrowUp'?5:-5)));
      else camera.distance=Math.max(1,Math.min(20,camera.distance*(event.key==='+'?.9:1.1)));
      this.setInspectionView(panel3d.id,{camera});}return;
    }
    if(this.displayedSource.spec.hoverMode!=='x'||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!this.committedFigure)return;
    const panel=this.panels.find(p=>p.id===(this.xHover?.panelId??'main'))??this.panels[0],layer=panel?.layers.find(l=>l.kind==='line');if(!layer)return;
    const index=this.sourceInspection(layer,panel),xs=index.x,dir=event.key==='ArrowLeft'||event.key==='End'?-1:1;
    let at=event.key==='End'?xs.length-1:0;
    if(event.key.startsWith('Arrow')&&this.xHover){
      let low=0,high=xs.length;while(low<high){const mid=low+Math.floor((high-low)/2);if(xs[mid]<this.xHover.cursorX)low=mid+1;else high=mid;}
      const current=this.xHover.items.find(item=>item.layerId===layer.id);at=current?current.index+dir:dir>0?low:low-1;
    }
    while(at>=0&&at<xs.length&&(!index.valid[at]||xs[at]<panel.bounds.x[0]||xs[at]>panel.bounds.x[1]))at+=dir;
    if(at<0||at>=xs.length)return;event.preventDefault();this.xPinned=true;this.inspectX(xs[at],panel);
    this.selectionStatus.textContent=`${this.axisLabel('x',xs[at],panel)}: ${this.xHover!.items.map(item=>`${panel.layers.find(l=>l.id===item.layerId)?.style.label??'Series'} ${this.axisLabel('y',item.y,panel)}`).join(', ')}`;
  };
  private drawXHover(ctx:CanvasRenderingContext2D):void{
    const event=this.xHover!,panel=this.panels.find(p=>p.id===(event.panelId??'main'));if(!panel)return;
    const r=panel.rect,x=r.left+normalize(event.cursorX,panel.bounds.x,panel.view.xScale)*r.width;
    ctx.save();ctx.beginPath();ctx.rect(r.left,r.top,r.width,r.height);ctx.clip();
    ctx.strokeStyle=this.theme.muted;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,r.top);ctx.lineTo(x,r.top+r.height);ctx.stroke();
    for(const item of event.items){const layer=panel.layers.find(l=>l.id===item.layerId)!;const px=r.left+normalize(item.x,panel.bounds.x,panel.view.xScale)*r.width,py=r.top+(1-normalize(item.y,panel.bounds.y,panel.view.yScale))*r.height;ctx.fillStyle=layer.style.color??this.theme.palette[0];ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fill();}
    ctx.restore();if(!this.source.presentation.tooltip)return;
    const lines=[this.axisLabel('x',event.cursorX,panel),...panel.layers.filter(l=>l.kind==='line').map((layer,i)=>{const hit=event.items.find(v=>v.layerId===layer.id);return `${layer.style.label??`Series ${i+1}`}: ${hit?`${this.axisLabel('y',hit.y,panel)} · x=${this.axisLabel('x',hit.x,panel)}`:'—'}`;})];
    ctx.font=`${this.fonts.tick}px ${this.theme.fontFamily}`;const width=Math.min(this.width-16,Math.max(...lines.map(t=>ctx.measureText(t).width))+20),lineHeight=this.fonts.tick+7,height=lines.length*lineHeight+14;
    const left=Math.max(8,Math.min(this.width-width-8,x+14)),top=Math.max(4,Math.min(this.height-height-4,r.top+12));
    ctx.fillStyle=this.theme.tooltipBackground;ctx.fillRect(left,top,width,height);ctx.fillStyle=this.theme.tooltipForeground;ctx.textAlign='left';
    lines.forEach((line,i)=>ctx.fillText(this.fitText(ctx,line,width-20),left+10,top+this.fonts.tick+7+i*lineHeight));
  }
  private streamIdentity(layerId:string,index?:number,source=this.displayedSource):{streamId?:string;sequence?:number;revision?:number}{const state=source.getStreamingState(layerId);return state?{streamId:state.streamId,revision:state.revision,...(index===undefined?{}:{sequence:state.nextSequence-state.retained+index})}:{};}
  private emitHit(payload:Omit<HoverEvent,'pointerPosition'>):void{const layer=this.displayedSource.spec.layers.find(layer=>layer.id===payload.layerId);const event={...payload,...this.streamIdentity(payload.layerId as string,payload.index as number|undefined),frameId:this.completedFrames,snapshotId:this.snapshotId,dataRevision:this.displayedSource.acceptedRevision,sourceRevision:layer?.data.x?this.displayedSource.registry.get(layer.data.x).descriptor.version:undefined,pointerPosition:{...this.pointerPosition}} as unknown as HoverEvent;this.hoverHit=event;this.figure.emit('hover',event);}
  private axisLabel(axis:'x'|'y',value:number,panel:PanelFrame,span?:number):string{const format=panel.view[`${axis}Format`];return panel.view[`${axis}Scale`]==='time'&&(!format||format.kind==='date')?formatTimeTick(value,span??(panel.bounds[axis][1]-panel.bounds[axis][0]),format):formatValue(value,format,span);}
  /** Browser gestures stay inside calendar limits; explicit API validation remains strict. */
  private gestureDomain(domain:Domain,axis:'x'|'y',view:ViewSpec):Domain|undefined{
    if(!domain.every(Number.isFinite))return;
    if(view[`${axis}Scale`]==='time'||view[`${axis}Format`]?.kind==='date')domain=[Math.max(-8.64e15,domain[0]),Math.min(8.64e15,domain[1])];
    if(domain[0]>=domain[1]||view[`${axis}Scale`]==='log'&&domain[0]<=0)return;
    return domain;
  }
  private panelAt(x:number,y:number):PanelFrame|undefined{return this.panels.find(({rect:r})=>x>=r.left&&x<=r.left+r.width&&y>=r.top&&y<=r.top+r.height);}
  private wheel=(event:WheelEvent):void=>{
    const [x,y]=this.location(event),panel=this.panelAt(x,y);if(!panel)return;event.preventDefault();
    const view=this.interactionFigure.panelView(panel.id),factor=Math.exp(Math.max(-1,Math.min(1,event.deltaY*.001))),r=panel.rect;
    if(view.kind==='3d'){this.interactionFigure.setPanelView(panel.id,{camera:{...view.camera,distance:Math.max(1,Math.min(20,view.camera.distance*factor))}});}
    else {const tx=(x-r.left)/r.width,ty=1-(y-r.top)/r.height;
      const zoom=(d:Domain,t:number,scale:ScaleKind):Domain=>[denormalize(t+(0-t)*factor,d,scale),denormalize(t+(1-t)*factor,d,scale)];
      const xd=this.gestureDomain(zoom(panel.bounds.x,tx,view.xScale),'x',view),yd=this.gestureDomain(zoom(panel.bounds.y,ty,view.yScale),'y',view);
      if(xd&&yd)this.interactionFigure.setPanelView(panel.id,{xDomain:xd,yDomain:yd});
    }this.emitInspectionViewChange(panel.id);
  };
  private pointerDown=(event:PointerEvent):void=>{
    const [x,y]=this.location(event),panel=this.panelAt(x,y);if(!panel||event.button!==0)return;
    this.xPinned=false;this.overlay.focus({preventScroll:true});this.overlay.setPointerCapture(event.pointerId);this.tooltip=undefined;
    this.drag={pointerId:event.pointerId,panelId:panel.id,x,y,lastX:x,lastY:y,select:event.shiftKey&&panel.view.kind==='2d',pan:event.shiftKey,bounds:structuredClone(panel.bounds),rect:{...panel.rect}};
  };
  private pointerMove=(event:PointerEvent):void=>{
    const [x,y]=this.location(event),d=this.drag;
    if(!d){this.pendingHover=[x,y];if(!this.hoverRaf)this.hoverRaf=requestAnimationFrame(()=>{this.hoverRaf=0;const pending=this.pendingHover;this.pendingHover=undefined;if(pending&&!this.disposed)this.hover(...pending);});return;}
    if(!d.select&&!d.moved&&Math.hypot(x-d.x,y-d.y)<4)return;
    if(Math.hypot(x-d.x,y-d.y)>=4)d.moved=true;
    const r=d.rect;
    if(d.select){this.box=[d.x,d.y,Math.max(r.left,Math.min(r.left+r.width,x)),Math.max(r.top,Math.min(r.top+r.height,y))];this.drawOverlay();return;}
    const view=this.interactionFigure.panelView(d.panelId);
    if(view.kind==='3d'){
      if(d.pan){const pan=view.pan3d??[0,0];this.interactionFigure.setPanelView(d.panelId,{pan3d:[pan[0]+(x-d.lastX)/r.width*2,pan[1]-(y-d.lastY)/r.height*2]});}
      else this.interactionFigure.setPanelView(d.panelId,{camera:{...view.camera,azimuth:view.camera.azimuth+(x-d.lastX)*.5,elevation:Math.max(-89,Math.min(89,view.camera.elevation+(y-d.lastY)*.5))}});
      d.lastX=x;d.lastY=y;
    }else{
      const dx=(d.x-x)/r.width,dy=(y-d.y)/r.height;
      const shifted=(domain:Domain,t:number,scale:ScaleKind):Domain=>[denormalize(t,domain,scale),denormalize(1+t,domain,scale)];
      const xd=this.gestureDomain(shifted(d.bounds.x,dx,view.xScale),'x',view),yd=this.gestureDomain(shifted(d.bounds.y,dy,view.yScale),'y',view);
      if(xd&&yd)this.interactionFigure.setPanelView(d.panelId,{xDomain:xd,yDomain:yd});
    }
  };
  private pointerUp=(event:PointerEvent):void=>{
    const d=this.drag;if(!d)return;const panel=this.panels.find(panel=>panel.id===d.panelId);
    if(d.select&&this.box&&panel)this.select(this.box,panel);
    const [x,y]=this.location(event),clicked=!d.select&&!d.moved&&Math.hypot(x-d.x,y-d.y)<4;this.drag=undefined;this.box=undefined;if(this.overlay.hasPointerCapture(event.pointerId))this.overlay.releasePointerCapture(event.pointerId);
    if(clicked){this.hover(x,y,true);if(this.hoverHit){this.selectedHit=structuredClone(this.hoverHit);this.figure.emit('click',this.hoverHit);}if(this.displayedSource.spec.hoverMode==='x'&&panel){this.inspectX(this.pointToData(x,y,panel)[0],panel);this.xPinned=event.pointerType==='touch';}}this.drawOverlay();this.emitInspectionViewChange(d.panelId);
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
    const horizontal=item.kind==='bar'?item.orientation==='horizontal':item.kind==='boxplot'&&layer.options&&'orientation' in layer.options&&layer.options.orientation==='horizontal';
    const valueAxis=horizontal?'x':'y';
    const metadata={layerId:layer.id,...this.panelMetadata(panel.id,this.displayedSource)},format=(value:number)=>formatValue(value,panel.view[`${valueAxis}Format`]);
    if(item.kind==='hist'){
      const rightClosed=item.binIndex===prepared.items.length-1;
      this.tooltip={x,y,text:`[${formatValue(item.left,panel.view.xFormat)}, ${formatValue(item.right,panel.view.xFormat)}${rightClosed?']':')'} · count=${item.count} · height=${format(item.height)}`};
      this.emitHit({...item,...metadata,kind:'bin'});
    }else if(item.kind==='bar'){
      const axis=item.orientation==='horizontal'?'y':'x',position=this.axisValue(axis,item.position,panel.id);
      const label=typeof position==='number'?this.axisLabel(axis,position,panel):position;
      this.tooltip={x,y,text:`${label} · value=${format(item.value)} · start=${format(item.start)} · end=${format(item.end)}`};
      this.emitHit({...item,...metadata,kind:'bar',category:position});
    }else{
      const axis=layer.options&&'orientation' in layer.options&&layer.options.orientation==='horizontal'?'y':'x',group=this.axisValue(axis,item.position,panel.id);
      const label=typeof group==='number'?this.axisLabel(axis,group,panel):group;
      if(hit.kind==='point'){
        this.tooltip={x,y,text:`${label} · outlier=${format(hit.value)} · sample=${hit.sourceIndex}`};
        this.emitHit({...item,...metadata,kind:'outlier',group,sourceIndex:hit.sourceIndex,value:hit.value});
      }else{
        this.tooltip={x,y,text:`${label} · n=${item.count} · Q1=${format(item.q1)} · median=${format(item.median)} · Q3=${format(item.q3)} · whiskers=[${format(item.whiskerLow)}, ${format(item.whiskerHigh)}] · outliers=${item.outlierCount}`};
        this.emitHit({...item,...metadata,kind:'box',group});
      }
    }
    return true;
  }
  private hover(x:number,y:number,forceNearest=false):void{
    this.lastHover=[x,y];
    const hadHit=this.hoverHit!==undefined;this.tooltip=undefined;this.hoverHit=undefined;const panel=this.panelAt(x,y);if(!panel||!this.committedFigure||this.failure){if(hadHit)this.figure.emit('hover',null);this.drawOverlay(this.failure?.message);return;}
    const source=this.displayedSource;
    if(panel.view.kind==='3d'){
      const view=panel.view,matrix=cameraMatrix(view.camera.azimuth,view.camera.elevation,view.camera.distance,panel.rect.width/panel.rect.height,view.pan3d??[0,0],scientificAspect(view,panel.bounds,panel.zDomain));
      const items=panel.layers.flatMap(layer=>{const geometry=this.geometries.get(layer.id)?.geometry;return geometry?[{layer,geometry}]:[];});
      const hit=pick3D(items,source.registry,matrix,panel.rect,x,y,{bounds:panel.bounds,zDomain:panel.zDomain,view});
      if(hit){this.emitHit({...hit});this.tooltip={x,y,text:`${hit.interpolated?'Interpolated':'Source sample'} · x=${formatValue(hit.x)} y=${formatValue(hit.y)} z=${formatValue(hit.z)}${hit.value===undefined?'':` · scalar=${formatValue(hit.value)}`}`};}
      else if(hadHit)this.figure.emit('hover',null);
      this.drawOverlay();return;
    }
    if(source.spec.hoverMode==='x'&&!forceNearest){if(!this.xPinned)this.inspectX(this.pointToData(x,y,panel)[0],panel);return;}
    const {rect:r,view,bounds}=panel,metadata=this.panelMetadata(panel.id,source);
    for(const layer of [...panel.layers].reverse()){
      const prepared=this.statistics.get(layer.id);
      if(prepared){if(this.statisticsHover(prepared,layer,x,y,panel))break;continue;}
      const plan=this.plans.get(layer.id);
      if(plan?.kind==='density'){
        const c=Math.min(plan.columns-1,Math.floor((x-r.left)/r.width*plan.columns)),row=Math.min(plan.rows-1,Math.floor((1-(y-r.top)/r.height)*plan.rows)),count=plan.counts[row*plan.columns+c];
        if(!count)continue;this.tooltip={x,y,text:`${count.toLocaleString()} records / bin`};this.emitHit({kind:'density',layerId:layer.id,...metadata,count,column:c,row});break;
      }
      if(layer.kind==='band')continue;
      const xs=source.registry.get(layer.data.x).values,ys=source.registry.get(layer.data.y).values;
      if(plan?.kind==='points'||plan?.kind==='line'){
        const groups=plan.kind==='points'?[plan.indices]:plan.segments;let best=64,index=-1,candidates:Iterable<number>[] = groups;
        if(!forceNearest&&plan.info.rendered>2000){
          let cached=this.hoverIndices.get(layer.id);
          if(cached?.plan!==plan){
            const revision=this.committedRevision;cached={plan};this.hoverIndices.set(layer.id,cached);const target=cached;
            void runSteps(hoverIndexSteps(xs,ys,groups,bounds,r.width,r.height,view.xScale,view.yScale),()=>this.disposed||this.committedRevision!==revision).then(index=>{if(this.disposed||revision!==this.committedRevision||this.hoverIndices.get(layer.id)!==target)return;target.index=index;if(this.lastHover)this.hover(...this.lastHover);},()=>{if(this.hoverIndices.get(layer.id)===target)this.hoverIndices.delete(layer.id);});
          }
          if(!cached.index)continue;candidates=[hoverCandidates(cached.index,x-r.left,y-r.top)];
        }
        for(const group of candidates)for(const i of group){const px=r.left+normalize(xs[i],bounds.x,view.xScale)*r.width,py=r.top+(1-normalize(ys[i],bounds.y,view.yScale))*r.height;const dist=(px-x)**2+(py-y)**2;if(dist<best){best=dist;index=i;}}
        if(index>=0){const xv=this.axisValue('x',xs[index],panel.id),yv=this.axisValue('y',ys[index],panel.id);this.tooltip={x,y,text:`x=${typeof xv==='number'?this.axisLabel('x',xv,panel):xv}  y=${typeof yv==='number'?this.axisLabel('y',yv,panel):yv}`};this.emitHit({kind:'point',layerId:layer.id,...metadata,index,x:xv,y:yv,...(layer.categorical?{xCoordinate:xs[index],yCoordinate:ys[index]}:{})});break;}
      }else if(layer.kind==='heatmap'){
        const [vx,vy]=this.pointToData(x,y,panel),xe=gridEdges(xs,view.xScale),ye=gridEdges(ys,view.yScale);
        const col=xe.findIndex((v,i)=>i<xe.length-1&&vx>=v&&vx<xe[i+1]),row=ye.findIndex((v,i)=>i<ye.length-1&&vy>=v&&vy<ye[i+1]);
        if(col>=0&&row>=0){const value=source.registry.get(layer.data.z).values[row*xs.length+col];this.tooltip={x,y,text:`value=${value}`};this.emitHit({kind:'cell',layerId:layer.id,...metadata,row,column:col,value});break;}
      }
    }if(!this.hoverHit&&hadHit)this.figure.emit('hover',null);this.drawOverlay();
  }
  private select(box:[number,number,number,number],panel:PanelFrame):void{
    if(!this.committedFigure||this.failure)return;
    const sequence=++this.selectionSequence,revision=this.committedRevision,source=this.displayedSource;
    const a=this.pointToData(box[0],box[1],panel),b=this.pointToData(box[2],box[3],panel);const bounds:Bounds={x:[Math.min(a[0],b[0]),Math.max(a[0],b[0])],y:[Math.min(a[1],b[1]),Math.max(a[1],b[1])]};
    for(const layer of panel.layers){
      if(source.spec.selectionLink?.scatter.includes(layer.id)){const target=this.interactionFigure;if(target.spec.selectionLink?.id===source.spec.selectionLink.id&&target.spec.selectionLink.scatter.includes(layer.id))target.selectLinked(layer.id,bounds,!!this.frozenFigure);continue;}
      const prepared=this.statistics.get(layer.id);
      if(prepared){
        const selected=new Set<number>();
        for(const mark of prepared.marks){
          const target=this.markBounds(mark);
          if(target.x[0]<=bounds.x[1]&&target.x[1]>=bounds.x[0]&&target.y[0]<=bounds.y[1]&&target.y[1]>=bounds.y[0])selected.add(prepared.items[mark.itemIndex].index);
        }
        const indices=Array.from(selected).sort((a,b)=>a-b).slice(0,10000);
        const result:Selection={kind:prepared.kind==='hist'?'bins':prepared.kind==='bar'?'bars':'boxes',layerId:layer.id,...this.panelMetadata(panel.id,source),indices,count:selected.size,truncated:selected.size>indices.length};
        this.figure.emit('selection',result);continue;
      }
      if(layer.kind!=='scatter'&&layer.kind!=='line')continue;
      const density=this.plans.get(layer.id)?.kind==='density',metadata=this.panelMetadata(panel.id,source),identity=this.streamIdentity(layer.id,undefined,source),stream=source.getStreamingState(layer.id);
      void this.scheduler.querySelection(`${layer.id}:selection`,layer.data.x,layer.data.y,bounds,source.registry,density?undefined:layer.data.color).then(selected=>{
        if(this.disposed||revision!==this.committedRevision||sequence!==this.selectionSequence)return;
        const indices=Array.from(selected.indices),rowSequences=stream?indices.map(index=>stream.nextSequence-stream.retained+index):undefined;
        const result:Selection=density?{kind:'density',layerId:layer.id,...metadata,...identity,bounds,count:selected.count}:{kind:'points',layerId:layer.id,...metadata,...identity,...(rowSequences?{sequences:rowSequences}:{}),indices,count:selected.count,truncated:selected.truncated};this.figure.emit('selection',result);
      },error=>{if(!this.disposed&&revision===this.committedRevision&&error?.name!=='AbortError')this.figure.emit('error',{message:error instanceof Error?error.message:String(error)});});
    }
  }
  async exportPNG(options:ExportPNGOptions={}):Promise<Blob>{
    const validated=validateExportPNGOptions(options),reservation=this.reserveExport();
    let lease:SnapshotLease|undefined;
    try{
      lease=this.captureExport(validated.source);const snapshot=lease.snapshot,buffers=new Map<string,DataEntry>();
      for(const source of snapshot.sources)buffers.set(source.id,lease.registry.get(source.id));
      return await this.queueSnapshotPNG(snapshot,buffers,validated,reservation.signal);
    }finally{lease?.release();this.exportReservations.delete(reservation);}
  }
  async exportSnapshotPNG(input:Snapshot,inputBuffers:ReadonlyMap<string,ArrayBuffer|NumericArray|DataEntry>,options:ExportPNGOptions={}):Promise<Blob>{
    const validated=validateExportPNGOptions(options),reservation=this.reserveExport();
    try{return await this.queueSnapshotPNG(input,inputBuffers,validated,reservation.signal);}
    finally{this.exportReservations.delete(reservation);}
  }
  private reserveExport():AbortController{
    if(this.disposed)throw new Error('Figure view disposed during PNG export');
    if(this.exportReservations.size>=8)throw Object.assign(new Error('At most 8 PNG exports may be pending per figure view'),{code:'EXPORT_BACKPRESSURE'});
    const reservation=new AbortController();this.exportReservations.add(reservation);return reservation;
  }
  private async queueSnapshotPNG(input:Snapshot,inputBuffers:ReadonlyMap<string,ArrayBuffer|NumericArray|DataEntry>,validated:ExportPNGOptions,signal:AbortSignal):Promise<Blob>{
    const target={width:validated.width??(validated.source==='displayed'?input.figure.width:this.width),height:validated.height??(validated.source==='displayed'?input.figure.height:this.height),scale:validated.scale??this.dpr};
    const raster=validateExportRaster(target.width,target.height,target.scale);
    this.renderer.validateRasterSize(raster.width,raster.height);
    // Capture an owned snapshot before queueing, so refresh/resize/close cannot mix generations.
    const copyBytes=[...inputBuffers.values()].reduce((n,buffer)=>n+('descriptor' in buffer?buffer.descriptor.byteLength:buffer.byteLength),0);
    const link=input.figure.selectionLink,linkedMembers=new Set(link?[...link.scatter,link.histogram]:[]);
    const linkedSources=new Set(input.figure.layers.filter(layer=>linkedMembers.has(layer.id)).flatMap(layer=>Object.values(layer.data)));
    // Import validation isolates linked sources. Account for those additional
    // owned copies before allocating either the queue buffers or the importer.
    const linkedBytes=input.sources.reduce((n,source)=>n+(linkedSources.has(source.id)?source.byteLength:0),0);
    const releaseCopy=this.snapshotStore.reserve(copyBytes+linkedBytes);
    try {
    const snapshot=structuredClone(input),buffers=new Map<string,ArrayBuffer>();
    for(const [id,buffer]of inputBuffers){
      if('descriptor' in buffer){const bytes=new Uint8Array(buffer.descriptor.byteLength);let offset=0;for(const chunk of buffer.chunks??[buffer.values]){bytes.set(new Uint8Array(chunk.buffer,chunk.byteOffset,chunk.byteLength),offset);offset+=chunk.byteLength;}buffers.set(id,bytes.buffer);}
      else buffers.set(id,ArrayBuffer.isView(buffer)?buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength) as ArrayBuffer:buffer.slice(0));
    }
    this.exportCopiedBytes+=copyBytes;
    snapshot.figure.width=target.width;snapshot.figure.height=target.height;
    const run=async()=>{
      if(this.disposed||signal.aborted)throw new Error('Figure view disposed during PNG export');
      const host=document.createElement('div');host.style.cssText=`position:absolute;left:-100000px;top:0;width:${target.width}px;height:${target.height}px;pointer-events:none;`;
      host.setAttribute('aria-hidden','true');document.body.appendChild(host);
      const copy=new Figure();let view:FigureView|undefined;
      try{copy.applySnapshot(snapshot,buffers);this.exportCopiedBytes+=linkedBytes;view=new FigureView(copy,host,target,this.renderer.gl);view.schedule();await view.ready({signal});return await view.capturePNG();}
      finally{view?.dispose();copy.close();host.remove();}
    };
    const result=this.exportQueue.then(run,run);this.exportQueue=result.catch(()=>{});
    let cancel!:()=>void;
    const cancelled=new Promise<never>((_,reject)=>{cancel=()=>{buffers.clear();reject(new Error('Figure view disposed during PNG export'));};signal.addEventListener('abort',cancel,{once:true});});
    try{return await Promise.race([result,cancelled]);}finally{signal.removeEventListener('abort',cancel);}
    } finally {releaseCopy();}
  }
  private async capturePNG():Promise<Blob>{
    const canvas=document.createElement('canvas');canvas.width=this.renderer.canvas.width;canvas.height=this.renderer.canvas.height;
    const overlay=document.createElement('canvas');overlay.width=canvas.width;overlay.height=canvas.height;
    const overlayContext=overlay.getContext('2d')!;overlayContext.setTransform(this.dpr,0,0,this.dpr,0,0);this.drawOverlay(undefined,overlayContext,true);
    const ctx=canvas.getContext('2d')!;ctx.drawImage(this.renderer.rasterCanvas(),0,0);ctx.drawImage(overlay,0,0);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding failed')),'image/png'));
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;for(const reservation of this.exportReservations)reservation.abort();this.exportReservations.clear();if(this.raf)cancelAnimationFrame(this.raf);if(this.hoverRaf)cancelAnimationFrame(this.hoverRaf);this.selectionSequence++;this.observer.disconnect();this.scheduler.dispose();this.renderer.dispose();
    for(const cleanup of this.cleanup)cleanup();this.root.remove();this.plans.clear();this.geometries.clear();this.extents.clear();this.statistics.clear();this.barCache.clear();this.statisticsRequests.clear();this.sources.clear();this.panels=[];
    this.linkedResult=undefined;this.linkedSpec=undefined;this.selectedPlans.clear();
    this.renderingFigure=undefined;this.committedFigure=undefined;this.hoverIndices.clear();
    this.frozenFigure=undefined;this.frozenLease?.release();this.frozenLease=undefined;
    for(const lease of this.retiredSnapshots)lease.release();this.retiredSnapshots.clear();
    // Pins and application export leases belong to the Figure, across mounts.
    if(this.ownsSnapshotStore)this.snapshotStore.dispose();
    for(const waiter of this.waiters.splice(0))waiter.reject(new Error('Figure view disposed'));
  }
}
