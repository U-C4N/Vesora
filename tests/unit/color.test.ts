import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {colorMap} from '../../packages/core/src/color';

function listed(name:string):number[][]{
  const text=readFileSync(new URL('../../artifacts/v11/_cm_listed.py',import.meta.url),'utf8');
  const start=text.indexOf(`_${name}_data = `),end=text.indexOf(']]',start)+2;
  return [...text.slice(start,end).matchAll(/\[([0-9][^\]]*)\]/g)].map(match=>match[1].split(',').map(Number));
}
function coolwarm():number[][]{
  const text=readFileSync(new URL('../../artifacts/v11/_cm.py',import.meta.url),'utf8');
  const block=text.slice(text.indexOf('_coolwarm_data = {'),text.indexOf('# Implementation of Carey'));
  const channel=(name:string)=>{
    const body=block.slice(block.indexOf(`'${name}': [`),block.indexOf(']',block.indexOf(`'${name}': [`)));
    return [...body.matchAll(/\(([^)]+)\)/g)].map(match=>Number(match[1].split(',')[1]));
  };
  const [red,green,blue]=['red','green','blue'].map(channel);
  return red.map((value,i)=>[value,green[i],blue[i]]);
}

describe('published colormap control points',()=>{
  it.each(['viridis','magma'] as const)('samples the Matplotlib %s stops',name=>{
    const stops=listed(name);
    expect(stops).toHaveLength(256);
    for(let i=0;i<stops.length;i++){
      const color=colorMap(i/255,[0,1],name);
      expect(color.slice(0,3)).toEqual(stops[i]);
      expect(color[3]).toBe(1);
      expect(color).not.toBe(colorMap(i/255,[0,1],name));
    }
  });
  it('samples the Matplotlib coolwarm knots, including an in-range negative',()=>{
    const stops=coolwarm();
    expect(stops).toHaveLength(33);
    stops.forEach((stop,i)=>expect(colorMap(-1+2*i/32,[-1,1],'coolwarm').slice(0,3)).toEqual(stop));
    const value=-0.1,t=(value+1)/2,position=t*32,index=Math.floor(position),blend=position-index;
    expect(value).toBeLessThan(0);
    expect(colorMap(value,[-1,1],'coolwarm')[0]).toBeCloseTo(stops[index][0]+(stops[index+1][0]-stops[index][0])*blend,12);
  });
  it('uses linear interpolation on a log-spaced domain',()=>{
    const stops=listed('viridis'),linear=(10-1)/(1000-1),logarithmic=Math.log10(10)/Math.log10(1000);
    expect(colorMap(10,[1,1000],'viridis').slice(0,3)).toEqual(colorMap(linear,[0,1],'viridis').slice(0,3));
    const position=linear*255,index=Math.floor(position),blend=position-index;
    expect(colorMap(10,[1,1000],'viridis')[0]).toBeCloseTo(stops[index][0]+(stops[index+1][0]-stops[index][0])*blend,12);
    expect(colorMap(10,[1,1000],'viridis')[0]).not.toBeCloseTo(colorMap(logarithmic,[0,1],'viridis')[0],6);
  });
  it('applies explicit under, over, and bad colors and rejects unit conversion',()=>{
    expect(colorMap(-2,[0,1],'viridis')).toEqual(colorMap(0,[0,1],'viridis'));
    expect(colorMap(-2,[0,1],'coolwarm',{under:[0,0,1]})).toEqual([0,0,1,1]);
    expect(colorMap(2,[0,1],'magma',{over:'#fff'})).toEqual([1,1,1,1]);
    expect(colorMap(Number.NaN,[0,1],'viridis',{bad:[0,0,0,0.25]})).toEqual([0,0,0,0.25]);
    expect(()=>colorMap(Number.NaN,[0,1],'viridis')).toThrow(RangeError);
    expect(()=>colorMap(0,[0,1],'viridis',{under:[255,0,0]})).toThrow(TypeError);
    expect(colorMap(5,[5,5],'magma')).toEqual(colorMap(0.5,[0,1],'magma'));
  });
});
