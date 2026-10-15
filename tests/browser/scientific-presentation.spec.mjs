import {test,expect} from '@playwright/test';

test('independent scalar colorbars name their own quantity in live and PNG overlays',async({page},testInfo)=>{
  await page.goto('/tests/browser/harness.html');
  const cases=await page.evaluate(async()=>{
    const {figure}=await import('/packages/core/dist/index.js'),host=document.querySelector('#chart');
    const original=CanvasRenderingContext2D.prototype.fillText,drawn=[];let phase='live';
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){
      // Both y-axis and colorbar labels rotate counterclockwise; the colorbar
      // occupies the right half of these single-panel fixtures.
      const transform=this.getTransform();if(transform.b<0&&Math.abs(transform.a)<1e-6&&transform.e>this.canvas.width/2)drawn.push({phase,text:String(text)});
      return original.call(this,text,...args);
    };
    const results=[];
    try{
      for(const kind of ['independent','explicit','empty','legacy-surface','heatmap','scatter','density']){
        const f=figure({kind:kind==='heatmap'||kind==='density'?'2d':'3d',width:640,height:400});
        const options=['legacy-surface','heatmap','density'].includes(kind)?{}:{values:kind==='scatter'?[100,200]:[[100,200],[300,400]]};
        if(kind==='explicit')options.colorbarLabel='Temperature / °C';
        if(kind==='empty')options.colorbarLabel='';
        if(kind==='density')f.scatter([0,0,1,1],[0,1,0,1],{representation:'density'});
        else if(kind==='heatmap')f.heatmap([0,1],[0,1],[[0,1],[2,3]],options);
        else if(kind==='scatter')f.scatter3d([0,1],[0,1],[0,1],options);
        else f.surface([0,1],[0,1],[[0,1],[2,3]],options);
        f.setView({zLabel:'Height / m'});f.mount(host);await f.ready();
        drawn.length=0;phase='live';f.view.drawOverlay();
        const width=f.view.panels[0].rect.width;
        phase='png';const bitmap=await createImageBitmap(await f.savefig({width:640,height:400,scale:1}));
        results.push({kind,width,labels:drawn.slice(),png:[bitmap.width,bitmap.height]});bitmap.close();f.close();
      }
      return results;
    }finally{CanvasRenderingContext2D.prototype.fillText=original;}
  });
  await testInfo.attach('colorbar-draws',{body:JSON.stringify(cases,null,2),contentType:'application/json'});
  const expected={independent:'value',explicit:'Temperature / °C',empty:null,'legacy-surface':'Height / m',heatmap:'Height / m',scatter:'value',density:'count / bin'};
  for(const item of cases){
    expect(item.png).toEqual([640,400]);
    for(const phase of ['live','png'])expect([...new Set(item.labels.filter(label=>label.phase===phase).map(label=>label.text))],`${item.kind} ${phase}: ${JSON.stringify(item.labels)}`).toEqual(expected[item.kind]?[expected[item.kind]]:[]);
  }
  expect(cases.find(item=>item.kind==='empty').width-cases.find(item=>item.kind==='independent').width).toBe(23);
  await page.setViewportSize({width:1440,height:1000});
  const reference=await page.evaluate(async()=>{
    document.querySelector('#chart').style.width='100%';
    const {mountSurfaceLab}=await import('/examples/web/v09-surface-lab.js'),demo=await mountSurfaceLab(document.querySelector('#chart'));window.scientificReference=demo;
    demo.figure.setCameraPreset('xy');await demo.figure.ready();
    const r=demo.figure.view.panels[0].rect,canvas=document.querySelectorAll('.vesora-figure canvas')[1].getBoundingClientRect();
    return {colorbars:demo.figure.spec.layers.filter(layer=>layer.kind==='surface'||layer.kind==='heatmap').map(layer=>layer.style.colorbarLabel),shading:demo.figure.spec.layers[0].style.shading,point:{x:canvas.left+r.left+r.width*.53,y:canvas.top+r.top+r.height*.47}};
  });
  expect(reference.colorbars).toEqual(['Scalar value (dimensionless)','Scalar value (dimensionless)']);expect(reference.shading).toBe('unlit');
  await page.locator('summary').filter({hasText:/^Inspector$/}).click();
  await page.screenshot({path:testInfo.outputPath('reference-live.png'),fullPage:true});
  await page.mouse.click(reference.point.x,reference.point.y);await page.getByRole('button',{name:'Freeze view',exact:true}).click();
  await expect(page.locator('.vv-inspection').first()).toContainText('Selected interpolated value');
  await page.screenshot({path:testInfo.outputPath('reference-frozen.png'),fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export PNG',exact:true}).click();const download=await downloadPromise;
  expect(await download.failure()).toBeNull();await download.saveAs(testInfo.outputPath('reference-frozen-export.png'));
  await page.evaluate(()=>window.scientificReference.dispose());
});

for(const [preset,hiddenAxis]of [['xy','z'],['xz','y'],['yz','x']])test(`${preset} camera omits only the projected-away axis annotations in live and PNG`,async({page})=>{
  await page.goto('/tests/browser/harness.html');
  const result=await page.evaluate(async({preset})=>{
    const {figure}=await import('/packages/core/dist/index.js'),f=figure({kind:'3d',width:640,height:400});
    const line=f.plot3d([10,20],[30,40],[50,60],{width:4});
    f.setView({xDomain:[10,20],yDomain:[30,40],zDomain:[50,60],xLabel:'axis-x',yLabel:'axis-y',zLabel:'axis-z'});f.setCameraPreset(preset);
    f.mount(document.querySelector('#chart'));await f.ready();
    const sourceValues=()=>Object.fromEntries(Object.entries(line.spec.data).map(([key,id])=>[key,Array.from(f.registry.get(id).values)]));
    const sourceBefore=JSON.stringify(sourceValues()),original=CanvasRenderingContext2D.prototype.fillText,drawn=[];let phase='live';
    CanvasRenderingContext2D.prototype.fillText=function(text,...args){drawn.push({phase,text:String(text)});return original.call(this,text,...args);};
    try{
      f.view.drawOverlay();phase='png';const bitmap=await createImageBitmap(await f.savefig({width:640,height:400,scale:1})),png=[bitmap.width,bitmap.height];bitmap.close();
      phase='hover';const hits=[];f.on('hover',hit=>{if(hit)hits.push(hit);});const r=f.view.panels[0].rect;f.view.hover(r.left+r.width/2,r.top+r.height/2,true);
      phase='near-preset';const [azimuth,elevation]={xy:[-90,88],xz:[-90,2],yz:[2,0]}[preset];f.setView({camera:{azimuth,elevation,distance:3}});await f.ready();
      phase='isometric';f.setCameraPreset('isometric');await f.ready();
      const result={drawn,png,hit:hits.at(-1),sourceUnchanged:JSON.stringify(sourceValues())===sourceBefore,layerId:line.id};f.close();return result;
    }finally{CanvasRenderingContext2D.prototype.fillText=original;f.close();}
  },{preset});
  const visible=['x','y','z'].filter(axis=>axis!==hiddenAxis).map(axis=>`axis-${axis}`).sort();
  for(const phase of ['live','png']){
    const labels=result.drawn.filter(label=>label.phase===phase).map(label=>label.text);
    expect([...new Set(labels.filter(label=>label.startsWith('axis-')))].sort()).toEqual(visible);
    const ranges={x:[10,20],y:[30,40],z:[50,60]},numbers=labels.filter(label=>/^\d/.test(label)).map(Number);
    expect(numbers.length).toBeGreaterThanOrEqual(4);
    expect(numbers.some(value=>value>=ranges[hiddenAxis][0]&&value<=ranges[hiddenAxis][1])).toBe(false);
  }
  for(const phase of ['near-preset','isometric'])expect([...new Set(result.drawn.filter(label=>label.phase===phase&&label.text.startsWith('axis-')).map(label=>label.text))].sort()).toEqual(['axis-x','axis-y','axis-z']);
  expect(result.png).toEqual([640,400]);expect(result.sourceUnchanged).toBe(true);
  expect(result.hit).toMatchObject({kind:'segment3d',layerId:result.layerId,indices:[0,1]});
  expect(result.hit.x).toBeCloseTo(15,6);expect(result.hit.y).toBeCloseTo(35,6);expect(result.hit.z).toBeCloseTo(55,6);
});

for(const width of [360,1440])test(`long scientific inspection stays reachable without stretching the desktop plot at ${width}px`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:800});await page.goto('/tests/browser/harness.html');
  const point=await page.evaluate(async()=>{
    const {subplots}=await import('/packages/core/dist/index.js'),{mountViewer}=await import('/packages/core/dist/viewer.js');
    const host=document.querySelector('#chart');host.style.width='100%';
    const f=subplots({rows:1,cols:2,kinds:[['3d','2d']],height:360}),surface=f.panel(0,0).surface([0,1,2],[0,1,2],[[0,1,0],[1,2,1],[0,1,0]],{values:[[10,20,30],[40,50,60],[70,80,90]],label:'Measured independent scalar field'});
    f.panel(0,1).slice(surface,{axis:'y',index:1});f.panel(0,0).setCameraPreset('xy');
    const viewer=mountViewer(f,host,{inspector:true});await f.ready();window.layoutInspectionFixture={f,viewer};
    const r=f.view.panels[0].rect,canvas=viewer.element.querySelectorAll('.vesora-figure canvas')[1].getBoundingClientRect();return {x:canvas.left+r.left+r.width*.53,y:canvas.top+r.top+r.height*.47};
  });
  await page.mouse.click(point.x,point.y);await page.getByRole('button',{name:'Freeze view',exact:true}).click();
  await expect(page.locator('.vv-inspection').first()).toContainText('Selected interpolated value');
  const slider=page.getByRole('slider',{name:/Y slice$/});
  await slider.focus();await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('2');
  const geometry=await page.evaluate(()=>{
    const sidebar=document.querySelector('.vv-sidebar'),plot=document.querySelector('.vv-plot'),body=document.querySelector('.vv-body'),slider=document.querySelector('.vv-slices input');
    const s=sidebar.getBoundingClientRect(),p=plot.getBoundingClientRect(),b=body.getBoundingClientRect(),r=slider.getBoundingClientRect();
    return {pageWidth:document.documentElement.scrollWidth,sidebar:{top:s.top,bottom:s.bottom,height:s.height,client:sidebar.clientHeight,scroll:sidebar.scrollHeight,scrollTop:sidebar.scrollTop},plot:{top:p.top,bottom:p.bottom,height:p.height},bodyHeight:b.height,slider:{top:r.top,bottom:r.bottom},overflow:getComputedStyle(sidebar).overflowY};
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(width);
  if(width===1440){expect(Math.abs(geometry.bodyHeight-geometry.plot.height)).toBeLessThanOrEqual(1);expect(geometry.sidebar.scroll).toBeGreaterThan(geometry.sidebar.client);expect(geometry.sidebar.scrollTop).toBeGreaterThan(0);expect(geometry.slider.top).toBeGreaterThanOrEqual(geometry.sidebar.top);expect(geometry.slider.bottom).toBeLessThanOrEqual(geometry.sidebar.bottom);}
  else{expect(geometry.overflow).toBe('visible');expect(geometry.sidebar.top).toBeGreaterThanOrEqual(geometry.plot.bottom);expect(geometry.slider.top).toBeGreaterThanOrEqual(0);expect(geometry.slider.bottom).toBeLessThanOrEqual(800);}
  await page.screenshot({path:testInfo.outputPath('keyboard-reachable-slice.png'),fullPage:true});
  await page.evaluate(()=>{window.layoutInspectionFixture.viewer.dispose();window.layoutInspectionFixture.f.close();});
});
