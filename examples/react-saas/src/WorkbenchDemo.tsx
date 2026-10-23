import {useEffect,useState} from 'react';
import {figure as createFigure,type Figure} from '@vesora/core/runtime';
import {VesoraViewer} from '@vesora/react/viewer';

/** The application owns production; freezing a viewer never pauses this timer. */
export function WorkbenchDemo(){
  const [figures,setFigures]=useState<{studio:Figure;embed:Figure}|null>(null),[error,setError]=useState(''),[embedInspector,setEmbedInspector]=useState(false);
  useEffect(()=>{
    const studio=createFigure({title:'Temperature experiment',height:480,runtime:{maxSnapshotBytes:8*1024*1024}}),embed=createFigure({title:'Sensor A',height:240,runtime:{maxSnapshotBytes:2*1024*1024}});
    const layers=[studio.plot([],[],{label:'Sensor A',color:'#c5f36b',width:2}),studio.plot([],[],{label:'Sensor B',color:'#79b7ff',width:2}),studio.plot([],[],{label:'Sensor C',color:'#f2b182',width:2})],embedded=embed.plot([],[],{label:'Sensor A',color:'#79b7ff',width:2});
    for(const [index,layer] of [...layers,embedded].entries()){
      layer.enableStreaming({maxPoints:4000});
      layer.setSemantics({x:{name:'Elapsed time',quantity:'time',unit:'s',dimension:'time'},y:{name:`Sensor ${index===3?'A':String.fromCharCode(65+index)} temperature`,quantity:'temperature',unit:'K',dimension:'temperature',origin:{datasetId:'synthetic-temperature-demo',field:`sensor-${index===3?0:index}`},transforms:[{execution:'external',name:'Synthetic signal generator',version:'1',parameters:{baselineK:298}}]}});
    }
    for(const current of [studio,embed]){current.setHoverMode('x');current.setView({xLabel:'Elapsed time (s)',yLabel:'Temperature (K)'});}
    let next=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
    const tick=async()=>{
      const samples=Array.from({length:40},()=>next++),x=samples.map(value=>value/800),ys=layers.map((_,index)=>samples.map(value=>298+Math.sin(value*.025+index)*(1.5+index)+.25*Math.sin(value*.09)));
      try{await Promise.all([studio.appendDataBatch(layers.map((layer,index)=>({layer,data:{x,y:ys[index]}})),{waitFor:'accepted'}),embed.appendDataBatch([{layer:embedded,data:{x,y:ys[0]}}],{waitFor:'accepted'})]);}
      catch(caught){if(!disposed)setError(caught instanceof Error?caught.message:String(caught));}
      if(!disposed)timer=setTimeout(()=>{void tick();},50);
    };
    setFigures({studio,embed});void tick();
    return()=>{disposed=true;clearTimeout(timer);studio.close();embed.close();};
  },[]);
  return <main style={{minHeight:'100vh',background:'#101215',color:'#edf0f4',fontFamily:'system-ui,sans-serif',padding:'24px clamp(12px,3vw,40px)'}}>
    <header style={{maxWidth:1440,margin:'0 auto 20px',display:'flex',justifyContent:'space-between',gap:20,flexWrap:'wrap'}}><div><p style={{fontSize:12,color:'#a2abb8'}}>STUDIO + EMBED</p><h1 style={{fontSize:28,margin:'6px 0'}}>Experiment workbench</h1></div><nav aria-label="Workbench navigation" style={{display:'flex',gap:24,alignItems:'center'}}><a href="?demo=balance" style={{color:'#71e3bf'}}>Explore Denge ↗</a><a href="./" style={{color:'#c5f36b'}}>Dashboard</a></nav></header>
    <p style={{maxWidth:1440,margin:'0 auto 20px',color:'#a2abb8'}}>Both views receive the same synthetic sensor readings. Freeze either view independently while new samples keep arriving. Each curve retains its latest 4,000 samples.</p>
    {error&&<p role="alert">{error}</p>}
    <div style={{maxWidth:1440,margin:'auto',display:'flex',flexWrap:'wrap',alignItems:'flex-start',gap:20}}>
      <section aria-label="Studio workspace" style={{flex:'1 1 640px',minWidth:0}}><h2 style={{fontSize:16}}>Studio</h2><p style={{fontSize:13,color:'#a2abb8'}}>Inspect channel units, source declarations and the selected sample. Export options choose the displayed frame or latest accepted data.</p>{figures&&<VesoraViewer figure={figures.studio} mode="studio" observation onError={caught=>setError(caught.message)}/>}</section>
      <aside aria-label="Embedded sensor card" style={{flex:'0 1 320px',width:320,maxWidth:'100%',minWidth:0}}><h2 style={{fontSize:16}}>Embed · 320 px card</h2><p style={{fontSize:13,color:'#a2abb8'}}>The same viewer fits inside an application card. Opening its inspector keeps the current view intact.</p><button type="button" aria-pressed={embedInspector} onClick={()=>setEmbedInspector(value=>!value)} style={{marginBottom:12,padding:'8px 12px',background:'#171a1f',color:'#edf0f4',border:'1px solid #637081',borderRadius:4}}>{embedInspector?'Hide card inspector':'Show card inspector'}</button>{figures&&<VesoraViewer figure={figures.embed} mode="embed" chrome={{inspector:embedInspector}} themeTokens={{accent:'#79b7ff'}} observation onError={caught=>setError(caught.message)}/>}</aside>
    </div>
    <p style={{maxWidth:1440,margin:'16px auto',fontSize:12,color:'#a2abb8'}}>Synthetic temperatures in kelvin; no measured experiment or performance claim. HTML can include an observation record and reopens offline. PNG contains the image only.</p>
  </main>;
}
