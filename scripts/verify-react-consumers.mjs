// Install release archives outside the checkout and exercise real Vite/Next consumers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const archives = resolve(process.argv[2] ?? join(root, 'dist', `release-v${manifest.version}`));
const npm = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')].find(path => path && existsSync(path));
assert.ok(npm, 'Cannot locate npm-cli.js; run this verifier with npm run test:consumers.');
const workspace = await mkdtemp(join(tmpdir(), 'vesora-react-consumers-'));
const env = {...process.env, NEXT_TELEMETRY_DISABLED: '1', npm_config_cache: process.env.VESORA_NPM_CACHE ?? join(root, 'artifacts/npm-cache')};
for (const key of ['NODE_PATH', 'NODE_OPTIONS']) delete env[key];
const core = join(archives, `vesora-core-${manifest.version}.tgz`);
const adapter = join(archives, `vesora-react-${manifest.version}.tgz`);
assert.ok(existsSync(core) && existsSync(adapter), 'Run npm run package:release first.');
const exact = name => lock.packages[`node_modules/${name}`].version;
const requestedReact = process.env.VESORA_REACT_VERSION ?? '19';
assert.ok(['18.3.1', '19'].includes(requestedReact), 'VESORA_REACT_VERSION must be 18.3.1 or 19.');
const reactVersion = requestedReact === '18.3.1' ? '18.3.1' : exact('react');
const dependencyVersion = name => name === 'react' || name === 'react-dom' ? reactVersion
  : requestedReact === '18.3.1' && (name === '@types/react' || name === '@types/react-dom') ? '18.3.0' : exact(name);
const checks = [];
const run = (command, args, cwd) => execFileSync(command, args, {cwd, env, stdio: 'inherit', windowsHide: true, timeout: 180_000});

const dashboard = `'use client';
import React, {useState,useRef,useEffect,useMemo} from 'react';
import {VesoraChart,type VesoraChartHandle} from '@vesora/react';
const start = Date.UTC(2026,9,1);
const series = [{key:'revenue',label:'Revenue'}] as const;
type Row = {timestamp:number;revenue:number;lower:number;upper:number};
export default function Dashboard(){
  const [offset,setOffset]=useState(0),[theme,setTheme]=useState<'light'|'dark'>('dark'),[quality,setQuality]=useState(false),[streaming,setStreaming]=useState(false);
  const chart=useRef<VesoraChartHandle<Row>>(null);
  useEffect(()=>{(window as any).vesoraConsumer=chart.current;});
  const data=useMemo(()=>[{timestamp:start,revenue:100+offset,lower:80+offset,upper:120+offset},{timestamp:start+86400000,revenue:200+offset,lower:180+offset,upper:220+offset}],[offset]);
  return <main><h1>Installed Vesora consumer</h1>
    <button onClick={()=>setOffset(value=>value+10)}>Refresh data</button>
    <button onClick={()=>setTheme(value=>value==='dark'?'light':'dark')}>Switch theme</button>
    <button onClick={()=>setQuality(true)}>Enable interval inspection</button>
    <button onClick={()=>{setQuality(false);setStreaming(true);}}>Enable streaming</button>
    <output>{offset}</output>
    <VesoraChart ref={chart} type="line" data={data} xKey="timestamp" series={quality?[{...series[0],band:{lowerKey:'lower',upperKey:'upper'}}]:series} theme={theme} hoverMode={quality||streaming?'x':undefined} streaming={streaming?{maxPoints:2}:undefined}
      xAxis={{type:'time'}} yAxis={{format:'currency',currency:'USD'}} height={360}
      />
  </main>;
}
`;

async function prepare(name, dependencies){
  const directory=join(workspace,name);await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'package.json'),JSON.stringify({name:`vesora-${name}-consumer`,version:'1.0.0',private:true,type:'module'},null,2));
  // Vesora itself comes only from archives; pinned framework/toolchain dependencies
  // may be downloaded when the developer's cache is incomplete.
  run(process.execPath,[npm,'install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline',core,adapter,...dependencies.map(name=>`${name}@${dependencyVersion(name)}`)],directory);
  const installedReact = JSON.parse(await readFile(join(directory, 'node_modules/react/package.json'), 'utf8')).version;
  assert.equal(installedReact, reactVersion, `${name}: installed React must match the requested matrix member`);
  return directory;
}

async function server(directory, executable, args, port){
  const processHandle=spawn(process.execPath,[executable,...args],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';processHandle.stdout.on('data',chunk=>output+=chunk);processHandle.stderr.on('data',chunk=>output+=chunk);
  const url=`http://127.0.0.1:${port}`;
  try{
    const deadline=Date.now()+45_000;
    while(Date.now()<deadline){
      if(processHandle.exitCode!==null)throw new Error(`Consumer server exited: ${output}`);
      try{if((await fetch(url)).ok)return {url,stop:()=>processHandle.kill()};}catch{}
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    throw new Error(`Consumer server timeout: ${output}`);
  }catch(error){processHandle.kill();throw error;}
}

async function verify(browser,url,name,blockedWorker=false){
  const context=await browser.newContext({viewport:{width:1000,height:720}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  if(blockedWorker)await page.addInitScript(()=>{window.Worker=class{constructor(){throw new Error('Worker blocked by policy');}};});
  try{
    await page.goto(url);
    await page.waitForFunction(()=>!!window.vesoraConsumer && document.querySelector('[data-vesora-state="ready"][data-vesora-rendering="false"]'));
    const before=await page.evaluate(async()=>{const html=await window.vesoraConsumer.exportHTML();const payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent);const fig=payload.snapshot.figure;window.firstConsumerCanvas=document.querySelector('.vesora-figure canvas');return {id:fig.id,layer:fig.layers[0].id,protocol:fig.protocolVersion};});
    assert.equal(before.protocol,5);
    await page.getByRole('button',{name:'Refresh data',exact:true}).click();
    await page.waitForFunction(async()=>{if(!window.vesoraConsumer)return false;const html=await window.vesoraConsumer.exportHTML(),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent),source=payload.buffers.find(item=>item.id===payload.snapshot.figure.layers[0].data.y);return new Float64Array(Uint8Array.from(atob(source.base64),character=>character.charCodeAt(0)).buffer)[0]===110;});
    const after=await page.evaluate(async()=>{const html=await window.vesoraConsumer.exportHTML(),fig=JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent).snapshot.figure;return {same:document.querySelector('.vesora-figure canvas')===window.firstConsumerCanvas,id:fig.id,layer:fig.layers[0].id};});
    assert.equal(after.same,true);assert.equal(after.id,before.id);assert.equal(after.layer,before.layer);
    await page.getByRole('button',{name:'Switch theme',exact:true}).click();
    await page.waitForFunction(async()=>{const html=await window.vesoraConsumer.exportHTML();return JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent).snapshot.figure.theme?.background==='#ffffff';});
    const exported=await page.evaluate(async()=>{const blob=await window.vesoraConsumer.exportPNG();return Array.from(new Uint8Array(await blob.arrayBuffer()).subarray(0,8));});
    assert.deepEqual(exported,[137,80,78,71,13,10,26,10]);
    await page.getByRole('button',{name:'Enable interval inspection',exact:true}).click();
    await page.waitForFunction(async()=>{const html=await window.vesoraConsumer.exportHTML(),fig=JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent).snapshot.figure;return fig.protocolVersion===6&&fig.hoverMode==='x'&&fig.layers.some(layer=>layer.kind==='band');});
    const dimensions=await page.evaluate(async()=>{const blob=await window.vesoraConsumer.exportPNG({width:800,height:500,scale:2}),bitmap=await createImageBitmap(blob),result=[bitmap.width,bitmap.height];bitmap.close();return result;});
    assert.deepEqual(dimensions,[1600,1000]);
    await page.getByRole('button',{name:'Enable streaming',exact:true}).click();
    await page.waitForFunction(async()=>{
      if(!document.querySelector('[data-vesora-state="ready"][data-vesora-rendering="false"]'))return false;
      const html=await window.vesoraConsumer.exportHTML();
      return JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent).snapshot.figure.layers.length===1;
    });
    await page.evaluate(async()=>{
      const start=Date.UTC(2026,9,1);
      await window.vesoraConsumer.appendRows([{timestamp:start+2*86400000,revenue:300,lower:280,upper:320},{timestamp:start+3*86400000,revenue:400,lower:380,upper:420}]);
    });
    const retained=await page.evaluate(async()=>{
      const html=await window.vesoraConsumer.exportHTML(),payload=JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent),layer=payload.snapshot.figure.layers[0];
      const source=payload.buffers.find(item=>item.id===layer.data.y);
      return {sources:payload.snapshot.sources,values:Array.from(new Float64Array(Uint8Array.from(atob(source.base64),character=>character.charCodeAt(0)).buffer))};
    });
    assert.deepEqual(retained.values,[300,400]);
    await page.getByRole('button',{name:'Switch theme',exact:true}).click();
    await page.waitForFunction(async()=>{const html=await window.vesoraConsumer.exportHTML();return JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent).snapshot.figure.theme.background!=='#ffffff';});
    const styled=await page.evaluate(async()=>{const html=await window.vesoraConsumer.exportHTML();return JSON.parse(new DOMParser().parseFromString(html,'text/html').getElementById('vesora-payload').textContent).snapshot.sources;});
    assert.deepEqual(styled,retained.sources,`${name}: styling must preserve streaming source versions`);
    await page.screenshot({path:join(workspace,`${name}.png`),fullPage:true});
    assert.deepEqual(errors,[],`${name}: uncaught browser errors`);
    checks.push(name);
    console.log(`${name}: React ${reactVersion}, installed archive, update identity, v6 export and bounded streaming passed.`);
  }finally{await context.close();}
}

let browser;
try{
  const vite=await prepare('vite',['react','react-dom','vite','typescript','@types/react','@types/react-dom']);
  await writeFile(join(vite,'index.html'),'<!doctype html><html><head><title>Vesora Vite consumer</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  await writeFile(join(vite,'Dashboard.tsx'),dashboard);
  await writeFile(join(vite,'main.tsx'),"import React from 'react';import {createRoot} from 'react-dom/client';import Dashboard from './Dashboard';createRoot(document.getElementById('root')!).render(<React.StrictMode><Dashboard/></React.StrictMode>);");
  await writeFile(join(vite,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',lib:['ES2022','DOM'],strict:true,skipLibCheck:false,noEmit:true},include:['*.tsx']}));
  run(process.execPath,[join(vite,'node_modules/typescript/bin/tsc'),'--noEmit'],vite);
  run(process.execPath,[join(vite,'node_modules/vite/bin/vite.js'),'build'],vite);
  const installedChrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
  browser=await chromium.launch({executablePath:process.env.VESORA_CHROME??(existsSync(installedChrome)?installedChrome:undefined),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const viteServer=await server(vite,join(vite,'node_modules/vite/bin/vite.js'),['preview','--host','127.0.0.1','--port','4185','--strictPort'],4185);
  try{await verify(browser,viteServer.url,'vite');await verify(browser,viteServer.url,'vite-worker-fallback',true);}finally{viteServer.stop();}

  // Next's App Router is verified with React 19; the React 18.3 support contract
  // is independently checked in a production Vite consumer with React 18 types.
  if(requestedReact !== '18.3.1') {
  const next=await prepare('next',['react','react-dom','next','typescript','@types/react','@types/react-dom','@types/node']);
  await mkdir(join(next,'app'));
  await writeFile(join(next,'app/Dashboard.tsx'),dashboard);
  await writeFile(join(next,'app/page.tsx'),"import Dashboard from './Dashboard';export default function Page(){return <Dashboard/>;}");
  await writeFile(join(next,'app/layout.tsx'),"import type {ReactNode} from 'react';export default function Layout({children}:{children:ReactNode}){return <html lang='en'><body>{children}</body></html>;}");
  await writeFile(join(next,'next.config.mjs'),"export default {reactStrictMode:true};");
  run(process.execPath,[join(next,'node_modules/next/dist/bin/next'),'build','--webpack'],next);
  const nextServer=await server(next,join(next,'node_modules/next/dist/bin/next'),['start','--hostname','127.0.0.1','--port','4186'],4186);
  try{await verify(browser,nextServer.url,'next');}finally{nextServer.stop();}
  }
  const archiveHashes = Object.fromEntries(await Promise.all([core, adapter].map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
  const result={version:manifest.version,reactVersion,archives,archiveHashes,browser:browser.version(),recordedAt:new Date().toISOString(),checks};
  await writeFile(join(workspace,'verification.json'),JSON.stringify(result,null,2));
  await mkdir(join(root,'artifacts','consumers'),{recursive:true});
  await writeFile(join(root,'artifacts','consumers',`react-${reactVersion}.json`),JSON.stringify(result,null,2));
  console.log(`Installed-consumer checks passed for React ${reactVersion}. Evidence: ${workspace}`);
}finally{await browser?.close();console.log(`Consumer files retained at ${workspace}`);}
