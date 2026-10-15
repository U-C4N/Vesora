import type {DataEntry,Domain,NumericArray,ScaleKind} from './types';

interface Summary {linear?:Domain;log?:Domain;time?:Domain;ascending:boolean;first?:number;last?:number}
const chunks=new WeakMap<NumericArray,Summary>(),entries=new WeakMap<DataEntry,Summary>();
const scales=['linear','log','time'] as const;
function summarize(values:NumericArray):Summary {
  let min=Infinity,max=-Infinity,positive=Infinity,positiveMax=-Infinity,timeMin=Infinity,timeMax=-Infinity,ascending=true;
  for(let i=0;i<values.length;i++){
    const value=values[i];if(!Number.isFinite(value)){ascending=false;continue;}
    if(i&&value<=values[i-1])ascending=false;
    min=Math.min(min,value);max=Math.max(max,value);
    if(value>0){positive=Math.min(positive,value);positiveMax=Math.max(positiveMax,value);}
    if(Math.abs(value)<=8.64e15){timeMin=Math.min(timeMin,value);timeMax=Math.max(timeMax,value);}
  }
  return {linear:min===Infinity?undefined:[min,max],log:positive===Infinity?undefined:[positive,positiveMax],time:timeMin===Infinity?undefined:[timeMin,timeMax],ascending,first:values[0],last:values[values.length-1]};
}
function metadata(entry:DataEntry):Summary {
  const existing=entries.get(entry);if(existing)return existing;
  if(!entry.chunks){const result=summarize(entry.values);entries.set(entry,result);return result;}
  const result:Summary={ascending:true};let previous:number|undefined;
  for(const chunk of entry.chunks){
    let summary=chunks.get(chunk);if(!summary){summary=summarize(chunk);chunks.set(chunk,summary);}
    for(const scale of scales){
      const bounds=summary[scale];if(!bounds)continue;
      const old=result[scale];
      if(old){old[0]=Math.min(old[0],bounds[0]);old[1]=Math.max(old[1],bounds[1]);}
      else result[scale]=[...bounds];
    }
    if(!summary.ascending||previous!==undefined&&summary.first!==undefined&&summary.first<=previous)result.ascending=false;
    if(chunk.length){result.first??=summary.first;result.last=summary.last;previous=summary.last;}
  }
  entries.set(entry,result);return result;
}
export function entryExtent(entry:DataEntry,scale:ScaleKind):Domain|undefined{const bounds=metadata(entry)[scale];return bounds?[...bounds]:undefined;}
export function ascending(entry:DataEntry):boolean{return metadata(entry).ascending;}
