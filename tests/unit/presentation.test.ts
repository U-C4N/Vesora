import {describe,expect,it,vi} from 'vitest';
import {Figure,subplots} from '../../packages/core/src/figure';
import {DARK_THEME,LIGHT_THEME,resolveTheme,validateAxisFormat,formatValue,formatTimeTick} from '../../packages/core/src/presentation';
import {extent,normalize,ticks,validateDomain} from '../../packages/core/src/scales';
import {planLine,planScatter} from '../../packages/core/src/planning';
import type {AxisFormat,Snapshot} from '../../packages/core/src/types';

const buffers=(figure:Figure)=>new Map(Array.from(figure.registry.entries(),([id,entry])=>[id,entry.values.buffer.slice(entry.values.byteOffset,entry.values.byteOffset+entry.values.byteLength) as ArrayBuffer]));
describe('presentation scene contracts',()=>{
  it('isolates resolved theme storage and promotes without losing legacy scene support',()=>{
    const palette=['#abc'],figure=subplots({rows:1,cols:2,theme:{palette}});
    expect(figure.spec.protocolVersion).toBe(5);expect(figure.spec.theme?.palette).toEqual(['#aabbcc']);palette[0]='#000';
    expect(figure.spec.theme?.palette).toEqual(['#aabbcc']);
    const next=new Figure();next.applySnapshot(figure.snapshot(),buffers(figure));expect(next.snapshot()).toEqual(figure.snapshot());
    for(const protocolVersion of [1,2,3,4]){const legacy=new Figure();legacy.spec.protocolVersion=protocolVersion;next.applySnapshot(legacy.snapshot(),buffers(legacy));expect(next.spec.protocolVersion).toBe(protocolVersion);legacy.close();}
    figure.close();next.close();
  });
  it('rejects malformed themes and formats without changing state',()=>{
    const figure=new Figure({theme:'dark'}),before=figure.snapshot();
    for(const theme of [{background:'url(https://example.com)'},{fontSize:Infinity},{fontSize:4},{fontFamily:'bad\nfont'},{palette:[]},{extra:'x'}]){
      expect(()=>figure.setTheme(theme as any)).toThrow();expect(figure.snapshot()).toEqual(before);
    }
    for(const format of [{kind:'currency',currency:'TRY1'},{kind:'date',timeZone:'Mars/Olympus'},{kind:'number',locale:'not_a_locale'},
      {kind:'date',options:{hour12:'false'}},{kind:'percent',options:{useGrouping:1}},{kind:'number',options:{maximumFractionDigits:Infinity}},
      {kind:'number',options:{minimumFractionDigits:4,maximumFractionDigits:2}},{kind:'date',options:{dateStyle:'short',year:'numeric'}},
      {kind:'date',options:{fractionalSecondDigits:0}},{kind:'number',options:{style:'currency'}}]){
      expect(()=>figure.setAxisFormat('y',format as any)).toThrow();expect(figure.snapshot()).toEqual(before);
    }
    expect(resolveTheme('dark')).toEqual(DARK_THEME);expect(resolveTheme()).toEqual(LIGHT_THEME);figure.close();
    const log=new Figure();log.setView({xScale:'log',xDomain:[1,10]});log.setAxisFormat('x',{kind:'date'});
    expect(()=>log.setView({xDomain:[-10,-1]})).toThrow(/positive/);log.close();
  });
  it('shares formats atomically and bookmarks restore complete axis presentation',()=>{
    const figure=subplots({rows:1,cols:2,shareX:true});const right=figure.panel(0,1);
    right.setView({xScale:'time'}).setAxisFormat('x',{kind:'date',timeZone:'Europe/Istanbul',locale:'tr-TR'});
    expect(figure.spec.protocolVersion).toBe(5);expect(figure.spec.view.xFormat).toEqual(right.view.xFormat);
    figure.bookmark('Dates');figure.setAxisFormat('x',null);expect(figure.spec.view).not.toHaveProperty('xFormat');expect(right.view).not.toHaveProperty('xFormat');
    figure.restoreBookmark('Dates');expect(figure.spec.view.xFormat?.kind).toBe('date');expect(right.view.xFormat).toEqual(figure.spec.view.xFormat);
    const snapshot=figure.snapshot(),before=figure.snapshot();snapshot.figure.protocolVersion=4;
    expect(()=>figure.applySnapshot(snapshot,buffers(figure))).toThrow(/protocol version 5/);expect(figure.snapshot()).toEqual(before);figure.close();
  });
  it('rejects hidden v5 presentation in a legacy bookmark',()=>{
    const figure=new Figure();figure.bookmark('old');const snapshot=figure.snapshot();snapshot.figure.bookmarks![0].view.xFormat={kind:'date'};
    expect(()=>figure.applySnapshot(snapshot,new Map())).toThrow(/protocol version 5/);figure.close();
  });
  it('keeps host-only preferences out of snapshots and validates size atomically',()=>{
    const figure=new Figure(),before=figure.snapshot();figure.setPresentation({legend:false,tooltip:false});expect(figure.snapshot()).toEqual(before);
    expect(()=>figure.setPresentation({legend:true,tooltip:'false'} as any)).toThrow();expect(figure.presentation).toEqual({legend:false,tooltip:false});
    expect(()=>figure.setSize({width:700,height:NaN})).toThrow();expect(figure.snapshot()).toEqual(before);
    figure.setSize({height:300});expect(figure.spec.height).toBe(300);expect(figure.unmount()).toBe(figure);figure.plot([0,1],[1,2]);figure.close();
  });
  it('subscriber exceptions cannot prevent other handlers or recurse through error events',()=>{
    const figure=new Figure(),diagnostics=vi.spyOn(console,'error').mockImplementation(()=>{}),received:string[]=[];
    figure.on('error',()=>{throw new Error('consumer');});figure.on('error',event=>received.push(event.message));
    expect(()=>figure.emit('error',{message:'WebGL failure'})).not.toThrow();expect(received).toEqual(['WebGL failure']);expect(diagnostics).toHaveBeenCalledOnce();
    diagnostics.mockImplementation(()=>{throw new Error('broken console');});expect(()=>figure.emit('error',{message:'second'})).not.toThrow();expect(received).toHaveLength(2);diagnostics.mockRestore();figure.close();
  });
});

describe('shared Intl formatting and UTC calendar scales',()=>{
  it('formats currency, percent, numbers and dates using explicit declarative semantics',()=>{
    const currency=validateAxisFormat({kind:'currency',currency:'try',locale:'tr-TR'});expect(currency).toMatchObject({currency:'TRY'});
    expect(formatValue(1234.5,currency)).toBe(new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(1234.5));
    expect(formatValue(.125,{kind:'percent',options:{maximumFractionDigits:1}})).toBe('12.5%');
    expect(formatValue(1200,{kind:'number',options:{notation:'compact'}})).toBe('1.2K');
    const epoch=Date.UTC(2026,9,12,23),date:AxisFormat={kind:'date',locale:'en-US',options:{year:'numeric',month:'2-digit',day:'2-digit'}};
    expect(formatValue(epoch,date)).toBe('10/12/2026');expect(formatValue(epoch,{...date,timeZone:'Europe/Istanbul'})).toBe('10/13/2026');
    expect(formatTimeTick(epoch,3600000)).toContain('11:00');expect(formatValue(NaN,date)).toBe('NaN');
  });
  it('uses real UTC month and leap-day boundaries across zoom ranges',()=>{
    const month=ticks([Date.UTC(2024,0,1),Date.UTC(2024,5,1)],'time',6);
    expect(month.map(value=>new Date(value).getUTCDate())).toEqual(month.map(()=>1));
    expect(month[2]-month[1]).toBe(29*86400000);
    const day=ticks([Date.UTC(2024,1,28),Date.UTC(2024,2,2)],'time',4);
    expect(day.map(value=>new Date(value).toISOString().slice(0,10))).toContain('2024-02-29');
    const hour=ticks([Date.UTC(2026,0,1),Date.UTC(2026,0,1,4)],'time',5);
    expect(hour).toHaveLength(5);expect(hour[1]-hour[0]).toBe(3600000);
  });
  it('preserves source precision, gaps and exact scatter plans for time coordinates',()=>{
    const start=Date.UTC(2026,0,1),x=Float64Array.of(start,start+1000,start+2000,start+3000),y=Float64Array.of(1,2,NaN,4);
    const query={bounds:{x:[start,start+3000] as [number,number],y:[0,5] as [number,number]},width:500,height:300,xScale:'time' as const,yScale:'linear' as const,pointBudget:100,mode:'points' as const};
    const scatter=planScatter(x,y,query);expect(scatter.kind).toBe('points');if(scatter.kind==='points')expect([...scatter.indices]).toEqual([0,1,3]);
    expect(planLine(x,y,query).segments).toHaveLength(2);expect(normalize(start+1000,query.bounds.x,'time')).toBeCloseTo(1/3);
    expect(extent([start,start],'time')).toEqual([start-86400000,start+86400000]);
    expect(()=>validateDomain([0,8.64e15+1],'time')).toThrow();expect(normalize(8.64e15+1,[0,1],'time')).toBeNaN();
    const figure=new Figure(),layer=figure.scatter([0,8.64e15+1],[1,2]),before=figure.snapshot();
    expect(()=>figure.setView({xScale:'time'})).toThrow(/epoch milliseconds/);expect(figure.snapshot()).toEqual(before);
    layer.setData({x:[0,1000]});figure.setView({xScale:'time'});const current=figure.snapshot();
    expect(()=>layer.setData({x:[0,8.64e15+1]})).toThrow(/epoch milliseconds/);expect(figure.snapshot()).toEqual(current);figure.close();
  });
});
