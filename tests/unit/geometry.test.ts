import {describe,expect,it} from 'vitest';
import {DataRegistry} from '../../packages/core/src/data';
import {buildGeometry,gridEdges} from '../../packages/core/src/geometry';
import {defaultView} from '../../packages/core/src/figure';
import {planLine,planScatter} from '../../packages/core/src/planning';
import type {LayerSpec,Query} from '../../packages/core/src/types';

const query:Query={bounds:{x:[-1,1],y:[-1,1]},width:100,height:100,xScale:'linear',yScale:'linear',pointBudget:100_000,mode:'auto'};
function source(x:number[],y:number[],z?:number[],color?:number[]){
  const registry=new DataRegistry();registry.set('x',Float64Array.from(x));registry.set('y',Float64Array.from(y));
  if(z)registry.set('z',Float64Array.from(z));if(color)registry.set('color',Float64Array.from(color));
  return registry;
}
const layer=(kind:LayerSpec['kind'],extra:Record<string,string>={}):LayerSpec=>({id:'layer',kind,data:{x:'x',y:'y',...extra},style:{},visible:true});

describe('float64 projection to finite GPU geometry',()=>{
  it('retains a horizontal crossing line with huge offscreen endpoints',()=>{
    const registry=source([-1e100,1e100],[0,0]);
    const plan=planLine(registry.get('x').values,registry.get('y').values,query);
    const geometry=buildGeometry(layer('line'),registry,query.bounds,[0,1],defaultView(),100,100,plan);
    expect(geometry.positions.length).toBe(18);
    expect([...geometry.positions].every(Number.isFinite)).toBe(true);
    expect(geometry.positions[0]).toBe(-1);expect(geometry.positions[6]).toBe(1);
  });
  it('retains a diagonal crossing at enormous normalized coordinates',()=>{
    const registry=source([-1e100,1e100],[-1e100,1e100]);
    const plan=planLine(registry.get('x').values,registry.get('y').values,query);
    const geometry=buildGeometry(layer('line'),registry,query.bounds,[0,1],defaultView(),100,100,plan);
    expect(geometry.positions.length).toBe(18);
    expect([...geometry.positions].every(Number.isFinite)).toBe(true);
    expect(geometry.positions[0]).toBeCloseTo(-1,1);expect(geometry.positions[1]).toBeCloseTo(-1,1);
    expect(geometry.positions[6]).toBeCloseTo(1,1);expect(geometry.positions[7]).toBeCloseTo(1,1);
  });
  it('does not collapse close high-offset scatter positions',()=>{
    const x=[1e12,1e12+.01],registry=source(x,[0,1]);
    const q={...query,bounds:{x:[x[0],x[1]] as [number,number],y:[0,1] as [number,number]}};
    const plan=planScatter(registry.get('x').values,registry.get('y').values,q);
    const geometry=buildGeometry(layer('scatter'),registry,q.bounds,[0,1],defaultView(),100,100,plan);
    expect(geometry.positions[0]).toBe(-1);expect(geometry.positions[3]).toBe(1);
  });
  it('uses endpoint scalar colors and breaks lines across invalid colors',()=>{
    const registry=source([-1,1],[-1,1],undefined,[0,100]);
    const plan=planLine(registry.get('x').values,registry.get('y').values,query);
    const geometry=buildGeometry(layer('line',{color:'color'}),registry,query.bounds,[0,1],defaultView(),100,100,plan);
    expect([...geometry.colors.slice(0,4)]).not.toEqual([...geometry.colors.slice(8,12)]);
    const broken=source([0,.0001,.0002,.0003],[0,0,0,0],undefined,[0,NaN,10,20]);
    const reduced=planLine(broken.get('x').values,broken.get('y').values,query);
    const gap=buildGeometry(layer('line',{color:'color'}),broken,query.bounds,[0,1],defaultView(),100,100,reduced);
    expect(gap.positions.length).toBe(0);
  });
  it('skips surface triangles with invalid logarithmic x/y coordinates',()=>{
    const registry=source([-1,1],[1,2],[0,1,2,3]);
    const view={...defaultView('3d'),xScale:'log' as const};
    const geometry=buildGeometry(layer('surface',{z:'z'}),registry,{x:[1,10],y:[1,2]},[0,3],view,100,100);
    expect(geometry.positions.length).toBe(0);
  });
  it('constructs finite grid boundaries for extreme coordinates',()=>{
    expect([...gridEdges(Float64Array.from([-1e308,1e308]),'linear')]).toEqual([-Number.MAX_VALUE,0,Number.MAX_VALUE]);
    expect([...gridEdges(Float64Array.from([1e-300,1e300]),'log')].every(value=>Number.isFinite(value)&&value>0)).toBe(true);
    const edges=gridEdges(Float64Array.from([1e12,1e12+.01]),'log');
    expect(edges[0]).toBeLessThan(edges[1]);expect(edges[1]).toBeLessThan(edges[2]);
  });
});
