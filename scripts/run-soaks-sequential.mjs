// Exact archives; one graphics host at a time. Run through run-soaks-awake.ps1.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {loadRelease,sha256,validateTagCommit} from './release-validation.mjs';
import {validateSoakReport,checkAwake} from './soak-sequential-contracts.mjs';

const args=process.argv.slice(2),options={phase:'short',hosts:'browser,qt,jupyter','min-free-gib':'2'};
while(args.length){const key=args.shift();assert.ok(['--release','--env','--output','--phase','--hosts','--min-free-gib','--expected-manifest-sha256','--short-evidence'].includes(key),`Unknown argument ${key}`);assert.ok(args.length,`Missing ${key}`);options[key.slice(2)]=args.shift();}
assert.ok(options.release&&options.env&&options.output&&options['expected-manifest-sha256'],'release, env, output and expected manifest hash are required');
assert.ok(['short','full'].includes(options.phase));
const hosts=options.hosts.split(',');assert.ok(hosts.length&&new Set(hosts).size===hosts.length&&hosts.every(host=>['browser','qt','jupyter'].includes(host)));
const minimumFree=Number(options['min-free-gib'])*1024**3;assert.ok(Number.isFinite(minimumFree)&&minimumFree>=1024**3);
const releaseDirectory=resolve(options.release),envDirectory=resolve(options.env),output=resolve(options.output),python=join(envDirectory,process.platform==='win32'?'Scripts/python.exe':'bin/python');
const release=await loadRelease(releaseDirectory,{publishable:true}),{manifest,manifestSha256}=release;
assert.equal(manifestSha256,options['expected-manifest-sha256'],'Unexpected archive identity');
const git=(...argv)=>execFileSync('git',argv,{encoding:'utf8',windowsHide:true}).trim();
validateTagCommit(manifest,git('rev-parse',`${manifest.tag}^{commit}`));
const guardPid=Number(process.env.VESORA_POWER_GUARD_PID),guardLog=process.env.VESORA_POWER_GUARD_LOG;
assert.equal(process.platform,'win32','This coordinator requires the Windows process-scoped guard');
assert.ok(Number.isSafeInteger(guardPid)&&guardPid===process.ppid&&guardLog,'Launch through scripts/run-soaks-awake.ps1');
const guard=JSON.parse((await readFile(guardLog,'utf8')).trim().split(/\r?\n/)[0]);
assert.equal(guard.event,'acquired');assert.equal(guard.pid,guardPid);assert.equal(guard.flags,'0x80000003');
const seconds=options.phase==='full'?7200:30,retention=options.phase==='full'?100000:1000;
const reportPath=(root,host,phase)=>host==='browser'?join(root,'browser','browser.json'):join(root,host,phase,host,`${host}-soak.json`);
const shortReferences=[];
if(options.phase==='full'){
  assert.ok(options['short-evidence'],'Full execution requires passed same-archive short evidence');
  for(const host of hosts){const path=reportPath(resolve(options['short-evidence']),host,'short'),bytes=await readFile(path);validateSoakReport(host,JSON.parse(bytes),manifest,manifestSha256,{seconds:30,retention:1000});shortReferences.push({host,path,sha256:sha256(bytes)});}
}
// The caller creates this fresh directory only to hold the native guard log.
await mkdir(output,{recursive:true});
const summaryPath=join(output,'summary.json');
const harnessPaths=['scripts/run-soaks-sequential.mjs','scripts/run-soaks-awake.ps1','scripts/soak-sequential-contracts.mjs','scripts/release-validation.mjs','scripts/release-identity.mjs','scripts/run-host-soaks.mjs','scripts/soak-browser-v09.mjs','tests/soak/resources.py','tests/soak/host_workload.py','tests/soak/jupyter_workload.py','tests/soak/verify_environment.py','tests/python/test_v09_soak_desktop.py','tests/python/test_linked_desktop.py','tests/browser/jupyter-soak.spec.mjs','tests/browser/jupyter/server.py','playwright.jupyter-soak.config.ts','playwright.config.ts','pyproject.toml'];
const fingerprint=async()=>Object.fromEntries(await Promise.all(harnessPaths.map(async path=>[path,sha256(await readFile(path))])));
const harnesses=await fingerprint(),workspace=()=>({head:git('rev-parse','HEAD'),status:git('status','--porcelain=v1','--untracked-files=all')});
const wheel=manifest.files.find(file=>file.name.endsWith('.whl'));
const environment={...process.env,PYTHONPATH:'',VESORA_PYTHON:python,VESORA_INSTALLED_PACKAGE:'1',VESORA_SOAK_WHEEL:join(releaseDirectory,wheel.name),VESORA_SOAK_PROFILE:'isolated'};
delete environment.PYTHONHOME;
const summary={status:'preparing',version:manifest.version,archiveCommit:manifest.commit,manifestSha256,releaseDirectory,environment:envDirectory,phase:options.phase,hosts,requestedSeconds:seconds,profile:'isolated',startedAt:new Date().toISOString(),minimumFreeBytes:minimumFree,powerGuard:{pid:guardPid,path:guardLog,scope:'Temporary SYSTEM_REQUIRED and DISPLAY_REQUIRED. Does not block lid closure, manual sleep, shutdown or battery exhaustion.'},workspaceInitial:workspace(),harnesses,shortReferences,jobs:{},resourceSamples:[],scope:'Exact archived runtime. Current separately hashed test harness; working tree may contain unrelated development changes. One graphics workload at a time, with a process-tree/system resource sample every 5 seconds including a 1-second CPU sample. Observed process working-set maxima can miss shorter peaks and shared pages can be double counted. This instrumentation can affect latency; soak timings do not replace the separate fixed latency benchmark. No build, publication or gate modification.',notEstablished:['human pilot','real screen-reader session','Jupyter reconnection during the long soak']};
await writeFile(summaryPath,JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
let persistQueue=Promise.resolve();
const persist=()=>{const body=JSON.stringify(summary,null,2)+'\n';persistQueue=persistQueue.then(async()=>{await writeFile(summaryPath+'.tmp',body);await rename(summaryPath+'.tmp',summaryPath);});return persistQueue;};
const verifyFixed=async()=>{assert.deepEqual(await fingerprint(),harnesses,'Soak harness changed during execution');const current=await loadRelease(releaseDirectory,{publishable:true});assert.equal(current.manifestSha256,manifestSha256);validateTagCommit(manifest,git('rev-parse',`${manifest.tag}^{commit}`));};
const sample=pid=>JSON.parse(execFileSync(python,['-I',resolve('tests/soak/resources.py'),...(pid?['--pid',String(pid)]:[])],{encoding:'utf8',windowsHide:true,timeout:15000}));
let active,interrupted=false,lastResource;
const stopOwned=()=>{if(active?.pid&&active.exitCode===null){try{execFileSync('taskkill',['/PID',String(active.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}};
const interrupt=()=>{interrupted=true;stopOwned();};process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
const recordSample=async(host,pid)=>{const row={host,...sample(pid)};summary.resourceSamples.push(row);await appendFile(join(output,'resources.jsonl'),JSON.stringify(row)+'\n');checkAwake(lastResource,row);lastResource=row;await persist();return row;};
try{
  const verified=JSON.parse(execFileSync(python,['-I',resolve('tests/soak/verify_environment.py')],{cwd:resolve('.'),env:environment,encoding:'utf8',windowsHide:true,timeout:60000}));
  assert.equal(verified.wheel_sha256,wheel.sha256);assert.equal(verified.vesora_version,manifest.pythonVersion);summary.verifiedEnvironment=verified;summary.status='running';await persist();
  for(const host of hosts){
    if(interrupted)throw new Error('Interrupted before next host');
    await verifyFixed();const preflight=await recordSample(host);
    assert.ok(preflight.availableMemoryBytes>=minimumFree,`${host}: insufficient memory headroom (${preflight.availableMemoryBytes} < ${minimumFree})`);
    assert.ok(preflight.diskFreeBytes>=2*1024**3,'Less than 2 GiB disk space for raw exports');
    const destination=join(output,host),report=reportPath(output,host,options.phase),logPath=join(output,`${host}.log`);
    await mkdir(destination);
    const argv=host==='browser'?['scripts/soak-browser-v09.mjs',releaseDirectory]:['scripts/run-host-soaks.mjs',releaseDirectory,'--phase',options.phase,'--host',host,'--profile','isolated','--env',envDirectory,'--output',destination];
    const env={...environment,...(host==='browser'?{VESORA_SOFTWARE_GPU:'1',VESORA_SOAK_SECONDS:String(seconds),VESORA_SOAK_RETENTION:String(retention),VESORA_SOAK_FREEZE_EVERY:options.phase==='full'?'300':'8',VESORA_SOAK_FREEZE_HOLD:options.phase==='full'?'10':'2',VESORA_SOAK_OUTPUT:destination}:{})};
    const job=summary.jobs[host]={status:'running',startedAt:new Date().toISOString(),command:[process.execPath,...argv],reportPath:report,logPath,preflight};
    const log=createWriteStream(logPath,{flags:'wx'});let watchdog,timer,childFailure,sampling=false;
    active=spawn(process.execPath,argv,{cwd:resolve('.'),env,windowsHide:true,stdio:['ignore','pipe','pipe']});job.pid=active.pid;
    const child=active,completed=new Promise(done=>{child.once('error',error=>{childFailure=String(error);});child.once('close',(code,signal)=>done({code,signal}));});
    log.on('error',error=>{childFailure=String(error);stopOwned();});
    const pump=chunk=>{log.write(chunk);process.stdout.write(`[${host}] ${chunk}`);};child.stdout.on('data',pump);child.stderr.on('data',pump);
    await persist();console.log(`SOAK_STARTED ${host} pid=${job.pid} output=${output}`);
    timer=setInterval(()=>{if(sampling)return;sampling=true;recordSample(host,child.pid).then(row=>{if(row.availableMemoryBytes<512*1024**2)throw new Error('Less than 512 MiB system memory remains');}).catch(error=>{childFailure=String(error);stopOwned();}).finally(()=>{sampling=false;});},5000);
    watchdog=setTimeout(()=>{childFailure='Producer plus ten-minute startup/cleanup deadline exceeded';stopOwned();},(seconds+600)*1000);
    try{
      const completion=await completed;job.exit=completion;clearInterval(timer);clearTimeout(watchdog);
      while(sampling)await new Promise(done=>setTimeout(done,20));
      await new Promise(done=>log.end(done));
      await recordSample(host);
      assert.equal(childFailure,undefined);assert.equal(completion.code,0,`${host} runner failed`);assert.equal(interrupted,false);
      const bytes=await readFile(report);Object.assign(job,validateSoakReport(host,JSON.parse(bytes),manifest,manifestSha256,{seconds,retention}));
      job.reportSha256=sha256(bytes);job.logSha256=sha256(await readFile(logPath));await verifyFixed();job.status='passed';
    }catch(error){job.status='failed';job.error=String(error);throw error;}
    finally{clearInterval(timer);clearTimeout(watchdog);stopOwned();active=undefined;job.completedAt=new Date().toISOString();await persist();}
  }
  summary.status='passed';summary.qualifiesTwoHourGate=options.phase==='full'&&hosts.length===3;
}catch(error){summary.status='failed';summary.error=String(error);summary.qualifiesTwoHourGate=false;stopOwned();}
finally{summary.completedAt=new Date().toISOString();summary.workspaceFinal=workspace();await persist();process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
console.log(`SOAK_COMPLETE ${JSON.stringify({status:summary.status,path:summaryPath,qualifiesTwoHourGate:summary.qualifiesTwoHourGate})}`);
process.exitCode=summary.status==='passed'?0:1;
