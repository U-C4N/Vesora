/** A small, conservative communicating-vessel model, independent of rendering.
 * Quantities map to incompressible model volume through volumeScale (m³/unit).
 * One open connection uses hydrostatic pressure and constant laminar resistance;
 * this is a lumped model, not a fluid-surface or turbulence simulation.
 */
export interface BalanceCategory {readonly id:string;readonly label:string;readonly volume:number}
export interface BalanceParameters {readonly area:number;readonly volumeScale:number;readonly density:number;readonly gravity:number;readonly conductance:number}
export type BalanceOptions=Partial<BalanceParameters>;
export interface BalanceState {readonly categories:readonly BalanceCategory[];readonly parameters:BalanceParameters;readonly total:number;readonly elapsed:number;readonly energy:number}
export interface BalanceReading extends BalanceCategory {readonly share:number;readonly height:number;readonly pressure:number}
export interface BalanceValve {readonly from:string;readonly to:string;readonly openness?:number}
export interface BalanceTransition {
  readonly state:BalanceState;readonly mode:'passive'|'manual';
  /** Signed quantity from the named from-category to the to-category. */
  readonly transferred:number;
  /** Mean signed quantity/second during a passive step; zero for a manual edit. */
  readonly flowRate:number;readonly pressureDifference:number;
  readonly energyChange:number;readonly dissipatedEnergy:number;readonly externalWork:number;
}
const DEFAULTS:BalanceParameters={area:1,volumeScale:.001,density:1000,gravity:9.81,conductance:.00005};
function finite(value:unknown,name:string,positive=false):number{
  if(typeof value!=='number'||!Number.isFinite(value)||(positive?value<=0:value<0))throw new RangeError(`${name} must be a finite ${positive?'positive':'nonnegative'} number`);
  return value;
}
function text(value:unknown,name:string,maximum:number):string{
  if(typeof value!=='string'||!value.trim()||value.length>maximum)throw new TypeError(`${name} must be nonempty text of at most ${maximum} characters`);
  return value;
}
function parameters(options:BalanceOptions):BalanceParameters{
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Balance options must be an object');
  for(const key of Object.keys(options))if(!Object.hasOwn(DEFAULTS,key))throw new TypeError(`Unknown balance parameter ${key}`);
  const result={...DEFAULTS,...options};
  for(const key of Object.keys(DEFAULTS) as (keyof BalanceParameters)[])finite(result[key],key,key!=='conductance');
  finite(result.density*result.gravity,'hydrostatic coefficient',true);
  finite(result.conductance*(result.density*result.gravity)/result.area,'hydraulic relaxation rate');
  return Object.freeze(result);
}
function readings(categories:readonly BalanceCategory[],params:BalanceParameters,total:number):BalanceReading[]{
  return categories.map(category=>{
    const physicalVolume=finite(category.volume*params.volumeScale,'mapped volume');
    const height=finite(physicalVolume/params.area,'height'),pressure=finite((params.density*params.gravity)*height,'pressure');
    return {...category,share:total===0?0:category.volume/total,height,pressure};
  });
}
function state(categories:readonly BalanceCategory[],params:BalanceParameters,total:number,elapsed:number):BalanceState{
  const rows=readings(categories,params,total);
  const energy=finite(rows.reduce((sum,row)=>sum+(row.pressure/2)*(row.volume*params.volumeScale),0),'potential energy');
  return Object.freeze({categories:Object.freeze(categories.map(category=>Object.freeze({...category}))),parameters:params,total,elapsed,energy});
}
/** Three to eight nonnegative categories, all with the same cross-sectional area. */
export function createBalance(categories:readonly BalanceCategory[],options:BalanceOptions={}):BalanceState{
  if(!Array.isArray(categories)||categories.length<3||categories.length>8)throw new RangeError('Balance needs 3–8 categories');
  const ids=new Set<string>(),copy=categories.map(category=>{
    if(!category||typeof category!=='object')throw new TypeError('A category needs id, label and volume');
    const id=text(category.id,'Category id',64);if(ids.has(id))throw new TypeError('Category IDs must be unique');ids.add(id);
    return {id,label:text(category.label,'Category label',256),volume:finite(category.volume,'Category volume')};
  });
  const total=finite(copy.reduce((sum,category)=>sum+category.volume,0),'Total quantity');
  return state(copy,parameters(options),total,0);
}
function checked(input:BalanceState):BalanceState{
  if(!input||typeof input!=='object')throw new TypeError('A balance state is required');
  const copy=createBalance(input.categories,input.parameters),total=finite(input.total,'Total quantity'),elapsed=finite(input.elapsed,'Elapsed time');
  const tolerance=64*Number.EPSILON*Math.max(total,copy.total);
  if(Math.abs(total-copy.total)>tolerance)throw new RangeError('Balance total differs from its category quantities');
  return state(copy.categories,copy.parameters,total,elapsed);
}
/** Detached exact values, common-baseline heights (m), and gauge pressures (Pa). */
export function inspectBalance(input:BalanceState):BalanceReading[]{const value=checked(input);return readings(value.categories,value.parameters,value.total);}
function pair(input:BalanceState,from:string,to:string):[number,number]{
  const a=input.categories.findIndex(category=>category.id===from),b=input.categories.findIndex(category=>category.id===to);
  if(a<0||b<0||a===b)throw new RangeError('Choose two different existing category IDs');
  return [a,b];
}
function transition(input:BalanceState,a:number,b:number,amount:number,seconds:number,mode:BalanceTransition['mode']):BalanceTransition{
  const categories=input.categories.map(category=>({...category})),before=readings(categories,input.parameters,input.total);
  const pairTotal=categories[a].volume+categories[b].volume;
  const from=Math.max(0,Math.min(pairTotal,categories[a].volume-amount));
  const transferred=categories[a].volume-from;
  // Derive the second quantity from the pair sum, rather than integrating two
  // independently rounded rates. Unconnected categories are untouched.
  // Preserve even a tiny disconnected remainder on exact no-ops: subtracting
  // a very large from-value from a rounded pair sum could otherwise erase it.
  if(transferred!==0){categories[a].volume=from;categories[b].volume=pairTotal-from;}
  const elapsed=finite(input.elapsed+seconds,'Elapsed time'),next=state(categories,input.parameters,input.total,elapsed);
  const energyChange=next.energy-input.energy,flowRate=seconds===0?0:transferred/seconds;
  if(!Number.isFinite(flowRate))throw new RangeError('Flow rate exceeds finite numeric range');
  return Object.freeze({state:next,mode,transferred,flowRate,pressureDifference:before[a].pressure-before[b].pressure,
    energyChange,dissipatedEnergy:mode==='passive'?Math.max(0,-energyChange):0,externalWork:mode==='manual'?energyChange:0});
}
/** Advance one open valve analytically: ΔV(t)=ΔV(0) exp(-2 C ρ g openness t/A).
 * The higher vessel always drains toward the lower. Even a large time step
 * cannot cross equilibrium. Other valves are closed in this v1 model.
 */
export function stepBalance(input:BalanceState,valve:BalanceValve,seconds:number):BalanceTransition{
  const current=checked(input);finite(seconds,'Step time');
  if(!valve||typeof valve!=='object')throw new TypeError('A valve is required');
  const [a,b]=pair(current,valve.from,valve.to),openness=finite(valve.openness===undefined?1:valve.openness,'Valve openness');
  if(openness>1)throw new RangeError('Valve openness must be between zero and one');
  const p=current.parameters,rate=p.conductance*(p.density*p.gravity)/p.area;
  const fraction=-Math.expm1(-((rate*openness)*seconds)*2);
  const difference=current.categories[a].volume-current.categories[b].volume;
  const amount=(difference/2)*Math.min(1,Math.max(0,fraction));
  return transition(current,a,b,amount,seconds,'passive');
}
/** Explicit manual redistribution, limited by available source quantity.
 * Uphill transfers require external work; this operation is not passive flow.
 */
export function transferBalance(input:BalanceState,from:string,to:string,requestedAmount:number):BalanceTransition{
  const current=checked(input);finite(requestedAmount,'Requested transfer');const [a,b]=pair(current,from,to);
  return transition(current,a,b,Math.min(requestedAmount,current.categories[a].volume),0,'manual');
}
