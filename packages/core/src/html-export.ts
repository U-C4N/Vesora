import type {Figure} from './figure';
import type {DataRegistry} from './data';
import type {DataEntry, Snapshot} from './types';

declare const __VESORA_HTML_TEMPLATE__: string;
const PAYLOAD_MARKER = '__VESORA_PAYLOAD_JSON__';
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

interface HtmlPayload {
  formatVersion: 1;
  snapshot: Snapshot;
  buffers: Array<{id: string; base64: string}>;
  capture?: {source:'accepted'|'displayed';capturedAt:string;frameId?:number;snapshotId?:string};
}
export interface ExportHTMLOptions {source?:'accepted'|'displayed'}

export function encodeEntryBuffer(entry:DataEntry):string {
  // Encoding scratch/output is separate from source storage. Never materialize
  // the retained numeric window merely to serialize it. Carry bytes across
  // numeric chunk boundaries so only the final base64 block may be padded.
  const scratch=new Uint8Array(24576),output:string[]=[];let used=0;
  for(const values of entry.chunks??[entry.values]){
    const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength),width=values.BYTES_PER_ELEMENT;
    for(let offset=0;offset<bytes.length;offset++){
      const index=littleEndian?offset:Math.floor(offset/width)*width+width-1-offset%width;
      scratch[used++]=bytes[index];
      if(used===scratch.length){output.push(btoa(String.fromCharCode(...scratch)));used=0;}
    }
  }
  if(used)output.push(btoa(String.fromCharCode(...scratch.subarray(0,used))));
  return output.join('');
}

/** Serialize an interactive, self-contained figure without mounting a renderer. */
export function toHTML(figure: Figure, options:ExportHTMLOptions={}): string {
  const lease=figure.captureExport(options.source??'accepted');
  try{return encodeHTMLSnapshot(lease.snapshot,lease.registry,{source:options.source??'accepted',capturedAt:lease.capturedAt,...(options.source==='displayed'?{frameId:figure.getInspectionState().frameId,snapshotId:figure.getInspectionState().snapshotId}:{})});}
  finally{lease.release();}
}

/** Internal serializer for an already owned snapshot lease (including Labs A/B). */
export function encodeHTMLSnapshot(snapshot:Snapshot,registry:DataRegistry,capture?:HtmlPayload['capture']):string {
  if (typeof __VESORA_HTML_TEMPLATE__ !== 'string') throw new Error('The HTML viewer is not bundled. Run npm run build.');
  const template = __VESORA_HTML_TEMPLATE__;
  if (template.indexOf(PAYLOAD_MARKER) < 0 || template.indexOf(PAYLOAD_MARKER) !== template.lastIndexOf(PAYLOAD_MARKER)) {
    throw new Error('The bundled HTML viewer has an invalid payload placeholder.');
  }
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

/** Download the same standalone document produced by toHTML(). */
export function downloadHTML(figure: Figure, filename = 'figure.html', options:ExportHTMLOptions={}): void {
  const blob = new Blob([toHTML(figure,options)], {type: 'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
