// Synthetic, reproducible examples. Every Python snippet works without NumPy.
function histogram(fig) {
  const samples=Array.from({length:4000},(_,i)=>Math.sin(i*1.618)+.4*Math.cos(i*2.399));
  fig.hist(samples,{bins:24,color:'#3569c8',label:'Measurements'});
  fig.setView({xLabel:'Value',yLabel:'Count'});fig.bookmark('Overview');
}
function cumulative(fig) {
  const samples=Array.from({length:3000},(_,i)=>Math.sin(i*1.618)+.4*Math.cos(i*2.399));
  fig.panel(0,0).hist(samples,{bins:20,density:true,color:'#137f8b'});
  fig.panel(0,0).setTitle('Probability density');fig.panel(0,0).setView({yLabel:'Density'});
  fig.panel(0,1).hist(samples,{bins:20,density:true,cumulative:true,color:'#d36a55'});
  fig.panel(0,1).setTitle('Cumulative probability');fig.panel(0,1).setView({yLabel:'Probability'});
  fig.bookmark('Overview');
}
function grouped(fig) {
  fig.setCategories('x',['Model A','Model B','Model C']);
  fig.bar(['Model A','Model B','Model C'],[72,81,77],{label:'Dataset 1',color:'#3569c8'});
  fig.bar(['Model A','Model C'],[75,84],{label:'Dataset 2',color:'#d36a55'});
  fig.setView({yLabel:'Synthetic score'});fig.bookmark('Overview');
}
function stacked(fig) {
  fig.setBarMode('stack');
  fig.barh(['North','Central','South'],[8,-3,5],{label:'Change A',color:'#137f8b'});
  fig.barh(['North','Central','South'],[-2,-4,3],{label:'Change B',color:'#d36a55'});
  fig.axvline(0,{color:'#64748b'});fig.setView({xLabel:'Change from baseline'});fig.bookmark('Overview');
}
function boxes(fig) {
  fig.boxplot([[1,2,3,4,5,14],[2,3,3,4,5,6],[],[4]],{labels:['Batch A','Batch B','Missing','Single'],color:'#137f8b'});
  fig.setView({yLabel:'Measurement'});fig.bookmark('Overview');
}
function categorical(fig) {
  fig.setCategories('x',['Small','Medium','Large']);
  fig.plot(['Small','Medium','Large'],[4,7,6],{label:'Trend',color:'#3569c8',width:3});
  fig.scatter(['Large','Small','Medium'],[8,3,5],{label:'Samples',color:'#d36a55',size:10});
  fig.setView({xLabel:'Configuration',yLabel:'Response'});fig.bookmark('Overview');
}
const snippets=[
  `samples = [math.sin(i*1.618)+.4*math.cos(i*2.399) for i in range(4000)]
fig.hist(samples, bins=24, color="#3569c8", label="Measurements")
fig.set_axes(xlabel="Value", ylabel="Count")`,
  `samples = [math.sin(i*1.618)+.4*math.cos(i*2.399) for i in range(3000)]
fig.panel(0, 0).hist(samples, bins=20, density=True, color="#137f8b")
fig.panel(0, 0).set_title("Probability density")
fig.panel(0, 0).set_axes(ylabel="Density")
fig.panel(0, 1).hist(samples, bins=20, density=True, cumulative=True, color="#d36a55")
fig.panel(0, 1).set_title("Cumulative probability")
fig.panel(0, 1).set_axes(ylabel="Probability")`,
  `fig.set_categories("x", ["Model A", "Model B", "Model C"])
fig.bar(["Model A", "Model B", "Model C"], [72, 81, 77], label="Dataset 1", color="#3569c8")
fig.bar(["Model A", "Model C"], [75, 84], label="Dataset 2", color="#d36a55")
fig.set_axes(ylabel="Synthetic score")`,
  `fig.set_bar_mode("stack")
fig.barh(["North", "Central", "South"], [8, -3, 5], label="Change A", color="#137f8b")
fig.barh(["North", "Central", "South"], [-2, -4, 3], label="Change B", color="#d36a55")
fig.axvline(0, color="#64748b")
fig.set_axes(xlabel="Change from baseline")`,
  `fig.boxplot([[1, 2, 3, 4, 5, 14], [2, 3, 3, 4, 5, 6], [], [4]],
            labels=["Batch A", "Batch B", "Missing", "Single"], color="#137f8b")
fig.set_axes(ylabel="Measurement")`,
  `fig.set_categories("x", ["Small", "Medium", "Large"])
fig.plot(["Small", "Medium", "Large"], [4, 7, 6], label="Trend", color="#3569c8", width=3)
fig.scatter(["Large", "Small", "Medium"], [8, 3, 5], label="Samples", color="#d36a55", size=10)
fig.set_axes(xlabel="Configuration", ylabel="Response")`,
];
export const statisticsExamples=[
  ['histogram','Explore a measurement distribution','HISTOGRAM',histogram,'All finite source samples counted into fixed bins.'],
  ['cumulative-histogram','Compare density and cumulative probability','NORMALIZATION',cumulative,'Density integrates to one; cumulative probability ends at one.'],
  ['grouped-bars','Compare categories across datasets','GROUPED BARS',grouped,'A missing category retains an empty series slot.'],
  ['stacked-bars','Separate positive and negative changes','STACKED BARH',stacked,'Positive and negative contributions accumulate independently.'],
  ['boxplots','Inspect spread and unusual measurements','BOXPLOT',boxes,'Exact quartiles, whiskers and outliers, including empty and single-value groups.'],
  ['categorical-series','Use named categories in lines and points','CATEGORICAL AXES',categorical,'Category identity stays fixed while input order is preserved.'],
].map(([id,title,type,create,description],i)=>{
  const layout=i===1?{rows:1,cols:2,shareX:true}:undefined;
  const factory=layout?'subplots':'figure';
  return {id,title,type,create,description,dimension:'2d',tags:['Statistics','Python + JavaScript','Offline HTML'],insight:description,...(layout?{layout}:{}),
    javascript:`import { ${factory} } from "@vesora/core";\n\n${create.toString()}\n\nconst fig = ${factory}(${JSON.stringify({...layout,height:520})});\n${create.name}(fig);\nfig.mount(document.querySelector("#chart"));`,
    python:`import math\nimport vesora as vs\n\nfig = ${layout?'vs.subplots(1, 2, sharex=True, height=520)':'vs.figure(height=520)'}\n${snippets[i]}\nfig.bookmark("Overview")\nfig.show()`,
  };
});
