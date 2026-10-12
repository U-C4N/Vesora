// Install release archives outside the checkout and exercise real Vite/Next consumers.
import assert from 'node:assert/strict';
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
const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const workspace = await mkdtemp(join(tmpdir(), 'vesora-react-consumers-'));
const env = {...process.env, NEXT_TELEMETRY_DISABLED: '1', npm_config_cache: process.env.VESORA_NPM_CACHE ?? join(root, 'artifacts/npm-cache')};
for (const key of ['NODE_PATH', 'NODE_OPTIONS']) delete env[key];
const core = join(archives, `vesora-core-${manifest.version}.tgz`);
const adapter = join(archives, `vesora-react-${manifest.version}.tgz`);
assert.ok(existsSync(core) && existsSync(adapter), 'Run npm run package:release first.');
const exact = name => lock.packages[`node_modules/${name}`].version;
const run = (command, args, cwd) => execFileSync(command, args, {cwd, env, stdio: 'inherit', windowsHide: true, timeout: 180_000});

const dashboard = `'use client';
import React, {useState,useRef,useEffect} from 'react';
import {VesoraChart,type VesoraChartHandle} from '@vesora/react';
const start = Date.UTC(2026,9,1);
const series = [{key:'revenue',label:'Revenue'}] as const;
export default function Dashboard(){
  const [offset,setOffset]=useState(0),[theme,setTheme]=useState<'light'|'dark'>('dark');
  const chart=useRef<VesoraChartHandle>(null);
  useEffect(()=>{(window as any).vesoraConsumer=chart.current;});
  const data=[{timestamp:start,revenue:100+offset},{timestamp:start+86400000,revenue:200+offset}];
  return <main><h1>Installed Vesora consumer</h1>
    <button onClick={()=>setOffset(value=>value+10)}>Refresh data</button>
    <button onClick={()=>setTheme(value=>value==='dark'?'light':'dark')}>Switch theme</button>
    <output>{offset}</output>
    <VesoraChart ref={chart} type="line" data={data} xKey="timestamp" series={series} theme={theme}
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
  run(process.execPath,[npm,'install','--ignore-scripts','--no-audit','--no-fund','--prefer-offline',core,adapter,...dependencies.map(name=>`${name}@${exact(name)}`)],directory);
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
    await page.screenshot({path:join(workspace,`${name}.png`),fullPage:true});
    assert.deepEqual(errors,[],`${name}: uncaught browser errors`);
    console.log(`${name}: installed archive, client mount, update identity, theme and PNG passed.`);
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

  const next=await prepare('next',['react','react-dom','next','typescript','@types/react','@types/react-dom','@types/node']);
  await mkdir(join(next,'app'));
  await writeFile(join(next,'app/Dashboard.tsx'),dashboard);
  await writeFile(join(next,'app/page.tsx'),"import Dashboard from './Dashboard';export default function Page(){return <Dashboard/>;}");
  await writeFile(join(next,'app/layout.tsx'),"import type {ReactNode} from 'react';export default function Layout({children}:{children:ReactNode}){return <html lang='en'><body>{children}</body></html>;}");
  await writeFile(join(next,'next.config.mjs'),"export default {reactStrictMode:true};");
  run(process.execPath,[join(next,'node_modules/next/dist/bin/next'),'build','--webpack'],next);
  const nextServer=await server(next,join(next,'node_modules/next/dist/bin/next'),['start','--hostname','127.0.0.1','--port','4186'],4186);
  try{await verify(browser,nextServer.url,'next');}finally{nextServer.stop();}
  await writeFile(join(workspace,'verification.json'),JSON.stringify({version:manifest.version,archives,checks:['vite','vite-worker-fallback','next']},null,2));
  console.log(`Vite and Next.js installed-consumer checks passed. Evidence: ${workspace}`);
}finally{await browser?.close();console.log(`Consumer files retained at ${workspace}`);}
