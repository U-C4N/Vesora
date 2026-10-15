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
  it('keeps exact visible boundary coordinates and constant color across adjacent segments',()=>{
    const registry=source([-1,0,1],[0,0,0]);
    const plan=planLine(registry.get('x').values,registry.get('y').values,query);
    const spec=layer('line');spec.style={color:'#804020',opacity:.5,width:2};
    const geometry=buildGeometry(spec,registry,query.bounds,[0,1],defaultView(),100,100,plan);
    expect(geometry.positions).toEqual(Float32Array.from([
      -1,.02,0,-1,-.02,0,0,-.02,0,-1,.02,0,0,-.02,0,0,.02,0,
      0,.02,0,0,-.02,0,1,-.02,0,0,.02,0,1,-.02,0,1,.02,0,
    ]));
    expect(geometry.colors).toEqual(Float32Array.from(Array.from({length:12},()=>[128/255,64/255,32/255,.5]).flat()));
  });
  it('interpolates scalar colors at clipped endpoints',()=>{
    const registry=source([-2,2],[0,0],undefined,[0,1]);
    const spec=layer('line',{color:'color'});spec.style={colormap:'viridis',colorDomain:[0,1]};
    const plan=planLine(registry.get('x').values,registry.get('y').values,query);
    const clipped=buildGeometry(spec,registry,query.bounds,[0,1],defaultView(),100,100,plan);
    const fullBounds={x:[-2,2] as [number,number],y:[-1,1] as [number,number]};
    const full=buildGeometry(spec,registry,fullBounds,[0,1],defaultView(),100,100,plan);
    for(let channel=0;channel<4;channel++){
      const start=full.colors[channel],end=full.colors[8+channel];
      expect(clipped.colors[channel]).toBeCloseTo(start+(end-start)*.25,6);
      expect(clipped.colors[8+channel]).toBeCloseTo(start+(end-start)*.75,6);
    }
    expect(clipped.positions[0]).toBe(-1);expect(clipped.positions[6]).toBe(1);
  });
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
