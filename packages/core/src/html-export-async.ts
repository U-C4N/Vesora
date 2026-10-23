import type {Figure} from './figure';
import {captureHTML,encodeCapturedHTML,downloadHTMLDocument} from './html-serialization';
import type {ExportHTMLOptions} from './html-serialization';

/** Capture now; load the self-contained HTML viewer on demand. */
export async function toHTMLAsync(figure:Figure,options:ExportHTMLOptions={}):Promise<string> {
  const capture=captureHTML(figure,options);
  try{
    const {getHTMLTemplate}=await import('./html-template');
    return encodeCapturedHTML(capture,getHTMLTemplate());
  }finally{capture.lease.release();}
}

/** Download an HTML export after its viewer template has loaded. */
export async function downloadHTMLAsync(figure:Figure,filename='figure.html',options:ExportHTMLOptions={}):Promise<void> {
  downloadHTMLDocument(await toHTMLAsync(figure,options),filename);
}
