// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mountViewer} from '../../packages/core/src/viewer';
import type {Figure} from '../../packages/core/src/figure';
import {toHTMLAsync} from '../../packages/core/src/html-export-async';

vi.mock('../../packages/core/src/html-export-async',()=>({toHTMLAsync:vi.fn(async()=>'<html>observation</html>')}));

function fixture(){
  let mounted=false;
  let selected:any;
  const listeners=new Map<string,Set<(value:any)=>void>>();
  const state={mode:'live' as 'live'|'frozen',acceptedRevision:1,displayedRevision:1,frameId:1,snapshotBytes:0,maxSnapshotBytes:1024,displayedStreams:{}};
  const view={kind:'2d',camera:{azimuth:35,elevation:25,distance:3}};
  const emit=(name:string,value:any)=>{if(name==='click')selected=structuredClone(value);listeners.get(name)?.forEach(listener=>listener(value));};
  const value={
    spec:{title:'Experiment',height:300,view,layers:[{id:'line',kind:'line',visible:true,data:{},style:{label:'Measurement'}}]},
    hasMountedView:()=>mounted,captureViews:()=>({view:{...view}}),getInspectionState:()=>({...state}),
    getInspectionSelection:()=>selected?structuredClone(selected):undefined,
    diagnostics:()=>({backend:'WebGL2',worker:true,sourceBytes:48,streams:{line:{retained:3,evicted:0}}}),
    inspect:()=>[],
    on:(event:string,callback:(value:any)=>void)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(callback);return()=>listeners.get(event)!.delete(callback);},
    mount:vi.fn((host:HTMLElement)=>{mounted=true;host.append(document.createElement('canvas'));}),unmount:vi.fn(()=>{mounted=false;}),close:vi.fn(),
    setTheme:vi.fn(),setSize:vi.fn(),ready:vi.fn(()=>Promise.resolve()),restoreViews:vi.fn(),resetInspectionView:vi.fn(),
    savefig:vi.fn(async()=>new Blob(['png'],{type:'image/png'})),
    updateVisibility:vi.fn((layer:any,visible:boolean)=>{layer.visible=visible;emit('frame',state);}),
    freezeInspection:vi.fn(()=>{state.mode='frozen';emit('inspectionchange',state);return {...state};}),resumeLive:vi.fn(async()=>{state.mode='live';emit('inspectionchange',state);}),
    setCameraPreset:vi.fn(),getInspectionSnapshot:()=>({figure:value.spec,sources:[]}),getInspectionView:()=>view,
    setInspectionView:vi.fn((_panelId:string,patch:any)=>{Object.assign(view,patch);emit('frame',state);}),focusInspectionSelection:vi.fn(),
    emit,listeners,
  };
  return {figure:value as unknown as Figure,mock:value};
}
afterEach(()=>{document.body.replaceChildren();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('borrowed scientific viewer',()=>{
  it('changes Studio/Embed chrome without remounting or changing frozen data, camera or scene colors',()=>{
    const {figure,mock}=fixture(),viewer=mountViewer(figure,document.body,{themeTokens:{accent:'#123456'}});
    figure.freezeInspection();mock.setTheme.mockClear();
    const layer=viewer.element.querySelector<HTMLButtonElement>('.vv-layer')!;
    // A hidden focused toolbar control moves focus to the viewer itself.
    const resume=[...viewer.element.querySelectorAll('button')].find(button=>button.textContent==='Return to live')!;resume.focus();
    viewer.updateOptions({mode:'embed',chrome:{toolbar:false},themeTokens:{accent:'#abcdef'}});
    expect(viewer.element.dataset.mode).toBe('embed');expect(viewer.element.dataset.inspector).toBe('hidden');
    expect(viewer.element.querySelector<HTMLElement>('.vv-sidebar')!.hidden).toBe(true);expect(viewer.element.querySelector<HTMLElement>('.vv-help')!.hidden).toBe(true);
    expect(document.activeElement).toBe(viewer.element);expect(viewer.element.style.getPropertyValue('--vv-accent')).toBe('#abcdef');
    expect(figure.getInspectionState().mode).toBe('frozen');expect(mock.mount).toHaveBeenCalledOnce();expect(mock.unmount).not.toHaveBeenCalled();expect(mock.setTheme).not.toHaveBeenCalled();expect(mock.restoreViews).not.toHaveBeenCalled();
    viewer.updateOptions({mode:'studio',chrome:undefined,themeTokens:undefined});
    expect(viewer.element.dataset.inspector).toBe('visible');expect(viewer.element.querySelector('.vv-layer')).toBe(layer);expect(viewer.element.style.getPropertyValue('--vv-accent')).toBe('');
    viewer.dispose();expect(mock.close).not.toHaveBeenCalled();
  });
  it('validates presentation updates atomically and isolates caller-owned chrome objects',()=>{
    const {figure}=fixture(),chrome={inspector:true},viewer=mountViewer(figure,document.body,{mode:'embed',chrome});
    chrome.inspector=false;expect(viewer.element.querySelector<HTMLElement>('.vv-sidebar')!.hidden).toBe(false);
    expect(()=>viewer.updateOptions({mode:'studio',themeTokens:{accent:123 as unknown as string}})).toThrow('color token');
    expect(viewer.element.dataset.mode).toBe('embed');
    expect(()=>viewer.updateOptions({exportSource:'future' as 'accepted'})).toThrow('export source');
    expect(viewer.element.querySelector<HTMLSelectElement>('[aria-label="Export source"]')!.value).toBe('displayed');viewer.dispose();
  });
  it('uses the explicit export choice without resuming frozen inspection and adds records only to HTML',async()=>{
    vi.stubGlobal('URL',{createObjectURL:vi.fn(()=>'blob:viewer-test'),revokeObjectURL:vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    const {figure,mock}=fixture(),viewer=mountViewer(figure,document.body,{observation:true});figure.freezeInspection();
    const source=viewer.element.querySelector<HTMLSelectElement>('[aria-label="Export source"]')!;
    source.value='accepted';source.dispatchEvent(new Event('change'));
    expect(viewer.element.querySelector('.vv-export-options')!.textContent).toContain('may differ from a frozen view');
    // An unrelated React-style presentation update must not reset the user's export choice.
    viewer.updateOptions({chrome:{status:false}});expect(source.value).toBe('accepted');
    const button=(label:string)=>[...viewer.element.querySelectorAll('button')].find(button=>button.textContent===label)!;
    button('Export PNG').click();await vi.waitFor(()=>expect(button('Export PNG').disabled).toBe(false));
    expect(mock.savefig).toHaveBeenCalledWith({source:'accepted'});expect(mock.resumeLive).not.toHaveBeenCalled();
    button('Export HTML').click();expect(toHTMLAsync).toHaveBeenLastCalledWith(figure,{source:'accepted',observation:true});
    expect(figure.getInspectionState().mode).toBe('frozen');viewer.dispose();
  });
  it('renders declared channel meaning and imported records from the frozen scene rather than newer live metadata',()=>{
    const {figure,mock}=fixture();
    const frozen={...mock.spec,layers:[{...mock.spec.layers[0],data:{x:'time',y:'temperature'}}],semantics:{schemaVersion:1 as const,sources:{time:{name:'Elapsed time',unit:'s'},temperature:{name:'<img src=x onerror=alert(1)>',quantity:'temperature',unit:'K',origin:{datasetId:'experiment-17'},transforms:[{execution:'external' as const,name:'calibration',version:'2'}]}}},observation:{schemaVersion:1 as const,source:'accepted' as const,capturedAt:'2026-10-23T10:00:00.000Z',sourceVersions:[{id:'time',version:2},{id:'temperature',version:3}],streams:[],representation:{status:'not-evaluated' as const}}};
    Object.assign(mock.spec,structuredClone(frozen));mock.getInspectionSnapshot=()=>({figure:frozen,sources:[]});
    const viewer=mountViewer(figure,document.body,{preserveTheme:true});figure.freezeInspection();
    Object.assign(mock.spec,{semantics:{schemaVersion:1,sources:{temperature:{unit:'C'}}},observation:undefined});mock.emit('frame',mock.getInspectionState());
    const meaning=viewer.element.querySelector('.vv-semantics')!,record=viewer.element.querySelector('.vv-record-body')!;
    expect(meaning.textContent).toContain('Elapsed time');expect(meaning.textContent).toContain('K');expect(meaning.textContent).toContain('calibration · 2');expect(meaning.querySelector('img')).toBeNull();
    expect(record.textContent).toContain('accepted');expect(record.textContent).toContain('temperature · 3');expect(record.textContent).toContain('Not evaluated for this capture');
    void figure.resumeLive();expect(viewer.element.querySelector('.vv-record-body')!.textContent).toContain('No observation record');expect(viewer.element.querySelector('.vv-semantics')!.textContent).not.toContain('calibration');viewer.dispose();
  });
  it('allows freezing a completed frame even when its data revision is zero',()=>{
    const {figure,mock}=fixture();
    const state=mock.getInspectionState();mock.getInspectionState=()=>({...state,displayedRevision:0,frameId:1});
    const viewer=mountViewer(figure,document.body),freeze=[...viewer.element.querySelectorAll('button')].find(node=>node.textContent==='Freeze view')!;
    expect(freeze.disabled).toBe(false);
    mock.getInspectionState=()=>({...state,displayedRevision:0,frameId:0});mock.emit('frame',mock.getInspectionState());
    expect(freeze.disabled).toBe(true);viewer.dispose();
  });
  it('rejects double attachment and disposes without closing application data',()=>{
    const {figure,mock}=fixture(),host=document.createElement('div');document.body.append(host);
    const viewer=mountViewer(figure,host);expect(host.querySelector('canvas')).not.toBeNull();
    expect(()=>mountViewer(figure,host)).toThrow('already has a mounted view');
    viewer.dispose();viewer.dispose();expect(mock.unmount).toHaveBeenCalledOnce();expect(mock.close).not.toHaveBeenCalled();
    expect([...mock.listeners.values()].every(handlers=>handlers.size===0)).toBe(true);expect(host.childElementCount).toBe(0);
    mountViewer(figure,host).dispose();expect(mock.mount).toHaveBeenCalledTimes(2);
  });
  it('keeps controls scoped and changes frozen inspection without stopping the producer',async()=>{
    const a=fixture(),b=fixture();const first=mountViewer(a.figure,document.body),second=mountViewer(b.figure,document.body,{theme:'light'});
    const find=(name:string)=>[...first.element.querySelectorAll('button')].find(button=>button.textContent===name)!;
    find('Freeze view').focus();find('Freeze view').click();expect(a.mock.freezeInspection).toHaveBeenCalledOnce();expect(b.mock.freezeInspection).not.toHaveBeenCalled();expect(document.activeElement).toBe(find('Return to live'));
    expect(first.element.querySelector('[role=status]')?.textContent).toContain('Frozen snapshot');
    expect(first.element.querySelector<HTMLButtonElement>('.vv-layer')?.disabled).toBe(true);
    find('Reset view').click();expect(a.mock.resetInspectionView).toHaveBeenCalledOnce();expect(a.mock.restoreViews).not.toHaveBeenCalled();
    find('Return to live').click();await Promise.resolve();expect(a.mock.resumeLive).toHaveBeenCalledOnce();expect(document.activeElement).toBe(find('Freeze view'));
    expect(second.element.dataset.theme).toBe('light');first.dispose();second.dispose();
  });
  it('preserves imported colors and makes WebGL failures visible',()=>{
    const {figure,mock}=fixture();mock.mount.mockImplementation(()=>{throw new Error('WebGL2 unavailable');});const onError=vi.fn();
    const viewer=mountViewer(figure,document.body,{preserveTheme:true,exportHTML:false,onError});
    expect(mock.setTheme).not.toHaveBeenCalled();expect(viewer.element.querySelector('[role=alert]')?.textContent).toContain('WebGL2');expect(onError).toHaveBeenCalledOnce();
    expect([...viewer.element.querySelectorAll('button')].find(button=>button.textContent==='Export HTML')?.hidden).toBe(true);
    viewer.dispose();expect(mock.close).not.toHaveBeenCalled();
  });
  it('preserves keyboard focus when toggling a layer',()=>{
    const {figure,mock}=fixture(),viewer=mountViewer(figure,document.body);
    const control=viewer.element.querySelector<HTMLButtonElement>('.vv-layer')!;
    control.focus();control.click();
    expect(mock.updateVisibility).toHaveBeenCalledOnce();
    expect(viewer.element.querySelector('.vv-layer')).toBe(control);
    expect(document.activeElement).toBe(control);expect(control.getAttribute('aria-pressed')).toBe('false');
    viewer.dispose();
  });
  it('defers programmatic scene theme changes until frozen inspection returns to live',async()=>{
    const {figure,mock}=fixture(),viewer=mountViewer(figure,document.body);
    mock.setTheme.mockClear();figure.freezeInspection();viewer.setTheme('light');
    expect(viewer.element.dataset.theme).toBe('light');expect(mock.setTheme).not.toHaveBeenCalled();
    await figure.resumeLive();expect(mock.setTheme).toHaveBeenCalledOnce();
    expect(mock.setTheme.mock.calls[0][0]).toMatchObject({background:'#fbfcfd'});
    viewer.dispose();
  });
  it('shows unified telemetry sample coordinates and clears stale inspection on leave',()=>{
    const {figure,mock}=fixture(),viewer=mountViewer(figure,document.body);
    mock.emit('xhover',{cursorX:2,items:[{layerId:'line',x:2,y:7,sequence:42}]});
    const inspector=viewer.element.querySelector('.vv-inspection')!;
    expect(inspector.textContent).toContain('Measurement');expect(inspector.textContent).toContain('x: 2 · y: 7 · sample 42');
    mock.emit('xhover',null);expect(inspector.textContent).toContain('Select or hover');viewer.dispose();
  });
  it('routes 3D aspect, fit and focus through displayed inspection controls',()=>{
    const {figure,mock}=fixture();mock.spec.view.kind='3d';
    const viewer=mountViewer(figure,document.body),button=(label:string)=>[...viewer.element.querySelectorAll('button')].find(node=>node.textContent===label)!;
    figure.freezeInspection();button('Equal axes').click();
    expect(mock.setInspectionView).toHaveBeenLastCalledWith('main',{equalAspect:true});expect(button('Equal axes').getAttribute('aria-pressed')).toBe('true');
    button('Fit data').click();expect(mock.setInspectionView).toHaveBeenLastCalledWith('main',expect.objectContaining({xDomain:undefined,yDomain:undefined,zDomain:undefined,camera:{azimuth:35,elevation:25,distance:3},pan3d:[0,0]}));
    button('Focus selection').click();expect(mock.focusInspectionSelection).toHaveBeenCalledWith('main');
    mock.focusInspectionSelection.mockImplementation(()=>{throw new Error('Select a 3D sample before focusing.');});button('Focus selection').click();
    expect(viewer.element.querySelector('[role=alert]')?.textContent).toContain('Select a 3D sample');viewer.dispose();
  });
  it('keeps clicked scientific identity after pointer leave and restores an offline selection',()=>{
    const first=fixture(),viewer=mountViewer(first.figure,document.body);
    const inspectorDetails=viewer.element.querySelector('.vv-inspection')!.closest('details')!;expect(inspectorDetails.open).toBe(false);
    const selection={kind:'surface',layerId:'line',x:0.00000001,y:2,z:3,value:4,cell:[1,2],triangle:0,interpolated:true,frameId:8,sourceRevision:3,sourceVersions:{x:3,y:3,z:4},pointerPosition:{x:0,y:0,clientX:0,clientY:0}};
    first.mock.emit('click',selection);first.mock.emit('hover',null);first.mock.emit('xhover',null);
    expect(inspectorDetails.open).toBe(true);expect(viewer.element.querySelector('.vv-statusbar')!.textContent).not.toContain('Frame');
    const detail=viewer.element.querySelector('.vv-inspection')!.textContent;
    expect(detail).toContain('Selected interpolated value');expect(detail).toContain('Cell row, column: 1, 2');expect(detail).toContain('Frame: 8');expect(detail).toContain('x: 1e-8');
    first.mock.emit('frame',first.mock.getInspectionState());expect(viewer.element.querySelector('.vv-inspection')!.textContent).toBe(detail);
    first.mock.getInspectionSelection=()=>undefined;first.mock.emit('frame',first.mock.getInspectionState());first.mock.emit('hover',null);
    expect(viewer.element.querySelector('.vv-inspection')!.textContent).toContain('Select or hover');
    viewer.dispose();
    const second=fixture();Object.assign(second.mock.spec,{inspection:{capturedAt:'2026-10-15T10:00:00Z',frameId:8,snapshotId:'snapshot-1',selection}});
    const offline=mountViewer(second.figure,document.body,{live:false});expect(offline.element.querySelector('.vv-inspection')!.textContent).toBe(detail);
    expect(offline.element.querySelector('.vv-inspection')!.closest('details')!.open).toBe(true);
    expect(offline.element.textContent).toContain('Captured 2026-10-15T10:00:00Z');expect(offline.element.textContent).toContain('Source frame 8');offline.dispose();
  });
});
