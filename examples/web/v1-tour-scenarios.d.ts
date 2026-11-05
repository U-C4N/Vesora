import type {Figure} from '@vesora/core/runtime';
export type ChartStorySlug='ecdf'|'spectrogram'|'timeline'|'errorbar'|'contour'|'quiver'|'parallel'|'pareto'|'hysteresis'|'ternary';
export interface ChartStoryMetadata {slug:ChartStorySlug;title:string;titleTr:string;questionTr:string;explanationTr:string;readingTr:string[];problemEn:string;insightEn:string;limitationsTr:string;apiJs:string;apiPython:string}
export interface ChartStoryOptions {theme?:'light'|'dark';width?:number;height?:number}
export interface ChartStory {figure:Figure;keyStats:Array<{label:string;value:string}>;caption:string;dispose():void}
export const chartStories:readonly ChartStoryMetadata[];
export function createChartStory(core:Pick<typeof import('@vesora/core/runtime'),'figure'|'queryECDF'|'linkObservations'>,slug:string,options?:ChartStoryOptions):ChartStory;
