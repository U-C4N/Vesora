import {describe,expect,it} from 'vitest';
import {DataRegistry} from '../../packages/core/src/data';
import {scatterSteps} from '../../packages/core/src/planning';
import {ScatterIndexCache} from '../../packages/core/src/scatter-index';
import {streamEntry} from '../../packages/core/src/streaming';
import type {PointPlan,Query} from '../../packages/core/src/types';

const query:Query={bounds:{x:[35,45],y:[55,65]},width:400,height:300,xScale:'linear',yScale:'linear',pointBudget:100000,mode:'auto'};
function finish<T>(steps:Generator<void,T>):T{while(true){const result=steps.next();if(result.done)return result.value;}}
function sources(count=32768,immutable=true){
  const registry=new DataRegistry();let state=12345;const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32);
  const x=Float64Array.from({length:count},()=>random()*100),y=Float64Array.from({length:count},()=>random()*100);
  x[0]=35;y[0]=55;x[1]=45;y[1]=65;x[2]=NaN;y[3]=Infinity;x[4]=-2;
  registry.set('x',x);registry.set('y',y);
  if(immutable)for(const id of ['x','y'])registry.store.set(id,streamEntry(registry.get(id),count));
  return registry;
}
function plan(registry:DataRegistry,options=query,index?:ScatterIndexCache,owned=false):PointPlan{return finish(scatterSteps(registry.get('x'),registry.get('y'),options,index,owned));}

describe('bounded exact scatter spatial index',()=>{
  it('keeps first-query scans and reuses a source-version index for sparse viewport queries',()=>{
    const registry=sources(),index=new ScatterIndexCache(),expected=plan(registry);
    expect(plan(registry,query,index)).toEqual(expected);expect(index.diagnostics()).toMatchObject({builds:0,indexBytes:0,lastMode:'scan'});
    expect(plan(registry,query,index)).toEqual(expected);const cold=index.diagnostics();expect(cold.lastMode).toBe('cold-index');expect(cold.builds).toBe(1);
    expect(cold.retainedBytes).toBe(0);expect(cold.indexBytes).toBeLessThanOrEqual(cold.maximumBytes);
    const pan={...query,bounds:{x:[40,50] as [number,number],y:[50,60] as [number,number]}};
    expect(plan(registry,pan,index)).toEqual(plan(registry,pan));expect(index.diagnostics()).toMatchObject({builds:1,warmQueries:1,lastMode:'warm-index'});
    expect(index.diagnostics().lastCandidateRows).toBeLessThan(32768/10);
  });
  it.each(['points','density','auto'] as const)('preserves %s results, source ordering, scale changes and representation hysteresis',mode=>{
    const registry=sources(),index=new ScatterIndexCache();plan(registry,query,index);plan(registry,query,index);
    for(const xScale of ['linear','log','time'] as const)for(const yScale of ['linear','log','time'] as const){
      const options={...query,mode,xScale,yScale,previous:'density' as const,width:40,height:20,pointBudget:100000};
      expect(plan(registry,options,index)).toEqual(plan(registry,options));
    }
  });
  it('preserves explicit point-budget failures and chooses a scan for broad queries',()=>{
    const registry=sources(),index=new ScatterIndexCache();plan(registry,query,index);plan(registry,query,index);
    expect(()=>plan(registry,{...query,mode:'points',pointBudget:2},index)).toThrow(/point budget/);
    const broad={...query,bounds:{x:[-1,101] as [number,number],y:[-1,101] as [number,number]}};
    expect(plan(registry,broad,index)).toEqual(plan(registry,broad));expect(index.diagnostics().lastMode).toBe('scan');
  });
  it('does not cache mutable caller arrays, while explicitly owned worker copies are eligible',()=>{
    const registry=sources(10000,false),index=new ScatterIndexCache();plan(registry,query,index);plan(registry,query,index);
    expect(index.diagnostics().builds).toBe(0);registry.get('x').values.fill(40);registry.get('y').values.fill(60);
    expect(plan(registry,query,index)).toEqual(plan(registry));expect(index.diagnostics().indexBytes).toBe(0);
    const worker=sources(10000,false);plan(worker,query,index,true);expect(plan(worker,query,index,true)).toEqual(plan(worker));expect(index.diagnostics().builds).toBe(1);
  });
  it('uses object identity and versions, even for a replacement with the same descriptor version',()=>{
    const registry=sources(),index=new ScatterIndexCache();plan(registry,query,index);plan(registry,query,index);
    const old=registry.get('y'),values=old.values.slice();values.fill(0);
    registry.store.set('y',streamEntry({descriptor:structuredClone(old.descriptor),values},values.length));
    expect(plan(registry,query,index)).toEqual(plan(registry));expect(plan(registry,query,index)).toEqual(plan(registry));
    expect(index.diagnostics().builds).toBe(2);index.release('y');expect(index.diagnostics().indexBytes).toBe(0);
  });
  it('charges in-progress builds, evicts LRU entries within the cap and refuses oversized indexes',()=>{
    const registry=sources(),index=new ScatterIndexCache(200000);plan(registry,query,index);const building=scatterSteps(registry.get('x'),registry.get('y'),query,index);
    expect(building.next().done).toBe(false);expect(index.diagnostics().indexBytes).toBeLessThanOrEqual(200000);
    finish(building);const first=index.diagnostics();expect(first.indexBytes).toBeGreaterThan(0);
    const next=sources();plan(next,query,index);plan(next,query,index);expect(index.diagnostics().entries).toBe(1);expect(index.diagnostics().indexBytes).toBeLessThanOrEqual(200000);
    const tiny=new ScatterIndexCache(1024);plan(registry,query,tiny);expect(plan(registry,query,tiny)).toEqual(plan(registry));expect(tiny.diagnostics().indexBytes).toBe(0);
    index.clear();expect(index.diagnostics()).toMatchObject({indexBytes:0,retainedBytes:0,entries:0});
  });
  it('does not resurrect an evicted/cancelled build after a cooperative yield',()=>{
    const registry=sources(150000),index=new ScatterIndexCache();plan(registry,query,index);
    const steps=scatterSteps(registry.get('x'),registry.get('y'),query,index);expect(steps.next().done).toBe(false);
    index.release('x');expect(index.diagnostics().indexBytes).toBe(0);expect(finish(steps)).toEqual(plan(registry));expect(index.diagnostics().indexBytes).toBe(0);
  });
  it('allows interleaved queries to finish the same cold build without retaining an invalid build cursor',()=>{
    const registry=sources(150000),index=new ScatterIndexCache();plan(registry,query,index);
    const first=scatterSteps(registry.get('x'),registry.get('y'),query,index);expect(first.next().done).toBe(false);
    const pan={...query,bounds:{x:[40,50] as [number,number],y:[50,60] as [number,number]}};
    expect(plan(registry,pan,index)).toEqual(plan(registry,pan));expect(finish(first)).toEqual(plan(registry));expect(index.diagnostics().builds).toBe(1);
  });
  it('handles constant axes, invalid coordinates and overflowing extents through exact fallback',()=>{
    const registry=sources(10000,false),index=new ScatterIndexCache();registry.get('x').values.fill(40);
    plan(registry,query,index,true);expect(plan(registry,query,index,true)).toEqual(plan(registry));
    const overflow=sources(10000,false);overflow.get('x').values[10]=-1e308;overflow.get('x').values[11]=1e308;
    plan(overflow,query,index,true);expect(plan(overflow,query,index,true)).toEqual(plan(overflow));
    const invalid=sources(10000,false);invalid.get('y').values.fill(NaN);plan(invalid,query,index,true);expect(plan(invalid,query,index,true)).toEqual(plan(invalid));
  });
});
