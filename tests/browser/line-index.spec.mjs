import {test,expect} from '@playwright/test';

test('real worker indexes preserve exact rolling lines and frozen sample ownership through eviction',async({page})=>{
  const errors=[],workers=[];page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>workers.push(worker.url()));
  await page.goto('/tests/browser/harness.html');
  try{
    const prepared=await page.evaluate(async()=>{
      const vs=await import('/packages/core/dist/index.js'),count=8192,curve=(x,series)=>Math.sin(x*.03)+series*3;
      const initialX=Float64Array.from({length:count},(_,i)=>i),initialY=Array.from({length:3},(_,series)=>Float64Array.from(initialX,x=>curve(x,series)));
      const fig=vs.figure({width:640,height:420}),layers=initialY.map((y,series)=>fig.plot(initialX,y,{label:`Series ${series}`,width:2}).enableStreaming({maxPoints:count}));
      fig.setView({yDomain:[-1,7]});fig.mount(document.querySelector('#chart'));await fig.ready();
      const scheduler=fig.view.scheduler,inputs=[],parity=[];
      const comparePlans=()=>{
        const panel=fig.view.panels[0],source=fig.view.committedFigure,query={bounds:panel.bounds,width:Math.round(panel.rect.width),height:Math.round(panel.rect.height),xScale:panel.view.xScale,yScale:panel.view.yScale,pointBudget:250000,mode:'auto'};
        const plain=plan=>({kind:plan.kind,segments:plan.segments.map(segment=>Array.from(segment)),info:plan.info});
        for(const layer of layers){
          const entry=source.spec.layers.find(item=>item.id===layer.id),x=source.registry.get(entry.data.x).values,y=source.registry.get(entry.data.y).values;
          const actual=plain(fig.view.plans.get(layer.id)),expected=plain(vs.planLine(x,y,query));
          if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`Worker line plan differs from direct planner: ${layer.id}`);
        }
        return layers.length;
      };
      parity.push(comparePlans());const cold=fig.diagnostics();
      let next=count;
      for(let batch=0;batch<2;batch++){
        const x=Float64Array.from({length:512},(_,i)=>next+i),ys=layers.map((_,series)=>Float64Array.from(x,value=>curve(value,series)));inputs.push(x,...ys);
        await fig.appendDataBatch(layers.map((layer,series)=>({layer,data:{x,y:ys[series]}})));next+=x.length;parity.push(comparePlans());
      }
      const warm=fig.diagnostics(),layer=layers[2],indices=fig.view.plans.get(layer.id).segments[0],index=indices[Math.floor(indices.length/2)],source=fig.view.committedFigure;
      const x=source.registry.get(layer.spec.data.x).values[index],y=source.registry.get(layer.spec.data.y).values[index],panel=fig.view.panels[0],rect=fig.view.overlay.getBoundingClientRect();
      window.lineIndexFixture={vs,fig,layers,scheduler,initialX,initialY,inputs,curve,count,next,comparePlans,parity};
      return {cold,warm,layerId:layer.id,location:{x:rect.left+panel.rect.left+vs.normalize(x,panel.bounds.x,panel.view.xScale)*panel.rect.width,y:rect.top+panel.rect.top+(1-vs.normalize(y,panel.bounds.y,panel.view.yScale))*panel.rect.height}};
    });
    expect(prepared.cold.worker).toBe(true);expect(prepared.cold.lineIndex.worker.builds).toBeGreaterThan(0);
    expect(prepared.warm.lineIndex.worker.hits).toBeGreaterThan(prepared.cold.lineIndex.worker.hits);
    expect(prepared.warm.lineIndex.worker.indexBytes).toBeGreaterThan(0);expect(prepared.warm.lineIndex.worker.retainedBytes).toBeGreaterThan(0);
    expect(prepared.warm.lineIndex.worker.indexBytes+prepared.warm.lineIndex.worker.retainedBytes).toBeLessThanOrEqual(8*1024*1024);
    expect(prepared.warm.lineIndex.fallback).toMatchObject({indexBytes:0,retainedBytes:0,builds:0,hits:0});
    await page.mouse.click(prepared.location.x,prepared.location.y);
    const result=await page.evaluate(async()=>{
      const {vs,fig,layers,scheduler,initialX,initialY,inputs,curve,count,comparePlans,parity}=window.lineIndexFixture;
      const selected=fig.getInspectionSelection();if(!selected||selected.layerId!==layers[2].id)throw new Error('Rendered indexed line did not select the expected series');
      if(selected.y!==curve(selected.x,2)||selected.sequence!==selected.x)throw new Error('Selected indexed sample does not identify its original value');
      const frozen=fig.freezeInspection(),shownBefore=layers.map(layer=>fig.getDisplayedStreamingState(layer.id));
      initialX.fill(-999);for(const y of initialY)y.fill(999);for(const input of inputs)input.fill(888);
      const x=Float64Array.from({length:count+256},(_,i)=>window.lineIndexFixture.next+i),ys=layers.map((_,series)=>Float64Array.from(x,value=>curve(value,series)));
      await fig.appendDataBatch(layers.map((layer,series)=>({layer,data:{x,y:ys[series]}})),{waitFor:'accepted'});
      const expectedNext=window.lineIndexFixture.next+x.length;x.fill(-777);for(const y of ys)y.fill(777);
      parity.push(comparePlans());
      const held=fig.getInspectionState(),selectedHeld=fig.getInspectionSelection(),live=layers.map(layer=>fig.getStreamingState(layer.id)),shownHeld=layers.map(layer=>fig.getDisplayedStreamingState(layer.id));
      const payload=JSON.parse(new DOMParser().parseFromString(vs.toHTML(fig,{source:'displayed'}),'text/html').querySelector('#vesora-payload').textContent);
      const values=id=>{const encoded=payload.buffers.find(buffer=>buffer.id===id).base64,bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new Float64Array(bytes.buffer);};
      const exportedRanges=layers.map((layer,series)=>{
        const saved=payload.snapshot.figure.layers.find(item=>item.id===layer.id),x=values(saved.data.x),y=values(saved.data.y);
        if(x.length!==count||y.length!==count)throw new Error('Frozen export retained length changed');
        for(let i=0;i<count;i++)if(x[i]!==1024+i||y[i]!==curve(x[i],series))throw new Error('Frozen export was changed by caller input mutation or accepted eviction');
        return [x[0],x[count-1]];
      });
      await fig.resumeLive();parity.push(comparePlans());
      const resumed=fig.getInspectionState(),afterResume=fig.diagnostics(),resumedRanges=layers.map(layer=>{
        const source=fig.view.committedFigure,entry=source.spec.layers.find(item=>item.id===layer.id),values=source.registry.get(entry.data.x).values;return [values[0],values.at(-1),values.length];
      });
      // Resume releases snapshot ownership; the bounded live index remains useful
      // until the figure closes, when both worker and fallback ownership must end.
      fig.close();return {selected,selectedHeld,frozen,held,shownBefore,shownHeld,live,exportedSelection:payload.snapshot.figure.inspection.selection,exportedCapture:payload.capture,exportedRanges,resumed,afterResume,resumedRanges,expectedNext,parity,closed:scheduler.stats,sourceBytes:fig.diagnostics().sourceBytes,canvases:document.querySelectorAll('#chart canvas').length};
    });
    expect(result.parity).toEqual([3,3,3,3,3]);expect(result.selectedHeld).toEqual(result.selected);expect(result.exportedSelection).toEqual(result.selected);
    expect(result.held.snapshotId).toBe(result.frozen.snapshotId);expect(result.exportedCapture.snapshotId).toBe(result.frozen.snapshotId);
    expect(result.shownHeld).toEqual(result.shownBefore);expect(result.exportedRanges).toEqual([[1024,9215],[1024,9215],[1024,9215]]);
    for(const state of result.live){expect(state).toMatchObject({retained:8192,nextSequence:result.expectedNext,evicted:result.expectedNext-8192});expect(state.evicted).toBeGreaterThan(result.selected.x);}
    expect(result.resumed.mode).toBe('live');expect(result.resumed.displayedRevision).toBe(result.resumed.acceptedRevision);expect(result.afterResume.snapshotBytes).toBe(0);
    expect(result.resumedRanges).toEqual(Array.from({length:3},()=>[result.expectedNext-8192,result.expectedNext-1,8192]));
    expect(result.closed).toMatchObject({worker:false,workerSourceBytes:0,cacheBytes:0,cacheEntries:0,pending:0,lineIndex:{worker:{indexBytes:0,retainedBytes:0},fallback:{indexBytes:0,retainedBytes:0}}});
    expect(result.sourceBytes).toBe(0);expect(result.canvases).toBe(0);expect(workers.some(url=>url.endsWith('/worker.js'))).toBe(true);expect(errors).toEqual([]);
  }finally{await page.evaluate(()=>window.lineIndexFixture?.fig.close()).catch(()=>{});}
});
