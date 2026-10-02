import type {Domain} from './types';

const palettes = {
  viridis: [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]],
  magma: [[0,0,4],[81,18,124],[183,55,121],[252,137,97],[252,253,191]],
};
export function colorMap(value: number, domain: Domain, name: 'viridis'|'magma' = 'viridis'): number[] {
  const t = domain[1] === domain[0] ? .5 : Math.max(0, Math.min(1, (value-domain[0])/(domain[1]-domain[0])));
  const palette = palettes[name];
  const position = t*(palette.length-1), i = Math.min(palette.length-2, Math.floor(position)), f = position-i;
  return [...palette[i].map((v,k)=>(v+(palette[i+1][k]-v)*f)/255),1];
}
export function parseColor(input = '#38bdf8', opacity = 1): number[] {
  const named: Record<string,string> = {blue:'#3b82f6',red:'#ef4444',green:'#22c55e',orange:'#f97316',purple:'#a855f7',black:'#000000',white:'#ffffff',cyan:'#06b6d4',yellow:'#eab308'};
  input = named[input.toLowerCase()] ?? input;
  if (/^#[0-9a-f]{3}$/i.test(input)) input = '#'+[...input.slice(1)].map(x=>x+x).join('');
  if (!/^#[0-9a-f]{6}$/i.test(input)) throw new Error('Colors must be #RGB, #RRGGBB or a supported named color');
  return [parseInt(input.slice(1,3),16)/255,parseInt(input.slice(3,5),16)/255,parseInt(input.slice(5,7),16)/255,opacity];
}
