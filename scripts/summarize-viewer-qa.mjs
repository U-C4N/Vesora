import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {viewerBuildFingerprint} from './viewer-build-fingerprint.mjs';

const root='artifacts/v09/ui',hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const build=await viewerBuildFingerprint();
const cases=[];
for(const item of await readdir(join(root,'matrix'),{withFileTypes:true})){
  if(!item.isDirectory()||!item.name.startsWith('viewer-matrix-'))continue;
  const directory=join(root,'matrix',item.name),evidence=JSON.parse(await readFile(join(directory,'evidence.json'),'utf8'));
  if(evidence.status!=='passed'||JSON.stringify(evidence.buildSha256)!==JSON.stringify(build))throw new Error(`Missing pass or different runtime: ${item.name}`);
  const screenshots=[];for(const name of ['default.png','inspector.png'])screenshots.push({path:relative(root,join(directory,name)).replaceAll('\\','/'),sha256:hash(await readFile(join(directory,name)))});
  cases.push({...evidence,evidencePath:relative(root,join(directory,'evidence.json')).replaceAll('\\','/'),screenshots});
}
const key=value=>`${value.width}-${value.dpr}-${value.theme}-${value.motion}`;
const expected=[];for(const width of [360,768,1440])for(const dpr of [1,2])for(const theme of ['dark','light'])for(const motion of ['no-preference','reduce'])expected.push(key({width,dpr,theme,motion}));
if(cases.length!==24||new Set(cases.map(key)).size!==24||expected.some(value=>!cases.some(item=>key(item)===value)))throw new Error('The complete 24-case matrix has not passed');
cases.sort((a,b)=>key(a).localeCompare(key(b)));
await writeFile(join(root,'matrix-summary.json'),JSON.stringify({scope:'source-checkout-development-ui-matrix',status:'passed',recordedAt:new Date().toISOString(),buildSha256:build,passed:cases.length,screenshots:cases.length*2,dimensions:{widths:[360,768,1440],devicePixelRatios:[1,2],themes:['dark','light'],reducedMotion:['no-preference','reduce']},realScreenReader:false,realBrowserZoom:false,initialInvocationNote:'All 24 matrix cases passed. A separate zoom probe in the same invocation initially failed because inherited installed-Chrome settings prevented extension loading; see the isolated corrected zoom evidence.',cases},null,2));
console.log('Verified 24 matrix cases and 48 screenshot hashes against the current built runtime.');
const zoomDirectory=join(root,'zoom','viewer-browser-zoom-actual-fbd9d--viewer-controls-and-reflow'),zoom=JSON.parse(await readFile(join(zoomDirectory,'evidence.json'),'utf8'));
if(zoom.status!=='passed'||zoom.zoom.factor!==2||zoom.zoom.settings.mode!=='automatic'||!zoom.realBrowserZoom||JSON.stringify(zoom.buildSha256)!==JSON.stringify(build))throw new Error('Native 200% browser zoom has not passed on the current runtime');
const zoomScreenshots=[];for(const image of zoom.screenshots)zoomScreenshots.push({...image,path:relative(root,join(zoomDirectory,image.name)).replaceAll('\\','/'),sha256:hash(await readFile(join(zoomDirectory,image.name)))});
await writeFile(join(root,'zoom-summary.json'),JSON.stringify({scope:'source-checkout-native-browser-zoom',recordedAt:new Date().toISOString(),...zoom,screenshots:zoomScreenshots,manualBrowserMenu:false,evidencePath:relative(root,join(zoomDirectory,'evidence.json')).replaceAll('\\','/')},null,2));
console.log('Verified native 200% automatic browser zoom and two viewport screenshot hashes.');
const index=JSON.parse(await readFile(join(root,'evidence.json'),'utf8'));
index.updatedAt=new Date().toISOString();index.additionalEvidence={matrix:'matrix-summary.json',nativeBrowserZoom:'zoom-summary.json'};
index.uiCoverage.realBrowserZoom=true;index.releaseAccessibilityGate='pending-real-screen-reader';
await writeFile(join(root,'evidence.json'),JSON.stringify(index,null,2));
