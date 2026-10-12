import {parseColor} from './color';
import {formatTick} from './scales';
import type {AxisFormat, ThemeInput, ThemeTokens} from './types';

export const LIGHT_THEME: Readonly<ThemeTokens> = Object.freeze({
  background:'#ffffff',foreground:'#334155',muted:'#475569',grid:'#e2e8f0',axis:'#cbd5e1',
  tooltipBackground:'#0f172a',tooltipForeground:'#ffffff',selection:'#ea580c',error:'#b91c1c',
  fontFamily:'system-ui, sans-serif',fontSize:12,palette:Object.freeze(['#38bdf8','#6366f1','#10b981','#f59e0b','#ec4899']) as unknown as string[],
});
export const DARK_THEME: Readonly<ThemeTokens> = Object.freeze({...LIGHT_THEME,
  background:'#0f172a',foreground:'#e2e8f0',muted:'#94a3b8',grid:'#334155',axis:'#475569',
  tooltipBackground:'#e2e8f0',tooltipForeground:'#0f172a',selection:'#fb923c',error:'#f87171',
});
const colorKeys=['background','foreground','muted','grid','axis','tooltipBackground','tooltipForeground','selection','error'] as const;
const themeKeys=new Set([...colorKeys,'fontFamily','fontSize','palette']);
const hex=(color:string)=>'#'+parseColor(color).slice(0,3).map(value=>Math.round(value*255).toString(16).padStart(2,'0')).join('');

/** Resolve presets and isolate caller-owned palette storage before committing. */
export function resolveTheme(input:ThemeInput='light'):ThemeTokens {
  if(typeof input==='string'){
    if(input!=='light'&&input!=='dark')throw new TypeError('Theme must be light, dark or theme tokens');
    return structuredClone(input==='dark'?DARK_THEME:LIGHT_THEME);
  }
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Theme tokens must be an object');
  for(const key of Object.keys(input))if(!themeKeys.has(key))throw new TypeError(`Unknown theme token: ${key}`);
  const theme={...LIGHT_THEME,...input};
  for(const key of colorKeys){if(typeof theme[key]!=='string')throw new TypeError(`Theme ${key} must be a color`);theme[key]=hex(theme[key]);}
  if(typeof theme.fontFamily!=='string'||!theme.fontFamily.trim()||theme.fontFamily.length>200||/[\u0000-\u001f\u007f]/.test(theme.fontFamily))throw new TypeError('Theme fontFamily must be nonempty text of at most 200 characters');
  if(!Number.isFinite(theme.fontSize)||theme.fontSize<8||theme.fontSize>32)throw new RangeError('Theme fontSize must be between 8 and 32');
  if(!Array.isArray(theme.palette)||theme.palette.length<1||theme.palette.length>32)throw new RangeError('Theme palette must contain 1 to 32 colors');
  theme.palette=theme.palette.map(color=>{if(typeof color!=='string')throw new TypeError('Palette entries must be colors');return hex(color);});
  return theme;
}
export function validateTheme(theme:ThemeTokens):void {
  if(!theme||Object.keys(theme).length!==themeKeys.size||[...themeKeys].some(key=>!Object.hasOwn(theme,key)))throw new TypeError('Serialized themes require every theme token');
  resolveTheme(theme);
}

const numericOptions=new Set(['localeMatcher','notation','compactDisplay','signDisplay','useGrouping','minimumIntegerDigits','minimumFractionDigits','maximumFractionDigits','minimumSignificantDigits','maximumSignificantDigits','currencyDisplay','currencySign']);
const dateOptions=new Set(['weekday','era','year','month','day','hour','minute','second','fractionalSecondDigits','hour12','hourCycle','dateStyle','timeStyle','calendar','numberingSystem','formatMatcher','localeMatcher','timeZoneName']);
const enumOptions:Record<string,readonly string[]>={
  localeMatcher:['lookup','best fit'],notation:['standard','scientific','engineering','compact'],compactDisplay:['short','long'],
  signDisplay:['auto','never','always','exceptZero','negative'],currencyDisplay:['symbol','narrowSymbol','code','name'],currencySign:['standard','accounting'],
  weekday:['long','short','narrow'],era:['long','short','narrow'],year:['numeric','2-digit'],month:['numeric','2-digit','long','short','narrow'],
  day:['numeric','2-digit'],hour:['numeric','2-digit'],minute:['numeric','2-digit'],second:['numeric','2-digit'],
  hourCycle:['h11','h12','h23','h24'],dateStyle:['full','long','medium','short'],timeStyle:['full','long','medium','short'],
  formatMatcher:['basic','best fit'],timeZoneName:['long','short','shortOffset','longOffset','shortGeneric','longGeneric'],
};
const formatters=new Map<string,Intl.NumberFormat|Intl.DateTimeFormat>();
function formatter(format:AxisFormat):Intl.NumberFormat|Intl.DateTimeFormat {
  const key=JSON.stringify(format);const cached=formatters.get(key);if(cached)return cached;
  const locale=format.locale??'en-US';
  const result=format.kind==='date'
    ?new Intl.DateTimeFormat(locale,{...(format.options??{year:'numeric',month:'short',day:'numeric'}),timeZone:format.timeZone??'UTC'})
    :new Intl.NumberFormat(locale,{...format.options,style:format.kind==='number'?'decimal':format.kind,...(format.kind==='currency'?{currency:format.currency}:{})});
  if(formatters.size>=100)formatters.delete(formatters.keys().next().value!);
  formatters.set(key,result);return result;
}
/** Keep declarative format options JSON-safe and reject errors before live state changes. */
export function validateAxisFormat(input:AxisFormat):AxisFormat {
  if(!input||typeof input!=='object'||Array.isArray(input)||!['number','currency','percent','date'].includes(input.kind))throw new TypeError('Invalid axis format kind');
  const allowed=new Set(['kind','locale','options',...(input.kind==='currency'?['currency']:[]),...(input.kind==='date'?['timeZone']:[])]);
  for(const key of Object.keys(input))if(!allowed.has(key))throw new TypeError(`Unknown axis format field: ${key}`);
  if(input.locale!==undefined&&(typeof input.locale!=='string'||!input.locale))throw new TypeError('Format locale must be nonempty');
  const format=structuredClone(input);
  if(format.kind==='currency'){
    if(typeof format.currency!=='string'||!/^[A-Za-z]{3}$/.test(format.currency))throw new RangeError('Currency must be a three-letter code');
    format.currency=format.currency.toUpperCase();
  }
  if(format.kind==='date'&&format.timeZone!==undefined&&(typeof format.timeZone!=='string'||!format.timeZone||/^[+-]/.test(format.timeZone)))throw new RangeError('Time zone must be UTC or an IANA name');
  if(format.options!==undefined){
    if(!format.options||typeof format.options!=='object'||Array.isArray(format.options))throw new TypeError('Format options must be an object');
    const keys=format.kind==='date'?dateOptions:numericOptions;
    for(const [key,value]of Object.entries(format.options)){
      if(!keys.has(key)||!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new TypeError(`Invalid format option: ${key}`);
      if(enumOptions[key]&&(typeof value!=='string'||!enumOptions[key].includes(value)))throw new RangeError(`Invalid format option: ${key}`);
      if(key==='hour12'&&typeof value!=='boolean'||key==='useGrouping'&&typeof value!=='boolean'&&!(typeof value==='string'&&['auto','always','min2'].includes(value)))throw new TypeError(`Invalid format option: ${key}`);
      if(['calendar','numberingSystem'].includes(key)&&(typeof value!=='string'||!/^[a-zA-Z0-9-]{3,32}$/.test(value)))throw new TypeError(`Invalid format option: ${key}`);
      if(key.includes('Digits')){
        const min=key==='minimumIntegerDigits'||key.includes('Significant')||key==='fractionalSecondDigits'?1:0,max=key==='fractionalSecondDigits'?3:key.includes('Fraction')?20:21;
        if(typeof value!=='number'||!Number.isInteger(value)||value<min||value>max)throw new RangeError(`Invalid format option: ${key}`);
      }
    }
    for(const suffix of ['FractionDigits','SignificantDigits']){
      const options=format.options as Record<string,unknown>,low=options[`minimum${suffix}`],high=options[`maximum${suffix}`];
      if(typeof low==='number'&&typeof high==='number'&&low>high)throw new RangeError('Minimum format digits cannot exceed maximum');
    }
  }
  formatter(format);return format;
}
export function formatValue(value:number,format?:AxisFormat,span?:number):string {
  if(!Number.isFinite(value))return String(value);
  if(!format)return formatTick(value,span);
  return formatter(format).format(value);
}
/** Time labels change with the visible interval; explicit Intl options override this. */
export function formatTimeTick(value:number,span:number,format?:AxisFormat):string {
  const options:Intl.DateTimeFormatOptions=span<86_400_000?{hour:'2-digit',minute:'2-digit',...(span<60_000?{second:'2-digit'}:{}),...(span<1000?{fractionalSecondDigits:3}:{})}:span<366*86_400_000?{month:'short',day:'numeric'}:{year:'numeric',month:'short'};
  return formatValue(value,format?.kind==='date'?{...format,options:format.options??options}:{kind:'date',options});
}
