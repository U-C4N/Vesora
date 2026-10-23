// Human observations are supplied by an observer. This module never simulates them.
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import {sha256} from './release-validation.mjs';

export const screenReaderSteps=['structure','focus','disclosures','surface-slice','freeze','resume','independent-viewers','observation','offline-export'];
const participantIds=['P01','P02','P03','P04','P05'];
const filled=value=>typeof value==='string'&&value.trim().length>0&&!['—','pending','not run'].includes(value.trim());
const date=value=>filled(value)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const evidence=value=>Array.isArray(value)&&value.length>0;
const reviewed=value=>filled(value?.reviewer)&&date(value?.reviewedAt);
const result=(missing,failed,details)=>({status:failed.length?'failed':missing.length?'pending':'passed',missing,failed,...details});

export function humanEvidenceTemplate({manifest,manifestSha256}){
  return {
    schemaVersion:1,version:manifest.version,commit:manifest.commit,manifestSha256,
    notice:'Enter only observed human results. Validation checks completeness and supplied artifacts; it does not establish that an observation happened or update release gates.',
    screenReader:{reader:null,readerVersion:null,language:null,os:null,browser:null,browserVersion:null,observer:null,observedAt:null,
      steps:screenReaderSteps.map(id=>({id,result:'pending',announcement:null,notes:null,evidence:[]})),review:{reviewer:null,reviewedAt:null}},
    pilot:{observer:null,os:null,browser:null,browserVersion:null,offlineEnvironment:null,
      interpolation:{absoluteTolerance:null,declaredAt:null},
      participants:participantIds.map((id,index)=>({id,profile:index<3?'scientific':'telemetry',observedAt:null,result:'pending',notes:null,
        steps:{surface:false,slice:false,freeze:false,export:false},
        freeze:{sourceUpdates:null,acceptedBefore:null,acceptedAfter:null,displayedFrameBefore:null,displayedFrameAfter:null},
        selectionKind:null,observationBefore:null,observationOffline:null,exports:[],evidence:[]})),
      review:{reviewer:null,reviewedAt:null}},
  };
}

function requireFields(record,fields,missing,prefix){for(const field of fields)if(!filled(record?.[field]))missing.push(`${prefix}.${field}`);}
const ordinal=value=>Number.isSafeInteger(value)&&value>=0;
function normalizedIdentity(identity){
  if(!identity||typeof identity!=='object'||Array.isArray(identity)||!filled(identity.layerId))return;
  if(identity.panelId!==undefined&&!filled(identity.panelId))return;
  const base={kind:identity.kind,layerId:identity.layerId,panelId:identity.panelId??'main'};
  if(identity.kind==='point3d'){
    const index=identity.index??identity.sourceIndex;
    if(!ordinal(index)||identity.index!==undefined&&identity.sourceIndex!==undefined&&identity.index!==identity.sourceIndex)return;
    return {...base,index};
  }
  if(identity.kind==='surface'&&Array.isArray(identity.cell)&&identity.cell.length===2&&identity.cell.every(ordinal)&&[0,1].includes(identity.triangle))return {...base,cell:identity.cell,triangle:identity.triangle};
  if(identity.kind==='segment3d'&&Array.isArray(identity.indices)&&identity.indices.length===2&&identity.indices.every(ordinal)&&identity.indices[1]===identity.indices[0]+1&&Number.isFinite(identity.t)&&identity.t>=0&&identity.t<=1)return {...base,indices:identity.indices,t:identity.t};
}
function validObservation(observation){
  const identity=normalizedIdentity(observation?.identity),values=observation?.values;
  return !!identity&&!!values&&['x','y','z',...(identity.kind==='surface'?['value']:[])].every(key=>Number.isFinite(values[key]))&&Object.keys(values).every(key=>['x','y','z','value'].includes(key)&&Number.isFinite(values[key]));
}
function matchingObservation(before,after,tolerance){
  if(!validObservation(before)||!validObservation(after))return false;
  try{assert.deepEqual(normalizedIdentity(after.identity),normalizedIdentity(before.identity));}catch{return false;}
  const keys=Object.keys(before.values??{});
  if(!['x','y','z'].every(key=>keys.includes(key))||keys.length!==Object.keys(after.values??{}).length)return false;
  return keys.every(key=>Number.isFinite(before.values[key])&&Number.isFinite(after.values[key])&&Math.abs(before.values[key]-after.values[key])<=tolerance);
}

export function validateHumanEvidence(input,{manifest,manifestSha256}){
  assert.equal(input.schemaVersion,1,'Unsupported human evidence schema');
  assert.equal(input.version,manifest.version,'Human evidence belongs to another version');
  assert.equal(input.commit,manifest.commit,'Human evidence belongs to another commit');
  assert.equal(input.manifestSha256,manifestSha256,'Human evidence belongs to different archive bytes');
  const sr=input.screenReader,pilot=input.pilot;assert.ok(sr&&pilot,'Both human evidence sections are required');
  assert.deepEqual(sr.steps?.map(step=>step.id),screenReaderSteps,'All nine screen-reader steps are required, once and in order');
  assert.deepEqual(pilot.participants?.map(person=>person.id),participantIds,'P01–P05 are required, once and in order');
  const srMissing=[],srFailed=[],pilotMissing=[],pilotFailed=[];
  requireFields(sr,['reader','readerVersion','language','os','browser','browserVersion','observer'],srMissing,'screenReader');
  if(!['Narrator','NVDA'].includes(sr.reader))srMissing.push('screenReader.reader must be Narrator or NVDA');
  if(!date(sr.observedAt))srMissing.push('screenReader.observedAt');
  if(!reviewed(sr.review))srMissing.push('screenReader.review');
  for(const step of sr.steps){
    assert.ok(['pending','passed','failed'].includes(step.result),`Invalid screen-reader result: ${step.id}`);
    if(step.result==='pending')srMissing.push(`screenReader.${step.id} not observed`);
    if(step.result==='failed')srFailed.push(`screenReader.${step.id}`);
    if(step.result!=='pending'&&(!filled(step.announcement)||!evidence(step.evidence)))srMissing.push(`screenReader.${step.id} announcement/evidence`);
  }
  requireFields(pilot,['observer','os','browser','browserVersion','offlineEnvironment'],pilotMissing,'pilot');
  if(!reviewed(pilot.review))pilotMissing.push('pilot.review');
  let unaided=0,observed=0;
  for(const [index,person]of pilot.participants.entries()){
    assert.equal(person.profile,index<3?'scientific':'telemetry',`${person.id} profile differs from the approved pilot cohort`);
    assert.ok(['pending','unaided','assisted','failed'].includes(person.result),`Invalid pilot result: ${person.id}`);
    assert.ok(Array.isArray(person.exports),`${person.id}.exports must be an array`);
    if(person.result==='pending')pilotMissing.push(`${person.id} not observed`);
    else{
      observed++;if(person.result==='unaided')unaided++;
      if(!date(person.observedAt)||!filled(person.notes)||!evidence(person.evidence))pilotMissing.push(`${person.id} observation date/notes/evidence`);
    }
    if(person.result==='unaided'||person.result==='assisted'){
      if(!['surface','slice','freeze','export'].every(key=>person.steps?.[key]===true))pilotMissing.push(`${person.id} complete workflow`);
      const frozen=person.freeze;
      if(!frozen||!Number.isSafeInteger(frozen.sourceUpdates)||frozen.sourceUpdates<2||!Number.isSafeInteger(frozen.acceptedBefore)||frozen.acceptedBefore<0||!Number.isSafeInteger(frozen.acceptedAfter)||frozen.acceptedAfter<=frozen.acceptedBefore||!Number.isSafeInteger(frozen.displayedFrameBefore)||frozen.displayedFrameBefore<1||frozen.displayedFrameAfter!==frozen.displayedFrameBefore)pilotMissing.push(`${person.id} two source updates during a stable displayed frame`);
      if(!person.exports.some(item=>item.kind==='png')||!person.exports.some(item=>item.kind==='html'))pilotMissing.push(`${person.id} PNG and HTML exports`);
    }
    for(const artifact of person.exports){
      assert.ok(['png','html'].includes(artifact.kind),`${person.id} unknown export kind`);
      if(artifact.observationMatches===false)pilotFailed.push(`${person.id} incorrect exported observation`);
      else if(artifact.observationMatches!==true)pilotMissing.push(`${person.id} export observation verification`);
      if(artifact.kind==='html'&&artifact.openedOffline!==true)pilotMissing.push(`${person.id} offline HTML reopening`);
    }
    if(person.exports.length){
      let tolerance=0;
      if(person.selectionKind==='interpolated'){
        const declared=pilot.interpolation;
        if(!Number.isFinite(declared?.absoluteTolerance)||declared.absoluteTolerance<0||!date(declared.declaredAt)||!date(person.observedAt)||Date.parse(declared.declaredAt)>Date.parse(person.observedAt))pilotMissing.push(`${person.id} interpolation tolerance declared before observation`);
        else tolerance=declared.absoluteTolerance;
      }else if(person.selectionKind!=='source')pilotMissing.push(`${person.id} selectionKind`);
      const selectedKind=person.observationBefore?.identity?.kind;
      if(selectedKind&&(person.selectionKind==='source')!==(selectedKind==='point3d'))pilotFailed.push(`${person.id} source/interpolated kind differs from observation identity`);
      if(!person.observationBefore||!person.observationOffline)pilotMissing.push(`${person.id} before/offline observation`);
      else if(!matchingObservation(person.observationBefore,person.observationOffline,tolerance))pilotFailed.push(`${person.id} mismatched observation identity/values`);
    }
  }
  if(observed<5)pilotMissing.push('All five participants must be observed');
  else if(unaided<4)pilotFailed.push('Fewer than four of five completed the workflow unaided');
  return {screenReader:result(srMissing,srFailed,{scope:'Human screen-reader smoke only; other accessibility checks remain separately required'}),
    betaPilot:result(pilotMissing,pilotFailed,{observed,unaided,requiredParticipants:5,requiredUnaided:4})};
}

export function humanEvidenceReferences(input){
  return [...input.screenReader.steps.flatMap(step=>step.evidence??[]),...input.pilot.participants.flatMap(person=>[...person.evidence??[],...(person.exports??[]).map(artifact=>({...artifact,
    expectedObservation:person.observationBefore,selectionKind:person.selectionKind,
    tolerance:person.selectionKind==='interpolated'?input.pilot.interpolation?.absoluteTolerance:0}))])];
}

export function validatePNGArtifact(bytes){
  assert.ok(bytes.length>=57&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG export has no PNG signature');
  let offset=8,header=false,data=false,ended=false,width,height;
  while(offset+12<=bytes.length){
    const length=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);
    assert.ok(offset+12+length<=bytes.length,'PNG chunk is truncated');
    if(!header){assert.equal(kind,'IHDR','PNG must start with IHDR');assert.equal(length,13,'PNG IHDR length is invalid');width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);assert.ok(width>0&&height>0,'PNG dimensions are invalid');header=true;}
    else assert.notEqual(kind,'IHDR','PNG has duplicate IHDR');
    if(kind==='IDAT'&&length>0)data=true;
    offset+=12+length;
    if(kind==='IEND'){assert.equal(length,0);ended=true;break;}
  }
  assert.ok(header&&data&&ended&&offset===bytes.length,'PNG export needs complete IHDR, IDAT and IEND chunks');
  return {width,height,observationVerification:'human attestation required; PNG pixels do not encode observation identity'};
}

export function validateHTMLArtifact(bytes,reference){
  const html=bytes.toString('utf8');
  assert.match(html,/<!doctype\s+html\s*>/i,'HTML export has no document doctype');
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(match=>/\bid\s*=\s*(["'])vesora-payload\1/i.test(match[1]));
  assert.equal(scripts.length,1,'HTML export needs one vesora-payload script');assert.match(scripts[0][1],/\btype\s*=\s*(["'])application\/json\1/i,'HTML payload must be JSON');
  const payload=JSON.parse(scripts[0][2]),figure=payload.snapshot?.figure,inspection=figure?.inspection,selection=inspection?.selection;
  assert.equal(payload.formatVersion,1,'Unsupported HTML payload format');assert.equal(figure?.protocolVersion,7,'Pilot HTML must contain protocol 7');
  assert.equal(payload.capture?.source,'displayed','Pilot HTML must capture the displayed frame');
  assert.ok(date(payload.capture.capturedAt)&&date(inspection?.capturedAt),'HTML capture time is missing');
  // The export lease has its own timestamp; inspection retains the earlier frozen time.
  assert.ok(Number.isSafeInteger(inspection.frameId)&&inspection.frameId>0,'HTML captured frame is missing');
  assert.equal(payload.capture.frameId,inspection.frameId,'HTML captured frame differs');
  assert.ok(filled(inspection.snapshotId),'Pilot HTML must retain a frozen snapshot identity');assert.equal(payload.capture.snapshotId,inspection.snapshotId,'HTML snapshot identity differs');
  assert.ok(selection&&filled(selection.layerId),'HTML has no selected observation');
  assert.ok(Array.isArray(figure.layers)&&Array.isArray(payload.snapshot.sources)&&Array.isArray(payload.buffers),'HTML scene data is missing');
  const layer=figure.layers.find(item=>item.id===selection.layerId);assert.ok(layer,'HTML selected layer is missing');
  assert.equal(layer.kind,{surface:'surface',point3d:'scatter3d',segment3d:'line3d'}[selection.kind],'HTML selection kind differs from its layer');
  assert.equal(selection.panelId??'main',layer.panelId??'main','HTML selection panel differs from its layer');
  assert.equal(selection.interpolated,selection.kind!=='point3d','HTML interpolation status differs from selection kind');
  const widths={float64:8,float32:4,int32:4,uint32:4,int16:2,uint16:2,int8:1,uint8:1},descriptors=new Map(),buffers=new Map();
  for(const source of payload.snapshot.sources){
    assert.ok(filled(source.id)&&!descriptors.has(source.id)&&widths[source.dtype]&&Array.isArray(source.shape)&&source.shape.length&&source.shape.every(ordinal)&&ordinal(source.version),'HTML source descriptor is invalid');
    const length=source.shape.reduce((a,b)=>a*b,1)*widths[source.dtype];assert.ok(Number.isSafeInteger(length)&&source.byteLength===length,'HTML source byte length differs from its shape');descriptors.set(source.id,source);
  }
  assert.equal(payload.buffers.length,descriptors.size,'HTML binary source count differs');
  for(const buffer of payload.buffers){
    const descriptor=descriptors.get(buffer.id);assert.ok(descriptor&&!buffers.has(buffer.id)&&typeof buffer.base64==='string','HTML binary source is invalid');
    assert.ok(/^[A-Za-z0-9+/]*={0,2}$/.test(buffer.base64)&&buffer.base64.length===4*Math.ceil(descriptor.byteLength/3),'HTML binary encoding is invalid');
    const data=Buffer.from(buffer.base64,'base64');assert.equal(data.length,descriptor.byteLength,'HTML binary source is truncated');buffers.set(buffer.id,data);
  }
  for(const [channel,id]of Object.entries(layer.data??{})){const descriptor=descriptors.get(id);assert.ok(descriptor,`HTML selected layer source is missing: ${channel}`);assert.equal(selection.sourceVersions?.[channel],descriptor.version,`HTML selected source version differs: ${channel}`);}
  for(const channel of ['x','y','z'])assert.ok(layer.data?.[channel]&&descriptors.has(layer.data[channel]),`HTML selected ${channel} data is missing`);
  const identity=normalizedIdentity(selection);assert.ok(identity,'HTML selected observation identity is invalid');
  const count=channel=>descriptors.get(layer.data[channel]).shape.reduce((a,b)=>a*b,1);
  const readers={float64:'readDoubleLE',float32:'readFloatLE',int32:'readInt32LE',uint32:'readUInt32LE',int16:'readInt16LE',uint16:'readUInt16LE',int8:'readInt8',uint8:'readUInt8'};
  const sample=(channel,index)=>{const descriptor=descriptors.get(layer.data[channel]);assert.ok(ordinal(index)&&index<count(channel),'HTML selected source sample is out of bounds');return buffers.get(descriptor.id)[readers[descriptor.dtype]](index*widths[descriptor.dtype]);};
  const sameNumber=(actual,expected)=>Number.isFinite(actual)&&Number.isFinite(expected)&&Math.abs(actual-expected)<=64*Number.EPSILON*Math.max(1,Math.abs(actual),Math.abs(expected));
  if(selection.kind==='surface'){
    assert.ok(selection.cell[0]<count('y')-1&&selection.cell[1]<count('x')-1&&count('z')===count('x')*count('y'),'HTML surface cell is outside its source grid');
    assert.ok(Array.isArray(selection.barycentric)&&selection.barycentric.length===3&&selection.barycentric.every(value=>Number.isFinite(value)&&value>=-1e-7&&value<=1+1e-7)&&Math.abs(selection.barycentric.reduce((a,b)=>a+b,0)-1)<1e-6,'HTML surface barycentric coordinates are invalid');
    const columns=count('x'),first=selection.cell[0]*columns+selection.cell[1],indices=selection.triangle===0?[first,first+1,first+columns+1]:[first,first+columns+1,first+columns],channel=layer.data.color?'color':'z';
    assert.equal(count(channel),count('z'),'HTML surface scalar shape differs from its grid');
    const scalar=indices.reduce((total,index,j)=>total+sample(channel,index)*selection.barycentric[j],0);
    assert.ok(sameNumber(selection.value,scalar),'HTML selected scalar differs from its source triangle');
  }else{
    const last=selection.kind==='point3d'?identity.index:identity.indices[1];
    assert.ok(['x','y','z',...(layer.data.color?['color']:[])].every(channel=>last<count(channel)),'HTML selected source index is out of bounds');
    if(selection.kind==='point3d')for(const channel of ['x','y','z'])assert.ok(sameNumber(selection[channel],sample(channel,identity.index)),`HTML selected ${channel} differs from its original sample`);
    if(layer.data.color){const scalar=selection.kind==='point3d'?sample('color',identity.index):sample('color',identity.indices[0])*(1-identity.t)+sample('color',identity.indices[1])*identity.t;assert.ok(sameNumber(selection.value,scalar),'HTML selected scalar differs from its source samples');}
  }
  const observation={identity,values:Object.fromEntries(['x','y','z',...(selection.value!==undefined?['value']:[])].map(key=>[key,selection[key]]))};
  assert.ok(validObservation(observation),'HTML selected coordinates/scalar are invalid');
  if(layer.data.color)assert.ok(Number.isFinite(selection.value),'HTML omits its independent scalar observation');
  assert.ok(validObservation(reference.expectedObservation),'Recorded observation requires a supported identity and coordinates/scalar');
  assert.ok(Number.isFinite(reference.tolerance)&&reference.tolerance>=0,'Recorded observation tolerance is missing');
  assert.ok(matchingObservation(reference.expectedObservation,observation,reference.tolerance),'HTML selected identity/values differ from the recorded observation');
  assert.equal(reference.selectionKind,selection.interpolated?'interpolated':'source','Recorded selection kind differs from HTML');
  // Camera/slice edits can complete another frame after the measured freeze interval.
  return {formatVersion:1,protocolVersion:7,frameId:inspection.frameId,snapshotId:inspection.snapshotId,selectedLayer:layer.id};
}

export async function verifyHumanEvidenceFiles(directory,references){
  const root=await realpath(directory),verified=[];
  for(const reference of references){
    assert.ok(filled(reference.path)&&!isAbsolute(reference.path),'Evidence requires a session-relative path');
    const path=resolve(root,reference.path),rel=relative(root,path);
    assert.ok(rel&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../')&&!isAbsolute(rel),'Evidence must stay inside the session directory');
    const actual=await realpath(path),actualRel=relative(root,actual);
    assert.ok(actualRel&&actualRel!=='..'&&!actualRel.startsWith('..\\')&&!actualRel.startsWith('../')&&!isAbsolute(actualRel),'Evidence symlink must stay inside the session directory');
    assert.match(reference.sha256??'',/^[a-f0-9]{64}$/,'Evidence requires a SHA-256');
    const bytes=await readFile(actual);assert.ok(bytes.length,'Evidence file is empty');
    assert.equal(sha256(bytes),reference.sha256,`Evidence bytes changed: ${reference.path}`);
    const format=reference.kind==='png'?validatePNGArtifact(bytes):reference.kind==='html'?validateHTMLArtifact(bytes,reference):undefined;
    verified.push({path:reference.path,sha256:reference.sha256,bytes:bytes.length,...(format?{format}:{})});
  }
  return verified;
}
