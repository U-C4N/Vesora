export {Figure,Layer,Panel,Annotation,figure,subplots,plot,scatter,scatter3d,heatmap,surface,hist,bar,barh,boxplot,defaultView} from './figure';
export {toHTML,downloadHTML} from './html-export';
export type {Series,Grid,AxisSeries,Groups,LayerOptions,HistogramOptions,BarOptions,BoxplotOptions,FigureEvent} from './figure';
export {DataRegistry,toNumericArray,decodeData,describeData} from './data';
export {planScatter,planLine} from './planning';
export {QueryScheduler} from './scheduler';
export {extent,normalize,project,invert,ticks} from './scales';
export {PROTOCOL_VERSION,EXTENDED_PROTOCOL_VERSION,STATISTICS_PROTOCOL_VERSION} from './types';
export type * from './types';
