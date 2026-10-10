import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {subplots,toHTML} from '../../packages/core/dist/index.js';

const python=process.env.VESORA_PYTHON??(existsSync('.venv/Scripts/python.exe')?resolve('.venv/Scripts/python.exe'):existsSync('.venv/bin/python')?resolve('.venv/bin/python'):'python');
async function hash(page){return page.evaluate(()=>{
  const canvas=[...document.querySelectorAll('#vesora-chart canvas')].find(c=>c.getContext('webgl2'));
  const gl=canvas.getContext('webgl2'),pixels=new Uint8Array(canvas.width*canvas.height*4);
  gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let hash=2166136261;for(const byte of pixels)hash=Math.imul(hash^byte,16777619);return hash>>>0;
});}

for(const producer of ['JavaScript','Python'])test(`${producer} linked panels, annotations and whole-view reset survive offline export`,async({page,context},info)=>{
  const path=info.outputPath('comparison.html');await mkdir(dirname(path),{recursive:true});
  if(producer==='JavaScript'){
    const fig=subplots({rows:1,cols:2,shareX:true,width:1000,height:500,title:'Offline comparison'});
    for(let col=0;col<2;col++){
      const p=fig.panel(0,col);p.setTitle(`Panel ${col+1}`);
      p.scatter([1,2,3],[1,3,2],{color:col?'#0000ff':'#ff0000',size:15,label:'Samples'});
      p.setView({xDomain:[0,4],yDomain:[0,col?10:4]});p.axhline(2,{color:'#ff00ff'});
      p.text(1,2.5,'Peak Ω </script>',{color:'#ff00ff'});
    }
    fig.bookmark('Overview');fig.panel(0,1).setView({xDomain:[0,2],yDomain:[1,4]});
    fig.bookmark('Detail');fig.restoreBookmark('Overview');
    await writeFile(path,toHTML(fig));fig.close();
  }else{
    execFileSync(python,['-X','utf8','-c',`import sys
import vesora as vs
fig=vs.subplots(1,2,sharex=True,width=1000,height=500,title='Offline comparison')
for col in range(2):
    p=fig.panel(0,col)
    p.set_title(f'Panel {col+1}')
    p.scatter([1,2,3],[1,3,2],color='#0000ff' if col else '#ff0000',size=15,label='Samples')
    p.set_axes(xlim=(0,4),ylim=(0,10 if col else 4))
    p.axhline(2,color='#ff00ff')
    p.text(1,2.5,'Peak Ω </script>',color='#ff00ff')
fig.bookmark('Overview')
fig.panel(0,1).set_axes(xlim=(0,2),ylim=(1,4))
fig.bookmark('Detail')
fig.restore_bookmark('Overview')
fig.save_html(sys.argv[1])
fig.close()`,path],{env:{...process.env,PYTHONPATH:resolve('python')},encoding:'utf8',windowsHide:true});
  }
  const external=[],errors=[];
  page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
  await context.setOffline(true);await page.setViewportSize({width:1200,height:900});
  await page.goto(pathToFileURL(path).href);
  const viewer=page.locator('#vesora-viewer');await expect(viewer).toHaveAttribute('data-ready','ready');
  await expect(page.locator('#vesora-layer option')).toHaveCount(2);
  await expect(page.locator('#vesora-layer option').nth(1)).toHaveText('Panel 2 · Samples');
  const initial=await hash(page);
  await page.getByRole('button',{name:'Detail',exact:true}).click();
  await expect(viewer).toHaveAttribute('data-ready','ready');expect(await hash(page)).not.toBe(initial);
  await page.getByRole('button',{name:'Reset view',exact:true}).click();
  await expect(viewer).toHaveAttribute('data-ready','ready');expect(await hash(page)).toBe(initial);
  const ink=await page.evaluate(()=>{
    const canvas=[...document.querySelectorAll('#vesora-chart canvas')].find(c=>c.getContext('2d'));
    const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let left=0,right=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]>180&&bytes[i+1]<120&&bytes[i+2]>180&&bytes[i+3]>100){if((i/4)%canvas.width<canvas.width/2)left++;else right++;}
    return {left,right};
  });
  expect(ink.left).toBeGreaterThan(100);expect(ink.right).toBeGreaterThan(100);
  const downloaded=page.waitForEvent('download');await page.locator('#vesora-png').click();
  const download=await downloaded,output=info.outputPath('comparison.png');await download.saveAs(output);
  const png=await readFile(output);expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  await page.screenshot({path:info.outputPath('viewer.png'),fullPage:true});
  expect(external).toEqual([]);expect(errors).toEqual([]);
});

test('comparison gallery renders three examples and resets complete panel views',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1280,height:1000});await page.goto('/examples/web/compare.html');
  await expect(page.locator('[data-example][data-ready="true"]')).toHaveCount(3);
  await page.evaluate(async()=>{
    const fig=vesoraGallery.get('heatmap-comparison');
    fig.panel(1,1).setView({xDomain:[0,1],yDomain:[0,1]});await fig.ready();
  });
  const card=page.locator('[data-example="heatmap-comparison"]');await card.locator('[data-action="reset"]').click();
  await expect.poll(()=>page.evaluate(()=>vesoraGallery.get('heatmap-comparison').panelEntries().map(p=>p.view.xDomain??null))).toEqual([null,null,null,null]);
  await page.screenshot({path:info.outputPath('comparison-gallery.png'),fullPage:true});
  await page.setViewportSize({width:320,height:800});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
});
