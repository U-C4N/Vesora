import {test,expect} from '@playwright/test';

test('real worker scatter index preserves zoom plans and source replacements within a bounded cache',async({page})=>{
  const errors=[],workers=[];page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>workers.push(worker.url()));
  await page.goto('/tests/browser/harness.html');
  try{
    const result=await page.evaluate(async()=>{
      const vs=await import('/packages/core/dist/index.js'),count=100000;let state=12345;
      const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32);
      const x=Float64Array.from({length:count},()=>random()*100),y=Float64Array.from({length:count},()=>random()*100);
      const fig=vs.figure({width:640,height:420}),layer=fig.scatter(x,y,{representation:'density'});
      window.scatterIndexFixture={fig,layer};fig.setView({xDomain:[0,100],yDomain:[0,100]});fig.mount(document.querySelector('#chart'));await fig.ready();
      const compare=()=>{
        const panel=fig.view.panels[0],source=fig.view.committedFigure,spec=source.spec.layers.find(item=>item.id===layer.id);
        const query={bounds:panel.bounds,width:Math.round(panel.rect.width),height:Math.round(panel.rect.height),xScale:panel.view.xScale,yScale:panel.view.yScale,pointBudget:250000,mode:'density'};
        const actual=fig.view.plans.get(layer.id),expected=vs.planScatter(source.registry.get(spec.data.x).values,source.registry.get(spec.data.y).values,query);
        if(actual.kind!==expected.kind||JSON.stringify(actual.info)!==JSON.stringify(expected.info)||actual.max!==expected.max||actual.columns!==expected.columns||actual.rows!==expected.rows||actual.counts.some((value,index)=>value!==expected.counts[index]))throw new Error('Indexed scatter result differs from the direct exact planner');
        return actual.info.visible;
      };
      const parity=[compare()],initial=fig.diagnostics();
      fig.setView({xDomain:[35,45],yDomain:[55,65]});await fig.ready();parity.push(compare());
      fig.setView({xDomain:[37,47],yDomain:[57,67]});await fig.ready();parity.push(compare());const warm=fig.diagnostics();
      layer.setData({y:Float64Array.from(y,value=>value+10)});await fig.ready();parity.push(compare());const replacement=fig.diagnostics();
      fig.setView({xDomain:[38,48],yDomain:[58,68]});await fig.ready();parity.push(compare());const rebuilt=fig.diagnostics();
      layer.remove();await fig.ready();return {initial,warm,replacement,rebuilt,parity};
    });
    expect(result.initial.worker).toBe(true);expect(result.warm.scatterIndex.worker.builds).toBeGreaterThan(0);
    expect(result.warm.scatterIndex.worker.warmQueries).toBeGreaterThan(0);expect(result.warm.scatterIndex.worker.lastCandidateRows).toBeLessThan(10000);
    expect(result.warm.scatterIndex.worker.indexBytes).toBeGreaterThan(0);expect(result.warm.scatterIndex.worker.indexBytes).toBeLessThanOrEqual(result.warm.scatterIndex.worker.maximumBytes);
    expect(result.warm.scatterIndex.worker.retainedBytes).toBe(0);expect(result.warm.scatterIndex.fallback.indexBytes).toBe(0);
    expect(result.rebuilt.scatterIndex.worker.builds).toBeGreaterThan(result.warm.scatterIndex.worker.builds);expect(result.parity).toHaveLength(5);
    await page.waitForFunction(()=>window.scatterIndexFixture.fig.diagnostics().scatterIndex.worker.indexBytes===0);
    const closed=await page.evaluate(()=>{const {fig}=window.scatterIndexFixture,scheduler=fig.view.scheduler;fig.close();return scheduler.stats;});
    expect(closed).toMatchObject({worker:false,workerSourceBytes:0,pending:0,scatterIndex:{worker:{indexBytes:0,retainedBytes:0},fallback:{indexBytes:0,retainedBytes:0}}});
    expect(workers.some(url=>url.endsWith('/worker.js'))).toBe(true);expect(errors).toEqual([]);
  }finally{await page.evaluate(()=>window.scatterIndexFixture?.fig.close()).catch(()=>{});}
});
