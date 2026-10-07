import {describe,expect,it} from 'vitest';
import {Figure} from '../../packages/core/src/figure';

describe('public Figure semantic model',()=>{
  it('retains typed dtype, source identity and layer identity across updates',()=>{
    const figure=new Figure({title:'Precision'}),line=figure.plot(new Float64Array([1e12,1e12+.01]),new Float32Array([1,2]));
    const before=figure.snapshot(),id=line.id,xId=line.spec.data.x;
    expect(before.sources.find(source=>source.id===xId)?.dtype).toBe('float64');
    line.setData({x:new Float64Array([1e12,1e12+.02])}).setStyle({width:3});
    expect(line.id).toBe(id);expect(line.spec.data.x).toBe(xId);
    expect(figure.registry.get(xId).descriptor.version).toBe(2);
    expect(line.spec.style.width).toBe(3);expect(figure.spec.layers).toHaveLength(1);
    figure.close();expect(figure.registry.size).toBe(0);
  });
  it('rejects invalid coordinate updates without altering valid data',()=>{
    const figure=new Figure(),line=figure.plot([0,1],[2,3]);
    const before=figure.snapshot();
    expect(()=>line.setData({x:[0,1,2]})).toThrow(/equal lengths/);
    expect(figure.snapshot()).toEqual(before);
    expect(()=>figure.setView({xScale:'log',xDomain:[0,1]})).toThrow(/positive/);
    expect(figure.spec.view.xScale).toBe('linear');
  });
  it('normalizes grid shape and reconstructs a protocol snapshot',()=>{
    const figure=new Figure(),surface=figure.surface([0,1,2],[0,1],[[1,2,3],[4,5,6]]);
    const snapshot=figure.snapshot();
    expect(snapshot.figure.view.kind).toBe('3d');
    expect(snapshot.sources.find(source=>source.id===surface.spec.data.z)?.shape).toEqual([2,3]);
    const buffers=new Map(Array.from(figure.registry.entries(),([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer]));
    const copy=new Figure();copy.applySnapshot(snapshot,buffers);
    expect(copy.snapshot()).toEqual(snapshot);
    expect([...copy.registry.get(surface.spec.data.z).values]).toEqual([1,2,3,4,5,6]);
    expect(()=>copy.scatter([1],[2])).toThrow(/separate figures/);
  });
  it('releases only the removed layer sources',()=>{
    const figure=new Figure(),line=figure.plot([0,1],[0,1]);figure.scatter([2],[3]);
    expect(figure.registry.size).toBe(4);line.remove();
    expect(figure.registry.size).toBe(2);expect(figure.spec.layers).toHaveLength(1);
  });
  it('rejects transposed or implicit grid reshaping atomically',()=>{
    const figure=new Figure();
    expect(()=>figure.heatmap([0,1,2],[0,1],[[1,2],[3,4],[5,6]])).toThrow(/shape/);
    const layer=figure.heatmap([0,1,2],[0,1],[[1,2,3],[4,5,6]]),before=figure.snapshot();
    expect(()=>layer.setData({x:[0,1],y:[0,1,2]})).toThrow(/reshaped/);
    expect(figure.snapshot()).toEqual(before);
  });
  it('retains data sources referenced by other layers in imported scenes',()=>{
    const figure=new Figure(),first=figure.scatter([0,1],[0,1]);
    const second=figure.scatter([2,3],[2,3]);
    second.spec.data=first.spec.data;first.remove();
    expect(figure.registry.get(second.spec.data.x).values.length).toBe(2);
  });
});

describe('saved views and bookmarks',()=>{
  it('captures independent views and replaces named bookmarks without reordering',()=>{
    const figure=new Figure({kind:'3d'});
    figure.setView({pan3d:[.3,-.2],camera:{azimuth:80,elevation:15,distance:4}});
    figure.bookmark('  Overview  ',{note:'A <plain-text> note'});
    figure.setView({pan3d:[1,2]});figure.bookmark('Detail');
    expect(figure.spec.bookmarks?.[0].view.pan3d).toEqual([.3,-.2]);
    figure.bookmark('Overview',{note:''});
    expect(figure.spec.bookmarks?.map(item=>item.name)).toEqual(['Overview','Detail']);
    expect(figure.spec.bookmarks?.[0]).not.toHaveProperty('note');
    figure.spec.view.pan3d![0]=9;
    expect(figure.spec.bookmarks?.[0].view.pan3d).toEqual([1,2]);
    figure.removeBookmark('Detail').removeBookmark('Overview');
    expect(figure.snapshot().figure).not.toHaveProperty('bookmarks');
    expect(()=>figure.restoreBookmark('missing')).toThrow(/Unknown bookmark/);
    expect(()=>figure.removeBookmark('missing')).toThrow(/Unknown bookmark/);
  });
  it('fully restores automatic domains and emits JSON-safe reset fields',()=>{
    const figure=new Figure();figure.plot([1,2],[3,4]);figure.bookmark('Automatic');
    const events:any[]=[];figure.on('viewchange',event=>events.push(event));
    figure.setView({xDomain:[1,2],yDomain:[3,4],zDomain:[5,6],pan3d:[.5,.25]});
    figure.restoreBookmark('Automatic');
    expect(figure.spec.view).not.toHaveProperty('xDomain');
    expect(figure.spec.view).not.toHaveProperty('yDomain');
    expect(figure.spec.view).not.toHaveProperty('zDomain');
    expect(figure.spec.view.pan3d).toEqual([0,0]);
    expect(JSON.parse(JSON.stringify(events[0]))).toMatchObject({xDomain:null,yDomain:null,zDomain:null,pan3d:[0,0]});
    events[0].camera.azimuth=180;
    expect(figure.spec.view.camera.azimuth).toBe(35);
    const legacy={...figure.spec.view};delete legacy.pan3d;
    figure.restoreView(legacy);
    expect(events[1].pan3d).toEqual([0,0]);
  });
  it('validates views and bookmark metadata before changing state',()=>{
    const figure=new Figure();figure.bookmark('Empty figure');const before=figure.snapshot();
    expect(()=>figure.setView({pan3d:[0,Infinity]})).toThrow(/finite/);
    expect(()=>figure.restoreView({...figure.spec.view,camera:{azimuth:0,elevation:0,distance:0}})).toThrow(/camera/);
    expect(()=>figure.bookmark(' ')).toThrow(/nonempty/);
    expect(()=>figure.bookmark('Invalid',{note:5 as any})).toThrow(/note/);
    expect(()=>figure.surface([0,1],[0,1],[[0,0],[0,0]])).toThrow(/separate figures/);
    expect(figure.snapshot()).toEqual(before);
  });
  it('imports optional saved views atomically and accepts older protocol-one scenes',()=>{
    const original=new Figure({kind:'3d'});original.bookmark('Pose',{note:'Saved'});
    const snapshot=original.snapshot(),copy=new Figure();copy.applySnapshot(snapshot,new Map());
    expect(copy.snapshot()).toEqual(snapshot);
    const before=copy.snapshot();
    const duplicate=structuredClone(snapshot);duplicate.figure.bookmarks!.push(duplicate.figure.bookmarks![0]);
    expect(()=>copy.applySnapshot(duplicate,new Map())).toThrow(/Duplicate bookmark/);
    const mismatch=structuredClone(snapshot);mismatch.figure.bookmarks![0].view.kind='2d';
    expect(()=>copy.applySnapshot(mismatch,new Map())).toThrow(/dimensionality/);
    expect(copy.snapshot()).toEqual(before);
    delete snapshot.figure.bookmarks;delete snapshot.figure.view.pan3d;
    copy.applySnapshot(snapshot,new Map());expect(copy.snapshot()).toEqual(snapshot);
  });
});
