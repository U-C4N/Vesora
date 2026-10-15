import type {Figure} from './figure';
import {toHTML} from './html-export';
import type {HoverEvent, ThemeInput, ViewState} from './types';
import {VIEWER_STYLE} from './viewer-style';

export type ViewerTheme = 'dark' | 'light';
export interface ViewerOptions {
  theme?: ViewerTheme;
  title?: string;
  /** Omit to use the figure's current height. */
  height?: number;
  /** Open the inspector initially. It otherwise opens when an observation is selected. */
  inspector?: boolean;
  /** Offline hosts can suppress live controls without changing the scene. */
  live?: boolean;
  /** Offline viewers already contain their own document; omit its HTML action. */
  exportHTML?: boolean;
  /** Keep an imported scene's custom colors while theming only the chrome. */
  preserveTheme?: boolean;
  /** Stack grid panels when the available plotting width is narrow. Defaults to true. */
  responsivePanels?: boolean;
  onError?: (error: Error) => void;
}
export interface ViewerHandle {
  readonly element: HTMLElement;
  readonly figure: Figure;
  setTheme(theme: ViewerTheme): void;
  /** Removes this view and its listeners; the application still owns the figure. */
  dispose(): void;
}

export const OBSIDIAN_DARK: Readonly<ThemeInput> = Object.freeze({background:'#101215',foreground:'#edf0f4',muted:'#a2abb8',grid:'#2c323b',axis:'#586473',tooltipBackground:'#edf0f4',tooltipForeground:'#101215',selection:'#c5f36b',error:'#ffb3a8',fontFamily:'system-ui, sans-serif',fontSize:12,palette:['#c5f36b','#79b7ff','#f2b182','#c0a2ff','#73d4c0']});
export const OBSIDIAN_LIGHT: Readonly<ThemeInput> = Object.freeze({background:'#fbfcfd',foreground:'#18202a',muted:'#4e5b6b',grid:'#e2e6ec',axis:'#768392',tooltipBackground:'#18202a',tooltipForeground:'#fbfcfd',selection:'#426b0a',error:'#a82424',fontFamily:'system-ui, sans-serif',fontSize:12,palette:['#426b0a','#225dab','#9b4818','#7242af','#146e61']});
const attachments = new WeakMap<Figure, ViewerHandle>();
const message = (error:unknown) => error instanceof Error ? error : new Error(String(error));
const text = (node:HTMLElement, value:string) => {if(node.textContent!==value)node.textContent=value;};
const formatter = new Intl.NumberFormat('en-US',{maximumFractionDigits:4});
const number = (value:number) => formatter.format(value);
const inspectionHint='Select or hover a sample to inspect its coordinates.';

/** Borrow an unmounted figure. No global keyboard handlers, styles or ownership transfer. */
export function mountViewer(figure:Figure, container:HTMLElement, options:ViewerOptions={}):ViewerHandle {
  if(!container || typeof container.appendChild!=='function')throw new TypeError('A viewer mount element is required.');
  if(attachments.has(figure)||figure.hasMountedView())throw new Error('This figure already has a mounted view. Unmount it before attaching another viewer.');
  if(options.height!==undefined&&(!Number.isFinite(options.height)||options.height<180))throw new RangeError('Viewer height must be at least 180 pixels.');
  const document=container.ownerDocument;
  const root=document.createElement('section');root.dataset.vesoraViewer='';root.setAttribute('aria-label',options.title??figure.spec.title??'Scientific viewer');
  const style=document.createElement('style');style.textContent=VIEWER_STYLE;root.append(style);
  const create=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent:HTMLElement=root)=>{const node=document.createElement(tag);node.className=className;parent.append(node);return node;};
  const toolbar=create('header','vv-toolbar');
  const title=create('h2','vv-title',toolbar);title.textContent=(options.title??figure.spec.title)||'Vesora';
  const actions=create('div','vv-toolbar-actions',toolbar);actions.setAttribute('role','group');actions.setAttribute('aria-label','Figure actions');
  const errorPanel=create('div','vv-error');errorPanel.hidden=true;errorPanel.setAttribute('role','alert');
  const errorText=create('p','',errorPanel);
  const body=create('div','vv-body');const plot=create('div','vv-plot',body);const chart=create('div','vv-chart',plot);
  const help=create('p','vv-help',plot);help.textContent='Drag to explore · wheel to zoom · double-click to reset';
  const sidebar=create('aside','vv-sidebar',body);sidebar.setAttribute('aria-label','Figure inspector');
  const layerDetails=create('details','',sidebar);layerDetails.open=true;create('summary','',layerDetails).textContent='Layers';
  const layerList=create('div','vv-layers',layerDetails);
  const inspectDetails=create('details','',sidebar);inspectDetails.open=options.inspector===true||!!figure.spec.inspection?.selection;create('summary','',inspectDetails).textContent='Inspector';
  const inspection=create('p','vv-inspection',inspectDetails);inspection.textContent=inspectionHint;
  const surfaceQuality=create('p','vv-notice',inspectDetails);surfaceQuality.hidden=true;
  const captureNotice=create('p','vv-notice',inspectDetails);
  const camera=create('div','vv-camera',inspectDetails);const cameraField=create('label','vv-field',camera);cameraField.append(document.createTextNode('3D panel'));
  const panelSelect=create('select','',cameraField);panelSelect.setAttribute('aria-label','3D panel');
  const cameraButtons=create('div','vv-camera-buttons',camera);cameraButtons.setAttribute('role','group');cameraButtons.setAttribute('aria-label','Camera view');
  const slices=create('div','vv-slices',inspectDetails);
  const diagnosticDetails=create('details','',sidebar);create('summary','',diagnosticDetails).textContent='Diagnostics';const diagnostics=create('p','vv-inspection',diagnosticDetails);
  const statusbar=create('footer','vv-statusbar');const status=create('span','vv-status',statusbar);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  let disposed=false,mounted=false,exporting=false,pendingTheme=false,theme:ViewerTheme=options.theme??'dark',layerKey='',panelKey='',sliceKey='';
  let selectedObservation:HoverEvent|undefined=figure.spec.inspection?.selection?structuredClone(figure.spec.inspection.selection):undefined;
  const initialViews:ViewState=figure.captureViews();
  const removers:Array<()=>void>=[];const downloads=new Set<string>();
  const fail=(caught:unknown)=>{if(disposed)return;const error=message(caught);errorText.textContent=/webgl/i.test(error.message)?'WebGL2 could not start. Use a WebGL2-capable browser to open this interactive figure.':error.message;errorPanel.hidden=false;text(status,'Unable to display the current view');try{options.onError?.(error);}catch{/* Consumer errors do not interrupt viewer cleanup. */}};
  const run=(action:()=>unknown)=>{try{const result=action();if(result instanceof Promise)void result.catch(fail);}catch(error){fail(error);}};
  const button=(label:string,parent:HTMLElement,action:()=>unknown)=>{const node=create('button','',parent);node.type='button';node.textContent=label;node.addEventListener('click',()=>run(action));return node;};
  const reset=button('Reset view',actions,()=>figure.getInspectionState().mode==='frozen'?figure.resetInspectionView():figure.restoreViews(initialViews));
  const freeze=button('Freeze view',actions,()=>figure.freezeInspection());
  const resume=button('Return to live',actions,()=>figure.resumeLive());resume.hidden=true;
  const themeButton=button('Light theme',actions,()=>handle.setTheme(theme==='dark'?'light':'dark'));
  const exportFile=async(format:'png'|'html')=>{
    if(exporting||disposed)return;exporting=true;png.disabled=html.disabled=true;
    try{
      const blob=format==='png'?await figure.savefig({source:'displayed'}):new Blob([toHTML(figure,{source:'displayed'})],{type:'text/html;charset=utf-8'});
      if(disposed)return;
      const url=URL.createObjectURL(blob);downloads.add(url);const link=document.createElement('a');link.href=url;link.download=`${(figure.spec.title||'vesora-figure').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,80)}.${format}`;link.click();
      setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},1000);
    }finally{exporting=false;if(!disposed)refresh();}
  };
  const png=button('Export PNG',actions,()=>exportFile('png'));const html=button('Export HTML',actions,()=>exportFile('html'));
  html.hidden=options.exportHTML===false;
  for(const preset of ['isometric','xy','xz','yz'] as const)button(preset==='isometric'?'Isometric':preset.toUpperCase(),cameraButtons,()=>{
    if(figure.getInspectionState().mode!=='frozen')return figure.setCameraPreset(preset,panelSelect.value);
    const angles={isometric:[35,25],xy:[-90,90],xz:[-90,0],yz:[0,0]}[preset];
    return figure.setInspectionView(panelSelect.value,{camera:{azimuth:angles[0],elevation:angles[1],distance:3},pan3d:[0,0]});
  });
  const equalAxes=button('Equal axes',cameraButtons,()=>figure.setInspectionView(panelSelect.value,{equalAspect:!figure.getInspectionView(panelSelect.value).equalAspect}));
  button('Fit data',cameraButtons,()=>figure.setInspectionView(panelSelect.value,{xDomain:undefined,yDomain:undefined,zDomain:undefined,camera:{...figure.getInspectionView(panelSelect.value).camera,distance:3},pan3d:[0,0]}));
  button('Focus selection',cameraButtons,()=>figure.focusInspectionSelection(panelSelect.value));
  panelSelect.addEventListener('change',()=>refresh());
  button('Retry view',errorPanel,()=>{errorPanel.hidden=true;if(!mounted){figure.mount(chart,{responsivePanels:options.responsivePanels!==false});mounted=true;}figure.setSize({height:options.height??figure.spec.height});return figure.ready().then(refresh);});
  const syncLayers=()=>{
    const shown=figure.getInspectionState().mode==='frozen'?figure.getInspectionSnapshot().figure:figure.spec;
    const key=JSON.stringify(shown.layers.map(layer=>layer.id));
    if(key!==layerKey){layerKey=key;layerList.replaceChildren();
      for(const layer of shown.layers){const node=button('',layerList,()=>{const current=figure.spec.layers.find(item=>item.id===layer.id);if(current)figure.updateVisibility(current,!current.visible);});node.className='vv-layer';node.dataset.layerId=layer.id;const swatch=create('span','vv-swatch',node);swatch.setAttribute('aria-hidden','true');create('span','vv-layer-label',node);}
      if(!shown.layers.length)create('p','vv-notice',layerList).textContent='No layers yet.';
    }
    for(const node of layerList.querySelectorAll<HTMLButtonElement>('button')){const layer=shown.layers.find(item=>item.id===node.dataset.layerId);if(!layer)continue;node.setAttribute('aria-pressed',String(layer.visible));node.setAttribute('aria-label',`${layer.style.label??layer.kind}: ${layer.visible?'hide':'show'} layer`);node.querySelector<HTMLElement>('.vv-swatch')!.style.background=layer.style.color??'var(--vv-accent)';text(node.querySelector<HTMLElement>('.vv-layer-label')!,layer.style.label??layer.kind);}
  };
  const sync3d=()=>{
    const captured=figure.getInspectionState().mode==='frozen'?figure.getInspectionSnapshot():undefined,shown=captured?.figure??figure.spec;
    const panels=[{id:'main',view:shown.view,title:shown.title},...(shown.panels??[]).filter(panel=>panel.id!=='main').map(panel=>({id:panel.id,view:panel.view,title:panel.title}))].filter(panel=>panel.view?.kind==='3d');
    camera.hidden=!panels.length;const key=JSON.stringify(panels.map(panel=>[panel.id,panel.title]));
    if(key!==panelKey){panelKey=key;const previous=panelSelect.value;panelSelect.replaceChildren();for(const panel of panels){const option=document.createElement('option');option.value=panel.id;option.textContent=panel.title||panel.id;panelSelect.append(option);}if(panels.some(panel=>panel.id===previous))panelSelect.value=previous;}
    equalAxes.setAttribute('aria-pressed',String(panels.length>0&&Boolean(figure.getInspectionView(panelSelect.value).equalAspect)));
    const relations=shown.slices??[];const nextKey=JSON.stringify(relations.map(relation=>[relation.sourceLayerId,relation.targetLayerId,relation.axis]));
    if(nextKey!==sliceKey){sliceKey=nextKey;slices.replaceChildren();for(const relation of relations){const source=shown.layers.find(layer=>layer.id===relation.sourceLayerId);if(!source)continue;const label=create('label','vv-field',slices);label.append(document.createTextNode(''));const input=create('input','',label);input.dataset.target=relation.targetLayerId;input.type='range';input.min='0';input.step='1';input.setAttribute('aria-label',`${source.style.label??'Surface'} ${relation.axis.toUpperCase()} slice`);input.addEventListener('input',()=>run(()=>figure.setInspectionSlice(relation.targetLayerId,Number(input.value))));}}
    for(const input of slices.querySelectorAll<HTMLInputElement>('input')){const relation=relations.find(item=>item.targetLayerId===input.dataset.target),source=relation&&shown.layers.find(layer=>layer.id===relation.sourceLayerId);if(!relation||!source)continue;const count=captured?captured.sources.find(item=>item.id===source.data[relation.axis])?.shape[0]??0:figure.registry.get(source.data[relation.axis]).values.length;input.max=String(Math.max(0,count-1));input.value=String(relation.index);input.parentElement!.firstChild!.textContent=`${relation.axis.toUpperCase()} slice · ${relation.index+1} / ${count}`;}
  };
  const refresh=()=>{
    if(disposed)return;syncLayers();sync3d();
    const state=figure.getInspectionState(),stats=figure.diagnostics();const streams=Object.values(stats.streams);const inspectionEnabled=options.live!==false,live=inspectionEnabled&&streams.length>0;
    const omitted=figure.inspect().filter(info=>info.kind==='surface'&&(info.omittedTriangles??0)>0);
    surfaceQuality.hidden=!omitted.length;
    text(surfaceQuality,omitted.map(info=>`${(state.mode==='frozen'?figure.getInspectionSnapshot().figure:figure.spec).layers.find(layer=>layer.id===info.layerId)?.style.label??'Surface'}: ${number(info.omittedTriangles!)} / ${number(info.totalTriangles!)} triangles omitted because coordinates or scalar values are not finite.`).join('\n'));
    if(pendingTheme&&state.mode==='live'){pendingTheme=false;figure.setTheme(theme==='dark'?OBSIDIAN_DARK:OBSIDIAN_LIGHT);}
    for(const control of layerList.querySelectorAll<HTMLButtonElement>('button')){control.disabled=state.mode==='frozen';control.title=state.mode==='frozen'?'Return to live before changing layers.':'';}
    themeButton.disabled=state.mode==='frozen';themeButton.title=state.mode==='frozen'?'Return to live before changing the theme.':'';
    const focusResume=document.activeElement===freeze&&state.mode==='frozen',focusFreeze=document.activeElement===resume&&state.mode==='live';
    freeze.hidden=!inspectionEnabled||state.mode==='frozen';resume.hidden=!inspectionEnabled||state.mode!=='frozen';freeze.disabled=!mounted||state.frameId===0;
    if(inspectionEnabled){if(focusResume)resume.focus();else if(focusFreeze)freeze.focus();}
    text(status,state.mode==='frozen'?`Frozen snapshot${state.capturedAt?` · ${new Date(state.capturedAt).toLocaleTimeString()}`:''}`:live?'Live':'Ready');
    const capture=figure.spec.inspection,capturedAt=state.capturedAt??capture?.capturedAt;
    captureNotice.hidden=!capturedAt;
    text(captureNotice,capturedAt?`Captured ${capturedAt}${state.snapshotId??capture?.snapshotId?` · Snapshot ${state.snapshotId??capture?.snapshotId}`:''}${capture?` · Source frame ${capture.frameId}`:''}`:'');
    text(diagnostics,`Backend: ${stats.backend??'unmounted'}\nWorker: ${stats.worker?'active':'cooperative fallback'}\nSource: ${number(stats.sourceBytes)} bytes\nFrame: ${state.frameId}\nSnapshot: ${number(state.snapshotBytes)} / ${number(state.maxSnapshotBytes)} bytes\nAccepted / displayed revision: ${state.acceptedRevision} / ${state.displayedRevision}${streams.length?`\nRetained: ${number(streams.reduce((sum,stream)=>sum+stream.retained,0))}\nEvicted: ${number(streams.reduce((sum,stream)=>sum+stream.evicted,0))}`:''}`);
    png.disabled=html.disabled=exporting||!mounted;reset.disabled=!mounted;
  };
  const showObservation=(event:HoverEvent|undefined,selected=false)=>{
    if(!event){text(inspection,inspectionHint);return;}
    const shown=figure.getInspectionState().mode==='frozen'?figure.getInspectionSnapshot().figure:figure.spec;
    const label=shown.layers.find(layer=>layer.id===event.layerId)?.style.label??event.layerId;
    const detail=[`${selected?'Selected':'Hovered'} ${event.interpolated?'interpolated value':'observation'} · ${label}`];
    for(const key of ['x','y','z','value','count'])if(event[key]!==undefined)detail.push(`${key}: ${String(event[key])}`);
    const sourceIndex=event.index??event.sourceIndex;if(sourceIndex!==undefined)detail.push(`Source index: ${sourceIndex}`);
    if(Array.isArray(event.cell))detail.push(`Cell row, column: ${event.cell.join(', ')}`);
    if(event.triangle!==undefined)detail.push(`Triangle: ${event.triangle}`);
    if(Array.isArray(event.indices))detail.push(`Segment indices: ${event.indices.join(', ')}`);
    for(const [key,label]of [['sequence','Sequence'],['frameId','Frame'],['snapshotId','Snapshot'],['sourceRevision','Source revision'],['dataRevision','Data revision']] as const)if(event[key]!==undefined)detail.push(`${label}: ${String(event[key])}`);
    if(event.sourceVersions&&typeof event.sourceVersions==='object')detail.push(`Channel versions: ${Object.entries(event.sourceVersions).map(([key,value])=>`${key} ${value}`).join(', ')}`);
    text(inspection,detail.join('\n'));
  };
  const handle:ViewerHandle={element:root,figure,setTheme(next){if(next!=='light'&&next!=='dark')throw new TypeError('Viewer theme must be light or dark.');if(disposed)return;theme=next;root.dataset.theme=next;themeButton.textContent=next==='dark'?'Light theme':'Dark theme';if(!options.preserveTheme){pendingTheme=figure.getInspectionState().mode==='frozen';if(!pendingTheme)figure.setTheme(next==='dark'?OBSIDIAN_DARK:OBSIDIAN_LIGHT);}},dispose(){if(disposed)return;disposed=true;for(const remove of removers)remove();for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();try{if(mounted&&figure.hasMountedView())figure.unmount();}finally{attachments.delete(figure);root.remove();}}};
  attachments.set(figure,handle);container.append(root);
  removers.push(
    figure.on('frame',()=>{errorPanel.hidden=true;selectedObservation=figure.getInspectionSelection();refresh();showObservation(selectedObservation,!!selectedObservation);}),
    figure.on('inspectionchange',refresh),figure.on('representation',refresh),figure.on('error',event=>fail(event.message)),
    figure.on('runtimechange',event=>{if(event.status==='recovering')text(status,'Restoring graphics…');else if(event.status==='fallback')text(status,'Ready · cooperative processing');}),
    figure.on('click',event=>{selectedObservation=structuredClone(event);inspectDetails.open=true;showObservation(selectedObservation,true);}),
    figure.on('hover',event=>showObservation(event??selectedObservation,!event&&!!selectedObservation)),
    figure.on('xhover',event=>{if(!event){showObservation(selectedObservation,!!selectedObservation);return;}const shown=figure.getInspectionState().mode==='frozen'?figure.getInspectionSnapshot().figure:figure.spec;const values=event.items.map(item=>`${shown.layers.find(layer=>layer.id===item.layerId)?.style.label??'Signal'}\nx: ${String(item.x)} · y: ${String(item.y)}${item.sequence===undefined?'':` · sample ${item.sequence}`}`);text(inspection,values.join('\n\n'));}),
    figure.on('selection',event=>text(inspection,`${number(event.count)} selected${'truncated' in event&&event.truncated?' · preview truncated':''}`)),
  );
  try{if(options.height!==undefined)figure.setSize({height:options.height});handle.setTheme(theme);figure.mount(chart,{responsivePanels:options.responsivePanels!==false});mounted=true;refresh();showObservation(selectedObservation,!!selectedObservation);void figure.ready().then(refresh).catch(fail);}catch(error){fail(error);}
  return handle;
}
