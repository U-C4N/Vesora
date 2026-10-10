import {figure} from './figure';
import {setWorkerURL} from './scheduler';
import {validateDescriptor} from './data';
import type {RepresentationInfo, Snapshot, ViewBookmark} from './types';

declare const __VESORA_WORKER_SOURCE__:string;
type LayerInfo=RepresentationInfo&{layerId:string;panelId?:string};

function element<T extends HTMLElement>(id:string):T {
  const node=document.getElementById(id);
  if(!node)throw new Error(`Missing viewer element: ${id}`);
  return node as T;
}

/** Decode only the declared binary sources; scene validation remains in the core. */
function decodePayload(raw:unknown):{snapshot:Snapshot;buffers:Map<string,ArrayBuffer>} {
  if(!raw||typeof raw!=='object')throw new Error('The file does not contain a valid figure.');
  const payload=raw as {formatVersion?:unknown;snapshot?:Snapshot;buffers?:Array<{id:string;base64:string}>};
  if(payload.formatVersion!==1)throw new Error('This figure uses an unsupported file format.');
  if(!payload.snapshot?.figure||!Array.isArray(payload.snapshot.sources)||!Array.isArray(payload.buffers))throw new Error('The figure data is incomplete.');
  const descriptors=new Map();
  for(const source of payload.snapshot.sources){
    validateDescriptor(source);
    if(descriptors.has(source.id))throw new Error('The figure contains a duplicate data source.');
    descriptors.set(source.id,source);
  }
  if(payload.buffers.length!==descriptors.size)throw new Error('The figure is missing binary data.');
  const buffers=new Map<string,ArrayBuffer>();
  for(const entry of payload.buffers){
    if(!entry||typeof entry.id!=='string'||typeof entry.base64!=='string'||!descriptors.has(entry.id)||buffers.has(entry.id))throw new Error('The figure contains an invalid binary source.');
    const expected=descriptors.get(entry.id).byteLength;
    if(entry.base64.length!==4*Math.ceil(expected/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.base64))throw new Error('The figure contains invalid encoded data.');
    const binary=atob(entry.base64);
    if(binary.length!==expected)throw new Error('The binary data length does not match its descriptor.');
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    buffers.set(entry.id,bytes.buffer);
  }
  return {snapshot:payload.snapshot,buffers};
}

async function start():Promise<void> {
  const root=element('vesora-viewer'),chart=element('vesora-chart'),status=element('vesora-status');
  const reset=element<HTMLButtonElement>('vesora-reset'),png=element<HTMLButtonElement>('vesora-png');
  const errorPanel=element('vesora-error'),errorMessage=element('vesora-error-message');
  const bookmarkList=element('vesora-bookmarks'),bookmarkNote=element('vesora-bookmark-note');
  const inspector=element<HTMLDetailsElement>('vesora-inspector'),layerSelect=element<HTMLSelectElement>('vesora-layer');
  const inspectorEmpty=element('vesora-inspector-empty'),inspectorContent=element('vesora-inspector-content');
  const metrics=element('vesora-metrics'),number=new Intl.NumberFormat('en-US');
  let fig:ReturnType<typeof figure>|undefined,workerURL:string|undefined,disposed=false;
  let infos:LayerInfo[]=[],activeBookmark:string|undefined,programmatic=false,exploring=false;
  let lastView='',exporting=false,readiness=0;
  const downloads=new Set<string>();
  const fail=(error:unknown)=>{
    if(disposed)return;
    root.dataset.ready='error';chart.setAttribute('aria-busy','false');png.disabled=true;
    status.textContent='Could not display the current view';
    const message=error instanceof Error?error.message:String(error);
    errorMessage.textContent=/webgl/i.test(message)?'This browser could not start WebGL2. Interactive viewing requires WebGL2.':message;
    errorPanel.hidden=false;
  };
  const clearBookmark=()=>{
    activeBookmark=undefined;bookmarkNote.hidden=true;bookmarkNote.textContent='';
    for(const button of bookmarkList.querySelectorAll('button'))button.setAttribute('aria-pressed','false');
  };
  const busy=()=>{
    root.dataset.ready='loading';chart.setAttribute('aria-busy','true');png.disabled=true;
    status.textContent='Updating view…';errorPanel.hidden=true;
  };
  const ready=()=>{
    if(disposed)return;
    root.dataset.ready='ready';chart.setAttribute('aria-busy','false');png.disabled=exporting;reset.disabled=false;
    errorPanel.hidden=true;
    status.textContent=activeBookmark?`Viewing ${activeBookmark}`:exploring?'Exploring freely':'Initial view';
  };
  const showMetrics=()=>{
    const info=infos.find(value=>value.layerId===layerSelect.value);
    inspectorEmpty.hidden=Boolean(info);inspectorContent.hidden=!info;
    if(!info){inspectorEmpty.textContent='No visible layers';return;}
    const layer=fig!.spec.layers.find(value=>value.id===info.layerId)!;
    const description:{name:string;note:string;rendered:string}={
      points:{name:'Original points',note:'Original data',rendered:'Points drawn'},
      density:{name:'Count density',note:'All visible samples counted',rendered:'Occupied bins'},
      line:{name:info.exact?'Full line':'Reduced line',note:info.exact?'Original samples retained':'Extrema-preserving reduction',rendered:'Retained samples'},
      grid:{name:'Heatmap',note:'Regular grid',rendered:'Cells drawn'},
      surface:{name:'Surface',note:'Regular-grid surface',rendered:'Triangles drawn'},
      hist:{name:'Histogram',note:'Exact source-data counts',rendered:'Bins drawn'},
      bar:{name:'Bar chart',note:'Original series values',rendered:'Bars drawn'},
      boxplot:{name:'Box plot',note:'Exact source-data quartiles',rendered:'Groups drawn'},
    }[info.kind];
    element('vesora-representation').textContent=description.name;
    element('vesora-representation-note').textContent=description.note;
    element('vesora-method').textContent=info.method;
    metrics.replaceChildren();
    const add=(key:string,label:string,value:number)=>{
      const row=document.createElement('div');row.className='metric';row.dataset.field=key;
      const term=document.createElement('dt'),amount=document.createElement('dd');
      term.textContent=label;amount.textContent=number.format(value);amount.dataset.value=String(value);
      row.append(term,amount);metrics.append(row);
    };
    add('total','Source samples',info.total);
    add('visible',info.kind==='hist'?'Samples in intersecting bins':info.kind==='boxplot'?'Samples in intersecting groups':info.kind==='bar'?'Intersecting bars':info.kind==='grid'?'Valid cells':info.kind==='surface'?'Valid vertices':layer.kind==='scatter3d'?'Valid points':'Visible samples',info.visible);
    add('rendered',description.rendered,info.rendered);
    if(info.valid!==undefined)add('valid','Finite samples',info.valid);
    if(info.omitted!==undefined)add('omitted','Non-finite samples omitted',info.omitted);
    if(info.kind==='hist'&&info.rangeExcluded!==undefined)add('rangeExcluded','Outside histogram range',info.rangeExcluded);
  };
  const updateInspector=(next:LayerInfo[])=>{
    infos=next;const selected=layerSelect.value;layerSelect.replaceChildren();
    for(const info of infos){
      const index=fig!.spec.layers.findIndex(layer=>layer.id===info.layerId),layer=fig!.spec.layers[index];
      const names={line:'Line',scatter:'Scatter',scatter3d:'3D scatter',heatmap:'Heatmap',surface:'Surface',hist:'Histogram',bar:'Bar chart',boxplot:'Box plot'};
      const panel=fig!.spec.panels?.find(panel=>panel.id===(info.panelId??'main'));
      const label=layer.style.label||`${names[layer.kind]} ${index+1}`;
      const option=document.createElement('option');option.value=info.layerId;option.textContent=panel?`${panel.title||`Panel ${panel.row+1}, ${panel.col+1}`} · ${label}`:label;
      layerSelect.append(option);
    }
    if(infos.some(info=>info.layerId===selected))layerSelect.value=selected;
    element('vesora-layer-field').hidden=infos.length<=1;showMetrics();
  };
  const cleanup=()=>{
    if(disposed)return;disposed=true;fig?.close();
    if(workerURL)URL.revokeObjectURL(workerURL);
    for(const url of downloads)URL.revokeObjectURL(url);
    downloads.clear();
  };
  window.addEventListener('pagehide',event=>{if(!event.persisted)cleanup();});
  inspector.open=window.matchMedia('(min-width: 900px)').matches;
  layerSelect.addEventListener('change',showMetrics);
  try{
    const {snapshot,buffers}=decodePayload(JSON.parse(element('vesora-payload').textContent||''));
    fig=figure();fig.applySnapshot(snapshot,buffers);
    const entryView=fig.captureViews();
    const bookmarks=fig.spec.bookmarks??[];
    document.title=fig.spec.title?`${fig.spec.title} — Vesora`:'Vesora — Interactive figure';
    element('vesora-help').textContent=fig.spec.view.kind==='3d'
      ?'Drag to rotate. Scroll to zoom. Shift + drag to pan. Double-click to reset the view.'
      :'Drag to pan. Scroll to zoom. Shift + drag to select a region. Double-click to reset the view.';
    const restore=(bookmark?:ViewBookmark)=>{
      try{
        busy();clearBookmark();exploring=false;programmatic=true;
        if(bookmark){
          activeBookmark=bookmark.name;
          for(const button of bookmarkList.querySelectorAll<HTMLButtonElement>('button'))button.setAttribute('aria-pressed',String(button.dataset.bookmark===bookmark.name));
          bookmarkNote.textContent=bookmark.note??'';bookmarkNote.hidden=!bookmark.note;
          fig!.restoreBookmark(bookmark.name);
        }else fig!.restoreViews(entryView);
      }catch(error){fail(error);}finally{programmatic=false;}
    };
    bookmarks.forEach((bookmark,index)=>{
      const button=document.createElement('button');button.type='button';button.className='bookmark';button.dataset.bookmark=bookmark.name;button.setAttribute('aria-pressed','false');
      const sequence=document.createElement('span'),label=document.createElement('span');
      sequence.className='bookmark-number';sequence.textContent=String(index+1).padStart(2,'0');sequence.setAttribute('aria-hidden','true');
      label.className='bookmark-label';label.textContent=bookmark.name;button.append(sequence,label);
      button.addEventListener('click',()=>restore(bookmark));bookmarkList.append(button);
    });
    element('vesora-bookmark-panel').hidden=!bookmarks.length;
    reset.addEventListener('click',()=>restore());
    // Legacy single charts reset to their exported entry view. In grids a double
    // click belongs to the active panel; the toolbar resets the complete figure.
    if(!fig.spec.layout)chart.addEventListener('dblclick',event=>{event.preventDefault();event.stopImmediatePropagation();restore();},true);
    lastView=JSON.stringify(fig.captureViews());
    fig.on('viewchange',()=>{
      const next=JSON.stringify(fig!.captureViews());
      if(next===lastView)return;
      lastView=next;if(!programmatic){clearBookmark();exploring=true;}busy();
      // Pointer-up can arrive after the final drag frame was already rendered.
      const current=++readiness;
      void fig!.ready().then(()=>{
        if(!disposed&&current===readiness){updateInspector(fig!.inspect());ready();}
      }).catch(error=>{if(current===readiness)fail(error);});
    });
    fig.on('representation',next=>{updateInspector(next);ready();});
    fig.on('error',error=>fail(error?.message??error));
    png.addEventListener('click',async()=>{
      if(!fig||exporting||disposed)return;
      exporting=true;png.disabled=true;png.textContent='Preparing PNG…';
      try{
        const blob=await fig.savefig();if(disposed)return;
        const url=URL.createObjectURL(blob);downloads.add(url);
        const link=document.createElement('a');link.href=url;
        const name=fig.spec.title.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,80).toLowerCase();
        link.download=`${name||'vesora-figure'}.png`;link.click();
        window.setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},1000);
      }catch(error){fail(error);}finally{exporting=false;png.textContent='Download PNG';png.disabled=root.dataset.ready!=='ready';}
    });
    workerURL=URL.createObjectURL(new Blob([__VESORA_WORKER_SOURCE__],{type:'text/javascript'}));
    setWorkerURL(workerURL);
    try{fig.mount(chart);}finally{setWorkerURL(undefined);}
    await fig.ready();
  }catch(error){fail(error);fig?.close();if(workerURL){URL.revokeObjectURL(workerURL);workerURL=undefined;}}
}

void start();
