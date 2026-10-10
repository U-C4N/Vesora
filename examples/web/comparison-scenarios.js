// Each comparison is one Figure, one WebGL context and one worker.
function signalComparison(fig) {
  const x = Float64Array.from({length:1200}, (_,i)=>i/100);
  const fitted = x.map(Math.sin), residual = x.map(t=>.12*Math.sin(17*t));
  const measured = fitted.map((v,i)=>v+residual[i]);
  const top=fig.panel(0,0), bottom=fig.panel(1,0);
  top.setTitle('Measurement and fit');
  top.plot(x,measured,{label:'Measurement',color:'#137f8b'});
  top.plot(x,fitted,{label:'Fit',color:'#d48c43'});
  top.setView({yLabel:'Amplitude'});
  bottom.setTitle('Residual');
  bottom.plot(x,residual,{label:'Measurement − fit',color:'#3569c8'});
  bottom.setView({xLabel:'Time (s)',yLabel:'Residual'});
  bottom.axhline(0,{color:'#64748b'});
  top.text(2,1.05,'Shared time axis',{fontSize:12});
  fig.bookmark('Overview');
  bottom.setView({xDomain:[2,4]});
  fig.bookmark('Two-second detail',{note:'Both panels use the same time interval.'});
  fig.restoreBookmark('Overview');
}

function sharedDistributions(fig) {
  const x=Float64Array.from({length:6000},(_,i)=>3*Math.sin(i*2.399963));
  const y=x.map((v,i)=>.45*v+Math.cos(i*1.618034));
  for(let col=0;col<2;col++){
    const panel=fig.panel(0,col);
    panel.setTitle(col?'After correction':'Before correction');
    panel.scatter(x,y.map((v,i)=>col?v-.45*x[i]:v),{size:3,color:col?'#d36a55':'#3569c8',label:'Synthetic samples'});
    panel.setView({xLabel:'Input',yLabel:'Response'});
    panel.axhline(0,{color:'#64748b'});
  }
  fig.bookmark('Overview');
  fig.panel(0,1).setView({xDomain:[-1,1],yDomain:[-1,1]});
  fig.bookmark('Central region');
  fig.restoreBookmark('Overview');
}

function heatmapComparison(fig) {
  const axis=Float64Array.from({length:40},(_,i)=>-3+6*i/39);
  for(let row=0;row<2;row++)for(let col=0;col<2;col++){
    const phase=(row*2+col)*Math.PI/2,panel=fig.panel(row,col);
    const z=Array.from(axis,y=>Array.from(axis,x=>Math.sin(x+phase)*Math.cos(y)));
    panel.setTitle(`Phase ${row*2+col}`);
    panel.heatmap(axis,axis,z,{colormap:'viridis',colorDomain:[-1,1]});
    panel.setView({xLabel:'x',yLabel:'y'});
    panel.axvline(0,{color:'#ffffff',width:1});
  }
  fig.bookmark('Overview');
  fig.panel(1,1).setView({xDomain:[-1,1],yDomain:[-1,1]});
  fig.bookmark('Center',{note:'All four fields share position and color limits.'});
  fig.restoreBookmark('Overview');
}

function javascript(create,layout){
  return `import { subplots } from "@vesora/core";\n\n${create.toString()}\n\nconst fig = subplots(${JSON.stringify({...layout,height:640})});\n${create.name}(fig);\nfig.mount(document.querySelector("#chart"));`;
}
const python=body=>`import math\nimport vesora as vs\n\n${body}\nfig.show()`;
const signalLayout={rows:2,cols:1,shareX:true};
const distributionLayout={rows:1,cols:2,shareX:true,shareY:true};
const heatmapLayout={rows:2,cols:2,shareX:true,shareY:true};

export const comparisonExamples=[
  {id:'signal-comparison',dimension:'2d',title:'Read the signal and its residual',type:'PANELS / SHARED TIME AXIS',
    description:'A synthetic measurement, fitted signal and residual with one shared time axis.',
    tags:['Two panels','Shared x','Annotations'],insight:'Zoom either panel to inspect the same interval in both.',
    layout:signalLayout,create:signalComparison,javascript:javascript(signalComparison,signalLayout),
    python:python(`fig = vs.subplots(2, 1, sharex=True, height=640)
x = [i/100 for i in range(1200)]
fitted = [math.sin(t) for t in x]
residual = [.12*math.sin(17*t) for t in x]
top, bottom = fig.panel(0, 0), fig.panel(1, 0)
top.set_title("Measurement and fit")
top.plot(x, [v+r for v,r in zip(fitted,residual)], label="Measurement", color="#137f8b")
top.plot(x, fitted, label="Fit", color="#d48c43")
top.set_axes(ylabel="Amplitude")
bottom.set_title("Residual")
bottom.plot(x, residual, label="Measurement − fit", color="#3569c8")
bottom.set_axes(xlabel="Time (s)", ylabel="Residual")
bottom.axhline(0, color="#64748b")
top.text(2, 1.05, "Shared time axis", font_size=12)
fig.bookmark("Overview")
bottom.set_axes(xlim=(2, 4))
fig.bookmark("Two-second detail", note="Both panels use the same time interval.")
fig.restore_bookmark("Overview")`)},
  {id:'shared-distributions',dimension:'2d',title:'Compare a correction on the same axes',type:'PANELS / LINKED DISTRIBUTIONS',
    description:'6,000 synthetic samples before and after removing a linear component.',
    tags:['Shared x and y','Scatter','Reference lines'],insight:'Matching scales make the remaining variation directly comparable.',
    layout:distributionLayout,create:sharedDistributions,javascript:javascript(sharedDistributions,distributionLayout),
    python:python(`fig = vs.subplots(1, 2, sharex=True, sharey=True, height=640)
x = [3*math.sin(i*2.399963) for i in range(6000)]
y = [.45*v+math.cos(i*1.618034) for i,v in enumerate(x)]
for col in range(2):
    panel = fig.panel(0, col)
    panel.set_title("After correction" if col else "Before correction")
    panel.scatter(x, [v-.45*x[i] if col else v for i,v in enumerate(y)], size=3,
                  color="#d36a55" if col else "#3569c8", label="Synthetic samples")
    panel.set_axes(xlabel="Input", ylabel="Response")
    panel.axhline(0, color="#64748b")
fig.bookmark("Overview")
fig.panel(0, 1).set_axes(xlim=(-1, 1), ylim=(-1, 1))
fig.bookmark("Central region")
fig.restore_bookmark("Overview")`)},
  {id:'heatmap-comparison',dimension:'2d',title:'Follow a field through four phases',type:'PANELS / HEATMAP COMPARISON',
    description:'Four 40 × 40 synthetic fields with shared position and fixed color limits.',
    tags:['Four panels','Heatmaps','Shared coordinates'],insight:'Use the same color range and view to compare each phase fairly.',
    layout:heatmapLayout,create:heatmapComparison,javascript:javascript(heatmapComparison,heatmapLayout),
    python:python(`fig = vs.subplots(2, 2, sharex=True, sharey=True, height=640)
axis = [-3+6*i/39 for i in range(40)]
for row in range(2):
    for col in range(2):
        phase = (row*2+col)*math.pi/2
        panel = fig.panel(row, col)
        panel.set_title(f"Phase {row*2+col}")
        panel.heatmap(axis, axis, [[math.sin(x+phase)*math.cos(y) for x in axis] for y in axis],
                      colormap="viridis", color_domain=(-1, 1))
        panel.set_axes(xlabel="x", ylabel="y")
        panel.axvline(0, color="#ffffff", width=1)
fig.bookmark("Overview")
fig.panel(1, 1).set_axes(xlim=(-1, 1), ylim=(-1, 1))
fig.bookmark("Center", note="All four fields share position and color limits.")
fig.restore_bookmark("Overview")`)},
];
