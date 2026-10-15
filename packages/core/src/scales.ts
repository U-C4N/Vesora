import type {Domain, NumericArray, ScaleKind} from './types';

export function transform(value: number, kind: ScaleKind = 'linear'): number {
  return kind === 'log' ? (value > 0 ? Math.log10(value) : NaN) : value;
}

export function validateDomain(domain: Domain, kind: ScaleKind = 'linear'): Domain {
  if (!['linear','log','time'].includes(kind)) throw new RangeError(`Unsupported scale kind: ${kind}`);
  if (domain.length !== 2 || !domain.every(Number.isFinite) || domain[0] >= domain[1] || (kind === 'log' && domain[0] <= 0) || kind==='time'&&domain.some(value=>Math.abs(value)>8.64e15)) {
    throw new RangeError(`${kind} scale requires a finite increasing domain${kind === 'log' ? ' with positive values' : ''}.`);
  }
  return domain;
}

export function extent(values: ArrayLike<number> | NumericArray, kind: ScaleKind = 'linear'): Domain {
  let min = Infinity, max = -Infinity;
  for (let start = 0; start < values.length; start += 65_536) {
    for (let i = start, end = Math.min(start + 65_536, values.length); i < end; i++) {
      const value = values[i];
      if (!Number.isFinite(value) || (kind === 'log' && value <= 0) || kind==='time'&&Math.abs(value)>8.64e15) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  if (min === Infinity) return kind === 'log' ? [1, 10] : [0, 1];
  if (min === max) {
    if (kind === 'log') return [Math.max(Number.MIN_VALUE, min / 2), Math.min(Number.MAX_VALUE, max * 2)];
    const padding = kind==='time'?86_400_000:Math.max(Math.abs(min) * 0.05, 1);
    if(kind==='time')return [Math.max(-8.64e15,min-padding),Math.min(8.64e15,max+padding)];
    return [Math.max(-Number.MAX_VALUE, min - padding), Math.min(Number.MAX_VALUE, max + padding)];
  }
  return [min, max];
}

/** Subtract in float64 before converting coordinates for the GPU. */
export function normalize(value: number, domain: Domain, kind: ScaleKind = 'linear'): number {
  if (!Number.isFinite(value) || (kind === 'log' && value <= 0) || kind==='time'&&Math.abs(value)>8.64e15) return NaN;
  if (kind === 'log') {
    const span = Math.log(domain[1] / domain[0]);
    return Number.isFinite(span) ? Math.log(value / domain[0]) / span : (Math.log(value) - Math.log(domain[0])) / (Math.log(domain[1]) - Math.log(domain[0]));
  }
  const span = domain[1] - domain[0];
  return Number.isFinite(span) ? (value - domain[0]) / span : (value / 2 - domain[0] / 2) / (domain[1] / 2 - domain[0] / 2);
}

/** Prepare one query's immutable domain without changing normalize's arithmetic. */
export function createNormalizer(domain:Domain,kind:ScaleKind='linear'):(value:number)=>number {
  const minimum=domain[0],maximum=domain[1];
  if(kind==='log'){
    const span=Math.log(maximum/minimum);
    if(Number.isFinite(span))return value=>!Number.isFinite(value)||value<=0?NaN:Math.log(value/minimum)/span;
    const origin=Math.log(minimum),logSpan=Math.log(maximum)-origin;
    return value=>!Number.isFinite(value)||value<=0?NaN:(Math.log(value)-origin)/logSpan;
  }
  const span=maximum-minimum;
  if(Number.isFinite(span)){
    if(kind==='time')return value=>!Number.isFinite(value)||Math.abs(value)>8.64e15?NaN:(value-minimum)/span;
    return value=>Number.isFinite(value)?(value-minimum)/span:NaN;
  }
  const origin=minimum/2,halfSpan=maximum/2-origin;
  if(kind==='time')return value=>!Number.isFinite(value)||Math.abs(value)>8.64e15?NaN:(value/2-origin)/halfSpan;
  return value=>Number.isFinite(value)?(value/2-origin)/halfSpan:NaN;
}

export function project(value: number, domain: Domain, range: Domain, kind: ScaleKind = 'linear'): number {
  return range[0] + normalize(value, domain, kind) * (range[1] - range[0]);
}

export function denormalize(t: number, domain: Domain, kind: ScaleKind = 'linear'): number {
  if (t === 0) return domain[0];
  if (t === 1) return domain[1];
  if (kind === 'log') {
    const ratio = domain[1] / domain[0];
    return Number.isFinite(ratio) ? domain[0] * Math.exp(t * Math.log(ratio)) : Math.exp((1 - t) * Math.log(domain[0]) + t * Math.log(domain[1]));
  }
  const span = domain[1] - domain[0];
  return Number.isFinite(span) ? domain[0] + t * span : (1 - t) * domain[0] + t * domain[1];
}

export function invert(pixel: number, domain: Domain, range: Domain, kind: ScaleKind = 'linear'): number {
  return denormalize((pixel - range[0]) / (range[1] - range[0]), domain, kind);
}

export function ticks(domain: Domain, kind: ScaleKind = 'linear', count = 6): number[] {
  validateDomain(domain, kind);
  count = Math.max(2, Math.min(100, Math.floor(count)));
  if(kind==='time')return timeTicks(domain,count);
  if (kind === 'log') {
    // Sub-decade/scientific ranges need meaningful 1–2–5 labels, not arbitrary
    // geometric fractions of the padded domain (for example 0.221, 0.465, ...).
    if(Math.log10(domain[1])-Math.log10(domain[0])<2){
      const candidates:number[]=[];
      for(let power=Math.floor(Math.log10(domain[0]));power<=Math.ceil(Math.log10(domain[1]));power++)for(const multiple of [1,2,5]){
        const value=multiple*10**power;
        if(Number.isFinite(value)&&value>=domain[0]&&value<=domain[1]&&value>0&&!candidates.includes(value))candidates.push(value);
      }
      if(candidates.length>=2){
        if(candidates.length<=count)return candidates;
        return Array.from({length:count},(_,i)=>candidates[Math.round(i*(candidates.length-1)/(count-1))]);
      }
      return ticks(domain,'linear',count);
    }
    const first = Math.ceil(Math.log10(domain[0])), last = Math.floor(Math.log10(domain[1]));
    if (last >= first) {
      const step = Math.max(1, Math.ceil((last - first + 1) / count));
      const result: number[] = [];
      for (let power = first; power <= last; power += step) result.push(10 ** power);
      if (result.length >= 2) return result;
    }
    return Array.from({length: count}, (_, i) => denormalize(i / (count - 1), domain, kind));
  }
  const span = domain[1] - domain[0];
  if (!Number.isFinite(span)) return Array.from({length: count}, (_, i) => denormalize(i / (count - 1), domain));
  const rough = span / (count - 1), magnitude = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / magnitude, step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * magnitude;
  if (!Number.isFinite(step) || step === 0) return [domain[0], domain[1]];
  const first = Math.ceil(domain[0] / step) * step;
  const result: number[] = [];
  for (let i = 0; i < 100; i++) {
    const value = first + i * step;
    if (value > domain[1]) break;
    if (value >= domain[0] && (result.length === 0 || value !== result[result.length - 1])) result.push(Object.is(value, -0) ? 0 : value);
  }
  return result.length >= 2 ? result : [domain[0], domain[1]];
}

/** UTC calendar ticks use real month lengths rather than a fixed 30-day interval. */
export function timeTicks(domain:Domain,count=6):number[] {
  validateDomain(domain,'time');count=Math.max(2,Math.min(100,Math.floor(count)));
  const day=86_400_000,rough=(domain[1]-domain[0])/(count-1);
  const fixed=[1,5,10,50,100,250,500,1000,5000,15000,30000,60000,300000,900000,1800000,3600000,10800000,21600000,43200000,day,2*day,7*day];
  const result:number[]=[];
  if(rough<=7*day){
    const step=fixed.find(value=>value>=rough)??7*day;
    const anchor=step===7*day?4*day:0; // Monday, 1970-01-05.
    const first=anchor+Math.ceil((domain[0]-anchor)/step)*step;
    for(let i=0;i<100;i++){const value=first+i*step;if(value>domain[1])break;if(value>=domain[0])result.push(value);}
  }else{
    const months=rough/(30.4375*day),step=months<=1?1:months<=3?3:months<=6?6:12*Math.max(1,Math.ceil(months/12));
    const date=new Date(domain[0]),absolute=date.getUTCFullYear()*12+date.getUTCMonth();
    let month=Math.floor(absolute/step)*step;
    for(let i=0;i<102;i++,month+=step){
      const tick=new Date(0);tick.setUTCFullYear(Math.floor(month/12),((month%12)+12)%12,1);tick.setUTCHours(0,0,0,0);
      const value=tick.getTime();if(!Number.isFinite(value)||value>domain[1])break;if(value>=domain[0])result.push(value);
    }
  }
  return result.length>=2?result:[domain[0],domain[1]];
}

export function formatTick(value: number, span?: number): string {
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (span !== undefined && Number.isFinite(span) && span !== 0) {
    const digits = Math.min(17, Math.max(3, Math.ceil(Math.log10(magnitude) - Math.log10(Math.abs(span))) + 3));
    return magnitude >= 1e5 || magnitude < 1e-3
      ? value.toExponential(digits - 1).replace(/\.?(0+)(e)/, '$2')
      : Number(value.toPrecision(digits)).toString();
  }
  return magnitude >= 1e5 || magnitude < 1e-3 ? value.toExponential(3).replace(/\.?(0+)(e)/, '$2') : Number(value.toPrecision(6)).toString();
}
