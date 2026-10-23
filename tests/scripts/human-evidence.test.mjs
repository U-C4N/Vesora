import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {sha256} from '../../scripts/release-validation.mjs';
import {humanEvidenceTemplate,humanEvidenceReferences,validateHumanEvidence,verifyHumanEvidenceFiles,validatePNGArtifact,validateHTMLArtifact} from '../../scripts/human-evidence.mjs';

// These records are deliberately synthetic test fixtures, never human release evidence.
const context={manifest:{version:'0.9.0-rc.6',commit:'a'.repeat(40)},manifestSha256:'b'.repeat(64)};
const reference={path:'synthetic-test-only.txt',sha256:sha256(Buffer.from('synthetic test only'))};
const observedAt='2026-10-23T10:00:00+03:00';
function complete(){
  const input=humanEvidenceTemplate(context);
  Object.assign(input.screenReader,{reader:'NVDA',readerVersion:'test',language:'tr',os:'test',browser:'test',browserVersion:'test',observer:'synthetic test',observedAt,review:{reviewer:'synthetic test',reviewedAt:observedAt}});
  for(const step of input.screenReader.steps)Object.assign(step,{result:'passed',announcement:'Synthetic test announcement',evidence:[reference]});
  Object.assign(input.pilot,{observer:'synthetic test',os:'test',browser:'test',browserVersion:'test',offlineEnvironment:'test',interpolation:{absoluteTolerance:0,declaredAt:'2026-10-23T09:00:00+03:00'},review:{reviewer:'synthetic test',reviewedAt:observedAt}});
  for(const person of input.pilot.participants)Object.assign(person,{observedAt,result:'unaided',notes:'Synthetic test notes',evidence:[reference],
    steps:{surface:true,slice:true,freeze:true,export:true},
    freeze:{sourceUpdates:2,acceptedBefore:4,acceptedAfter:6,displayedFrameBefore:3,displayedFrameAfter:3},
    selectionKind:'interpolated',observationBefore:{identity:{kind:'surface',layerId:'test',cell:[0,0],triangle:0},values:{x:1,y:1,z:3,value:3}},
    observationOffline:{identity:{kind:'surface',layerId:'test',cell:[0,0],triangle:0},values:{x:1,y:1,z:3,value:3}},
    exports:[{path:'synthetic-test-only.png',sha256:sha256(png),kind:'png',observationMatches:true},{path:'synthetic-test-only.html',sha256:'d'.repeat(64),kind:'html',openedOffline:true,observationMatches:true}]});
  return input;
}
function htmlFixture(){
  const input=complete(),ref=humanEvidenceReferences(input).find(item=>item.kind==='html');
  const channels={x:[0,1],y:[0,1],z:[0,1,2,3],color:[0,1,2,3]};
  const selection={...ref.expectedObservation.identity,...ref.expectedObservation.values,interpolated:true,barycentric:[0,0,1],sourceVersions:{x:1,y:1,z:1,color:1}};
  const payload={formatVersion:1,capture:{source:'displayed',capturedAt:'2026-10-23T10:00:05+03:00',frameId:3,snapshotId:'test-snapshot'},snapshot:{figure:{protocolVersion:7,
    inspection:{capturedAt:observedAt,frameId:3,snapshotId:'test-snapshot',selection},layers:[{id:'test',kind:'surface',data:{x:'x',y:'y',z:'z',color:'color'}}]},
    sources:Object.entries(channels).map(([id,values])=>({id,dtype:'float64',shape:values.length===2?[2]:[2,2],version:1,byteLength:values.length*8}))},
    buffers:Object.entries(channels).map(([id,values])=>{const data=Buffer.alloc(values.length*8);values.forEach((value,index)=>data.writeDoubleLE(value,index*8));return {id,base64:data.toString('base64')};})};
  const bytes=()=>Buffer.from(`<!doctype html><html><script id="vesora-payload" type="application/json">${JSON.stringify(payload)}</script></html>`);
  return {ref,payload,bytes};
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB5cAAAAASUVORK5CYII=','base64');

test('blank intake is pending and never invents a human pass',()=>{
  const output=validateHumanEvidence(humanEvidenceTemplate(context),context);
  assert.equal(output.screenReader.status,'pending');assert.equal(output.betaPilot.status,'pending');assert.equal(output.betaPilot.observed,0);
  assert.equal(humanEvidenceReferences(humanEvidenceTemplate(context)).length,0);
});

test('exact candidate identity and all unique cohort/reader records are mandatory',()=>{
  for(const field of ['version','commit','manifestSha256']){const input=complete();input[field]='stale';assert.throws(()=>validateHumanEvidence(input,context));}
  const missing=complete();missing.pilot.participants.pop();assert.throws(()=>validateHumanEvidence(missing,context),/P01/);
  const duplicate=complete();duplicate.pilot.participants[4].id='P01';assert.throws(()=>validateHumanEvidence(duplicate,context),/P01/);
  const reader=complete();reader.screenReader.steps.pop();assert.throws(()=>validateHumanEvidence(reader,context),/nine/);
});

test('approved pilot threshold allows four unaided and one observed failure',()=>{
  const input=complete(),last=input.pilot.participants[4];last.result='failed';last.steps={};last.freeze={};last.exports=[];
  const output=validateHumanEvidence(input,context);assert.equal(output.betaPilot.status,'passed');assert.equal(output.betaPilot.unaided,4);
  input.pilot.participants[3].result='assisted';assert.equal(validateHumanEvidence(input,context).betaPilot.status,'failed');
});

test('four completed people and an unobserved fifth remain pending',()=>{
  const input=complete();input.pilot.participants[4]=humanEvidenceTemplate(context).pilot.participants[4];
  assert.equal(validateHumanEvidence(input,context).betaPilot.status,'pending');
});

test('every produced export matters, including a failed or pending participant',()=>{
  for(const result of ['failed','pending']){const input=complete(),person=input.pilot.participants[4];person.result=result;person.exports[0].observationMatches=false;
    assert.equal(validateHumanEvidence(input,context).betaPilot.status,'failed');}
  const mismatch=complete();mismatch.pilot.participants[0].observationOffline.identity.cell=[2,4];
  assert.equal(validateHumanEvidence(mismatch,context).betaPilot.status,'failed');
});

test('workflow, frozen identity, offline reopening and both export formats cannot be omitted',()=>{
  for(const mutate of [p=>p.steps.slice=false,p=>p.freeze.sourceUpdates=1,p=>p.freeze.displayedFrameAfter++,p=>p.freeze.acceptedAfter=4,p=>p.exports.pop(),p=>p.exports[1].openedOffline=false]){
    const input=complete();mutate(input.pilot.participants[0]);assert.equal(validateHumanEvidence(input,context).betaPilot.status,'pending');
  }
});

test('interpolation tolerance must predate the observation and never changes identity',()=>{
  const input=complete(),person=input.pilot.participants[0];person.selectionKind='interpolated';person.observationOffline.values.z+=0.00001;
  input.pilot.interpolation={absoluteTolerance:0.0001,declaredAt:'2026-10-23T09:00:00+03:00'};
  assert.equal(validateHumanEvidence(input,context).betaPilot.status,'passed');
  input.pilot.interpolation.declaredAt='2026-10-23T11:00:00+03:00';assert.notEqual(validateHumanEvidence(input,context).betaPilot.status,'passed');
  input.pilot.interpolation.declaredAt='2026-10-23T09:00:00+03:00';person.observationOffline.identity.triangle=1;assert.equal(validateHumanEvidence(input,context).betaPilot.status,'failed');
});

test('invented identities, missing surface scalar and incompatible source kinds cannot pass',()=>{
  for(const mutate of [p=>{p.observationBefore.identity=p.observationOffline.identity={note:'same'};},p=>{delete p.observationBefore.values.value;delete p.observationOffline.values.value;},p=>{p.selectionKind='source';},p=>{p.observationBefore.identity.triangle=p.observationOffline.identity.triangle=3;}]){
    const input=complete();mutate(input.pilot.participants[0]);assert.equal(validateHumanEvidence(input,context).betaPilot.status,'failed');
  }
});

test('point sourceIndex alias normalizes to the actual index without accepting malformed identities',()=>{
  const input=complete(),person=input.pilot.participants[0];person.selectionKind='source';
  person.observationBefore.identity={kind:'point3d',layerId:'test',sourceIndex:5};person.observationOffline.identity={kind:'point3d',layerId:'test',index:5,panelId:'main'};
  assert.equal(validateHumanEvidence(input,context).betaPilot.status,'passed');
  person.observationBefore.identity.sourceIndex=-1;assert.equal(validateHumanEvidence(input,context).betaPilot.status,'failed');
});

test('PNG validation rejects renamed text, missing image chunks and invalid dimensions',()=>{
  assert.deepEqual([validatePNGArtifact(png).width,validatePNGArtifact(png).height],[1,1]);
  assert.throws(()=>validatePNGArtifact(Buffer.from('not an image')),/signature/);
  assert.throws(()=>validatePNGArtifact(png.subarray(0,33)));
  const invalid=Buffer.from(png);invalid.writeUInt32BE(0,16);assert.throws(()=>validatePNGArtifact(invalid),/dimensions/);
});

test('HTML validation binds the recorded observation and frame to the displayed export payload',()=>{
  const fixture=htmlFixture();assert.equal(validateHTMLArtifact(fixture.bytes(),fixture.ref).frameId,3);
  for(const mutate of [f=>{f.payload.capture.source='accepted';},f=>{f.payload.snapshot.figure.inspection.selection.cell=[1,0];},f=>{delete f.payload.snapshot.figure.inspection.selection.value;},f=>{f.payload.snapshot.figure.inspection.selection.sourceVersions.color=2;},f=>{f.payload.snapshot.figure.inspection.selection.z=999;},f=>{f.payload.buffers[0].base64='';},f=>{f.payload.capture.frameId=9;},f=>{f.payload.snapshot.figure.inspection.selection.value=999;f.ref.expectedObservation.values.value=999;}]){
    const changed=htmlFixture();mutate(changed);assert.throws(()=>validateHTMLArtifact(changed.bytes(),changed.ref));
  }
  assert.throws(()=>validateHTMLArtifact(Buffer.from('not HTML'),fixture.ref),/doctype/);
});

test('later export timestamps and camera frames preserve a valid frozen observation',()=>{
  const fixture=htmlFixture();fixture.payload.capture.frameId=fixture.payload.snapshot.figure.inspection.frameId=4;
  assert.equal(validateHTMLArtifact(fixture.bytes(),fixture.ref).frameId,4);
  assert.notEqual(fixture.payload.capture.capturedAt,fixture.payload.snapshot.figure.inspection.capturedAt);
});

test('screen-reader announcements, versions, review and every real step are required',()=>{
  assert.equal(validateHumanEvidence(complete(),context).screenReader.status,'passed');
  for(const mutate of [i=>i.screenReader.readerVersion=null,i=>i.screenReader.steps[0].announcement=null,i=>i.screenReader.steps[0].evidence=[],i=>i.screenReader.steps[0].result='pending',i=>i.screenReader.review.reviewer=null]){
    const input=complete();mutate(input);assert.equal(validateHumanEvidence(input,context).screenReader.status,'pending');
  }
  const input=complete();input.screenReader.steps[0].result='failed';assert.equal(validateHumanEvidence(input,context).screenReader.status,'failed');
});

test('artifact validation rejects changed hashes, missing files and directory escape',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'vesora-human-contract-'));
  t.after(async()=>{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(directory.includes('vesora-human-contract-'));await rm(directory,{recursive:true,force:true});});
  await writeFile(join(directory,reference.path),'synthetic test only');
  assert.equal((await verifyHumanEvidenceFiles(directory,[reference])).length,1);
  await assert.rejects(verifyHumanEvidenceFiles(directory,[{...reference,sha256:'c'.repeat(64)}]),/changed/);
  await assert.rejects(verifyHumanEvidenceFiles(directory,[{...reference,path:'missing.txt'}]));
  await assert.rejects(verifyHumanEvidenceFiles(directory,[{...reference,path:'../outside.txt'}]),/inside/);
  await assert.rejects(verifyHumanEvidenceFiles(directory,[{...reference,path:resolve(directory,reference.path)}]),/relative/);
  await assert.rejects(verifyHumanEvidenceFiles(directory,[{...reference,kind:'png'}]),/PNG/);
  await assert.rejects(verifyHumanEvidenceFiles(directory,[{...reference,kind:'html'}]),/HTML/);
  const html=htmlFixture();await writeFile(join(directory,'export.png'),png);await writeFile(join(directory,'export.html'),html.bytes());
  assert.equal((await verifyHumanEvidenceFiles(directory,[{path:'export.png',sha256:sha256(png),kind:'png'},{...html.ref,path:'export.html',sha256:sha256(html.bytes())}])).length,2);
});
