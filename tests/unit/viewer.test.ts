// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mountViewer} from '../../packages/core/src/viewer';
import type {Figure} from '../../packages/core/src/figure';

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
    updateVisibility:vi.fn((layer:any,visible:boolean)=>{layer.visible=visible;emit('frame',state);}),
    freezeInspection:vi.fn(()=>{state.mode='frozen';emit('inspectionchange',state);return {...state};}),resumeLive:vi.fn(async()=>{state.mode='live';emit('inspectionchange',state);}),
    setCameraPreset:vi.fn(),getInspectionSnapshot:()=>({figure:value.spec,sources:[]}),getInspectionView:()=>view,
    setInspectionView:vi.fn((_panelId:string,patch:any)=>{Object.assign(view,patch);emit('frame',state);}),focusInspectionSelection:vi.fn(),
    emit,listeners,
  };
  return {figure:value as unknown as Figure,mock:value};
}
afterEach(()=>document.body.replaceChildren());
describe('borrowed scientific viewer',()=>{
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
