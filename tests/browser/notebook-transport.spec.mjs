import {test,expect} from '@playwright/test';

async function notebook(page,transportVersion=3){
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async version=>{
    const {figure}=await import('/packages/core/dist/index.js');
    const source=figure({title:'Notebook transport ownership',width:600,height:360});
    const line=source.plot([0,1,2],[1,3,2]).enableStreaming({maxPoints:5});
    const snapshot=source.snapshot(),buffers=snapshot.sources.map(item=>source.registry.get(item.id).values.slice().buffer);
    const streams={[line.id]:source.getStreamingState(line.id)};
    source.close();
    const bundle=await (await fetch('/python/vesora/_assets/notebook.js')).text();
    const hook='const fig = figure();';
    if(bundle.split(hook).length!==2)throw new Error('Expected one notebook Figure construction hook');
    // Observe the real bundled Figure without replacing the transport, renderer,
    // worker or viewer. Tests control only notification timing below.
    const url=URL.createObjectURL(new Blob([bundle.replace(hook,`${hook}\nglobalThis.notebookFigure=fig;`)],{type:'text/javascript'}));
    const {render}=await import(url),listeners=new Map(),messages=[],ownedEvents=[];
    let acknowledged,registered,dispose;
    const model={get:key=>key==='buffers'?[]:undefined,
      on:(event,callback)=>{const callbacks=listeners.get(event)??new Set();callbacks.add(callback);listeners.set(event,callbacks);},
      off:(event,callback)=>listeners.get(event)?.delete(callback),
      send:message=>{
        messages.push(structuredClone({...message,observedFrameId:window.notebookFigure.getInspectionState().frameId}));
        if(message.type==='ack')acknowledged=message.revision;
        // Match the host's ACK-before-registration rule. An early frame must be
        // sent again once the ACK is visible to the receiving comm endpoint.
        if(message.type==='frame'&&acknowledged!==undefined&&message.revision<=acknowledged)registered=message;
        if(message.type==='event'&&['selection','click','viewchange'].includes(message.event))ownedEvents.push({event:message.event,
          registered:!!registered&&registered.revision===message.revision&&registered.frameId===message.frameId&&registered.snapshotId===message.snapshotId});
      }};
    const receive=(message,parts=[])=>Promise.all([...listeners.get('msg:custom')??[]].map(callback=>callback(message,parts)));
    const sendSnapshot=(revision=10,protocol=version)=>receive({type:'stream-snapshot',transportVersion:protocol,transferId:`snapshot-${revision}`,
      revision,snapshot,streams,bufferLengths:buffers.map(part=>part.byteLength)},buffers);
    const sendAppend=(revision,protocol=version)=>{
      const layer=notebookFigure.spec.layers[0],state=notebookFigure.getStreamingState(layer.id);
      const parts=[new Float64Array([state.nextSequence]).buffer,new Float64Array([4]).buffer];
      const update={layerId:layer.id,state,channels:['x','y'].map((channel,index)=>{
        const descriptor=notebookFigure.registry.get(layer.data[channel]).descriptor;
        return {channel,sourceId:descriptor.id,baseVersion:descriptor.version,
          descriptor:{...descriptor,version:descriptor.version+1,shape:[1],byteLength:8},bufferIndex:index};
      })};
      return receive({type:'stream-delta',transportVersion:protocol,transferId:`append-${revision}`,revision,baseRevision:revision-1,
        bufferLengths:parts.map(part=>part.byteLength),...(protocol===3?{transactions:[{revision,updates:[update]}]}:{updates:[update]})},parts);
    };
    window.notebookTest={messages,ownedEvents,sendSnapshot,sendAppend,
      close:()=>{dispose();URL.revokeObjectURL(url);return [...listeners.values()].reduce((sum,callbacks)=>sum+callbacks.size,0);}};
    dispose=render({model,el:document.querySelector('#chart')});
    await sendSnapshot();await notebookFigure.ready();
  },transportVersion);
}

test('notebook v3 re-registers a completed pre-ACK frame and suppresses only acknowledged duplicates',async({page})=>{
  await notebook(page);
  await page.evaluate(()=>{
    notebookTest.messages.length=0;
    const original=notebookFigure.appendDataBatch.bind(notebookFigure);
    notebookFigure.appendDataBatch=(...args)=>new Promise((resolve,reject)=>{
      original(...args).then(()=>notebookFigure.ready()).then(()=>{
        window.releaseAppend=()=>{
          notebookFigure.appendDataBatch=original;resolve();
          // The append continuation remembers its revision before this queued
          // notification, but its final ACK continuation has not run yet.
          queueMicrotask(()=>{
            notebookFigure.emit('frame',notebookFigure.getInspectionState());
            notebookFigure.emit('representation',notebookFigure.inspect());
          });
        };
      },reject);
    });
    window.pendingAppend=notebookTest.sendAppend(11);
  });
  await expect.poll(()=>page.evaluate(()=>typeof window.releaseAppend)).toBe('function');
  const result=await page.evaluate(async()=>{
    releaseAppend();await pendingAppend;
    const afterAppend=structuredClone(notebookTest.messages);
    notebookTest.messages.length=0;
    notebookFigure.emit('frame',notebookFigure.getInspectionState());
    notebookFigure.emit('frame',notebookFigure.getInspectionState());
    notebookFigure.emit('representation',notebookFigure.inspect());
    notebookFigure.emit('click',{layerId:notebookFigure.spec.layers[0].id,index:0,x:0,y:1});
    const repeated=structuredClone(notebookTest.messages),ownership=structuredClone(notebookTest.ownedEvents),worker=notebookFigure.diagnostics().worker;
    const listeners=notebookTest.close();return {afterAppend,repeated,ownership,worker,listeners};
  });
  const ack=result.afterAppend.findIndex(message=>message.type==='ack'&&message.revision===11);
  const frames=result.afterAppend.map((message,index)=>({message,index})).filter(({message})=>message.type==='frame'&&message.revision===11);
  expect(ack).toBeGreaterThan(-1);
  expect(frames.some(({index})=>index<ack)).toBe(true);
  expect(frames.filter(({index})=>index>ack)).toHaveLength(1);
  expect(new Set(frames.map(({message})=>message.frameId)).size).toBe(1);
  expect(result.afterAppend.some(message=>message.type==='event'&&message.event==='representation'&&message.revision===11)).toBe(true);
  expect(result.repeated.map(message=>[message.type,message.event])).toEqual([['event','representation'],['event','click']]);
  expect(result.ownership.at(-1)).toEqual({event:'click',registered:true});
  expect(result.worker).toBe(true);expect(result.listeners).toBe(0);
  await expect(page.locator('#chart canvas')).toHaveCount(0);
});

test('notebook v3 keeps frozen registration, mode/snapshot identity and replacement registration',async({page})=>{
  await notebook(page);
  const result=await page.evaluate(async()=>{
    notebookTest.messages.length=0;
    const live=notebookFigure.getInspectionState(),held=notebookFigure.freezeInspection();
    notebookFigure.emit('click',{layerId:notebookFigure.spec.layers[0].id,index:0,x:0,y:1});
    const freezeMessages=structuredClone(notebookTest.messages);
    notebookTest.messages.length=0;await notebookTest.sendAppend(11);
    const acceptedWhileHeld=structuredClone(notebookTest.messages);
    notebookTest.messages.length=0;await notebookTest.sendSnapshot(12);
    notebookFigure.emit('click',{layerId:notebookFigure.spec.layers[0].id,index:0,x:0,y:1});
    const replacement=structuredClone(notebookTest.messages);
    // A host-side re-registration may retain the completed frame number while
    // assigning a different inspection token. The token is part of identity.
    notebookTest.messages.length=0;
    const inspection=notebookFigure.getInspectionState.bind(notebookFigure);
    notebookFigure.getInspectionState=()=>({...inspection(),snapshotId:`${held.snapshotId}-replacement`});
    notebookFigure.emit('inspectionchange',notebookFigure.getInspectionState());
    notebookFigure.emit('frame',notebookFigure.getInspectionState());
    const replacedToken=structuredClone(notebookTest.messages);notebookFigure.getInspectionState=inspection;
    notebookTest.messages.length=0;
    const resume=notebookFigure.resumeLive(),immediateResume=structuredClone(notebookTest.messages);await resume;
    const resumed=structuredClone(notebookTest.messages),ownership=structuredClone(notebookTest.ownedEvents);
    notebookTest.close();return {live,held,freezeMessages,acceptedWhileHeld,replacement,replacedToken,immediateResume,resumed,ownership};
  });
  expect(result.held.frameId).toBe(result.live.frameId);
  expect(result.freezeMessages.filter(message=>message.type==='frame')).toHaveLength(1);
  expect(result.freezeMessages[0]).toMatchObject({type:'frame',revision:10,mode:'frozen',snapshotId:result.held.snapshotId,frameId:result.live.frameId});
  expect(result.acceptedWhileHeld.map(message=>message.type)).toEqual(['ack']);
  expect(result.replacement.slice(0,2)).toMatchObject([{type:'ack',revision:12},{type:'frame',revision:10,mode:'frozen',snapshotId:result.held.snapshotId}]);
  expect(result.replacedToken).toHaveLength(1);
  expect(result.replacedToken[0]).toMatchObject({type:'frame',revision:10,mode:'frozen',frameId:result.held.frameId,snapshotId:`${result.held.snapshotId}-replacement`});
  expect(result.immediateResume[0]).toMatchObject({type:'frame',revision:10,frameId:result.held.frameId,mode:'live'});
  expect(result.immediateResume[0].snapshotId).toBeUndefined();
  expect(result.resumed.some(message=>message.type==='frame'&&message.mode==='live'&&message.revision===12)).toBe(true);
  expect(result.ownership).toEqual([{event:'click',registered:true},{event:'click',registered:true}]);
});

test('notebook v2 retains rendered ACKs and representation events without frame packets',async({page})=>{
  await notebook(page,2);
  const result=await page.evaluate(async()=>{
    const initial=structuredClone(notebookTest.messages);notebookTest.messages.length=0;
    const before=notebookFigure.getInspectionState().frameId;await notebookTest.sendAppend(11,2);
    let freezeCode;try{notebookFigure.freezeInspection();}catch(error){freezeCode=error.code;}
    notebookFigure.emit('frame',notebookFigure.getInspectionState());
    const appended=structuredClone(notebookTest.messages),after=notebookFigure.getInspectionState().frameId;
    notebookTest.close();return {initial,appended,before,after,freezeCode};
  });
  expect(result.initial.find(message=>message.type==='ack').observedFrameId).toBeGreaterThan(0);
  expect(result.after).toBeGreaterThan(result.before);
  expect(result.appended.find(message=>message.type==='ack')).toMatchObject({revision:11,observedFrameId:result.after});
  expect([...result.initial,...result.appended].filter(message=>message.type==='frame')).toEqual([]);
  expect(result.appended.some(message=>message.type==='event'&&message.event==='representation')).toBe(true);
  expect(result.freezeCode).toBe('TRANSPORT_UNSUPPORTED');
});
