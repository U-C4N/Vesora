import type {Figure} from './figure';
import type {DataRegistry} from './data';
import type {DataEntry, Snapshot} from './types';
import {OBSERVATION_PROTOCOL_VERSION} from './types';
import {validateObservationMetadata} from './observation';
import type {SnapshotLease} from './snapshot-store';

const PAYLOAD_MARKER = '__VESORA_PAYLOAD_JSON__';
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

interface HtmlPayload {
  formatVersion: 1;
  snapshot: Snapshot;
  buffers: Array<{id: string; base64: string}>;
  capture?: {source:'accepted'|'displayed';capturedAt:string;frameId?:number;snapshotId?:string};
}
export interface ExportHTMLOptions {source?:'accepted'|'displayed';observation?:boolean}

export function encodeEntryBuffer(entry:DataEntry):string {
  // Encoding scratch/output is separate from source storage. Never materialize
  // the retained numeric window merely to serialize it. Carry bytes across
  // numeric chunk boundaries so only the final base64 block may be padded.
  const scratch=new Uint8Array(24576),output:string[]=[];let used=0;
  for(const values of entry.chunks??[entry.values]){
    const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength),width=values.BYTES_PER_ELEMENT;
    if(littleEndian){
      for(let offset=0;offset<bytes.length;){
        const count=Math.min(scratch.length-used,bytes.length-offset);
        scratch.set(bytes.subarray(offset,offset+count),used);used+=count;offset+=count;
        if(used===scratch.length){output.push(btoa(String.fromCharCode(...scratch)));used=0;}
      }
      continue;
    }
    for(let offset=0;offset<bytes.length;offset++){
      const index=Math.floor(offset/width)*width+width-1-offset%width;
      scratch[used++]=bytes[index];
      if(used===scratch.length){output.push(btoa(String.fromCharCode(...scratch)));used=0;}
    }
  }
  if(used)output.push(btoa(String.fromCharCode(...scratch.subarray(0,used))));
  return output.join('');
}

/** Capture before an asynchronous template load so scene, data and evidence stay atomic. */
export function captureHTML(figure:Figure,options:ExportHTMLOptions={}):{lease:SnapshotLease;source:'accepted'|'displayed';observation:boolean} {
  if(options.observation!==undefined&&typeof options.observation!=='boolean')throw new TypeError('observation must be a boolean');
  const source=options.source??'accepted',observation=options.observation??false;
  return {lease:figure.captureExport(source),source,observation};
}

export function encodeCapturedHTML(capture:ReturnType<typeof captureHTML>,template:string):string {
  const {lease,source,observation}=capture;
  // Imported evidence describes its original capture. Only an explicit request
  // creates a new record from the same owned sources as this HTML document.
  delete lease.snapshot.figure.observation;
  if(observation){
    if(!lease.observation)throw new Error('Export observation context was not captured');
    lease.snapshot.figure.protocolVersion=Math.max(OBSERVATION_PROTOCOL_VERSION,lease.snapshot.figure.protocolVersion);
    lease.snapshot.figure.observation=lease.observation;
    validateObservationMetadata(lease.snapshot.figure,lease.snapshot.sources);
  }
  const representation=lease.observation?.representation;
  return serializeHTMLSnapshot(template,lease.snapshot,lease.registry,{source,capturedAt:lease.capturedAt,...(representation?.status==='rendered'?{frameId:representation.frameId,...(representation.snapshotId?{snapshotId:representation.snapshotId}:{})}:{})},observation);
}

/** Internal serializer for an already owned snapshot lease (including Labs A/B). */
export function serializeHTMLSnapshot(template:string,snapshot:Snapshot,registry:DataRegistry,capture?:HtmlPayload['capture'],includeObservation=false):string {
  if (template.indexOf(PAYLOAD_MARKER) < 0 || template.indexOf(PAYLOAD_MARKER) !== template.lastIndexOf(PAYLOAD_MARKER)) {
    throw new Error('The bundled HTML viewer has an invalid payload placeholder.');
  }
  // Other callers (such as a Labs pin) also export without carrying old evidence
  // implicitly. Strip only the serialized copy, leaving their pinned scene intact.
  if(snapshot.figure.observation&&!includeObservation){const {observation,...figure}=snapshot.figure;snapshot={...snapshot,figure};}
  const payload: HtmlPayload = {
    formatVersion: 1,
    snapshot,
    buffers: snapshot.sources.map(source => ({id: source.id, base64: encodeEntryBuffer(registry.get(source.id))})),
    capture,
  };
  const escaped = JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g, character => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return template.replace(PAYLOAD_MARKER, () => escaped);
}

/** Download an already captured standalone document. */
export function downloadHTMLDocument(html:string,filename:string):void {
  const blob = new Blob([html], {type: 'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
