import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';

const volumes=page=>page.locator('.balance-reading-panel tbody td[data-value]').evaluateAll(nodes=>nodes.map(node=>Number(node.dataset.value)));
const sum=values=>values.reduce((a,b)=>a+b,0);
async function assertMembraneAreas(page,volumeA,volumeB){
  // Measure the rendered closed paths, independently of their generating cubic.
  const geometry=await page.locator('.membrane-plot').evaluate(svg=>{
    const area=selector=>{
      const path=svg.querySelector(selector),length=path.getTotalLength(),points=Array.from({length:2048},(_,index)=>path.getPointAtLength(length*index/2048));
      return Math.abs(points.reduce((sum,point,index)=>{const next=points[(index+1)%points.length];return sum+point.x*next.y-next.x*point.y;},0))/2;
    };
    const frame=svg.querySelector('.membrane-frame');
    return {a:area('.membrane-region-a'),b:area('.membrane-region-b'),transfer:area('.membrane-transfer'),frame:Number(frame.getAttribute('width'))*Number(frame.getAttribute('height'))};
  });
  const totalArea=geometry.a+geometry.b,totalVolume=volumeA+volumeB;
  expect(Math.abs(totalArea/geometry.frame-1)).toBeLessThan(.0005);
  expect(Math.abs(geometry.a/totalArea-volumeA/totalVolume)).toBeLessThan(.0005);
  expect(Math.abs(geometry.b/totalArea-volumeB/totalVolume)).toBeLessThan(.0005);
  expect(Math.abs(geometry.transfer/totalArea-Math.abs(volumeA-volumeB)/(2*totalVolume))).toBeLessThan(.0005);
  return geometry;
}
async function assertCategoryReadingsFit(page,count){
  const container=page.locator('.membrane-categories');
  await expect(container.locator('.membrane-category')).toHaveCount(count);
  const layout=await container.evaluate(node=>{
    const box=node.getBoundingClientRect();
    return {left:box.left,right:box.right,overflow:node.scrollWidth-node.clientWidth,columns:getComputedStyle(node).gridTemplateColumns.split(' ').length,labels:[...node.querySelectorAll('.membrane-category-name,.membrane-category-value')].map(label=>{const rect=label.getBoundingClientRect();return {text:label.textContent,left:rect.left,right:rect.right};})};
  });
  expect(layout.overflow).toBe(0);expect(layout.columns).toBe(2);expect(layout.labels).toHaveLength(count*2);
  for(const label of layout.labels){expect(label.left).toBeGreaterThanOrEqual(layout.left);expect(label.right).toBeLessThanOrEqual(layout.right);}
  await expect.poll(()=>page.locator('.membrane-canvas').evaluate(node=>node.scrollWidth-node.clientWidth)).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
}
async function open(page){
  await page.goto('/?demo=balance');
  await expect(page.locator('.balance-core-view canvas').first()).toBeVisible();
  await expect(page.locator('.balance-reading-panel tbody tr')).toHaveCount(4);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('Denge couples exact volumes, passive energy loss, focus and a real 3D observation',async({page,browser},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:1160});await open(page);
  const before=await volumes(page);before.forEach((value,index)=>expect(value).toBeCloseTo([56,24,14,6][index],10));
  const energyBefore=Number((await page.locator('.balance-metrics>div').nth(1).locator('strong').innerText()).split(' ')[0]);
  await page.getByRole('button',{name:'Step 0.5 s',exact:true}).click();
  const after=await volumes(page);
  expect(after[0]).toBeLessThan(before[0]);expect(after[3]).toBeGreaterThan(before[3]);expect(after[1]).toBe(24);expect(sum(after)).toBeCloseTo(100,10);
  expect(Number((await page.locator('.balance-metrics>div').nth(1).locator('strong').innerText()).split(' ')[0])).toBeLessThan(energyBefore);
  expect(Number((await page.getByTestId('balance-dissipation').innerText()).split(' ')[0])).toBeGreaterThan(0);
  await page.locator('[data-category-id="east"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-row-id="east"]')).toHaveAttribute('data-selected','true');expect(await volumes(page)).toEqual(after);
  await page.getByRole('button',{name:'Set baseline',exact:true}).click();
  for(const cell of await page.locator('.balance-reading-panel tbody td:nth-child(4)').all())await expect(cell).toHaveText('0.000 L');
  const membrane=await assertMembraneAreas(page,after[0],after[3]);
  const target=(after[0]+after[3])/2;
  await expect(page.locator('.membrane-equilibrium')).toHaveAttribute('aria-label',`Connected pair equal level: ${target.toFixed(2)} litres each`);
  await expect(page.locator('.membrane-transfer-reading')).toContainText(`${((after[0]-after[3])/2).toFixed(1)} L`);
  await page.getByRole('button',{name:'Isometric',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export 3D observation',exact:true}).click();
  const download=await downloadPromise;expect(await download.failure()).toBeNull();
  const html=await readFile(await download.path(),'utf8'),payload=JSON.parse(html.match(/<script[^>]*id="vesora-payload"[^>]*>([\s\S]*?)<\/script>/)[1]);
  expect(payload.snapshot.figure.observation).toMatchObject({source:'displayed',representation:{status:'rendered'}});
  expect(payload.snapshot.figure.title).toContain('vertical scale exaggerated');
  const surfaceLayers=payload.snapshot.figure.layers.filter(layer=>layer.type==='surface'||layer.kind==='surface');
  expect(surfaceLayers).toHaveLength(4);
  const decode=id=>{const descriptor=payload.snapshot.sources.find(source=>source.id===id),buffer=Buffer.from(payload.buffers.find(buffer=>buffer.id===id).base64,'base64'),array=buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength);return Array.from(descriptor.dtype==='float64'?new Float64Array(array):new Float32Array(array));};
  surfaceLayers.forEach((layer,index)=>{
    const semantics=payload.snapshot.figure.semantics.sources;
    expect(semantics[layer.data.z].unit).toBe('m');expect(semantics[layer.data.color].unit).toBe('L');expect(semantics[layer.data.z].transforms).toBeUndefined();
    for(const value of decode(layer.data.z))expect(value).toBeCloseTo(after[index]*.001,6);
    for(const value of decode(layer.data.color))expect(value).toBeCloseTo(after[index],4);
  });
  await expect(page.getByRole('alert')).toHaveCount(0);expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('denge-desktop-1440.png'),fullPage:true});
  await page.locator('.balance-2d').screenshot({path:testInfo.outputPath('denge-2d-desktop.png')});
  await writeFile(testInfo.outputPath('denge-metrics.json'),JSON.stringify({browser:browser.version(),viewport:{width:1440,height:1160},before,after,total:sum(after),energyBefore,membrane,exportLayers:surfaceLayers.length,pageErrors:errors,scope:'Synthetic model functional/visual QA; membrane area independently estimated from 2048 sampled rendered-path points; not a fluid experiment or a performance benchmark.'},null,2));
  await page.getByRole('button',{name:'Start flow',exact:true}).click();
  await expect(page.locator('.balance-simulation-status')).toContainText('Pressure flow running');
  await expect.poll(async()=>(await volumes(page))[0]).toBeLessThan(after[0]);
  await page.getByRole('button',{name:'Pause flow',exact:true}).click();
  await expect(page.locator('.balance-simulation-status')).toContainText('Simulation paused');
  expect(sum(await volumes(page))).toBeCloseTo(100,10);expect(errors).toEqual([]);
});

test('manual uphill transfer is explicit, reservoirs stay nonnegative, and valve closure stops passive transfer',async({page})=>{
  await open(page);await page.getByRole('combobox',{name:'Reservoir A',exact:true}).selectOption('west');await page.getByRole('combobox',{name:'Reservoir B',exact:true}).selectOption('north');
  await page.locator('.balance-manual summary').click();await page.getByRole('spinbutton',{name:'Manual transfer amount'}).fill('5');
  await page.getByRole('button',{name:'Transfer West → North',exact:true}).click();
  (await volumes(page)).forEach((value,index)=>expect(value).toBeCloseTo([61,24,14,1][index],10));await expect(page.locator('.balance-message')).toContainText('Manual transfer: 5.00 L');
  await assertMembraneAreas(page,1,61);
  const text=await page.locator('.balance-manual').innerText();expect(Number(text.match(/Net external work: ([\d.]+)/)[1])).toBeGreaterThan(0);
  await page.getByRole('slider',{name:'Valve opening'}).press('Home');const closed=await volumes(page);await page.getByRole('button',{name:'Step 0.5 s',exact:true}).click();expect(await volumes(page)).toEqual(closed);
  await page.getByRole('combobox',{name:'Reservoir count',exact:true}).selectOption('8');expect(await volumes(page)).toHaveLength(8);expect(sum(await volumes(page))).toBeCloseTo(100,10);
  await page.getByRole('combobox',{name:'Reservoir count',exact:true}).selectOption('3');expect(await volumes(page)).toHaveLength(3);expect((await volumes(page)).every(value=>value>=0)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('reduced motion and narrow layout preserve membrane, all category readings and single steps',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page);
  await expect(page.getByRole('button',{name:'Start flow',exact:true})).toBeDisabled();await expect(page.locator('.balance-simulation-status')).toContainText('Reduced motion');
  const before=await volumes(page);await page.getByRole('button',{name:'Step 0.5 s',exact:true}).click();expect((await volumes(page))[0]).toBeLessThan(before[0]);
  expect(await page.locator('.balance-2d').evaluate(node=>[node,...node.querySelectorAll('*')].every(element=>getComputedStyle(element).animationName==='none'))).toBe(true);
  const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('.balance-table-scroll').clientWidth,tableScroll:document.querySelector('.balance-table-scroll').scrollWidth}));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.width);expect(layout.tableScroll).toBeGreaterThan(layout.tableWidth);
  await assertCategoryReadingsFit(page,4);
  await page.screenshot({path:testInfo.outputPath('denge-mobile-390.png'),fullPage:true});
  await page.locator('.balance-chart-grid').screenshot({path:testInfo.outputPath('denge-mobile-chart-390.png')});
  await page.setViewportSize({width:320,height:844});
  await assertCategoryReadingsFit(page,4);
  await page.locator('.balance-2d').screenshot({path:testInfo.outputPath('denge-2d-320.png')});
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('combobox',{name:'Reservoir count',exact:true}).selectOption('8');
  await assertCategoryReadingsFit(page,8);
  await page.setViewportSize({width:320,height:844});await assertCategoryReadingsFit(page,8);
  await page.locator('[data-category-id="reserve"]').focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-row-id="reserve"]')).toHaveAttribute('data-selected','true');
  await page.getByRole('link',{name:'Open Studio'}).click();await expect(page.getByRole('heading',{name:'Experiment workbench',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Explore Denge'}).click();await expect(page.getByRole('heading',{name:'Vesora Denge.',exact:true})).toBeVisible();
});
