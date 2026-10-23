import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test.beforeEach(async({page})=>{await page.goto('/tests/browser/harness.html');await page.evaluate(async()=>{window.vs=await import('/packages/core/dist/index.js');});});

test('observation binds committed metadata and streams while accepted data advances',async({page})=>{
  const result=await page.evaluate(async()=>{
    const fig=vs.figure(),line=fig.plot([0,1,2],[10,11,12]).enableStreaming({maxPoints:3});
    line.setSemantics({x:{quantity:'time',unit:'s'},y:{quantity:'temperature',unit:'K'}});
    fig.mount(document.querySelector('#chart'));await fig.ready();const frozen=fig.freezeInspection();
    await line.appendData({x:[3,4,5,6],y:[13,14,15,16]},{waitFor:'accepted'});line.setSemantics({y:{quantity:'temperature',unit:'degC'}});
    const read=source=>JSON.parse(new DOMParser().parseFromString(vs.toHTML(fig,{source,observation:true}),'text/html').querySelector('#vesora-payload').textContent);
    const shown=read('displayed'),accepted=read('accepted');
    fig.setInspectionView('main',{xDomain:[.5,1.5]});const pending=read('displayed');await fig.ready({target:'displayed'});const committed=read('displayed');
    const reserved=fig.diagnostics().snapshotBytes;await fig.resumeLive();const resumed=read('displayed'),released=fig.diagnostics().snapshotBytes;fig.close();
    return {shown,accepted,pending,committed,resumed,frozen,reserved,released,y:line.id};
  });
  const observation=value=>value.snapshot.figure.observation;
  expect(observation(result.shown)).toMatchObject({source:'displayed',streams:[{sequenceStart:0,sequenceEndExclusive:3}],representation:{status:'rendered',frameId:result.frozen.frameId,snapshotId:result.frozen.snapshotId,layers:[{total:3}]}});
  expect(observation(result.accepted)).toMatchObject({source:'accepted',streams:[{sequenceStart:4,sequenceEndExclusive:7}],representation:{status:'not-evaluated'}});
  const unit=value=>value.snapshot.figure.semantics.sources[value.snapshot.figure.layers[0].data.y].unit;
  expect(unit(result.shown)).toBe('K');expect(unit(result.accepted)).toBe('degC');
  expect(result.pending.snapshot.figure.view).toEqual(result.shown.snapshot.figure.view);
  expect(observation(result.pending).representation.frameId).toBe(observation(result.shown).representation.frameId);
  expect(result.committed.snapshot.figure.view.xDomain).toEqual([.5,1.5]);
  expect(observation(result.committed).representation.frameId).toBeGreaterThan(observation(result.pending).representation.frameId);
  expect(unit(result.resumed)).toBe('degC');expect(observation(result.resumed).streams[0].sequenceStart).toBe(4);
  for(const value of [result.shown,result.accepted,result.committed,result.resumed])expect(observation(value).sourceVersions).toEqual(value.snapshot.sources.map(({id,version})=>({id,version})));
  expect(result.reserved).toBeGreaterThan(0);expect(result.released).toBe(0);
});

test('imported observation survives mounting and invalidates only the mutated frozen scene',async({page})=>{
  const result=await page.evaluate(async()=>{
    const original=vs.figure();original.scatter([0,1,2],[2,1,3]).setSemantics({y:{unit:'K'}});
    const payload=JSON.parse(new DOMParser().parseFromString(vs.toHTML(original,{observation:true}),'text/html').querySelector('#vesora-payload').textContent);
    const fig=vs.figure();fig.applySnapshot(payload.snapshot,new Map(payload.buffers.map(({id,base64})=>[id,Uint8Array.from(atob(base64),c=>c.charCodeAt(0)).buffer])));original.close();
    const imported=fig.getObservation();fig.mount(document.querySelector('#chart'));await fig.ready();const mounted=fig.getObservation(),shown=fig.getInspectionSnapshot().figure.observation;
    fig.freezeInspection();fig.setInspectionView('main',{xDomain:[0,1]});await fig.ready({target:'displayed'});
    const edited=fig.getInspectionSnapshot().figure.observation,live=fig.getObservation();await fig.resumeLive();
    fig.setTitle('A new observation');const invalidated=fig.getObservation();fig.close();return {imported,mounted,shown,edited,live,invalidated};
  });
  expect(result.imported).toBeTruthy();expect(result.mounted).toEqual(result.imported);expect(result.shown).toEqual(result.imported);
  expect(result.edited).toBeUndefined();expect(result.live).toEqual(result.imported);expect(result.invalidated).toBeUndefined();
});

test('rendered 3D observation describes segments and excludes isolated samples',async({page})=>{
  const result=await page.evaluate(async()=>{
    const fig=vs.figure({kind:'3d'});fig.plot3d([0,1,2,3,4,5],[0,1,2,3,4,5],[0,1,NaN,3,NaN,5]);
    fig.mount(document.querySelector('#chart'));await fig.ready();
    const payload=JSON.parse(new DOMParser().parseFromString(vs.toHTML(fig,{source:'displayed',observation:true}),'text/html').querySelector('#vesora-payload').textContent);
    fig.close();return payload.snapshot.figure.observation.representation.layers[0];
  });
  expect(result).toMatchObject({kind:'line',total:6,visible:2,rendered:2,omitted:4,exact:true});
});

test('Python observation HTML opens offline in the shared viewer with declared semantics',async({page,context},testInfo)=>{
  const root=process.cwd(),python=process.env.VESORA_PYTHON??(existsSync(resolve(root,'.venv/Scripts/python.exe'))?resolve(root,'.venv/Scripts/python.exe'):'python');
  const path=testInfo.outputPath('python-observation.html');await mkdir(dirname(path),{recursive:true});
  const code=`import sys\nimport vesora as vs\nf=vs.figure(title='Observed temperature',width=640,height=420)\nl=f.plot([0,1,2],[270,271,272]).enable_streaming(max_points=3)\nl.set_semantics({'x':{'quantity':'time','unit':'s'},'y':{'quantity':'temperature','unit':'K','origin':{'datasetId':'lab-42','field':'temperature'}}})\nl.append_data(x=[3,4],y=[273,274])\nf.save_html(sys.argv[1],observation=True)\nf.close()\n`;
  execFileSync(python,['-c',code,path],{cwd:root,env:{...process.env,PYTHONPATH:resolve(root,'python')},encoding:'utf8',windowsHide:true});
  const html=await readFile(path,'utf8'),payload=JSON.parse(html.match(/<script[^>]*id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
  expect(payload.snapshot.figure.observation).toMatchObject({source:'accepted',streams:[{sequenceStart:2,sequenceEndExclusive:5}],representation:{status:'not-evaluated'}});
  const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url());});
  await context.setOffline(true);await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  await expect(page.getByRole('heading',{name:'Observed temperature',exact:true})).toBeVisible();
  expect(errors).toEqual([]);expect(requests).toEqual([]);
});
