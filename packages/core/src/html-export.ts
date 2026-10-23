import type {Figure} from './figure';
import type {DataRegistry} from './data';
import type {Snapshot} from './types';
import {captureHTML,encodeCapturedHTML,serializeHTMLSnapshot,downloadHTMLDocument} from './html-serialization';
import type {ExportHTMLOptions} from './html-serialization';
import {getHTMLTemplate} from './html-template';

export {encodeEntryBuffer} from './html-serialization';
export type {ExportHTMLOptions} from './html-serialization';

/** Synchronous compatibility API. Use @vesora/core/runtime for on-demand HTML export. */
export function toHTML(figure:Figure,options:ExportHTMLOptions={}):string {
  const capture=captureHTML(figure,options);
  try{return encodeCapturedHTML(capture,getHTMLTemplate());}
  finally{capture.lease.release();}
}

/** Internal serializer for an already owned snapshot lease (including Labs A/B). */
export function encodeHTMLSnapshot(snapshot:Snapshot,registry:DataRegistry,capture?:Parameters<typeof serializeHTMLSnapshot>[3],includeObservation=false):string {
  return serializeHTMLSnapshot(getHTMLTemplate(),snapshot,registry,capture,includeObservation);
}

/** Download the same standalone document produced by toHTML(). */
export function downloadHTML(figure:Figure,filename='figure.html',options:ExportHTMLOptions={}):void {
  downloadHTMLDocument(toHTML(figure,options),filename);
}
