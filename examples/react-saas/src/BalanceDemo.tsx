import {useCallback,useEffect,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {figure as createFigure,downloadHTMLAsync} from '@vesora/core/runtime';
import type {Figure,Layer} from '@vesora/core/runtime';
import {createBalance,inspectBalance,stepBalance,transferBalance} from '@vesora/core/balance';
import {VesoraViewer} from '@vesora/react/viewer';
import {VesoraMark} from './components/VesoraMark';
import './balance.css';
import {BalanceDistribution} from './BalanceDistribution';

type BalanceState=ReturnType<typeof createBalance>;
const colors=['#71e3bf','#bba5f4','#ffb286','#83bafa','#e2db85','#ed9fbd','#81cbd2','#bac788'];
const names=['North','East','South','West','Central','Delta','Field','Reserve'];
const format=(value:number,digits=2)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);
function initialState(count=4):BalanceState{
  const weights=[56,24,14,6,8,7,5,4].slice(0,count),total=weights.reduce((sum,value)=>sum+value,0);
  return createBalance(weights.map((value,index)=>({id:names[index].toLowerCase(),label:names[index],volume:value/total*100})));
}
function useReducedMotion(){
  const [reduced,setReduced]=useState(()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false);
  useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),change=()=>setReduced(media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  return reduced;
}
function Icon({name}:{name:'play'|'pause'|'reset'|'arrow'|'export'|'step'|'cube'}){
  const paths={play:'m9 5 11 7-11 7Z',pause:'M8 5v14M16 5v14',reset:'M4 10a8 8 0 1 1 1 7M4 4v6h6',arrow:'M4 12h16m-6-6 6 6-6 6',export:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',step:'m5 5 10 7-10 7ZM19 5v14',cube:'m12 3 9 5v8l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v8'};
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

/** Equal-area boxes. NaN separates independent line segments in the shared engine. */
function chamberLines(index:number,height:number,hatching=false,side=1){
  const left=index*1.5*side,right=left+side,x:number[]=[],y:number[]=[],z:number[]=[];
  const segment=(a:number[],b:number[])=>{x.push(a[0],b[0],NaN);y.push(a[1],b[1],NaN);z.push(a[2],b[2],NaN);};
  for(const at of [left,right])for(const depth of [0,side])segment([at,depth,0],[at,depth,height]);
  for(const level of [0,height]){segment([left,0,level],[right,0,level]);segment([left,side,level],[right,side,level]);segment([left,0,level],[left,side,level]);segment([right,0,level],[right,side,level]);}
  if(hatching){for(let step=1;step<12;step++)segment([left+side*step/12,0,0],[left+side*step/12,0,height]);for(let step=1;step<8;step++)segment([right,side*step/8,0],[right,side*step/8,height]);}
  return {x,y,z};
}
type Scene={figure:Figure;tops:Layer[];liquids:Layer[];baselines:Layer[];ids:string[]};
export interface BalanceChartProps {
  /** A model snapshot; this component never advances or mutates the model. */
  state:BalanceState;
  baseline?:Readonly<Record<string,number>>;
  selectedId?:string;
  onSelect?:(id:string)=>void;
  compare?:boolean;
  activePair?:{from:string;to:string;openness:number};
  running?:boolean;
  reducedMotion?:boolean;
  onFigureReady?:(figure:Figure|null)=>void;
}

/** Reusable exact 2D reading and shared-engine 3D view of the same model snapshot. */
export function BalanceChart({state,baseline,selectedId,onSelect,compare=false,activePair,running=false,reducedMotion=false,onFigureReady}:BalanceChartProps){
  const rows=inspectBalance(state),scene=useRef<Scene|null>(null),[figure,setFigure]=useState<Figure|null>(null),[error,setError]=useState('');
  const callbacks=useRef({onSelect,onFigureReady});callbacks.current={onSelect,onFigureReady};
  const latest=useRef({state,baseline,compare,selectedId});latest.current={state,baseline,compare,selectedId};
  const ids=JSON.stringify(state.categories.map(category=>category.id)),sceneKey=JSON.stringify(state.categories.map(category=>[category.id,category.label])),maxHeight=state.total*state.parameters.volumeScale/state.parameters.area,side=Math.sqrt(state.parameters.area),litresPerUnit=state.parameters.volumeScale*1000;
  useEffect(()=>{
    const current=latest.current,initial=inspectBalance(current.state);
    const fig=createFigure({kind:'3d',title:'Denge · vertical scale exaggerated',height:350,theme:{background:'#121d2a',foreground:'#e0ebf5',muted:'#8fa4b9',grid:'#27394b',axis:'#55728c',fontSize:10,titleFontSize:10,labelFontSize:10,palette:colors},runtime:{maxSnapshotBytes:4*1024*1024}});
    fig.setView({xDomain:[-.35*side,((initial.length-1)*1.5+1.35)*side],yDomain:[-.15*side,1.15*side],zDomain:[0,maxHeight||.1],xLabel:'Position (m)',yLabel:'Depth (m)',zLabel:'Height (m; exaggerated)',boxAspect:[Math.max(2.5,initial.length*1.1),1.5,3.1],camera:{azimuth:-65,elevation:22,distance:2.5}});fig.setPresentation({legend:false});
    const tops:Layer[]=[],liquids:Layer[]=[],baselines:Layer[]=[],layerIds=new Map<string,string>();
    initial.forEach((row,index)=>{
      const shortLabel=row.label.slice(0,180);
      const frame=chamberLines(index,maxHeight,false,side);fig.plot3d(frame.x,frame.y,frame.z,{color:'#587087',opacity:.45,width:1,label:`${shortLabel} vessel`});
      const liquid=chamberLines(index,row.height,true,side),body=fig.plot3d(liquid.x,liquid.y,liquid.z,{color:colors[index],opacity:.65,width:1.4,label:shortLabel});liquids.push(body);layerIds.set(body.id,row.id);
      const volume=row.volume*litresPerUnit,left=index*1.5*side,right=left+side;
      const top=fig.surface([left,right],[0,side],[[row.height,row.height],[row.height,row.height]],{values:[[volume,volume],[volume,volume]],colorDomain:[0,state.total*litresPerUnit||1],colormap:'viridis',shading:'unlit',opacity:.85,label:`${shortLabel} volume`,colorbarLabel:'Model volume (L)'});tops.push(top);layerIds.set(top.id,row.id);
      const origin={datasetId:'vesora-balance-synthetic',field:row.id};
      top.setSemantics({x:{name:'Category position',unit:'m'},y:{name:'Equal-area vessel depth',unit:'m'},z:{name:`${shortLabel} height (vertical display scale exaggerated)`,quantity:'length',unit:'m',origin},color:{name:`${shortLabel} volume`,quantity:'volume',unit:'L',origin}});
      body.setSemantics({z:{name:`${shortLabel} volume boundary`,quantity:'length',unit:'m',origin}});
      const h=(current.baseline?.[row.id]??row.volume)*state.parameters.volumeScale/state.parameters.area;
      baselines.push(fig.plot3d([left,right,right,left,left],[0,0,side,side,0],[h,h,h,h,h],{color:'#e0ebf5',opacity:.42,width:1,label:`${shortLabel} baseline`}).setVisible(current.compare));
    });
    const remove=fig.on('click',event=>{const id=layerIds.get(event.layerId);if(id)callbacks.current.onSelect?.(id);});
    scene.current={figure:fig,tops,liquids,baselines,ids:initial.map(row=>row.id)};setFigure(fig);setError('');callbacks.current.onFigureReady?.(fig);
    return()=>{remove();callbacks.current.onFigureReady?.(null);if(scene.current?.figure===fig)scene.current=null;fig.close();};
  },[ids,sceneKey,state.total,state.parameters.area,state.parameters.volumeScale,maxHeight]);
  useEffect(()=>{
    const current=scene.current;if(!current||JSON.stringify(current.ids)!==ids)return;
    try{rows.forEach((row,index)=>{const volume=row.volume*litresPerUnit;current.tops[index].setData({z:[[row.height,row.height],[row.height,row.height]],color:[[volume,volume],[volume,volume]]});current.liquids[index].setData({z:chamberLines(index,row.height,true,side).z});});}catch(caught){setError(caught instanceof Error?caught.message:String(caught));}
  },[state,ids]);
  useEffect(()=>{
    const current=scene.current;if(!current)return;
    rows.forEach((row,index)=>{const selected=!selectedId||selectedId===row.id;current.liquids[index].setStyle({opacity:selected?.85:.55,width:selected?1.8:1});current.tops[index].setStyle({opacity:selected?.9:.72});const h=(baseline?.[row.id]??row.volume)*state.parameters.volumeScale/state.parameters.area;current.baselines[index].setData({z:[h,h,h,h,h]}).setVisible(compare);});
  },[ids,selectedId,baseline,compare,state.parameters.area,state.parameters.volumeScale]);
  return <div className="balance-chart-grid">
    <BalanceDistribution state={state} baseline={baseline} selectedId={selectedId} onSelect={onSelect} compare={compare} activePair={activePair} running={running} reducedMotion={reducedMotion}/>
    <section className="balance-visual balance-3d" aria-labelledby="balance-3d-title">
      <div className="balance-panel-heading"><div><span className="balance-section-index">02 / SPATIAL VIEW</span><h2 id="balance-3d-title">The same volume, in space.</h2></div><span className="balance-view-tag"><Icon name="cube"/>3D</span></div>
      <p className="balance-chart-description">Equal {format(state.parameters.area)} m² footprints. Axes normalized; vertical scale exaggerated. Read physical height in metres.</p>
      <div className="balance-camera-controls" role="group" aria-label="3D camera"><button onClick={()=>figure?.setView({camera:{azimuth:-65,elevation:22,distance:2.5},pan3d:[0,0]})}>Isometric</button><button onClick={()=>figure?.setCameraPreset('xz')}>Front</button><button onClick={()=>figure?.setCameraPreset('xy')}>Top</button><span>Drag to rotate</span></div>
      {error&&<p role="alert" className="balance-error">{error}</p>}
      <div className="balance-core-view">{figure&&<VesoraViewer figure={figure} mode="embed" preserveTheme chrome={{toolbar:false,inspector:false,status:false,help:false}} onError={caught=>setError(caught.message)}/>}</div>
      <div className="balance-visual-footer"><span>Surface color = volume</span><span>Read exact values in 2D and the table</span></div>
    </section>
  </div>;
}

export function BalanceDemo(){
  const [state,setState]=useState(()=>initialState()),stateRef=useRef(state),[running,setRunning]=useState(false),reduced=useReducedMotion();
  const [from,setFrom]=useState('north'),[to,setTo]=useState('west'),[openness,setOpenness]=useState(.35),[selected,setSelected]=useState('north'),[compare,setCompare]=useState(true);
  const [baseline,setBaseline]=useState(()=>Object.fromEntries(state.categories.map(category=>[category.id,category.volume]))),[baselineEnergy,setBaselineEnergy]=useState(state.energy);
  const [dissipated,setDissipated]=useState(0),[manualWork,setManualWork]=useState(0),[amount,setAmount]=useState('5'),[message,setMessage]=useState('Choose a connection, then let pressure equalize it.'),[error,setError]=useState(''),[exporting,setExporting]=useState(false);
  const exportFigure=useRef<Figure|null>(null),rows=inspectBalance(state),fromRow=rows.find(row=>row.id===from)!,toRow=rows.find(row=>row.id===to)!;
  const total=rows.reduce((sum,row)=>sum+row.volume,0),errorVolume=total-state.total,pressureDifference=fromRow.pressure-toRow.pressure,potentialFlow=state.parameters.conductance*openness*pressureDifference/state.parameters.volumeScale;
  const commit=useCallback((next:BalanceState)=>{stateRef.current=next;setState(next);},[]);
  const advance=useCallback((seconds:number)=>{try{const result=stepBalance(stateRef.current,{from,to,openness},seconds);commit(result.state);setDissipated(value=>value+result.dissipatedEnergy);setError('');}catch(caught){setRunning(false);setError(caught instanceof Error?caught.message:String(caught));}},[from,to,openness,commit]);
  useEffect(()=>{if(reduced)setRunning(false);},[reduced]);
  useEffect(()=>{if(!running||reduced)return;let id=0,last=performance.now(),elapsed=0;const frame=(now:number)=>{elapsed+=Math.min(.1,(now-last)/1000);last=now;if(elapsed>=.05){advance(elapsed);elapsed=0;}id=requestAnimationFrame(frame);};id=requestAnimationFrame(frame);return()=>cancelAnimationFrame(id);},[running,reduced,advance]);
  const reset=(count=state.categories.length)=>{setRunning(false);const next=initialState(count);commit(next);setFrom(next.categories[0].id);setTo(next.categories.at(-1)!.id);setSelected(next.categories[0].id);setBaseline(Object.fromEntries(next.categories.map(category=>[category.id,category.volume])));setBaselineEnergy(next.energy);setDissipated(0);setManualWork(0);setMessage('Initial distribution restored. Total volume is 100 litres.');setError('');};
  const manual=()=>{try{setRunning(false);const result=transferBalance(stateRef.current,from,to,Number(amount));commit(result.state);setManualWork(value=>value+result.externalWork);setMessage(`Manual transfer: ${format(result.transferred)} L from ${fromRow.label} to ${toRow.label}. External work ${format(result.externalWork,3)} J.`);setError('');}catch(caught){setError(caught instanceof Error?caught.message:String(caught));}};
  const exportHTML=async()=>{
    const owner=exportFigure.current;if(!owner||exporting)return;setRunning(false);setExporting(true);
    try{
      // Let React stop production and commit the last model snapshot to both views.
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      if(exportFigure.current!==owner)throw new Error('The reservoir set changed. Export the new scene again.');
      await owner.ready({target:'displayed'});
      await downloadHTMLAsync(owner,'vesora-balance.html',{source:'displayed',observation:true});
      setMessage('3D scene exported with height, volume semantics and an observation record. The simulation controls are not included.');
    }catch(caught){setError(caught instanceof Error?caught.message:String(caught));}finally{setExporting(false);}
  };
  const focus=rows.find(row=>row.id===selected)??rows[0],high=pressureDifference>=0?fromRow:toRow,low=pressureDifference>=0?toRow:fromRow;
  return <main className="balance-app" data-reduced-motion={reduced?'true':'false'}>
    <nav className="balance-nav" aria-label="Balance navigation"><a className="balance-brand" href="./" aria-label="Vesora dashboard"><VesoraMark size={36} className="balance-brand-logo"/><small>/ EXPERIMENTS</small></a><div><a href="?demo=workbench">Open Studio <span aria-hidden="true">↗</span></a><span className="balance-version">BALANCE / 01</span></div></nav>
    <header className="balance-intro"><div><span className="balance-eyebrow"><i/>A CONSERVATIVE PHYSICAL MODEL</span><h1>Vesora <em>Denge.</em></h1><p>Connect categories as equal-area reservoirs.<br/>Pressure moves the volume. The total stays yours.</p></div><div className="balance-intro-actions"><span className="balance-system-badge"><i/>Closed system · {state.categories.length} reservoirs</span><button className="balance-button balance-export-button" onClick={()=>void exportHTML()} disabled={exporting}><Icon name="export"/>{exporting?'Preparing export…':'Export 3D observation'}</button><span className="balance-export-note">Interactive HTML · embedded data + semantics</span></div></header>
    <section className="balance-metrics" aria-label="Physical model measurements"><div><span>Total volume</span><strong data-testid="balance-total">{format(total)} <small>L</small></strong><p><i className="balance-conserved-dot"/>Conservation error {Math.abs(errorVolume)<1e-12?'0':errorVolume.toExponential(1)} L</p></div><div><span>Potential energy</span><strong>{format(state.energy,3)} <small>J</small></strong><p>{state.energy-baselineEnergy>0?'+':''}{format(state.energy-baselineEnergy,3)} J vs baseline</p></div><div><span>Passive dissipation</span><strong data-testid="balance-dissipation">{format(dissipated,3)} <small>J</small></strong><p>Energy lost during pressure-driven flow</p></div><div><span>{running?'Instantaneous flow':'Potential flow · paused'}</span><strong>{format(Math.abs(potentialFlow))} <small>L/s</small></strong><p>{high.label}<span aria-hidden="true"> → </span>{low.label} · {format(Math.abs(pressureDifference),1)} Pa difference</p></div></section>
    <div className="balance-workspace"><aside className="balance-control-panel" aria-labelledby="balance-control-title"><div className="balance-control-heading"><span className="balance-section-index">THE CONNECTION</span><h2 id="balance-control-title">Find a new balance.</h2><p>One valve connects two reservoirs. Flow always follows the pressure difference.</p></div>
      <div className="balance-pair"><label>Reservoir A<select aria-label="Reservoir A" value={from} onChange={event=>{const id=event.target.value;setFrom(id);if(id===to)setTo(rows.find(row=>row.id!==id)!.id);}}>{rows.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label><span className="balance-pair-mark" aria-hidden="true">⇄</span><label>Reservoir B<select aria-label="Reservoir B" value={to} onChange={event=>setTo(event.target.value)}>{rows.filter(row=>row.id!==from).map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select></label></div>
      <div className="balance-valve-setting"><label htmlFor="balance-openness">Valve opening <strong>{Math.round(openness*100)}%</strong></label><input id="balance-openness" type="range" min="0" max="1" step=".05" value={openness} onChange={event=>setOpenness(Number(event.target.value))}/><div><span>Closed</span><span>Fully open</span></div></div>
      <div className="balance-transport"><button className="balance-button balance-primary" onClick={()=>setRunning(value=>!value)} disabled={reduced} aria-pressed={running}><Icon name={running?'pause':'play'}/>{running?'Pause flow':'Start flow'}</button><button className="balance-button" onClick={()=>{setRunning(false);advance(.5);setMessage('Advanced the passive model by 0.5 seconds.');}}><Icon name="step"/>Step 0.5 s</button></div>
      <div className="balance-simulation-status"><i className={running?'is-running':''}/>{reduced?'Reduced motion · use single steps':running?'Pressure flow running':'Simulation paused'}<span>{format(state.elapsed,1)} s</span></div>
      <div className="balance-control-divider"/>
      <div className="balance-focus-card" style={{'--category':colors[rows.indexOf(focus)]} as CSSProperties}><span>FOCUSED RESERVOIR</span><h3><i/>{focus.label}</h3><div><strong>{format(focus.volume)} <small>L</small></strong><span>{format(focus.share*100,1)}% of total</span></div><p>{format(focus.height*1000,2)} mm head · {format(focus.pressure,2)} Pa</p></div>
      <div className="balance-compare-controls"><button aria-pressed={compare} onClick={()=>setCompare(value=>!value)}><span aria-hidden="true">⊟</span>Compare baseline</button><button onClick={()=>{setBaseline(Object.fromEntries(rows.map(row=>[row.id,row.volume])));setBaselineEnergy(state.energy);setCompare(true);setMessage('Current distribution saved as the comparison baseline.');}}>Set baseline</button></div>
      <details className="balance-manual"><summary>Manual transfer <span>external work</span></summary><p>This action can move volume against pressure. It is separate from passive flow.</p><label>Amount (L)<input aria-label="Manual transfer amount" type="number" min="0" max={fromRow.volume} step="1" value={amount} onChange={event=>setAmount(event.target.value)}/></label><button className="balance-button" onClick={manual}>Transfer {fromRow.label} → {toRow.label}</button><p>Net external work: {format(manualWork,3)} J</p></details>
      <div className="balance-reset-row"><label>Reservoirs<select aria-label="Reservoir count" value={state.categories.length} onChange={event=>reset(Number(event.target.value))}>{[3,4,5,6,7,8].map(count=><option key={count}>{count}</option>)}</select></label><button aria-label="Reset balance" onClick={()=>reset()}><Icon name="reset"/>Reset</button></div>
    </aside><div className="balance-main-stage"><BalanceChart state={state} baseline={baseline} selectedId={selected} onSelect={setSelected} compare={compare} activePair={{from,to,openness}} running={running} reducedMotion={reduced} onFigureReady={figure=>{exportFigure.current=figure;}}/>
      <section className="balance-reading-panel" aria-labelledby="balance-reading-title"><div className="balance-reading-heading"><div><span className="balance-section-index">03 / THE NUMBERS</span><h2 id="balance-reading-title">Perspective changes. Values do not.</h2></div><span>1 displayed unit = 1 litre</span></div><div className="balance-table-scroll"><table><caption className="balance-sr-only">Exact model values for each equal-area reservoir. Select a row to focus its 2D and 3D representation.</caption><thead><tr><th scope="col">Reservoir</th><th scope="col">Volume</th><th scope="col">Share</th><th scope="col">Δ baseline</th><th scope="col">Height</th><th scope="col">Pressure</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.id} data-selected={row.id===selected?'true':'false'} data-row-id={row.id}><th scope="row"><button aria-pressed={row.id===selected} onClick={()=>setSelected(row.id)}><i style={{background:colors[index]}}/>{row.label}<span aria-hidden="true">↗</span></button></th><td data-value={row.volume}>{format(row.volume,3)} <small>L</small></td><td>{format(row.share*100,2)}<small>%</small></td><td className={row.volume-(baseline[row.id]??row.volume)>=0?'is-positive':'is-negative'}>{row.volume-(baseline[row.id]??row.volume)>0?'+':''}{format(row.volume-(baseline[row.id]??row.volume),3)} <small>L</small></td><td>{format(row.height*1000,3)} <small>mm</small></td><td>{format(row.pressure,3)} <small>Pa</small></td></tr>)}</tbody><tfoot><tr><th scope="row">Conserved total</th><td>{format(total,3)} L</td><td>100.00%</td><td colSpan={3}>All reservoirs use A = {state.parameters.area} m²</td></tr></tfoot></table></div></section>
    </div></div>
    <div className="balance-message" role="status">{message}</div>{error&&<p className="balance-error" role="alert">{error}</p>}
    <footer className="balance-model-note"><div><strong>The model, openly.</strong><p>Synthetic, equal-area reservoirs with incompressible fluid. A single pressure-driven connection dissipates potential energy. Manual transfers can add or remove energy; volume remains conserved.</p></div><div className="balance-equations"><span>h = V / A</span><span>p = ρgh</span><span>Q = CuΔp</span></div><details><summary>Parameters & interpretation</summary><p>Area {state.parameters.area} m² per vessel · density {state.parameters.density} kg/m³ · gravity {state.parameters.gravity} m/s² · effective conductance {state.parameters.conductance} m³/(Pa·s) · u is valve opening (0–1). The 2D membrane divides a fixed area in proportion to the connected pair’s volumes; its hatched area is the volume needed to reach equal shares. The curved boundary is a visual encoding, not a simulated fluid surface. 3D uses volume boundaries and fluid top surfaces with normalized axes and exaggerated vertical scale; use the table for exact comparisons. Constant laminar resistance is assumed; conductance is not calibrated pipe flow. This is an idealized quasi-static analogy, not a computational fluid dynamics solver.</p></details></footer>
  </main>;
}
