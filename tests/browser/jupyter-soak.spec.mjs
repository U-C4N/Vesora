import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';

test('real Jupyter two-hour atomic producer and frozen inspection soak',async({page,request,browser},testInfo)=>{
  test.skip(process.env.VESORA_SOAK_JUPYTER!=='1','Set VESORA_SOAK_JUPYTER=1 for the actual Jupyter soak');
  const seconds=Number(process.env.VESORA_SOAK_SECONDS??7200);
  if(!Number.isFinite(seconds)||seconds<5||seconds>86400)throw new Error('VESORA_SOAK_SECONDS must be 5..86400');
  test.setTimeout((seconds+360)*1000);
  page.setDefaultTimeout(15_000);
  const every=Number(process.env.VESORA_SOAK_FREEZE_EVERY??Math.min(300,seconds/3));
  const hold=Number(process.env.VESORA_SOAK_FREEZE_HOLD??Math.min(10,seconds/10));
  const output=resolve(process.env.VESORA_SOAK_OUTPUT??testInfo.outputPath('jupyter-soak'));
  await mkdir(output,{recursive:true});
  const local=resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
  const python=process.env.VESORA_PYTHON??process.env.PYTHON??(existsSync(local)?local:'python');
  const data=join(output,'jupyter-data');await mkdir(data,{recursive:true});
  const child=spawn(python,['-u',resolve('tests/browser/jupyter/server.py')],{cwd:resolve('.'),windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PYTHONUNBUFFERED:'1',JUPYTER_DATA_DIR:data}});
  let logs='',metadata,report={status:'failed',host:'jupyter',requested_seconds:seconds};
  const errors=[],hostExtensionErrors=[],cycles=[],samples=[];
  // Jupyter may emit unrelated extension warnings; renderer failures are also
  // checked through its visible alert and the producer's real error callback.
  page.on('pageerror',error=>{if(error.message==='No active debugger session')hostExtensionErrors.push({message:error.message,stack:error.stack});else errors.push(error.message);});
  child.stderr.on('data',chunk=>{logs=(logs+chunk).slice(-200000);});
  const started=new Promise((ready,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Jupyter startup timed out.\n${logs.slice(-5000)}`)),60000);let stdout='';
    child.stdout.on('data',chunk=>{stdout+=chunk;logs=(logs+chunk).slice(-200000);const line=stdout.split(/\r?\n/).slice(0,-1).find(v=>v.startsWith('VESORA_JUPYTER '));
      if(line){clearTimeout(timer);ready(JSON.parse(line.slice('VESORA_JUPYTER '.length)));}if(stdout.length>100000)stdout=stdout.slice(-50000);});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Jupyter exited ${code}.\n${logs.slice(-5000)}`));});
  });
  async function progress(){
    let completed;try{completed=JSON.parse(await readFile(join(output,'jupyter-producer.json'),'utf8'));}catch{}
    if(completed?.status==='failed')throw new Error(`Real Jupyter producer failed: ${completed.error}`);
    const current=JSON.parse(await readFile(join(output,'progress.json'),'utf8'));
    return completed?.status==='passed'?{...current,status:'passed',elapsed_seconds:completed.actual_total_seconds,next_sequence:completed.next_sequence}:current;
  }
  async function readRenderer(){return page.locator('[data-vesora-viewer]').evaluate(root=>{
    const diagnostics=[...root.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Diagnostics')?.querySelector('p')?.textContent??'';
    const frame=diagnostics.match(/Frame: ([\d,]+)/),snapshot=diagnostics.match(/Snapshot: ([\d,]+) \/ ([\d,]+) bytes/);
    const source=diagnostics.match(/Source: ([\d,]+) bytes/);
    const g=root.querySelector('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');
    return {frameId:frame?Number(frame[1].replaceAll(',','')):null,snapshotBytes:snapshot?Number(snapshot[1].replaceAll(',','')):null,
      sourceBytes:source?Number(source[1].replaceAll(',','')):null,maxSnapshotBytes:snapshot?Number(snapshot[2].replaceAll(',','')):null,
      status:root.querySelector('[role=status]').textContent,diagnostics,contextLost:g.isContextLost(),
      renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER),
      browserHeapBytes:performance.memory?.usedJSHeapSize??null,canvasCount:root.querySelectorAll('canvas').length};
  });}
  try{
    metadata=await started;const headers={Authorization:`token ${metadata.token}`};
    await expect.poll(async()=>{try{return(await request.get(`${metadata.url}/api/status`,{headers,timeout:2000})).status();}catch{return 0;}},{timeout:45000}).toBe(200);
    const sourcePath=resolve('tests/soak/jupyter_workload.py');
    const sources=[`import importlib.util, json\nfrom pathlib import Path\nspec = importlib.util.spec_from_file_location("vesora_jupyter_soak", ${JSON.stringify(sourcePath)})\nsoak_module = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(soak_module)\nsoak, soak_task = await soak_module.start(${JSON.stringify(output)})\nprint("VESORA_SOAK_STARTED")`,
      `report = await soak_module.finish(soak, soak_task)\nreport["final_export"] = soak_module.validate_final(soak)\nreport["validated_frozen_exports"] = soak_module.validate_exports(${JSON.stringify(output)})\nPath(${JSON.stringify(join(output,'jupyter-producer.json'))}).write_text(json.dumps(report, indent=2), encoding="utf-8")\nprint("VESORA_SOAK_FINISHED")`];
    const notebook={nbformat:4,nbformat_minor:5,metadata:{kernelspec:{name:'vesora-test',display_name:'Vesora integration',language:'python'}},
      cells:sources.map((source,index)=>({cell_type:'code',id:`soak-${index}`,execution_count:null,metadata:{},source,outputs:[]}))};
    const saved=await request.put(`${metadata.url}/api/contents/vesora-host-test.ipynb`,{headers,data:{type:'notebook',format:'json',content:notebook}});
    expect(saved.ok()).toBe(true);await page.setViewportSize({width:1440,height:1000});
    await page.goto(`${metadata.url}/lab/tree/vesora-host-test.ipynb?token=${encodeURIComponent(metadata.token)}`);
    const cells=page.locator('.jp-NotebookPanel .jp-CodeCell');await expect(cells).toHaveCount(2,{timeout:45000});
    await expect.poll(async()=>{const response=await request.get(`${metadata.url}/api/kernels`,{headers});return response.ok()&&(await response.json()).some(k=>k.execution_state==='idle'&&k.connections>0);},{timeout:60000}).toBe(true);
    async function run(index,marker){const cell=cells.nth(index);await cell.locator('.cm-content').click();await page.getByRole('button',{name:'Run this cell and advance (Shift+Enter)',exact:true}).click();
      await expect(cell.locator('.jp-OutputArea')).toContainText(marker,{timeout:120000});await expect(cell.locator('.jp-OutputArea-error')).toHaveCount(0);}
    await run(0,'VESORA_SOAK_STARTED');const viewer=page.locator('[data-vesora-viewer]');await expect(viewer).toHaveCount(1);
    let nextFreeze=every,nextSample=0;const wallDeadline=Date.now()+(seconds+180)*1000;
    while(true){
      const state=await progress();expect(state.status,state.errors?.join('\n')).not.toBe('failed');
      if(state.elapsed_seconds>=nextSample){const stats=await readRenderer();samples.push({elapsed_seconds:state.elapsed_seconds,...stats});
        expect(stats.contextLost).toBe(false);expect(stats.snapshotBytes).not.toBeNull();expect(stats.snapshotBytes).toBeLessThanOrEqual(stats.maxSnapshotBytes);
        nextSample=state.elapsed_seconds+5;}
      if(state.status==='passed')break;
      if(state.status==='producing'&&state.elapsed_seconds>=nextFreeze&&state.elapsed_seconds+hold<seconds-3){
        await viewer.getByRole('button',{name:'Freeze view',exact:true}).click();await expect(viewer.getByRole('status')).toContainText('Frozen snapshot');
        const before=await progress(),held=await readRenderer();const index=cycles.length;
        const cycle={started_seconds:before.elapsed_seconds,sequence_at_freeze:before.next_sequence,held};
        for(const extension of ['html','png']){
          const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),viewer.getByRole('button',{name:extension==='html'?'Export HTML':'Export PNG',exact:true}).click()]);
          await download.saveAs(join(output,`frozen-${String(index).padStart(3,'0')}.${extension}`));expect(await download.failure()).toBeNull();
        }
        // Yield to the real kernel background task while the displayed frame is held.
        await page.waitForTimeout(hold*1000);
        await expect.poll(async()=>(await progress()).next_sequence,{timeout:10000}).toBeGreaterThan(before.next_sequence);
        const after=await progress();cycle.accepted_rows_while_frozen=after.next_sequence-before.next_sequence;
        const frozen=await readRenderer();expect(frozen.frameId).toBe(held.frameId);expect(frozen.snapshotBytes).toBe(held.snapshotBytes);
        const payload=JSON.parse((await readFile(join(output,`frozen-${String(index).padStart(3,'0')}.html`),'utf8')).match(/<script[^>]*id="vesora-payload"[^>]*>(.*?)<\/script>/s)[1]);
        expect(payload.capture.source).toBe('displayed');expect(payload.capture.snapshotId).toBeTruthy();cycle.capture=payload.capture;
        await viewer.getByRole('button',{name:'Return to live',exact:true}).click();await expect(viewer.getByRole('status')).toHaveText('Live');
        await expect.poll(async()=>(await readRenderer()).snapshotBytes,{timeout:60000}).toBe(0);
        cycles.push(cycle);nextFreeze=after.elapsed_seconds+every;
        console.log(`Jupyter soak cycle ${cycles.length}: ${after.elapsed_seconds.toFixed(1)}s, accepted ${cycle.accepted_rows_while_frozen} rows/series while frozen.`);
      }
      await expect(viewer.locator('.vv-error')).toBeHidden();expect(Date.now()).toBeLessThan(wallDeadline);await page.waitForTimeout(500);
    }
    expect(cycles.length).toBeGreaterThan(0);const finalRenderer=await readRenderer();expect(finalRenderer.snapshotBytes).toBe(0);
    const [downloadedFinal]=await Promise.all([page.waitForEvent('download',{timeout:60000}),viewer.getByRole('button',{name:'Export HTML',exact:true}).click()]);
    await downloadedFinal.saveAs(join(output,'final-displayed.html'));expect(await downloadedFinal.failure()).toBeNull();
    await run(1,'VESORA_SOAK_FINISHED');await expect(page.locator('[data-vesora-viewer]')).toHaveCount(0);
    const producer=JSON.parse(await readFile(join(output,'jupyter-producer.json'),'utf8'));expect(producer.status).toBe('passed');
    const offlineContext=await browser.newContext({offline:true});
    try{const offline=await offlineContext.newPage();await offline.goto(pathToFileURL(join(output,'frozen-000.html')).href);
      await expect(offline.locator('#vesora-viewer')).toHaveAttribute('data-ready','ready',{timeout:60000});}
    finally{await offlineContext.close();}
    report={...producer,cycles,renderer_samples:samples,final_renderer:finalRenderer,browser_version:browser.version(),browser_errors:errors,
      host_extension_errors:hostExtensionErrors,host_extension_scope:'Exact optional JupyterLab No active debugger session errors are preserved separately; no debugger was requested. All other page errors fail the run.',
      browser_resource_scope:'Shared viewer DOM diagnostics, WebGL context state and optional Chromium JS heap; GPU/worker memory and pending exports are not inferred. Source atomicity is checked in every periodic export; Qt additionally checks every frame event.'};
    expect(errors).toEqual([]);
  }catch(error){report={...report,status:'failed',error:String(error),cycles,renderer_samples:samples,browser_errors:errors};throw error;}
  finally{
    const reportText=JSON.stringify(report,null,2);await writeFile(join(output,'jupyter-soak.json'),metadata?reportText.replaceAll(metadata.token,'[redacted]'):reportText);
    if(metadata&&child.exitCode===null)await request.post(`${metadata.url}/api/shutdown`,{headers:{Authorization:`token ${metadata.token}`},timeout:10000}).catch(()=>{});
    if(child.exitCode===null){await Promise.race([once(child,'exit'),new Promise(done=>setTimeout(done,10000))]);if(child.exitCode===null)child.kill();}
    // Do not persist the server token contained in startup URLs/logs.
    await writeFile(join(output,'jupyter-server.log'),metadata?logs.replaceAll(metadata.token,'[redacted]'):logs);
    child.stdout.destroy();child.stderr.destroy();child.unref();
    console.log(`Jupyter soak evidence: ${join(output,'jupyter-soak.json')}`);
  }
});
