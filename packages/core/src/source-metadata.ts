import type {DataEntry,Domain,NumericArray,ScaleKind} from './types';

interface Summary {linear?:Domain;log?:Domain;time?:Domain;ascending:boolean;first?:number;last?:number}
const chunks=new WeakMap<NumericArray,Summary>(),entries=new WeakMap<DataEntry,Summary>();
const scales=['linear','log','time'] as const;
function summarize(values:NumericArray):Summary {
  let min=Infinity,max=-Infinity,positive=Infinity,positiveMax=-Infinity,timeMin=Infinity,timeMax=-Infinity,ascending=true,previous=-Infinity;
  for(let i=0;i<values.length;i++){
    const value=values[i];if(!Number.isFinite(value)){ascending=false;continue;}
    if(ascending){if(value<=previous)ascending=false;previous=value;}
    // Most samples do not extend an extremum. Keep Math's signed-zero rules
    // for zero values without calling both extrema functions on every sample.
    if(value===0){min=Math.min(min,value);max=Math.max(max,value);}
    else{if(value<min)min=value;if(value>max)max=value;}
    if(value>0){if(value<positive)positive=value;if(value>positiveMax)positiveMax=value;}
    if(Math.abs(value)<=8.64e15){
      if(value===0){timeMin=Math.min(timeMin,value);timeMax=Math.max(timeMax,value);}
      else{if(value<timeMin)timeMin=value;if(value>timeMax)timeMax=value;}
    }
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
