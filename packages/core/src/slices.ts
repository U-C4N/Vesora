import type {NumericArray, SurfaceSliceSpec} from './types';

/** Exact source-grid samples: a slice never interpolates or bridges a missing value. */
export function surfaceSliceValues(values:Record<string,NumericArray>,slice:Pick<SurfaceSliceSpec,'axis'|'index'>):{x:Float64Array;y:Float64Array}{
  if(slice.axis!=='x'&&slice.axis!=='y')throw new TypeError('Surface slice axis must be x or y');
  const fixed=values[slice.axis],free=values[slice.axis==='x'?'y':'x'];
  if(!Number.isSafeInteger(slice.index)||slice.index<0||slice.index>=fixed.length)throw new RangeError('Surface slice index is outside the source grid');
  const x=Float64Array.from(free),y=new Float64Array(free.length),columns=values.x.length;
  for(let i=0;i<y.length;i++)y[i]=values.z[slice.axis==='x'?i*columns+slice.index:slice.index*columns+i];
  return {x,y};
}
