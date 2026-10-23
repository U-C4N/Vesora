import {describe,expect,it} from 'vitest';
import {createBalance,inspectBalance,stepBalance,transferBalance} from '../../packages/core/src/balance';
import type {BalanceCategory,BalanceState} from '../../packages/core/src/balance';

const categories:BalanceCategory[]=[{id:'a',label:'A',volume:80},{id:'b',label:'B',volume:20},{id:'c',label:'C',volume:0}];
const values=(state:BalanceState)=>state.categories.map(category=>category.volume);
describe('conservative Balance model',()=>{
  it('maps one quantity to equal-area height, gauge pressure, share and gravitational energy',()=>{
    const state=createBalance(categories),rows=inspectBalance(state);
    expect(rows[0]).toMatchObject({volume:80,share:.8,height:.08});expect(rows[0].pressure).toBeCloseTo(784.8,12);
    expect(state.energy).toBeCloseTo(.5*1000*9.81*(.08**2+.02**2),12);
    expect(state.total).toBe(100);expect(state.elapsed).toBe(0);
  });
  it('owns immutable state and returns detached readouts without mutating caller input',()=>{
    const original=structuredClone(categories),state=createBalance(original);original[0].volume=500;
    const rows=inspectBalance(state);rows[0]={...rows[0],volume:900};
    expect(state.categories[0].volume).toBe(80);expect(Object.isFrozen(state)).toBe(true);expect(Object.isFrozen(state.categories[0])).toBe(true);
  });
  it('preserves dimensional scaling when vessel area or quantity-to-volume mapping changes',()=>{
    const base=createBalance(categories),wide=createBalance(categories,{area:4}),mapped=createBalance(categories,{volumeScale:.002});
    expect(inspectBalance(wide)[0].height).toBeCloseTo(inspectBalance(base)[0].height/4,12);
    expect(inspectBalance(wide)[0].pressure).toBeCloseTo(inspectBalance(base)[0].pressure/4,12);
    expect(wide.energy).toBeCloseTo(base.energy/4,12);
    expect(inspectBalance(mapped)[0].height).toBeCloseTo(inspectBalance(base)[0].height*2,12);
    expect(inspectBalance(mapped)[0].pressure).toBeCloseTo(inspectBalance(base)[0].pressure*2,12);
    expect(mapped.energy).toBeCloseTo(base.energy*4,12);
    const valve={from:'a',to:'b'};
    expect(values(stepBalance(wide,valve,4).state)).toEqual(values(stepBalance(base,valve,1).state));
    expect(values(stepBalance(mapped,valve,1).state)).toEqual(values(stepBalance(base,valve,1).state));
  });
  it('matches the closed form and dissipates energy while preserving total and disconnected categories',()=>{
    const initial=createBalance(categories),next=stepBalance(initial,{from:'a',to:'b'},.7),rate=.00005*1000*9.81;
    const difference=60*Math.exp(-2*rate*.7);
    expect(values(next.state)[0]).toBeCloseTo(50+difference/2,12);expect(values(next.state)[1]).toBeCloseTo(50-difference/2,12);
    expect(values(next.state)[2]).toBe(0);expect(next.state.total).toBe(100);expect(next.state.elapsed).toBe(.7);
    expect(next.transferred).toBeGreaterThan(0);expect(next.flowRate).toBeCloseTo(next.transferred/.7,12);
    expect(next.dissipatedEnergy).toBeCloseTo(initial.energy-next.state.energy,12);expect(next.externalWork).toBe(0);
    expect(values(initial)).toEqual([80,20,0]);
  });
  it('is timestep-independent, direction symmetric, and cannot overshoot equilibrium at large time',()=>{
    const initial=createBalance(categories),whole=stepBalance(initial,{from:'a',to:'b'},1).state;
    let partitioned=initial;for(let i=0;i<100;i++)partitioned=stepBalance(partitioned,{from:'a',to:'b'},.01).state;
    values(whole).forEach((volume,index)=>expect(values(partitioned)[index]).toBeCloseTo(volume,11));
    const reverse=stepBalance(initial,{from:'b',to:'a'},1);expect(values(reverse.state)).toEqual(values(whole));expect(reverse.transferred).toBeLessThan(0);
    expect(values(stepBalance(initial,{from:'a',to:'b'},1e300).state)).toEqual([50,50,0]);
  });
  it('keeps zero steps, closed valves, zero conductance and zero-total states stationary',()=>{
    const initial=createBalance(categories);
    expect(values(stepBalance(initial,{from:'a',to:'b'},0).state)).toEqual(values(initial));
    expect(values(stepBalance(initial,{from:'a',to:'b',openness:0},100).state)).toEqual(values(initial));
    expect(values(stepBalance(createBalance(categories,{conductance:0}),{from:'a',to:'b'},100).state)).toEqual(values(initial));
    const zero=createBalance(categories.map(category=>({...category,volume:0})));
    expect(inspectBalance(zero).map(row=>row.share)).toEqual([0,0,0]);expect(stepBalance(zero,{from:'a',to:'b'},10).state.energy).toBe(0);
    const differentScales=createBalance(categories.map((category,index)=>({...category,volume:[1e10,1e-20,1][index]})));
    expect(values(stepBalance(differentScales,{from:'a',to:'b'},0).state)).toEqual(values(differentScales));
    expect(values(transferBalance(differentScales,'a','b',0).state)).toEqual(values(differentScales));
  });
  it('limits manual redistribution to available quantity and labels uphill work separately',()=>{
    const initial=createBalance(categories),uphill=transferBalance(initial,'b','a',1000);
    expect(values(uphill.state)).toEqual([100,0,0]);expect(uphill.transferred).toBe(20);expect(uphill.mode).toBe('manual');
    expect(uphill.dissipatedEnergy).toBe(0);expect(uphill.externalWork).toBeGreaterThan(0);expect(uphill.state.elapsed).toBe(0);
    expect(values(transferBalance(uphill.state,'b','c',10).state)).toEqual([100,0,0]);
  });
  it('preserves nonnegativity, total and passive energy monotonicity across changing valve pairs',()=>{
    let state=createBalance([{id:'a',label:'A',volume:71.125},{id:'b',label:'B',volume:13.75},{id:'c',label:'C',volume:5.125},{id:'d',label:'D',volume:10}]);
    for(let i=0;i<3000;i++){
      const from=state.categories[i%4].id,to=state.categories[(i+1)%4].id,before=state.energy;
      state=stepBalance(state,{from,to,openness:(i%10)/10},(i%7)/10).state;
      expect(state.energy).toBeLessThanOrEqual(before+1e-12);expect(values(state).every(value=>value>=0)).toBe(true);
      expect(values(state).reduce((a,b)=>a+b,0)).toBeCloseTo(100,11);
    }
  });
  it.each([NaN,Infinity,-1])('rejects invalid quantities and time atomically (%s)',invalid=>{
    expect(()=>createBalance([{...categories[0],volume:invalid},...categories.slice(1)])).toThrow();
    const initial=createBalance(categories);expect(()=>stepBalance(initial,{from:'a',to:'b'},invalid)).toThrow();
    expect(()=>transferBalance(initial,'a','b',invalid)).toThrow();expect(values(initial)).toEqual([80,20,0]);
  });
  it('rejects duplicate IDs, category limits, unknown endpoints, invalid physics and numeric overflow',()=>{
    expect(()=>createBalance(categories.slice(0,2))).toThrow();expect(()=>createBalance(Array(9).fill(categories[0]))).toThrow();
    expect(()=>createBalance([categories[0],categories[0],categories[2]])).toThrow();
    for(const options of [{area:0},{density:-1},{volumeScale:Infinity},{conductance:-1},{gravity:0},{density:1e308,gravity:1e308}])expect(()=>createBalance(categories,options)).toThrow();
    expect(()=>createBalance(categories.map(category=>({...category,volume:1e308})))).toThrow();
    const initial=createBalance(categories);
    expect(()=>stepBalance(initial,{from:'a',to:'missing'},1)).toThrow();expect(()=>stepBalance(initial,{from:'a',to:'a'},1)).toThrow();
    expect(()=>stepBalance(initial,{from:'a',to:'b',openness:1.01},1)).toThrow();
    expect(()=>stepBalance(initial,{from:'a',to:'b',openness:null as never},1)).toThrow();
    expect(()=>inspectBalance({...initial,total:1})).toThrow();
  });
});
