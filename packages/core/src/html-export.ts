import type {Figure} from './figure';
import type {NumericArray, Snapshot} from './types';

declare const __VESORA_HTML_TEMPLATE__: string;
const PAYLOAD_MARKER = '__VESORA_PAYLOAD_JSON__';
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

interface HtmlPayload {
  formatVersion: 1;
  snapshot: Snapshot;
  buffers: Array<{id: string; base64: string}>;
}

function encodeBuffer(values: NumericArray): string {
  // Copy only this view, not unrelated bytes in its backing buffer.
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength).slice();
  if (!littleEndian && values.BYTES_PER_ELEMENT > 1) {
    const width = values.BYTES_PER_ELEMENT;
    for (let offset = 0; offset < bytes.length; offset += width) {
      for (let i = 0; i < width / 2; i++) {
        const a = offset + i, b = offset + width - 1 - i;
        [bytes[a], bytes[b]] = [bytes[b], bytes[a]];
      }
    }
  }
  // Complete chunks have a multiple of three bytes, so only the last can pad.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24576) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
  }
  return chunks.join('');
}

/** Serialize an interactive, self-contained figure without mounting a renderer. */
export function toHTML(figure: Figure): string {
  if (typeof __VESORA_HTML_TEMPLATE__ !== 'string') throw new Error('The HTML viewer is not bundled. Run npm run build.');
  const template = __VESORA_HTML_TEMPLATE__;
  if (template.indexOf(PAYLOAD_MARKER) < 0 || template.indexOf(PAYLOAD_MARKER) !== template.lastIndexOf(PAYLOAD_MARKER)) {
    throw new Error('The bundled HTML viewer has an invalid payload placeholder.');
  }
  const snapshot = figure.snapshot();
  const payload: HtmlPayload = {
    formatVersion: 1,
    snapshot,
    buffers: snapshot.sources.map(source => ({id: source.id, base64: encodeBuffer(figure.registry.get(source.id).values)})),
  };
  const escaped = JSON.stringify(payload).replace(/[<>&\u2028\u2029]/g, character => {
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
  return template.replace(PAYLOAD_MARKER, () => escaped);
}

/** Download the same standalone document produced by toHTML(). */
export function downloadHTML(figure: Figure, filename = 'figure.html'): void {
  const blob = new Blob([toHTML(figure)], {type: 'text/html;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
