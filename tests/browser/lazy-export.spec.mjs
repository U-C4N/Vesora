import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

test('Studio loads its HTML template on demand, captures before loading, and exports offline',async({page,context},testInfo)=>{
  const requested=[],errors=[];
  page.on('request',request=>requested.push(request.url()));
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    window.core=await import('/packages/core/dist/runtime.js');
    const {mountViewer}=await import('/packages/core/dist/viewer.js');
    window.fig=core.figure({title:'Before load',width:640,height:420});
    window.line=fig.plot([1,2,3],[2,4,3]);line.setSemantics({y:{unit:'m'}});
    window.viewer=mountViewer(fig,document.querySelector('#chart'),{observation:true,exportSource:'accepted'});
    await fig.ready();
  });
  expect(requested.some(url=>url.includes('html-template')||url.endsWith('/index.js'))).toBe(false);
  let allowTemplate,templateRequested;
  const waiting=new Promise(resolve=>templateRequested=resolve),gate=new Promise(resolve=>allowTemplate=resolve);
  await page.route('**/packages/core/dist/html-template.js',async route=>{templateRequested();await gate;await route.continue();});
  const downloaded=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export HTML',exact:true}).click();
  await waiting;
  expect(await page.evaluate(()=>fig.diagnostics().snapshotBytes)).toBeGreaterThan(0);
  await page.evaluate(()=>{line.setData({x:[100],y:[200]});line.setSemantics({y:{unit:'mm'}});fig.spec.title='After load';});
  allowTemplate();
  const download=await downloaded,path=testInfo.outputPath('lazy-export.html');await mkdir(dirname(path),{recursive:true});await download.saveAs(path);
  const html=await readFile(path,'utf8'),payload=JSON.parse(html.match(/<script id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
  expect(payload.snapshot.figure.title).toBe('Before load');
  expect(payload.snapshot.sources.map(source=>source.shape[0])).toEqual([3,3]);
  expect(Object.values(payload.snapshot.figure.semantics.sources)).toContainEqual({unit:'m'});
  expect(payload.snapshot.figure.observation.source).toBe('accepted');
  expect(requested.filter(url=>url.endsWith('/html-template.js'))).toHaveLength(1);
  await expect.poll(()=>page.evaluate(()=>fig.diagnostics().snapshotBytes)).toBe(0);
  const identity=await page.evaluate(async()=>{
    const legacy=await import('/packages/core/dist/index.js'),labs=await import('/packages/core/dist/labs.js');
    const same=legacy.Figure===core.Figure&&legacy.Layer===core.Layer&&fig instanceof legacy.Figure;
    const sync=legacy.toHTML(fig);viewer.dispose();fig.close();return {same,sync:sync.includes('vesora-payload'),labs:typeof labs};
  });
  expect(identity).toEqual({same:true,sync:true,labs:'object'});
  await page.unroute('**/packages/core/dist/html-template.js');
  const external=[];page.on('request',request=>{if(/^https?:/.test(request.url()))external.push(request.url());});
  await context.route(/^https?:\/\//,route=>route.abort());await context.setOffline(true);
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready');
  expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('a failed template request releases its capture and reports an actionable viewer error',async({page})=>{
  await page.route('**/packages/core/dist/html-template.js',route=>route.abort('failed'));
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/runtime.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    window.fig=figure();fig.plot([1,2],[3,4]);window.viewer=mountViewer(fig,document.querySelector('#chart'));await fig.ready();
  });
  await page.getByRole('button',{name:'Export HTML',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>fig.diagnostics().snapshotBytes)).toBe(0);
  await expect(page.getByRole('button',{name:'Export HTML',exact:true})).toBeEnabled();
  await page.evaluate(()=>{viewer.dispose();fig.close();});
});

test('Python notebook blob module keeps HTML export self-contained',async({page},testInfo)=>{
  const requests=[],errors=[];page.on('request',request=>requests.push(request.url()));page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/tests/browser/harness.html');
  await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/runtime.js'),fig=figure();fig.plot([1,2],[3,4]);
    const snapshot=fig.snapshot(),buffers=snapshot.sources.map(source=>new DataView(fig.registry.get(source.id).values.buffer));
    const source=await(await fetch('/python/vesora/_assets/notebook.js')).text();
    window.notebookURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    const {render}=await import(notebookURL),state={snapshot,buffers},listeners=new Map();window.messages=[];
    window.disposeNotebook=render({el:document.querySelector('#chart'),model:{get:key=>state[key],on:(name,callback)=>{listeners.set(name,[...(listeners.get(name)??[]),callback]);},off:(name,callback)=>listeners.set(name,(listeners.get(name)??[]).filter(item=>item!==callback)),send:message=>messages.push(message)}});
    fig.close();
  });
  await expect.poll(()=>page.evaluate(()=>messages.some(message=>message.type==='ready'))).toBe(true);
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export HTML',exact:true}).click();
  const download=await downloaded,path=testInfo.outputPath('notebook-export.html');await mkdir(dirname(path),{recursive:true});await download.saveAs(path);
  expect(await readFile(path,'utf8')).toContain('vesora-payload');
  expect(requests.some(url=>url.includes('html-template'))).toBe(false);
  expect(errors).toEqual([]);
  await page.evaluate(()=>{disposeNotebook();URL.revokeObjectURL(notebookURL);});
});
