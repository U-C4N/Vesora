import {expect,it} from 'vitest';
import {chunkEntry,describeData,numericReader} from '../../packages/core/src/data';
import {runSteps,lineSteps,scatterSteps,planLine,planScatter} from '../../packages/core/src/planning';
import {Figure} from '../../packages/core/src/figure';
import {buildGeometry} from '../../packages/core/src/geometry';
import type {Query} from '../../packages/core/src/types';

const query:Query={bounds:{x:[3,10],y:[-2,2]},width:500,height:300,xScale:'linear',yScale:'linear',pointBudget:10000,mode:'auto'};
it('reads retained chunk boundaries and random indices without materializing the source',async()=>{
  const values=Float64Array.from({length:20},(_,i)=>i),entry=chunkEntry(describeData('x',values),[values.slice(0,3),values.slice(3,9),values.slice(9)]),reader=numericReader(entry);
  for(const at of [19,0,2,3,8,9,1,18])expect(reader.get(at)).toBe(values[at]);
  expect(entry.materializedByteLength).toBe(0);
  const y=Float64Array.from(values,v=>v===6?NaN:Math.sin(v)),ye=chunkEntry(describeData('y',y),[y.slice(0,7),y.slice(7)]);
  expect(await runSteps(lineSteps(entry,ye,query))).toEqual(planLine(values,y,query));
  expect(await runSteps(scatterSteps(entry,ye,query))).toEqual(planScatter(values,y,query));
  expect(entry.materializedByteLength).toBe(0);expect(ye.materializedByteLength).toBe(0);
});
it('constructs reduced streaming geometry without concatenating the full retained window',async()=>{
  const f=new Figure(),x=Float64Array.from({length:10000},(_,i)=>i),layer=f.plot(x,Float64Array.from(x,v=>Math.sin(v))).enableStreaming({maxPoints:10000});
  await layer.appendData({x:[10000],y:[0]},{waitFor:'accepted'});
  const xe=f.registry.get(layer.spec.data.x),ye=f.registry.get(layer.spec.data.y),plan=await runSteps(lineSteps(xe,ye,query,true));
  const geometry=buildGeometry(layer.spec,f.registry,query.bounds,[0,1],f.spec.view,500,300,plan);
  expect(geometry.positions.length).toBeGreaterThan(0);expect(xe.materializedByteLength).toBe(0);expect(ye.materializedByteLength).toBe(0);f.close();
});
