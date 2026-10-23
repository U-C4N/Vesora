// CPU-only paired benchmark of the old byte-copy loop and current HTML encoder.
// It measures serialization, not rendering, transport, or end-to-end export time.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {cpus,platform,arch} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=resolve(root,'packages/core/src/html-export.ts');
const compiled=await build({absWorkingDir:root,entryPoints:[source],bundle:true,platform:'node',format:'esm',write:false});
const {encodeEntryBuffer}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
function baseline(entry){
  const scratch=new Uint8Array(24576),output=[];let used=0;
  for(const values of entry.chunks??[entry.values]){
    const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);
    for(let offset=0;offset<bytes.length;offset++){
      scratch[used++]=bytes[offset];
      if(used===scratch.length){output.push(btoa(String.fromCharCode(...scratch)));used=0;}
    }
  }
  if(used)output.push(btoa(String.fromCharCode(...scratch.subarray(0,used))));
  return output.join('');
}
assert.equal(new Uint8Array(new Uint16Array([1]).buffer)[0],1,'Benchmark baseline is little-endian');
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const cases=[];
for(const chunked of [false,true]){
  const values=Float64Array.from({length:500_003},(_,i)=>Math.sin(i)*1e6),chunks=[];
  for(let start=0;start<values.length;start+=4096)chunks.push(values.subarray(start,start+4096));
  const entry=chunked?{chunks,get values(){throw new Error('Chunked export must not materialize');}}:{values};
  const expected=Buffer.from(values.buffer).toString('base64'),before=[],after=[];
  for(let round=-2;round<9;round++)for(const optimized of round%2?[true,false]:[false,true]){
    const start=performance.now(),actual=(optimized?encodeEntryBuffer:baseline)(entry),duration=performance.now()-start;
    assert.equal(actual,expected);if(round>=0)(optimized?after:before).push(duration);
  }
  cases.push({kind:chunked?'immutable-chunks':'contiguous',bytes:values.byteLength,rounds:9,beforeMs:before,afterMs:after,beforeMedianMs:median(before),afterMedianMs:median(after),speedup:median(before)/median(after),exactBase64:true});
}
const report={capturedAt:new Date().toISOString(),node:process.version,platform:platform(),arch:arch(),cpu:cpus()[0]?.model,sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex'),scope:'CPU encoding only; no GPU or end-to-end performance claim',cases};
const output=resolve(root,'artifacts/product-update/html-encoding.json');await mkdir(resolve(root,'artifacts/product-update'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,cases:cases.map(({kind,beforeMedianMs,afterMedianMs,speedup,exactBase64})=>({kind,beforeMedianMs,afterMedianMs,speedup,exactBase64}))},null,2));
