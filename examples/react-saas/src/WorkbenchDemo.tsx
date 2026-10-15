import {useEffect,useState} from 'react';
import {figure as createFigure,type Figure} from '@vesora/core';
import {VesoraViewer} from '@vesora/react/viewer';

/** The application owns production; freezing a viewer never pauses this timer. */
export function WorkbenchDemo(){
  const [figure,setFigure]=useState<Figure|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    const current=createFigure({title:'Telemetry observatory',height:480,runtime:{maxSnapshotBytes:8*1024*1024}});
    const layers=[current.plot([],[],{label:'Signal A',color:'#c5f36b',width:2}),current.plot([],[],{label:'Signal B',color:'#79b7ff',width:2}),current.plot([],[],{label:'Signal C',color:'#f2b182',width:2})];
    for(const layer of layers)layer.enableStreaming({maxPoints:4000});current.setHoverMode('x');current.setView({xLabel:'Sample',yLabel:'Synthetic amplitude'});
    let next=0,disposed=false;
    const tick=()=>{const x=Array.from({length:40},()=>next++);void current.appendDataBatch(layers.map((layer,index)=>({layer,data:{x,y:x.map(value=>Math.sin(value*.025+index)+.25*Math.sin(value*.09)+index*1.6)}})),{waitFor:'accepted'}).catch(caught=>{if(!disposed)setError(caught instanceof Error?caught.message:String(caught));});};
    setFigure(current);tick();const timer=setInterval(tick,50);
    return()=>{disposed=true;clearInterval(timer);current.close();};
  },[]);
  return <main style={{minHeight:'100vh',background:'#101215',color:'#edf0f4',fontFamily:'system-ui,sans-serif',padding:'24px clamp(12px,3vw,40px)'}}>
    <header style={{maxWidth:1440,margin:'0 auto 20px',display:'flex',justifyContent:'space-between',gap:20,flexWrap:'wrap'}}><div><p style={{fontSize:12,color:'#a2abb8',letterSpacing:'.12em'}}>VESORA / OBSIDIAN</p><h1 style={{fontSize:28,margin:'6px 0'}}>A live signal. A stable point of view.</h1></div><a href="./" style={{color:'#c5f36b'}}>Signal Studio</a></header>
    <p style={{maxWidth:1440,margin:'0 auto 20px',color:'#a2abb8'}}>Freeze the view to inspect an exact retained snapshot while new samples keep arriving. Return to live to catch up. Each curve keeps its latest 4,000 samples.</p>
    {error&&<p role="alert">{error}</p>}
    <div style={{maxWidth:1440,margin:'auto'}}>{figure&&<VesoraViewer figure={figure} onError={caught=>setError(caught.message)}/>}</div>
    <p style={{maxWidth:1440,margin:'16px auto',fontSize:12,color:'#a2abb8'}}>Synthetic signals · PNG and HTML exports capture the displayed frame. HTML reopens offline without reconnecting the producer.</p>
  </main>;
}
