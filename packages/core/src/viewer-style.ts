/** Every selector is rooted at the viewer; embedding never restyles the host page. */
export const VIEWER_STYLE = `
[data-vesora-viewer]{--vv-bg:#101215;--vv-panel:#171a1f;--vv-text:#edf0f4;--vv-muted:#a2abb8;--vv-line:#343b46;--vv-control:#637081;--vv-accent:#c5f36b;--vv-error:#ffb3a8;container:vesora-viewer / inline-size;color-scheme:dark;box-sizing:border-box;display:block;position:relative;min-width:0;background:var(--vv-bg);color:var(--vv-text);border:1px solid var(--vv-line);border-radius:8px;overflow:hidden;font:13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
[data-vesora-viewer][data-theme=light]{--vv-bg:#fbfcfd;--vv-panel:#f0f3f6;--vv-text:#18202a;--vv-muted:#4e5b6b;--vv-line:#c8d0da;--vv-control:#768392;--vv-accent:#426b0a;--vv-error:#a82424;color-scheme:light}
[data-vesora-viewer] *,[data-vesora-viewer] *:before,[data-vesora-viewer] *:after{box-sizing:border-box}
[data-vesora-viewer] [hidden]{display:none!important}
[data-vesora-viewer] button,[data-vesora-viewer] select,[data-vesora-viewer] input{font:inherit;color:inherit}
[data-vesora-viewer] button,[data-vesora-viewer] select{min-height:36px;border:1px solid var(--vv-control);border-radius:4px;background:var(--vv-panel);padding:6px 10px;cursor:pointer}
[data-vesora-viewer] button:hover:not(:disabled){border-color:var(--vv-muted)}
[data-vesora-viewer] button:disabled{opacity:.5;cursor:default}
[data-vesora-viewer] button:focus-visible,[data-vesora-viewer] select:focus-visible,[data-vesora-viewer] input:focus-visible,[data-vesora-viewer] summary:focus-visible{outline:2px solid var(--vv-accent);outline-offset:3px}
[data-vesora-viewer] button[aria-pressed=true]{border-color:var(--vv-accent);color:var(--vv-accent)}
[data-vesora-viewer] .vv-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px;border-bottom:1px solid var(--vv-line);min-width:0}
[data-vesora-viewer] .vv-title{font-size:14px;font-weight:650;margin:0 auto 0 0;min-width:0;overflow-wrap:anywhere}
[data-vesora-viewer] .vv-toolbar-actions{display:flex;flex-wrap:wrap;gap:6px;min-width:0;max-width:100%}
[data-vesora-viewer] .vv-body{display:grid;grid-template-columns:minmax(0,1fr) 230px;min-width:0}
[data-vesora-viewer][data-inspector=hidden] .vv-body{grid-template-columns:minmax(0,1fr)}
[data-vesora-viewer][data-mode=embed] .vv-toolbar{padding:8px}
[data-vesora-viewer] .vv-plot{min-width:0;position:relative;overflow:hidden}
[data-vesora-viewer] .vv-chart{width:100%;min-width:0}
[data-vesora-viewer] .vv-chart canvas{display:block;max-width:100%}
[data-vesora-viewer] .vv-sidebar{padding:14px;border-left:1px solid var(--vv-line);background:var(--vv-panel);min-width:0}
[data-vesora-viewer] .vv-sidebar details+details{margin-top:16px;padding-top:12px;border-top:1px solid var(--vv-line)}
[data-vesora-viewer] summary{cursor:pointer;font-weight:600;min-height:30px;line-height:30px}
[data-vesora-viewer] .vv-layers{display:grid;gap:6px;margin-top:8px}
[data-vesora-viewer] .vv-layer{text-align:left;display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere}
[data-vesora-viewer] .vv-swatch{display:inline-block;width:10px;height:10px;border-radius:2px;flex:none}
[data-vesora-viewer] .vv-inspection{margin:8px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;color:var(--vv-muted)}
[data-vesora-viewer] .vv-sample{margin-top:8px;min-width:0;color:var(--vv-text);white-space:normal}
[data-vesora-viewer] .vv-sample.vv-inspection{color:var(--vv-text);white-space:normal}
[data-vesora-viewer] .vv-sample-line{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
[data-vesora-viewer] .vv-shared{margin-top:8px}
[data-vesora-viewer] .vv-sample-raw{margin-top:8px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--vv-muted);font-size:12px;font-variant-numeric:tabular-nums}
[data-vesora-viewer] .vv-camera,[data-vesora-viewer] .vv-slices{display:grid;gap:8px;margin-top:12px}
[data-vesora-viewer] .vv-camera-buttons{display:flex;flex-wrap:wrap;gap:5px}
[data-vesora-viewer] .vv-field{display:grid;gap:4px;color:var(--vv-muted);font-size:12px}
[data-vesora-viewer] .vv-field select{width:100%;min-width:0;color:var(--vv-text)}
[data-vesora-viewer] .vv-field input{width:100%;accent-color:var(--vv-accent)}
[data-vesora-viewer] .vv-statusbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:9px 12px;border-top:1px solid var(--vv-line);font-size:12px;color:var(--vv-muted)}
[data-vesora-viewer] .vv-status{color:var(--vv-text)}
[data-vesora-viewer] .vv-pill{display:inline-flex;align-items:center;gap:6px;min-height:36px;max-width:100%;padding:4px 10px;border:1px solid var(--vv-line);border-radius:999px;background:var(--vv-panel);font-size:12px}
[data-vesora-viewer] .vv-pill .vv-state-dot{margin-right:0}
[data-vesora-viewer] .vv-pill[data-mode=frozen] .vv-state-dot{background:var(--vv-muted)}
[data-vesora-viewer] .vv-pill[data-mode=live] .vv-state-dot{background:var(--vv-accent)}
[data-vesora-viewer] .vv-state-dot{display:inline-block;background:var(--vv-accent);width:6px;height:6px;border-radius:50%;margin-right:7px}
[data-vesora-viewer] .vv-error{padding:12px;margin:12px;border:1px solid var(--vv-error);color:var(--vv-error);overflow-wrap:anywhere}
[data-vesora-viewer] .vv-error p{margin:0 0 8px}
[data-vesora-viewer] .vv-help{margin:0;padding:9px 12px;color:var(--vv-muted);font-size:12px;border-top:1px solid var(--vv-line)}
[data-vesora-viewer] .vv-notice{margin:8px 0;color:var(--vv-muted);font-size:12px}
[data-vesora-viewer] .vv-export{flex:1 1 240px;min-width:0;max-width:100%}
[data-vesora-viewer] .vv-export-panel{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;max-width:100%;margin-top:6px}
[data-vesora-viewer] .vv-export-panel .vv-field{flex:1 1 140px;min-width:0;max-width:100%;margin:0}
[data-vesora-viewer] .vv-export-panel .vv-notice{flex:1 1 180px;max-width:280px;margin:0}
[data-vesora-viewer] .vv-export-panel .vv-checkbox{margin-top:0}
[data-vesora-viewer] .vv-checkbox{display:flex;align-items:center;gap:8px;margin-top:8px;max-width:100%;overflow-wrap:anywhere}
[data-vesora-viewer] .vv-checkbox input{flex:none;accent-color:var(--vv-accent)}
[data-vesora-viewer] .vv-metadata .vv-field{margin-top:8px}
[data-vesora-viewer] .vv-channel h3{font-size:12px;margin:12px 0 4px}
[data-vesora-viewer] .vv-properties{margin:8px 0;display:grid;gap:2px;min-width:0;font-size:12px}
[data-vesora-viewer] .vv-properties dt{color:var(--vv-muted);font-weight:500}
[data-vesora-viewer] .vv-properties dd{margin:0 0 5px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
[data-vesora-viewer] .vv-overview{padding:4px 12px 8px;min-width:0}
[data-vesora-viewer] .vv-overview-track{position:relative;height:28px;border:1px solid var(--vv-line);border-radius:4px;background:var(--vv-panel);touch-action:none;cursor:ew-resize}
[data-vesora-viewer] .vv-overview-window{position:absolute;top:2px;bottom:2px;background:var(--vv-accent);opacity:.35;border-radius:3px;pointer-events:none}
[data-vesora-viewer] .vv-cursor-guide{position:absolute;width:1px;background:var(--vv-muted);pointer-events:none;z-index:2}
[data-vesora-viewer] .vv-table-wrap{overflow:auto;max-width:100%;margin-top:8px}
[data-vesora-viewer] .vv-rows{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
[data-vesora-viewer] .vv-rows th,[data-vesora-viewer] .vv-rows td{border-bottom:1px solid var(--vv-line);padding:4px 6px;text-align:right;white-space:nowrap}
[data-vesora-viewer] .vv-rows th:first-child,[data-vesora-viewer] .vv-rows td:first-child{text-align:left}
[data-vesora-viewer] .vv-pager{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px}
[data-vesora-viewer] .vv-sample:focus-visible,[data-vesora-viewer] .vv-overview-track:focus-visible{outline:2px solid var(--vv-accent);outline-offset:3px}
[data-vesora-viewer]:focus-visible{outline:2px solid var(--vv-accent);outline-offset:2px}
@container vesora-viewer (min-width:761px){[data-vesora-viewer] .vv-sidebar{contain:size;min-height:0;overflow-y:auto}}
@container vesora-viewer (max-width:760px){[data-vesora-viewer] .vv-body{grid-template-columns:minmax(0,1fr)}[data-vesora-viewer] .vv-sidebar{border-left:0;border-top:1px solid var(--vv-line)}[data-vesora-viewer] .vv-toolbar-actions{width:100%}[data-vesora-viewer] button,[data-vesora-viewer] summary{min-height:42px}[data-vesora-viewer] .vv-layers{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}}
@container vesora-viewer (max-width:360px){[data-vesora-viewer] .vv-toolbar{flex-direction:column;align-items:stretch}[data-vesora-viewer] .vv-title,[data-vesora-viewer] .vv-toolbar-actions,[data-vesora-viewer] .vv-export,[data-vesora-viewer] .vv-pill{width:100%;max-width:100%;min-width:0}[data-vesora-viewer] button,[data-vesora-viewer] select,[data-vesora-viewer] .vv-checkbox{max-width:100%}}
@media(prefers-reduced-motion:reduce){[data-vesora-viewer] *,[data-vesora-viewer] *:before,[data-vesora-viewer] *:after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
`;
