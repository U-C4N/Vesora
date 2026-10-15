// Exact-wheel host runner. Defaults to short Qt then Jupyter validation.
// node scripts/run-host-soaks.mjs [release-dir] --phase short|full|both --host qt|jupyter|both [--prepare] [--prepare-only]
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

const args=process.argv.slice(2),options={phase:'short',host:'both',profile:'isolated'};let release;
while(args.length){const arg=args.shift();if(['--prepare','--prepare-only'].includes(arg))options[arg.slice(2)]=true;
  else if(['--phase','--host','--python','--env','--output','--profile'].includes(arg)){assert.ok(args.length,`Missing value for ${arg}`);options[arg.slice(2)]=args.shift();}
  else if(!arg.startsWith('-')&&!release)release=arg;else throw new Error(`Unknown argument: ${arg}`);}
assert.ok(['short','full','both'].includes(options.phase));assert.ok(['qt','jupyter','both'].includes(options.host));assert.ok(['isolated','concurrent-stress'].includes(options.profile));
const version=JSON.parse(await readFile('package.json','utf8')).version,directory=resolve(release??`dist/release-v${version}`);
const manifestBytes=await readFile(join(directory,'release-manifest.json')),manifest=JSON.parse(manifestBytes);
const wheels=manifest.files.filter(file=>/^vesora-.*\.whl$/.test(file.name));assert.equal(wheels.length,1);
const wheel=join(directory,wheels[0].name),hash=bytes=>createHash('sha256').update(bytes).digest('hex');assert.equal(hash(await readFile(wheel)),wheels[0].sha256);
const envDirectory=resolve(options.env??'artifacts/v09/host-soak-env'),python=join(envDirectory,process.platform==='win32'?'Scripts/python.exe':'bin/python');
const basePython=options.python??process.env.VESORA_PYTHON??resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
const environment={...process.env,PYTHONPATH:'',VESORA_PYTHON:python,VESORA_INSTALLED_PACKAGE:'1',VESORA_SOAK_WHEEL:wheel,VESORA_SOAK_PROFILE:options.profile};
delete environment.PYTHONHOME;
const execute=(command,argv,env=environment)=>new Promise((done,reject)=>{const child=spawn(command,argv,{cwd:resolve('.'),env,stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`${command} exited ${code}`)));});
if(options.prepare||options['prepare-only']){
  if(!existsSync(python))await execute('uv',['venv','--python',basePython,envDirectory]);
  await execute('uv',['pip','install','--python',python,'--reinstall-package','vesora',wheel,'PySide6==6.11.2','aiohttp==3.14.3','anywidget==0.11.0','jupyterlab==4.6.4','ipykernel==7.4.0','pytest','numpy']);
}
assert.ok(existsSync(python),'Create the separate host environment with --prepare first.');
const output=resolve(options.output??`artifacts/v09/soak/hosts-${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}`);await mkdir(output,{recursive:true});
const verification=execFileSync(python,['-I',resolve('tests/soak/verify_environment.py')],{cwd:resolve('.'),env:environment,windowsHide:true,encoding:'utf8'});
const provenance=JSON.parse(verification);assert.equal(provenance.wheel_sha256,wheels[0].sha256);assert.equal(provenance.vesora_version,manifest.pythonVersion);
await writeFile(join(output,'environment.json'),JSON.stringify({...provenance,manifest_sha256:hash(manifestBytes),profile:options.profile},null,2));
console.log(`Verified exact wheel ${wheels[0].sha256}; Python ${python}; evidence ${output}`);
if(!options['prepare-only']){
  const phases=options.phase==='both'?['short','full']:[options.phase],hosts=options.host==='both'?['qt','jupyter']:[options.host];
  for(const phase of phases)for(const host of hosts){
    const destination=join(output,phase,host),short=phase==='short';await mkdir(destination,{recursive:true});
    const env={...environment,VESORA_SOAK_OUTPUT:destination,VESORA_SOAK_SECONDS:short?'30':'7200',VESORA_SOAK_RETENTION:short?'1000':'100000',
      VESORA_SOAK_FREEZE_EVERY:short?'8':'300',VESORA_SOAK_FREEZE_HOLD:short?'2':'10',VESORA_SOAK_BATCH:'100',VESORA_SOAK_HZ:'20',
      VESORA_SOAK_QT:host==='qt'?'1':'0',VESORA_SOAK_JUPYTER:host==='jupyter'?'1':'0'};
    if(host==='qt')await execute(python,['-m','pytest','tests/python/test_v09_soak_desktop.py','-q','-s','-o','pythonpath=','-p','no:cacheprovider','--basetemp',join(destination,'pytest')],env);
    else await execute(process.execPath,[resolve('node_modules/@playwright/test/cli.js'),'test','--config','playwright.jupyter-soak.config.ts','--trace','off','--workers','1','--output',join(destination,'playwright')],env);
    const report=JSON.parse(await readFile(join(destination,`${host}-soak.json`),'utf8'));assert.equal(report.status,'passed');assert.equal(report.exact_wheel_verified,true);
    assert.equal(report.two_hour_duration_met,!short);console.log(`${phase} ${host} passed; ${report.actual_producer_seconds.toFixed(2)}s actual production.`);
  }
}
