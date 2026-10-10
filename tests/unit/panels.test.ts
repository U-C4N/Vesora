import {describe,expect,it} from 'vitest';
import {Figure,subplots,defaultView} from '../../packages/core/src/figure';
import {PROTOCOL_VERSION,EXTENDED_PROTOCOL_VERSION} from '../../packages/core/src/types';
import type {Snapshot} from '../../packages/core/src/types';

const buffers=(figure:Figure)=>new Map(Array.from(figure.registry.entries(),([id,entry])=>[
  id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer,
]));

describe('grid ownership and legacy compatibility',()=>{
  it('retains the v1 shape for existing figures and v2 for a fixed grid',()=>{
    const legacy=new Figure();legacy.plot([0,1],[1,2]);legacy.bookmark('Original');
    expect(legacy.snapshot().figure.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(legacy.spec).not.toHaveProperty('panels');expect(legacy.spec).not.toHaveProperty('layout');
    expect(legacy.spec.bookmarks![0]).not.toHaveProperty('panelViews');
    const grid=subplots({rows:2,cols:2});
    expect(grid).toBeInstanceOf(Figure);expect(grid.spec.protocolVersion).toBe(EXTENDED_PROTOCOL_VERSION);
    expect(grid.panelEntries().map(panel=>[panel.id,panel.row,panel.col])).toEqual([
      ['main',0,0],['panel-0-1',0,1],['panel-1-0',1,0],['panel-1-1',1,1],
    ]);
    expect(grid.spec.panels![0]).not.toHaveProperty('view');
    expect(grid.panel(0,0).view).toBe(grid.spec.view);
  });
  it('keeps layers in one registry and keeps figure aliases on the main panel',()=>{
    const figure=subplots({rows:1,cols:2,title:'Figure'}),right=figure.panel(0,1);
    const leftLayer=figure.plot([0,1],[1,2]),rightLayer=right.scatter([4,5],[6,7]);
    right.setTitle('Right').setView({xLabel:'Independent',xDomain:[4,5]});
    figure.setView({xLabel:'Main'});figure.panel(0,0).setTitle('Left');
    expect(leftLayer.spec).not.toHaveProperty('panelId');expect(rightLayer.spec.panelId).toBe(right.id);
    expect(figure.spec.layers).toHaveLength(2);expect(figure.registry.size).toBe(4);
    expect(figure.panelLayers().map(layer=>layer.id)).toEqual([leftLayer.id]);
    expect(figure.panelLayers(right.id).map(layer=>layer.id)).toEqual([rightLayer.id]);
    expect(figure.spec.title).toBe('Figure');expect(figure.panelEntries().map(panel=>panel.title)).toEqual(['Left','Right']);
    expect(figure.spec.view.xLabel).toBe('Main');expect(figure.spec.view.xDomain).toBeUndefined();
    rightLayer.setData({y:[8,9]});expect(figure.registry.get(rightLayer.spec.data.y).descriptor.version).toBe(2);
    rightLayer.remove();expect(figure.registry.size).toBe(2);expect(figure.spec.layers[0].id).toBe(leftLayer.id);
  });
  it('rejects invalid grid construction, panel access and mixed 3D operations',()=>{
    for(const rows of [0,-1,1.5,Infinity])expect(()=>subplots({rows,cols:1})).toThrow(/positive/);
    expect(()=>subplots({rows:1,cols:1,shareX:1 as any})).toThrow(/booleans/);
    const figure=subplots({rows:1,cols:1});
    expect(()=>figure.panel(0,1)).toThrow(/outside/);expect(()=>figure.panel(.5,0)).toThrow(/integers/);
    expect(()=>figure.panelView('missing')).toThrow(/Unknown panel/);
    expect(()=>figure.surface([0,1],[0,1],[[0,1],[1,0]])).toThrow(/2D/);
    expect(()=>figure.setView({kind:'3d'})).toThrow(/2D/);
    expect(figure.spec.layers).toHaveLength(0);expect(figure.registry.size).toBe(0);
  });
});

describe('shared view transactions and full-layout bookmarks',()=>{
  it('shares scale and domains atomically while preserving labels and unshared axes',()=>{
    const figure=subplots({rows:2,cols:2,shareX:true});
    const panel=figure.panel(1,1),events:any[]=[];figure.on('viewchange',event=>events.push(event));
    figure.setView({xLabel:'Primary',yDomain:[-1,1]});
    panel.setView({xScale:'log',xDomain:[1,100],xLabel:'Secondary',yDomain:[10,20]});
    for(const entry of figure.panelEntries())expect([entry.view.xScale,entry.view.xDomain]).toEqual(['log',[1,100]]);
    expect(figure.spec.view.xLabel).toBe('Primary');expect(panel.view.xLabel).toBe('Secondary');
    expect(figure.spec.view.yDomain).toEqual([-1,1]);expect(panel.view.yDomain).toEqual([10,20]);
    expect(events).toEqual([]); // Existing programmatic setView behavior remains unchanged.
    const before=figure.snapshot();expect(()=>panel.setView({xDomain:[-1,1]})).toThrow(/positive/);
    expect(figure.snapshot()).toEqual(before);
    panel.setView({xDomain:undefined});for(const entry of figure.panelEntries())expect(entry.view).not.toHaveProperty('xDomain');
  });
  it('does not alias shared domain array objects between panels or callers',()=>{
    const figure=subplots({rows:1,cols:2,shareY:true}),domain:[number,number]=[1,3];
    figure.setView({yDomain:domain});domain[0]=99;
    expect(figure.panel(0,1).view.yDomain).toEqual([1,3]);
    expect(figure.spec.view.yDomain).not.toBe(figure.panel(0,1).view.yDomain);
    const captured=figure.captureViews();captured.panelViews!['panel-0-1'].yDomain![0]=22;
    expect(figure.panel(0,1).view.yDomain).toEqual([1,3]);
  });
  it('restores all panel domains, labels and automatic limits from one bookmark',()=>{
    const figure=subplots({rows:1,cols:2,shareX:true}),right=figure.panel(0,1);
    right.setView({yDomain:[-2,2],yLabel:'Saved label'});figure.bookmark('Overview',{note:'Plain <text>'});
    const saved=structuredClone(figure.spec.bookmarks![0]);
    figure.setView({xDomain:[2,4],yDomain:[1,3]});right.setView({yDomain:[20,30],yLabel:'Changed'});
    const events:any[]=[];figure.on('viewchange',event=>events.push(event));figure.restoreBookmark('Overview');
    expect(figure.captureViews()).toEqual({view:saved.view,panelViews:saved.panelViews});
    const event=JSON.parse(JSON.stringify(events[0]));
    expect(event.xDomain).toBeNull();expect(event.yDomain).toBeNull();expect(event.panelId).toBe('main');
    expect(event.panelViews[right.id].xDomain).toBeNull();expect(event.panelViews[right.id].yDomain).toEqual([-2,2]);
    expect(figure.spec.bookmarks![0]).toEqual(saved);
    figure.bookmark('Overview');expect(figure.spec.bookmarks).toHaveLength(1);
  });
  it('propagates an active-panel reset and reports the original panel identity',()=>{
    const figure=subplots({rows:1,cols:2,shareX:true}),right=figure.panel(0,1),events:any[]=[];
    figure.setView({xDomain:[5,8],yDomain:[1,2]});right.setView({yDomain:[3,4]});
    figure.on('viewchange',event=>events.push(event));
    figure.restorePanelView(right.id,defaultView());
    expect(figure.spec.view.xDomain).toBeUndefined();expect(figure.spec.view.yDomain).toEqual([1,2]);
    expect(right.view.yDomain).toBeUndefined();expect(events[0].panelId).toBe(right.id);
    expect(events[0].panelViews[right.id].yDomain).toBeNull();
  });
  it('rejects incomplete and inconsistent full-layout restores without changing state',()=>{
    const figure=subplots({rows:1,cols:2,shareX:true}),before=figure.snapshot();
    expect(()=>figure.restoreViews({view:defaultView()})).toThrow(/panelViews/);
    const state=figure.captureViews();state.panelViews!['panel-0-1'].xDomain=[1,2];
    expect(()=>figure.restoreViews(state)).toThrow(/Shared axis/);expect(figure.snapshot()).toEqual(before);
    const extra=figure.captureViews();extra.panelViews!.missing=defaultView();
    expect(()=>figure.restoreViews(extra)).toThrow(/every secondary/);expect(figure.snapshot()).toEqual(before);
  });
});

describe('scientific annotations',()=>{
  it('creates, updates and removes independent plain-text/data-coordinate annotations',()=>{
    const figure=subplots({rows:1,cols:2}),panel=figure.panel(0,1);
    const text=panel.text(1e12+.01,2,'<strong>plain text</strong>',{fontSize:16,color:'#123456'});
    const horizontal=figure.axhline(3,{width:2}),vertical=panel.axvline(4,{opacity:.5});
    expect(text.spec.panelId).toBe(panel.id);expect(horizontal.spec).not.toHaveProperty('panelId');
    expect(text.spec.text).toBe('<strong>plain text</strong>');expect(figure.registry.size).toBe(0);
    text.update({x:1e12+.02,text:'Revised',color:'#654321'});expect(text.spec.x).toBe(1e12+.02);expect(text.spec.style.fontSize).toBe(16);
    const before=figure.snapshot();expect(()=>text.update({fontSize:0})).toThrow(/positive/);expect(figure.snapshot()).toEqual(before);
    vertical.remove();horizontal.remove();text.remove();expect(figure.spec).not.toHaveProperty('annotations');
    expect(()=>text.update({text:'Stale'})).toThrow(/removed/);expect(()=>text.remove()).toThrow(/removed/);
  });
  it('promotes only new annotation scenes to v2 and preserves automatic domains',()=>{
    const figure=new Figure();figure.plot([0,1],[1,2]);const before=figure.captureViews();
    const mark=figure.axvline(1e100);
    expect(figure.spec.protocolVersion).toBe(EXTENDED_PROTOCOL_VERSION);expect(figure.captureViews()).toEqual(before);
    mark.remove();expect(figure.spec.protocolVersion).toBe(EXTENDED_PROTOCOL_VERSION);
    figure.setView({xScale:'log'});figure.axvline(-1); // The renderer omits invalid-log positions.
    expect(figure.spec.annotations![0].x).toBe(-1);
  });
  it('rejects invalid coordinates, styles, kinds and 3D annotation targets atomically',()=>{
    const figure=new Figure(),before=figure.snapshot();
    for(const value of [NaN,Infinity,-Infinity])expect(()=>figure.text(value,0,'Invalid')).toThrow(/finite/);
    expect(()=>figure.text(0,0,5 as any)).toThrow(/string/);
    expect(()=>figure.axhline(2,{width:-1})).toThrow(/positive/);
    expect(()=>figure.axvline(2,{opacity:2})).toThrow(/opacity/);
    expect(()=>figure.axhline(2,{fontFamily:'sans'} as any)).toThrow(/Unknown/);
    expect(figure.snapshot()).toEqual(before);
    const text=figure.text(1,2,'Text'),withText=figure.snapshot();
    expect(()=>figure.setView({kind:'3d'})).toThrow(/2D/);expect(()=>figure.scatter3d([0],[0],[0])).toThrow(/separate/);
    expect(()=>text.update({y:undefined})).toThrow(/finite/);expect(figure.snapshot()).toEqual(withText);
    const threeD=new Figure({kind:'3d'});expect(()=>threeD.axhline(0)).toThrow(/2D/);
    const line=new Figure().axhline(0);expect(()=>line.update({x:1})).toThrow(/Unexpected/);expect(()=>line.update({text:'label'})).toThrow(/text/);
  });
});

describe('v1/v2 snapshot acceptance',()=>{
  it('allocates fresh annotation IDs after import and preserves the imported annotation',()=>{
    const target=new Figure(),sequence=Number(target.spec.id.split('-').at(-1));
    const snapshot=target.snapshot();snapshot.figure.protocolVersion=EXTENDED_PROTOCOL_VERSION;
    snapshot.figure.annotations=[{id:`annotation-${sequence+1}`,kind:'text',x:0,y:0,text:'Imported',style:{color:'#123456'}}];
    target.applySnapshot(snapshot,new Map());
    const added=target.text(1,1,'New');expect(added.id).toBe(`annotation-${sequence+2}`);
    added.update({text:'Updated new',x:2});
    expect(target.spec.annotations![0]).toEqual(snapshot.figure.annotations![0]);
    expect(target.spec.annotations![1].text).toBe('Updated new');
    const copy=new Figure();copy.applySnapshot(target.snapshot(),new Map());
    expect(copy.snapshot()).toEqual(target.snapshot());
    added.remove();expect(target.spec.annotations).toEqual(snapshot.figure.annotations);
  });
  it('reserves imported layer IDs and all possible generated data channel names',()=>{
    const original=new Figure(),imported=original.scatter([10,20],[30,40]);
    original.text(10,30,'Imported note');
    const target=new Figure(),sequence=Number(target.spec.id.split('-').at(-1));
    const snapshot=original.snapshot(),sourceBuffers=buffers(original);
    snapshot.figure.layers[0].id=`layer-${sequence+1}`;
    // This source belongs to another layer but collides with the next candidate's
    // future color channel. The new layer initially has only x/y channels.
    const previousY=snapshot.figure.layers[0].data.y,collision=`layer-${sequence+2}-color`;
    snapshot.figure.layers[0].data.y=collision;
    snapshot.sources.find(source=>source.id===previousY)!.id=collision;
    sourceBuffers.set(collision,sourceBuffers.get(previousY)!);sourceBuffers.delete(previousY);
    const importedAnnotation=structuredClone(snapshot.figure.annotations![0]);
    // Layer/annotation IDs also share the figure's object namespace.
    snapshot.figure.annotations![0].id=`layer-${sequence+3}`;importedAnnotation.id=`layer-${sequence+3}`;
    target.applySnapshot(snapshot,sourceBuffers);
    const added=target.scatter([1,2],[3,4]);expect(added.id).toBe(`layer-${sequence+4}`);
    added.setData({color:[5,6],y:[7,8]});
    expect([...target.registry.get(imported.spec.data.x).values]).toEqual([10,20]);
    expect([...target.registry.get(collision).values]).toEqual([30,40]);
    expect(target.spec.layers[0]).toEqual(snapshot.figure.layers[0]);
    expect(target.spec.annotations![0]).toEqual(importedAnnotation);
    const copy=new Figure();copy.applySnapshot(target.snapshot(),buffers(target));
    expect(copy.snapshot()).toEqual(target.snapshot());
    expect([...copy.registry.get(collision).values]).toEqual([30,40]);
    added.remove();expect([...target.registry.get(collision).values]).toEqual([30,40]);
  });
  it('round-trips a grid, all panel data, annotations and bookmarks without duplicated main view',()=>{
    const original=subplots({rows:2,cols:1,shareX:true});
    original.plot([0,1],[1,2]);original.panel(1,0).heatmap([0,1],[0,1],[[1,2],[3,4]]);
    original.panel(1,0).text(.5,.5,'Cell');original.bookmark('Both');
    const copy=new Figure();copy.applySnapshot(original.snapshot(),buffers(original));
    expect(copy.snapshot()).toEqual(original.snapshot());expect(copy.spec.panels![0]).not.toHaveProperty('view');
    expect(copy.panelLayers('panel-1-0')).toHaveLength(1);
    const legacy=new Figure();legacy.scatter3d([0],[1],[2]);legacy.bookmark('3D');
    copy.applySnapshot(legacy.snapshot(),buffers(legacy));expect(copy.snapshot()).toEqual(legacy.snapshot());
    expect(copy.spec).not.toHaveProperty('layout');expect(copy.spec.protocolVersion).toBe(PROTOCOL_VERSION);
  });
  it.each([
    ['extensions in v1',(s:Snapshot)=>{s.figure.protocolVersion=1;}],
    ['unknown panel',(s:Snapshot)=>{s.figure.layers[0].panelId='missing';}],
    ['duplicate cell',(s:Snapshot)=>{s.figure.panels![1].col=0;}],
    ['duplicate main view',(s:Snapshot)=>{s.figure.panels![0].view=defaultView();}],
    ['secondary 3D',(s:Snapshot)=>{s.figure.panels![1].view!.kind='3d';}],
    ['inconsistent share',(s:Snapshot)=>{s.figure.panels![1].view!.xDomain=[1,2];}],
    ['unknown bookmark panel',(s:Snapshot)=>{s.figure.bookmarks![0].panelViews!.missing=defaultView();}],
    ['missing bookmark panels',(s:Snapshot)=>{delete s.figure.bookmarks![0].panelViews;}],
    ['annotation unknown panel',(s:Snapshot)=>{s.figure.annotations![0].panelId='missing';}],
    ['duplicate annotation',(s:Snapshot)=>{s.figure.annotations!.push(structuredClone(s.figure.annotations![0]));}],
    ['annotation invalid style',(s:Snapshot)=>{s.figure.annotations![0].style.opacity=3;}],
  ])('rejects %s without replacing a valid figure',(_name,corrupt)=>{
    const original=subplots({rows:1,cols:2,shareX:true});original.plot([0],[1]);original.text(0,1,'Note');original.bookmark('All');
    const target=new Figure();target.scatter([10],[20]);const before=target.snapshot(),snapshot=original.snapshot();corrupt(snapshot);
    expect(()=>target.applySnapshot(snapshot,buffers(original))).toThrow();expect(target.snapshot()).toEqual(before);
  });
});
