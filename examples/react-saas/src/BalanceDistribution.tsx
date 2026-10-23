import {useEffect,useId,useRef,useState} from 'react';
import type {CSSProperties} from 'react';
import {inspectBalance} from '@vesora/core/balance';
import type {BalanceState} from '@vesora/core/balance';
import {VesoraMark} from './components/VesoraMark';
import './balance-distribution.css';

interface DistributionProps {
  state:BalanceState;
  baseline?:Readonly<Record<string,number>>;
  selectedId?:string;
  onSelect?:(id:string)=>void;
  compare?:boolean;
  activePair?:{from:string;to:string;openness:number};
  running?:boolean;
  reducedMotion?:boolean;
}
const number=(value:number,digits=1)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value);
const INK_A='#ac523d',INK_B='#285b69';

/** The cubic has linear y and a zero-integral horizontal deflection.
 * Its enclosed area is exactly r*W*H; its swept area to r=.5 is the
 * quantity that must change sides. This encodes volume, not vessel shape.
 */
function seam(r:number,left:number,top:number,width:number,height:number){
  const ratio=Math.max(0,Math.min(1,r)),x=left+width*ratio;
  const bend=3*width*ratio*(1-ratio)*(2*ratio-1);
  return {x,forward:`C ${x+bend} ${top+height/3} ${x-bend} ${top+2*height/3} ${x} ${top+height}`,
    reverse:`C ${x-bend} ${top+2*height/3} ${x+bend} ${top+height/3} ${x} ${top}`};
}

export function BalanceDistribution({state,baseline,selectedId,onSelect,compare=false,activePair,running=false,reducedMotion=false}:DistributionProps){
  const host=useRef<HTMLDivElement>(null),[availableWidth,setAvailableWidth]=useState(440),uid=useId().replaceAll(':','');
  useEffect(()=>{
    const element=host.current;if(!element)return;
    const measure=()=>setAvailableWidth(Math.max(220,element.clientWidth));
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[]);
  const rows=inspectBalance(state),litres=state.parameters.volumeScale*1000;
  const a=rows.find(row=>row.id===activePair?.from),b=rows.find(row=>row.id===activePair?.to);
  const pairTotal=(a?.volume??0)+(b?.volume??0),hasPair=!!a&&!!b&&a.id!==b.id,hasVolume=hasPair&&pairTotal>0;
  const ratio=hasVolume?a!.volume/pairTotal:.5,target=pairTotal/2,remaining=hasPair?Math.abs(a!.volume-b!.volume)/2:0;
  const high=a&&b?(a.pressure>=b.pressure?a:b):undefined,low=a&&b?(high===a?b:a):undefined;
  const equal=!!high&&!!low&&high.pressure-low.pressure<=1e-6,closed=(activePair?.openness??0)===0,noConductance=state.parameters.conductance===0;
  const status=!hasPair?'Choose a connection':!hasVolume?'Empty pair':equal?'At balance':closed?'Valve closed':noConductance?'No passive flow':running&&!reducedMotion?'Equalizing':'Potential transfer';
  const width=availableWidth,left=10,top=35,plotWidth=width-20,height=184,right=left+plotWidth,bottom=top+height,mid=left+plotWidth/2;
  const boundary=seam(ratio,left,top,plotWidth,height);
  const areaA=`M ${left} ${top} H ${boundary.x} ${boundary.forward} H ${left} Z`;
  const areaB=`M ${boundary.x} ${top} H ${right} V ${bottom} H ${boundary.x} ${boundary.reverse} Z`;
  const transfer=`M ${mid} ${top} H ${boundary.x} ${boundary.forward} H ${mid} Z`;
  const savedA=baseline?.[a?.id??''],savedB=baseline?.[b?.id??''];
  const samePairTotal=savedA!==undefined&&savedB!==undefined&&Math.abs(savedA+savedB-pairTotal)<=1e-9*Math.max(1,pairTotal);
  const saved=compare&&hasVolume&&samePairTotal?seam(savedA!/pairTotal,left,top,plotWidth,height):undefined;
  const colorFor=(id:string)=>id===a?.id?INK_A:id===b?.id?INK_B:'#9a9d91';

  return <section className="balance-visual balance-2d membrane" aria-labelledby={`${uid}-title`}>
    <header className="membrane-heading">
      <div><span className="membrane-eyebrow"><VesoraMark size={22} title="Vesora"/><span>/ CONSERVATION STUDY</span></span><h2 id={`${uid}-title`}>Membrane<span>.</span></h2></div>
      <div className="membrane-edition"><span>02D</span><small>AREA = VOLUME</small></div>
    </header>
    <div className="membrane-pair-meta"><span>Connected pair <strong>{number(pairTotal*litres)} L</strong></span><span>of {number(state.total*litres)} L total</span></div>
    <div className="membrane-pair-readings">
      <button type="button" disabled={!a} onClick={()=>a&&onSelect?.(a.id)} style={{'--membrane-ink':INK_A} as CSSProperties} aria-label={a?`Inspect ${a.label}`:'Choose reservoir A'}><span><i/>{a?.label??'Reservoir A'}</span><strong>{number((a?.volume??0)*litres)}<small> L</small></strong></button>
      <div className="membrane-equal-mark" aria-hidden="true">⇌</div>
      <button type="button" disabled={!b} onClick={()=>b&&onSelect?.(b.id)} style={{'--membrane-ink':INK_B} as CSSProperties} aria-label={b?`Inspect ${b.label}`:'Choose reservoir B'}><span><i/>{b?.label??'Reservoir B'}</span><strong>{number((b?.volume??0)*litres)}<small> L</small></strong></button>
    </div>
    <div ref={host} className="membrane-canvas">
      <svg className="membrane-plot" width={width} height="250" viewBox={`0 0 ${width} 250`} role="img" aria-labelledby={`${uid}-graphic-title ${uid}-graphic-desc`}>
        <title id={`${uid}-graphic-title`}>{hasPair?`${a!.label} and ${b!.label}: one conserved area`:'Choose two reservoirs'}</title>
        <desc id={`${uid}-graphic-desc`}>{hasPair?`Left area: ${number(a!.volume*litres,2)} litres. Right area: ${number(b!.volume*litres,2)} litres. Hatched area: ${number(remaining*litres,2)} litres must change sides to reach ${number(target*litres,2)} litres each. The curve encodes volume proportions; it is not a physical fluid surface.`:'Connect two different reservoirs to inspect their balance.'}</desc>
        <defs><pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse"><path d="M -2 2 L 2 -2 M 0 7 L 7 0 M 5 9 L 9 5" stroke="#f6e7bc" strokeWidth="1"/></pattern></defs>
        <text x={mid} y="17" textAnchor="middle" className="membrane-target-label">{hasPair?`${number(target*litres)} L each at balance`:'Select a pair'}</text>
        {hasVolume?<>
          <path className="membrane-region-a" d={areaA} fill={INK_A}/>
          <path className="membrane-region-b" d={areaB} fill={INK_B}/>
          <path className="membrane-transfer" d={transfer} fill={`url(#${uid}-hatch)`}/>
          {saved&&<path className="membrane-baseline" d={`M ${saved.x} ${top} ${saved.forward}`}/>}
          <path className="membrane-seam" d={`M ${boundary.x} ${top} ${boundary.forward}`}/>
        </>:<rect x={left} y={top} width={plotWidth} height={height} className="membrane-empty"/>}
        <g className="membrane-equilibrium" aria-label={`Connected pair equal level: ${number(target*litres,2)} litres each`}><path d={`M ${mid} ${top-9} V ${bottom+9}`} className="membrane-target"/><path d={`M ${mid-4} ${top-9} h 8 M ${mid-4} ${bottom+9} h 8`} className="membrane-target-caps"/></g>
        <rect className="membrane-frame" x={left} y={top} width={plotWidth} height={height}/>
        <text className="membrane-side-note" x={left} y="245">{a?.label??'A'}</text><text className="membrane-side-note" x={right} y="245" textAnchor="end">{b?.label??'B'}</text>
      </svg>
    </div>
    <div className="membrane-transfer-reading">
      <div><span className="membrane-state"><i className={running&&!reducedMotion&&!closed&&!noConductance&&!equal?'is-live':''}/>{status}</span><p>{equal?'Two equal shares.':high&&low?<>{high.label}<span aria-hidden="true"> → </span>{low.label}</>:'Choose a pair above.'}</p></div>
      <div className="membrane-amount"><strong>{remaining*litres>0&&remaining*litres<.05?'<0.1':number(remaining*litres)}<small> L</small></strong><span>{equal?'in balance':'to change sides'}</span></div>
    </div>
    <p className="membrane-explanation"><i className="membrane-hatch-key"/>The hatched area is what must move. At balance, it disappears.</p>
    <div className="membrane-category-heading"><span>ALL RESERVOIRS</span><span>{compare?'Δ saved baseline':'Select to inspect'}</span></div>
    <div className="membrane-categories" aria-label="All reservoir readings">{rows.map(row=>{
      const delta=row.volume-(baseline?.[row.id]??row.volume);
      return <button type="button" key={row.id} className="membrane-category" style={{'--membrane-ink':colorFor(row.id)} as CSSProperties} data-category-id={row.id} data-volume={row.volume*litres} aria-pressed={row.id===selectedId} aria-label={`${row.label}: ${number(row.volume*litres,2)} litres, ${number(row.share*100)} percent`} onClick={()=>onSelect?.(row.id)}>
        <span className="membrane-category-name"><i/>{row.label}</span><span className="membrane-category-value">{number(row.volume*litres)}<small> L</small></span><span className="membrane-category-share">{number(row.share*100)}%</span>{compare&&<span className="membrane-category-delta">{delta>0?'+':''}{number(delta*litres)} L</span>}
      </button>;
    })}</div>
    <footer className="membrane-caption"><span>Fixed area. Moving boundary. Conserved volume.</span>{saved&&<span><i/>Saved split</span>}</footer>
  </section>;
}
