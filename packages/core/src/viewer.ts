import type {Figure} from './figure';
import {toHTMLAsync} from './html-export-async';
import type {Domain, HoverEvent, LayerSpec, Selection, ThemeInput, ViewSpec, ViewState, XHoverEvent} from './types';
import {VIEWER_STYLE} from './viewer-style';

export type ViewerTheme = 'dark' | 'light';
export type ViewerMode = 'studio' | 'embed';
export interface ViewerChrome {
  toolbar?: boolean;
  /** Visibility of the whole inspector sidebar, including layers and diagnostics. */
  inspector?: boolean;
  status?: boolean;
  help?: boolean;
}
export interface ViewerChromeTokens {
  background: string; panel: string; text: string; muted: string;
  border: string; control: string; accent: string; error: string;
}
export interface ViewerPresentationOptions {
  /** Studio shows the inspector; Embed starts with a compact toolbar and status. */
  mode?: ViewerMode;
  chrome?: ViewerChrome;
  /** Viewer-local CSS colors. These do not change plot colors or captured data. */
  themeTokens?: Partial<ViewerChromeTokens>;
  /** Initial export choice. Changing it never resumes a frozen view. */
  exportSource?: 'displayed' | 'accepted';
  /** Include a portable observation record in HTML exports only. Defaults to false. */
  observation?: boolean;
}
export interface ViewerOptions extends ViewerPresentationOptions {
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
  /** Updates chrome and export defaults without remounting or changing the figure. */
  updateOptions(options: ViewerPresentationOptions): void;
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
const PAGE_SIZE=20;
const OVERVIEW_KINDS=new Set(['line','band','spectrogram']);
const tokenProperties:Record<keyof ViewerChromeTokens,string>={background:'bg',panel:'panel',text:'text',muted:'muted',border:'line',control:'control',accent:'accent',error:'error'};
function presentationPatch(input:ViewerPresentationOptions,document:Document):ViewerPresentationOptions {
  if(!input||typeof input!=='object')throw new TypeError('Viewer options must be an object.');
  const result:ViewerPresentationOptions={};
  for(const key of ['mode','exportSource','observation'] as const)if(Object.hasOwn(input,key))Object.assign(result,{[key]:input[key]});
  if(result.mode!==undefined&&!['studio','embed'].includes(result.mode))throw new TypeError('Viewer mode must be studio or embed.');
  if(result.exportSource!==undefined&&!['displayed','accepted'].includes(result.exportSource))throw new TypeError('Viewer export source must be displayed or accepted.');
  if(result.observation!==undefined&&typeof result.observation!=='boolean')throw new TypeError('Viewer observation must be a boolean.');
  if(Object.hasOwn(input,'chrome')){
    if(input.chrome!==undefined&&(!input.chrome||typeof input.chrome!=='object'||Array.isArray(input.chrome)))throw new TypeError('Viewer chrome must be an object.');
    result.chrome=input.chrome===undefined?undefined:{};
    for(const [key,value] of Object.entries(input.chrome??{})){
      if(!['toolbar','inspector','status','help'].includes(key)||value!==undefined&&typeof value!=='boolean')throw new TypeError(`Invalid viewer chrome option ${key}.`);
      Object.assign(result.chrome!,{[key]:value});
    }
  }
  if(Object.hasOwn(input,'themeTokens')){
    if(input.themeTokens!==undefined&&(!input.themeTokens||typeof input.themeTokens!=='object'||Array.isArray(input.themeTokens)))throw new TypeError('Viewer theme tokens must be an object.');
    result.themeTokens=input.themeTokens===undefined?undefined:{};
    for(const [key,value] of Object.entries(input.themeTokens??{})){
      if(!Object.hasOwn(tokenProperties,key))throw new TypeError(`Invalid viewer color token ${key}.`);
      if(value===undefined)continue;
      if(typeof value!=='string'||!value.trim()||value.length>256||document.defaultView?.CSS?.supports&&!document.defaultView.CSS.supports('color',value))throw new TypeError(`Invalid viewer color token ${key}.`);
      Object.assign(result.themeTokens!,{[key]:value});
    }
  }
  return result;
}

/** Borrow an unmounted figure. No global keyboard handlers, styles or ownership transfer. */
export function mountViewer(figure:Figure, container:HTMLElement, options:ViewerOptions={}):ViewerHandle {
  if(!container || typeof container.appendChild!=='function')throw new TypeError('A viewer mount element is required.');
  if(attachments.has(figure)||figure.hasMountedView())throw new Error('This figure already has a mounted view. Unmount it before attaching another viewer.');
  if(options.height!==undefined&&(!Number.isFinite(options.height)||options.height<180))throw new RangeError('Viewer height must be at least 180 pixels.');
  const document=container.ownerDocument;
  let presentation=presentationPatch(options,document);
  const root=document.createElement('section');root.dataset.vesoraViewer='';root.setAttribute('aria-label',options.title??figure.spec.title??'Scientific viewer');
  const style=document.createElement('style');style.textContent=VIEWER_STYLE;root.append(style);
  const create=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,parent:HTMLElement=root)=>{const node=document.createElement(tag);node.className=className;parent.append(node);return node;};
  const toolbar=create('header','vv-toolbar');
  const title=create('h2','vv-title',toolbar);title.textContent=(options.title??figure.spec.title)||'Vesora';
  const actions=create('div','vv-toolbar-actions',toolbar);actions.setAttribute('role','group');actions.setAttribute('aria-label','Figure actions');
  const pill=create('span','vv-status vv-pill',toolbar);pill.setAttribute('role','status');pill.setAttribute('aria-live','polite');
  const pillDot=create('span','vv-state-dot',pill);pillDot.setAttribute('aria-hidden','true');
  const status=create('span','vv-status-text',pill);
  const exportDetails=create('details','vv-export',toolbar);exportDetails.open=true;create('summary','',exportDetails).textContent='Export';
  const exportPanel=create('div','vv-export-panel',exportDetails);
  const exportSourceField=create('label','vv-field',exportPanel);exportSourceField.append(document.createTextNode('Export source'));
  const exportSource=create('select','',exportSourceField);exportSource.setAttribute('aria-label','Export source');
  for(const [value,label] of [['displayed','Displayed frame'],['accepted','Latest accepted data']]){const item=document.createElement('option');item.value=value;item.textContent=label;exportSource.append(item);}
  const observationField=create('label','vv-checkbox',exportPanel);const observation=create('input','',observationField);observation.type='checkbox';observationField.append(document.createTextNode('Include observation record in HTML'));observationField.hidden=options.exportHTML===false;
  const exportHint=create('p','vv-notice',exportPanel);
  const errorPanel=create('div','vv-error');errorPanel.hidden=true;errorPanel.setAttribute('role','alert');
  const errorText=create('p','',errorPanel);
  const body=create('div','vv-body');const plot=create('div','vv-plot',body);const chart=create('div','vv-chart',plot);
  const overview=create('div','vv-overview',plot);overview.hidden=true;
  const overviewTrack=create('div','vv-overview-track',overview);overviewTrack.tabIndex=0;overviewTrack.setAttribute('role','slider');overviewTrack.setAttribute('aria-label','Visible x range');
  const overviewWindow=create('div','vv-overview-window',overviewTrack);
  const cursorGuide=create('div','vv-cursor-guide',plot);cursorGuide.hidden=true;cursorGuide.setAttribute('aria-hidden','true');
  const help=create('p','vv-help',plot);help.textContent='Drag to explore · wheel to zoom · double-click to reset';
  const sidebar=create('aside','vv-sidebar',body);sidebar.setAttribute('aria-label','Figure inspector');
  const layerDetails=create('details','',sidebar);layerDetails.open=true;create('summary','',layerDetails).textContent='Layers';
  const layerList=create('div','vv-layers',layerDetails);
  const inspectDetails=create('details','',sidebar);inspectDetails.open=options.inspector===true||!!figure.spec.inspection?.selection;create('summary','',inspectDetails).textContent='Inspector';
  const sampleCard=create('article','vv-sample vv-inspection',inspectDetails);sampleCard.tabIndex=0;sampleCard.setAttribute('aria-label','Sample');
  const sampleBody=create('div','vv-sample-body',sampleCard);
  const sharedCursor=create('div','vv-shared',sampleCard);sharedCursor.hidden=true;
  const sampleDetails=create('details','vv-details',inspectDetails);create('summary','',sampleDetails).textContent='Details';
  const sampleRaw=create('div','vv-sample-raw',sampleDetails);
  const diagnostics=create('p','vv-inspection vv-diagnostics',sampleDetails);
  const surfaceQuality=create('p','vv-notice',inspectDetails);surfaceQuality.hidden=true;
  const captureNotice=create('p','vv-notice',inspectDetails);
  const camera=create('div','vv-camera',inspectDetails);const cameraField=create('label','vv-field',camera);cameraField.append(document.createTextNode('3D panel'));
  const panelSelect=create('select','',cameraField);panelSelect.setAttribute('aria-label','3D panel');
  const cameraButtons=create('div','vv-camera-buttons',camera);cameraButtons.setAttribute('role','group');cameraButtons.setAttribute('aria-label','Camera view');
  const slices=create('div','vv-slices',inspectDetails);
  const metadataDetails=create('details','vv-metadata',sidebar);create('summary','',metadataDetails).textContent='Data meaning';
  const metadataField=create('label','vv-field',metadataDetails);metadataField.append(document.createTextNode('Layer'));
  const metadataLayer=create('select','',metadataField);metadataLayer.setAttribute('aria-label','Metadata layer');
  const semantics=create('div','vv-semantics',metadataDetails);
  const recordDetails=create('details','vv-record',sidebar);create('summary','',recordDetails).textContent='Observation record';
  const record=create('div','vv-record-body',recordDetails);
  const selectionDetails=create('details','vv-selection',sidebar);selectionDetails.hidden=true;
  const selectionSummary=create('summary','',selectionDetails);selectionSummary.textContent='Selection';
  const selectionNote=create('p','vv-notice',selectionDetails);
  const tableWrap=create('div','vv-table-wrap',selectionDetails);const selectionTable=create('table','vv-rows',tableWrap);const tableHead=create('thead','',selectionTable);const tableBody=create('tbody','',selectionTable);
  const pager=create('div','vv-pager',selectionDetails);
  const pagePrev=create('button','',pager);pagePrev.type='button';pagePrev.textContent='Previous';
  const pageLabel=create('span','vv-page',pager);
  const pageNext=create('button','',pager);pageNext.type='button';pageNext.textContent='Next';
  const statusbar=create('footer','vv-statusbar');statusbar.hidden=true;
  let disposed=false,mounted=false,exporting=false,pendingTheme=false,theme:ViewerTheme=options.theme??'dark',layerKey='',panelKey='',sliceKey='',metadataLayerKey='',metadataKey='',recordKey='';
  let selectedObservation:HoverEvent|undefined=figure.spec.inspection?.selection?structuredClone(figure.spec.inspection.selection):undefined;
  let lastXHover:XHoverEvent|null=null,lastCell:HoverEvent|undefined,selectionPage=0,selectionEvent:Selection|undefined;
  let overviewState:{panelId:string;full:Domain;domain?:Domain}|undefined;
  let overviewDrag:{pointerId:number;originClient:number;origin:number;full:Domain;panelId:string;moved:boolean}|undefined;
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
      const source=exportSource.value as 'displayed'|'accepted',includeObservation=observation.checked;
      const blob=format==='png'?await figure.savefig({source}):new Blob([await toHTMLAsync(figure,{source,observation:includeObservation})],{type:'text/html;charset=utf-8'});
      if(disposed)return;
      const url=URL.createObjectURL(blob);downloads.add(url);const link=document.createElement('a');link.href=url;link.download=`${(figure.spec.title||'vesora-figure').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,80)}.${format}`;link.click();
      setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},1000);
    }finally{exporting=false;if(!disposed)refresh();}
  };
  const png=button('Export PNG',exportPanel,()=>exportFile('png'));const html=button('Export HTML',exportPanel,()=>exportFile('html'));
  exportPanel.insertBefore(png,exportSourceField);exportPanel.insertBefore(html,exportSourceField);
  html.hidden=options.exportHTML===false;
  const syncExportHint=()=>text(exportHint,exportSource.value==='accepted'?'Exports the latest accepted data. This may differ from a frozen view. PNG is an image; observation records are included only in HTML.':'Exports the frame you are inspecting. PNG is an image; observation records are included only in HTML.');
  exportSource.addEventListener('change',syncExportHint);
  const applyPresentation=(patch:ViewerPresentationOptions)=>{
    presentation={...presentation,...patch};
    const mode=presentation.mode??'studio',chrome={toolbar:true,inspector:mode==='studio',status:true,help:mode==='studio',...presentation.chrome};
    // Undefined individual flags retain the mode default.
    toolbar.hidden=chrome.toolbar===false;sidebar.hidden=chrome.inspector===false;pill.hidden=chrome.status===false;statusbar.hidden=true;help.hidden=chrome.help===false;
    if(presentation.chrome?.inspector===undefined)sidebar.hidden=mode==='embed';
    if(presentation.chrome?.help===undefined)help.hidden=mode==='embed';
    root.dataset.mode=mode;root.dataset.inspector=sidebar.hidden?'hidden':'visible';
    for(const [key,property] of Object.entries(tokenProperties)){const value=presentation.themeTokens?.[key as keyof ViewerChromeTokens];if(value===undefined)root.style.removeProperty(`--vv-${property}`);else root.style.setProperty(`--vv-${property}`,value);}
    if(!exportSource.dataset.initialized||Object.hasOwn(patch,'exportSource'))exportSource.value=presentation.exportSource??'displayed';
    if(!exportSource.dataset.initialized||Object.hasOwn(patch,'observation'))observation.checked=presentation.observation??false;
    exportSource.dataset.initialized='true';syncExportHint();
    // If a host hides the focused control, keep keyboard focus in this viewer.
    const active=document.activeElement;
    if(active&&((toolbar.hidden&&toolbar.contains(active))||(sidebar.hidden&&sidebar.contains(active)))){root.tabIndex=-1;root.focus();}
  };
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
  const syncLayers=(shown:Figure['spec'])=>{
    const key=JSON.stringify(shown.layers.map(layer=>layer.id));
    if(key!==layerKey){layerKey=key;layerList.replaceChildren();
      for(const layer of shown.layers){const node=button('',layerList,()=>{const current=figure.spec.layers.find(item=>item.id===layer.id);if(current)figure.updateVisibility(current,!current.visible);});node.className='vv-layer';node.dataset.layerId=layer.id;const swatch=create('span','vv-swatch',node);swatch.setAttribute('aria-hidden','true');create('span','vv-layer-label',node);}
      if(!shown.layers.length)create('p','vv-notice',layerList).textContent='No layers yet.';
    }
    for(const node of layerList.querySelectorAll<HTMLButtonElement>('button')){const layer=shown.layers.find(item=>item.id===node.dataset.layerId);if(!layer)continue;node.setAttribute('aria-pressed',String(layer.visible));node.setAttribute('aria-label',`${layer.style.label??layer.kind}: ${layer.visible?'hide':'show'} layer`);node.querySelector<HTMLElement>('.vv-swatch')!.style.background=layer.style.color??'var(--vv-accent)';text(node.querySelector<HTMLElement>('.vv-layer-label')!,layer.style.label??layer.kind);}
  };
  const sync3d=(captured?:ReturnType<Figure['getInspectionSnapshot']>)=>{
    const shown=captured?.figure??figure.spec;
    const panels=[{id:'main',view:shown.view,title:shown.title},...(shown.panels??[]).filter(panel=>panel.id!=='main').map(panel=>({id:panel.id,view:panel.view,title:panel.title}))].filter(panel=>panel.view?.kind==='3d');
    camera.hidden=!panels.length;const key=JSON.stringify(panels.map(panel=>[panel.id,panel.title]));
    if(key!==panelKey){panelKey=key;const previous=panelSelect.value;panelSelect.replaceChildren();for(const panel of panels){const option=document.createElement('option');option.value=panel.id;option.textContent=panel.title||panel.id;panelSelect.append(option);}if(panels.some(panel=>panel.id===previous))panelSelect.value=previous;}
    equalAxes.setAttribute('aria-pressed',String(panels.length>0&&Boolean(figure.getInspectionView(panelSelect.value).equalAspect)));
    const relations=shown.slices??[];const nextKey=JSON.stringify(relations.map(relation=>[relation.sourceLayerId,relation.targetLayerId,relation.axis]));
    if(nextKey!==sliceKey){sliceKey=nextKey;slices.replaceChildren();for(const relation of relations){const source=shown.layers.find(layer=>layer.id===relation.sourceLayerId);if(!source)continue;const label=create('label','vv-field',slices);label.append(document.createTextNode(''));const input=create('input','',label);input.dataset.target=relation.targetLayerId;input.type='range';input.min='0';input.step='1';input.setAttribute('aria-label',`${source.style.label??'Surface'} ${relation.axis.toUpperCase()} slice`);input.addEventListener('input',()=>run(()=>figure.setInspectionSlice(relation.targetLayerId,Number(input.value))));}}
    for(const input of slices.querySelectorAll<HTMLInputElement>('input')){const relation=relations.find(item=>item.targetLayerId===input.dataset.target),source=relation&&shown.layers.find(layer=>layer.id===relation.sourceLayerId);if(!relation||!source)continue;const count=captured?captured.sources.find(item=>item.id===source.data[relation.axis])?.shape[0]??0:figure.registry.get(source.data[relation.axis]).values.length;input.max=String(Math.max(0,count-1));input.value=String(relation.index);input.parentElement!.firstChild!.textContent=`${relation.axis.toUpperCase()} slice · ${relation.index+1} / ${count}`;}
    slices.hidden=!relations.length;
  };
  const pairs=(parent:HTMLElement,values:Array<[string,string]>)=>{const list=create('dl','vv-properties',parent);for(const [name,value] of values){create('dt','',list).textContent=name;create('dd','',list).textContent=value;}};
  const syncMetadata=(shown:Figure['spec'],preferredLayer?:string)=>{
    const nextLayerKey=JSON.stringify(shown.layers.map(layer=>[layer.id,layer.style.label]));
    if(nextLayerKey!==metadataLayerKey){metadataLayerKey=nextLayerKey;const previous=metadataLayer.value;metadataLayer.replaceChildren();for(const layer of shown.layers){const option=document.createElement('option');option.value=layer.id;option.textContent=layer.style.label??layer.id;metadataLayer.append(option);}if(shown.layers.some(layer=>layer.id===previous))metadataLayer.value=previous;}
    if(preferredLayer&&shown.layers.some(layer=>layer.id===preferredLayer))metadataLayer.value=preferredLayer;
    metadataField.hidden=!shown.layers.length;
    const layer=shown.layers.find(layer=>layer.id===metadataLayer.value),channels=Object.entries(layer?.data??{});
    const meanings=channels.map(([channel,id])=>({channel,id,meaning:shown.semantics?.sources[id]}));
    const nextMetadataKey=JSON.stringify([layer?.id,meanings]);
    if(nextMetadataKey!==metadataKey){metadataKey=nextMetadataKey;semantics.replaceChildren();
      if(!meanings.length)create('p','vv-notice',semantics).textContent='No source channels in this layer.';
      for(const {channel,id,meaning} of meanings){
        const section=create('section','vv-channel',semantics);create('h3','',section).textContent=channel;
        const values:Array<[string,string]>=[['Source',id]];
        if(!meaning)values.push(['Meaning','Not declared']);
        else{
          for(const [key,label] of [['name','Name'],['quantity','Quantity'],['unit','Unit'],['dimension','Dimension']] as const)if(meaning[key]!==undefined)values.push([label,meaning[key]!]);
          if(meaning.unit===undefined)values.push(['Unit','Not declared']);
          if(meaning.origin){values.push(['Dataset',meaning.origin.datasetId]);if(meaning.origin.field!==undefined)values.push(['Field',meaning.origin.field]);if(meaning.origin.reference!==undefined)values.push(['Reference',meaning.origin.reference]);}
          for(const transform of meaning.transforms??[])values.push(['External transform',`${transform.name}${transform.version?` · ${transform.version}`:''}${transform.parameters?` · ${JSON.stringify(transform.parameters)}`:''}`]);
        }
        pairs(section,values);
      }
      create('p','vv-notice',semantics).textContent='Units and transforms are declarations supplied with the data. They are not converted or executed here.';
    }
    const observationRecord=shown.observation;
    const versions=observationRecord?.sourceVersions.filter(source=>channels.some(([,id])=>source.id===id));
    const streams=observationRecord?.streams.filter(stream=>stream.layerId===layer?.id);
    const representation=observationRecord?.representation;
    const rendered=representation?.status==='rendered'?representation.layers.filter(info=>info.layerId===layer?.id):[];
    const nextRecordKey=JSON.stringify([layer?.id,observationRecord?.source,observationRecord?.capturedAt,observationRecord?.sourceVersions.length,versions,streams,representation?.status,representation?.status==='rendered'?[representation.frameId,representation.snapshotId,rendered]:undefined]);
    if(nextRecordKey!==recordKey){recordKey=nextRecordKey;record.replaceChildren();
      if(!observationRecord)create('p','vv-notice',record).textContent='No observation record is attached to this scene. Enable it in Export to include one in HTML.';
      else{
        const values:Array<[string,string]>=[['Capture source',observationRecord.source],['Captured',observationRecord.capturedAt],['Recorded sources',String(observationRecord.sourceVersions.length)]];
        for(const source of versions??[])values.push(['Source version',`${source.id} · ${source.version}`]);
        for(const stream of streams??[])values.push(['Retained stream',`${stream.streamId} · revision ${stream.revision} · [${stream.sequenceStart}, ${stream.sequenceEndExclusive})`]);
        if(representation?.status==='rendered'){
          values.push(['Representation','Rendered'],['Frame',String(representation.frameId)]);if(representation.snapshotId)values.push(['Snapshot',representation.snapshotId]);
          for(const info of rendered){values.push(['Method',`${info.kind} · ${info.method}`],['Counts',`total ${info.total} · visible ${info.visible} · rendered ${info.rendered}`],['Representation exact',String(info.exact)]);if(info.omittedTriangles!==undefined)values.push(['Omitted triangles',`${info.omittedTriangles}${info.totalTriangles===undefined?'':` / ${info.totalTriangles}`}`]);}
        }else values.push(['Representation','Not evaluated for this capture']);
        pairs(record,values);create('p','vv-notice',record).textContent='Source versions and representation describe this captured scene. Counts follow the recorded representation; retained streams exclude evicted samples.';
      }
    }
  };
  metadataLayer.addEventListener('change',()=>syncMetadata(figure.getInspectionState().mode==='frozen'?figure.getInspectionSnapshot().figure:figure.spec));
  const refresh=()=>{
    if(disposed)return;
    const state=figure.getInspectionState(),captured=state.mode==='frozen'?figure.getInspectionSnapshot():undefined,shown=captured?.figure??figure.spec;
    syncLayers(shown);sync3d(captured);syncMetadata(shown);
    const stats=figure.diagnostics();const streams=Object.values(stats.streams);const inspectionEnabled=options.live!==false,live=inspectionEnabled&&streams.length>0;
    const omitted=figure.inspect().filter(info=>info.kind==='surface'&&(info.omittedTriangles??0)>0);
    surfaceQuality.hidden=!omitted.length;
    text(surfaceQuality,omitted.map(info=>`${shown.layers.find(layer=>layer.id===info.layerId)?.style.label??'Surface'}: ${number(info.omittedTriangles!)} / ${number(info.totalTriangles!)} triangles omitted because coordinates or scalar values are not finite.`).join('\n'));
    if(pendingTheme&&state.mode==='live'){pendingTheme=false;figure.setTheme(theme==='dark'?OBSIDIAN_DARK:OBSIDIAN_LIGHT);}
    for(const control of layerList.querySelectorAll<HTMLButtonElement>('button')){control.disabled=state.mode==='frozen';control.title=state.mode==='frozen'?'Return to live before changing layers.':'';}
    themeButton.title='';
    const focusResume=document.activeElement===freeze&&state.mode==='frozen',focusFreeze=document.activeElement===resume&&state.mode==='live';
    freeze.hidden=!inspectionEnabled||state.mode==='frozen';resume.hidden=!inspectionEnabled||state.mode!=='frozen';freeze.disabled=!mounted||state.frameId===0;
    if(inspectionEnabled){if(focusResume)resume.focus();else if(focusFreeze)freeze.focus();}
    pill.dataset.mode=state.mode==='frozen'?'frozen':live?'live':'ready';
    text(status,state.mode==='frozen'?`Frozen snapshot${state.capturedAt?` · ${new Date(state.capturedAt).toLocaleTimeString()}`:''}`:live?'Live':'Ready');
    syncOverview();
    const capture=figure.spec.inspection,capturedAt=state.capturedAt??capture?.capturedAt;
    captureNotice.hidden=!capturedAt;
    text(captureNotice,capturedAt?`Captured ${capturedAt}${state.snapshotId??capture?.snapshotId?` · Snapshot ${state.snapshotId??capture?.snapshotId}`:''}${capture?` · Source frame ${capture.frameId}`:''}`:'');
    text(diagnostics,`Backend: ${stats.backend??'unmounted'}\nWorker: ${stats.worker?'active':'cooperative fallback'}\nSource: ${number(stats.sourceBytes)} bytes\nFrame: ${state.frameId}\nSnapshot: ${number(state.snapshotBytes)} / ${number(state.maxSnapshotBytes)} bytes\nAccepted / displayed revision: ${state.acceptedRevision} / ${state.displayedRevision}${streams.length?`\nRetained: ${number(streams.reduce((sum,stream)=>sum+stream.retained,0))}\nEvicted: ${number(streams.reduce((sum,stream)=>sum+stream.evicted,0))}`:''}`);
    png.disabled=html.disabled=exporting||!mounted;reset.disabled=!mounted;
  };
  const shownSpec=()=>figure.getInspectionState().mode==='frozen'?figure.getInspectionSnapshot().figure:figure.spec;
  const sourceValues=(id?:string):ArrayLike<number>|undefined=>{if(!id||!figure.registry?.has(id))return;try{return figure.registry.get(id).values;}catch{return;}};
  const finiteExtent=(values:ArrayLike<number>):Domain|undefined=>{let min=Infinity,max=-Infinity;for(let i=0;i<values.length;i++){const value=values[i];if(!Number.isFinite(value))continue;if(value<min)min=value;if(value>max)max=value;}return min<max?[min,max]:undefined;};
  const addLine=(parent:HTMLElement,value:string)=>{const node=create('p','vv-sample-line',parent);node.textContent=value;return node;};
  const representationName=(info?:{kind:string;exact?:boolean;method?:string})=>{if(!info)return;const method=info.method??'';if(info.kind==='density'||/density|count aggregation/i.test(method))return 'density';if(info.kind==='line'&&info.exact===false)return 'reduced line';if(info.exact===true)return 'exact';if(info.kind==='line'&&/min\/max|pixel column/i.test(method))return 'reduced line';};
  const representationFor=(spec:Figure['spec'],layerId:string)=>{const inspected=figure.inspect().find(info=>info.layerId===layerId);const record=spec.observation?.representation;const recorded=record&&record.status==='rendered'?record.layers.find(info=>info.layerId===layerId):undefined;return representationName(inspected)??representationName(recorded);};
  const unitFor=(spec:Figure['spec'],layerId:string,channel:string)=>{const source=spec.layers.find(layer=>layer.id===layerId)?.data[channel];const unit=source?spec.semantics?.sources[source]?.unit:undefined;return typeof unit==='string'&&unit.trim()?unit.trim():undefined;};
  const withUnit=(value:unknown,unit?:string)=>`${String(value)}${unit?` ${unit}`:''}`;
  const cellLine=(event:HoverEvent)=>{if(Array.isArray(event.cell))return `Cell row, column: ${event.cell.join(', ')}`;if(typeof event.row==='number'&&typeof event.column==='number')return `Cell row, column: ${event.row}, ${event.column}`;};
  const rawLines=(event:HoverEvent)=>{const lines:string[]=[];for(const [key,label]of [['sequence','Sequence'],['frameId','Frame'],['snapshotId','Snapshot'],['sourceRevision','Source revision'],['dataRevision','Data revision']] as const)if(event[key]!==undefined)lines.push(`${label}: ${String(event[key])}`);if(event.sourceVersions&&typeof event.sourceVersions==='object')lines.push(`Channel versions: ${Object.entries(event.sourceVersions).map(([key,value])=>`${key} ${String(value)}`).join(', ')}`);return lines;};
  const showObservation=(event:HoverEvent|undefined,selected=false)=>{
    sampleBody.replaceChildren();sampleRaw.replaceChildren();sharedCursor.hidden=true;sharedCursor.replaceChildren();
    if(!event){addLine(sampleBody,inspectionHint);return;}
    const shown=shownSpec();syncMetadata(shown,event.layerId);
    const label=shown.layers.find(layer=>layer.id===event.layerId)?.style.label??event.layerId;
    addLine(sampleBody,`${selected?'Selected':'Hovered'} ${event.interpolated?'interpolated value':'observation'}`);
    addLine(sampleBody,String(label));
    for(const key of ['x','y','z','value'] as const)if(event[key]!==undefined)addLine(sampleBody,`${key}: ${withUnit(event[key],key==='value'?undefined:unitFor(shown,event.layerId,key))}`);
    if(event.count!==undefined)addLine(sampleBody,`count: ${String(event.count)}`);
    const sourceIndex=event.index??event.sourceIndex;if(typeof sourceIndex==='number')addLine(sampleBody,`Source index: ${sourceIndex}`);
    const cell=cellLine(event);if(cell)addLine(sampleBody,cell);
    if(event.triangle!==undefined)addLine(sampleBody,`Triangle: ${String(event.triangle)}`);
    if(Array.isArray(event.indices))addLine(sampleBody,`Segment indices: ${event.indices.join(', ')}`);
    const method=representationFor(shown,event.layerId);if(method)addLine(sampleBody,`Representation: ${method}`);
    const raw=rawLines(event);if(raw.length)addLine(sampleRaw,raw.join('\n'));
  };
  const showXHover=(event:XHoverEvent)=>{
    const shown=shownSpec(),share=shown.layout?.shareX===true;
    sampleBody.replaceChildren();sampleRaw.replaceChildren();sharedCursor.replaceChildren();sharedCursor.hidden=!share;
    if(share)addLine(sampleBody,'Shared cursor');
    if(!event.items.length&&!(share&&lastCell&&cellLine(lastCell)))addLine(sampleBody,inspectionHint);
    for(const item of event.items){
      const label=shown.layers.find(layer=>layer.id===item.layerId)?.style.label??item.layerId;
      addLine(sampleBody,String(label));
      addLine(sampleBody,`x: ${withUnit(item.x,unitFor(shown,item.layerId,'x'))}`);
      addLine(sampleBody,`y: ${withUnit(item.y,unitFor(shown,item.layerId,'y'))}`);
      if(typeof item.index==='number')addLine(sampleBody,`Source index: ${item.index}`);
      if(item.sequence!==undefined)addLine(sampleBody,`Sequence: ${item.sequence}`);
      const method=representationFor(shown,item.layerId);if(method)addLine(sampleBody,`Representation: ${method}`);
      syncMetadata(shown,item.layerId);
    }
    if(share&&lastCell){const cell=cellLine(lastCell);if(cell){addLine(sampleBody,cell);if(lastCell.value!==undefined)addLine(sampleBody,`value: ${String(lastCell.value)}`);}}
    if(share){addLine(sharedCursor,'Shared cursor');for(const node of sampleBody.querySelectorAll('.vv-sample-line'))addLine(sharedCursor,node.textContent??'');}
  };
  const placeGuide=()=>{
    const spec=shownSpec(),share=spec.layout?.shareX===true,cols=spec.layout?.cols??1,point=lastXHover?.pointerPosition,canvas=chart.querySelector('canvas');
    if(!share||cols!==1||!point||!(canvas instanceof HTMLElement)){cursorGuide.hidden=true;return;}
    const plotRect=plot.getBoundingClientRect(),canvasRect=canvas.getBoundingClientRect();
    if(plotRect.width<=0||canvasRect.width<=0){cursorGuide.hidden=true;return;}
    cursorGuide.hidden=false;cursorGuide.style.top=`${canvasRect.top-plotRect.top}px`;cursorGuide.style.height=`${canvasRect.height}px`;cursorGuide.style.left=`${canvasRect.left-plotRect.left+point.x}px`;
  };
  const overviewPanels=(spec:Figure['spec'])=>{
    const panels:Array<{id:string;view:ViewSpec;layers:LayerSpec[]}>=[{id:'main',view:spec.view,layers:spec.layers.filter(layer=>(layer.panelId??'main')==='main')}];
    if(spec.layout)for(const panel of spec.panels??[])if(panel.id!=='main'&&panel.view)panels.push({id:panel.id,view:panel.view,layers:spec.layers.filter(layer=>layer.panelId===panel.id)});
    return panels;
  };
  const overviewEligible=(panel:{view:ViewSpec;layers:LayerSpec[]})=>panel.view?.kind==='2d'&&(!panel.view.projection||panel.view.projection==='cartesian')&&(panel.view.xScale==='linear'||panel.view.xScale==='time')&&panel.layers.some(layer=>layer.visible!==false&&OVERVIEW_KINDS.has(layer.kind));
  const paintOverview=(full:Domain,domain:Domain)=>{const span=full[1]-full[0]||1,left=Math.min(1,Math.max(0,(domain[0]-full[0])/span)),right=Math.min(1,Math.max(left,(domain[1]-full[0])/span));overviewWindow.style.left=`${left*100}%`;overviewWindow.style.width=`${Math.max((right-left)*100,.8)}%`;};
  const applyXDomain=(panelId:string,domain:Domain|undefined)=>{const patch={xDomain:domain};if(figure.getInspectionState().mode==='frozen'){figure.setInspectionView(panelId,patch);return;}if(panelId==='main')figure.setView(patch);else figure.setPanelView(panelId,patch);};
  const syncOverview=()=>{
    const spec=shownSpec(),panels=overviewPanels(spec).filter(overviewEligible),share=spec.layout?.shareX===true;
    const target=share?panels.length?{id:'main'}:undefined:panels.length===1?panels[0]:undefined;
    if(!target){overview.hidden=true;overviewState=undefined;return;}
    const watched=share?panels:[panels[0]];
    let min=Infinity,max=-Infinity;
    for(const panel of watched)for(const layer of panel.layers)if(layer.visible!==false&&OVERVIEW_KINDS.has(layer.kind)){const span=finiteExtent(sourceValues(layer.data.x)??[]);if(!span)continue;min=Math.min(min,span[0]);max=Math.max(max,span[1]);}
    if(!(min<max)){overview.hidden=true;overviewState=undefined;return;}
    const full:Domain=[min,max];let domain:Domain|undefined;
    try{const view=figure.getInspectionView(target.id);if(view.xDomain&&view.xDomain[0]<view.xDomain[1])domain=[view.xDomain[0],view.xDomain[1]];}catch{/* A mounted view reports the domain after the first frame. */}
    overview.hidden=false;overviewState={panelId:target.id,full,domain};const shown=domain??full;paintOverview(full,shown);
    overviewTrack.setAttribute('aria-valuemin',String(full[0]));overviewTrack.setAttribute('aria-valuemax',String(full[1]));overviewTrack.setAttribute('aria-valuenow',String(shown[0]));overviewTrack.setAttribute('aria-valuetext',`${shown[0]} to ${shown[1]}`);
  };
  const dataAt=(clientX:number,full:Domain)=>{const rect=overviewTrack.getBoundingClientRect(),width=Math.max(1,rect.width),fraction=Math.min(1,Math.max(0,(clientX-rect.left)/width));return full[0]+fraction*(full[1]-full[0]);};
  overviewTrack.addEventListener('pointerdown',event=>{if(!overviewState||event.button!==0)return;try{overviewTrack.setPointerCapture?.(event.pointerId);}catch{/* Pointer capture is optional for a domain drag. */}const state=overviewState;overviewDrag={pointerId:event.pointerId,originClient:event.clientX,origin:dataAt(event.clientX,state.full),full:state.full,panelId:state.panelId,moved:false};});
  overviewTrack.addEventListener('pointermove',event=>{if(!overviewDrag||event.pointerId!==overviewDrag.pointerId)return;if(Math.abs(event.clientX-overviewDrag.originClient)>=3)overviewDrag.moved=true;const end=dataAt(event.clientX,overviewDrag.full);paintOverview(overviewDrag.full,[Math.min(overviewDrag.origin,end),Math.max(overviewDrag.origin,end)]);});
  overviewTrack.addEventListener('pointerup',event=>{if(!overviewDrag||event.pointerId!==overviewDrag.pointerId)return;const drag=overviewDrag;overviewDrag=undefined;if(!drag.moved)return;const end=dataAt(event.clientX,drag.full),domain:Domain=[Math.min(drag.origin,end),Math.max(drag.origin,end)];if(domain[1]>domain[0])run(()=>applyXDomain(drag.panelId,domain));});
  overviewTrack.addEventListener('dblclick',event=>{if(!overviewState)return;event.preventDefault();const panelId=overviewState.panelId;run(()=>applyXDomain(panelId,undefined));});
  const selectionIndices=(event:Selection)=>event.kind==='density'||!('indices' in event)||!event.indices?undefined:Array.from(event.indices);
  const renderSelection=(event?:Selection)=>{
    if(event){selectionEvent=event;selectionPage=0;}
    const current=selectionEvent;
    if(!current||current.count<=0){selectionDetails.hidden=true;return;}
    selectionDetails.hidden=false;
    const indices=selectionIndices(current),preview=!!indices&&(('truncated' in current&&current.truncated)||indices.length<current.count);
    const spec=shownSpec();
    selectionSummary.textContent=`Selection · ${number(current.count)}`;
    text(selectionNote,!indices?`${number(current.count)} selected. No row preview was included.`:preview?`This page is a preview. ${number(current.count)} selected; ${number(indices!.length)} indices are included.`:`${number(current.count)} selected.`);
    const layers=current.kind==='linked'&&spec.selectionLink?[...spec.selectionLink.scatter,spec.selectionLink.histogram].flatMap(id=>{const layer=spec.layers.find(item=>item.id===id);return layer?[layer]:[];}):spec.layers.filter(layer=>layer.id===current.layerId);
    const columns:Array<{header:string;cell:(index:number)=>string}>=[{header:'Source index',cell:index=>String(index)}];
    for(const layer of layers){const label=layer.style.label??layer.id;for(const [channel,source] of Object.entries(layer.data))columns.push({header:`${label} ${channel}`,cell:index=>{const values=sourceValues(source);return !values||index<0||index>=values.length||!Number.isFinite(values[index])?'—':String(values[index]);}});}
    const pages=Math.max(1,Math.ceil((indices?.length??0)/PAGE_SIZE));
    if(selectionPage>=pages)selectionPage=pages-1;if(selectionPage<0)selectionPage=0;
    const page=indices?indices.slice(selectionPage*PAGE_SIZE,selectionPage*PAGE_SIZE+PAGE_SIZE):[];
    tableHead.replaceChildren();tableBody.replaceChildren();tableWrap.hidden=page.length===0;
    if(page.length){const head=document.createElement('tr');tableHead.append(head);for(const column of columns){const cell=document.createElement('th');cell.textContent=column.header;head.append(cell);}for(const index of page){const row=document.createElement('tr');tableBody.append(row);for(const column of columns){const cell=document.createElement('td');cell.textContent=column.cell(index);row.append(cell);}}}
    pager.hidden=!indices||indices.length<=PAGE_SIZE;text(pageLabel,`Page ${selectionPage+1} of ${pages}`);pagePrev.disabled=selectionPage<=0;pageNext.disabled=selectionPage>=pages-1;
  };
  pagePrev.addEventListener('click',()=>{if(selectionPage>0){selectionPage-=1;renderSelection();}});
  pageNext.addEventListener('click',()=>{selectionPage+=1;renderSelection();});
  const handle:ViewerHandle={element:root,figure,setTheme(next){if(next!=='light'&&next!=='dark')throw new TypeError('Viewer theme must be light or dark.');if(disposed)return;theme=next;root.dataset.theme=next;themeButton.textContent=next==='dark'?'Light theme':'Dark theme';if(!options.preserveTheme){pendingTheme=figure.getInspectionState().mode==='frozen';if(!pendingTheme)figure.setTheme(next==='dark'?OBSIDIAN_DARK:OBSIDIAN_LIGHT);}},updateOptions(patch){if(disposed)return;applyPresentation(presentationPatch(patch,document));},dispose(){if(disposed)return;disposed=true;for(const remove of removers)remove();for(const url of downloads)URL.revokeObjectURL(url);downloads.clear();try{if(mounted&&figure.hasMountedView())figure.unmount();}finally{attachments.delete(figure);root.remove();}}};
  applyPresentation(presentation);
  attachments.set(figure,handle);container.append(root);
  removers.push(
    figure.on('frame',()=>{errorPanel.hidden=true;selectedObservation=figure.getInspectionSelection();lastXHover=null;refresh();showObservation(selectedObservation,!!selectedObservation);placeGuide();}),
    figure.on('inspectionchange',refresh),figure.on('representation',refresh),figure.on('error',event=>fail(event.message)),
    figure.on('runtimechange',event=>{if(event.status==='recovering')text(status,'Restoring graphics…');else if(event.status==='fallback')text(status,'Ready · cooperative processing');}),
    figure.on('click',event=>{selectedObservation=structuredClone(event);lastXHover=null;inspectDetails.open=true;showObservation(selectedObservation,true);placeGuide();}),
    figure.on('hover',event=>{if(event?.kind==='cell'&&(Array.isArray(event.cell)||typeof event.row==='number'||typeof event.column==='number'))lastCell=event;else lastCell=undefined;if(lastXHover&&shownSpec().layout?.shareX){showXHover(lastXHover);placeGuide();return;}showObservation(event??selectedObservation,!event&&!!selectedObservation);}),
    figure.on('xhover',event=>{lastXHover=event;placeGuide();if(!event){showObservation(selectedObservation,!!selectedObservation);return;}showXHover(event);}),
    figure.on('selection',event=>renderSelection(event)),
  );
  try{if(options.height!==undefined)figure.setSize({height:options.height});handle.setTheme(theme);figure.mount(chart,{responsivePanels:options.responsivePanels!==false});mounted=true;refresh();showObservation(selectedObservation,!!selectedObservation);void figure.ready().then(refresh).catch(fail);}catch(error){fail(error);}
  return handle;
}
