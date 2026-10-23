declare const __VESORA_HTML_TEMPLATE__:string;

/** Build-generated self-contained viewer, loaded only when HTML export is requested. */
export function getHTMLTemplate():string {
  if(typeof __VESORA_HTML_TEMPLATE__!=='string')throw new Error('The HTML viewer is not bundled. Run npm run build.');
  return __VESORA_HTML_TEMPLATE__;
}
