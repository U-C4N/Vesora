export const PROTOCOL_VERSION = 1;
export const EXTENDED_PROTOCOL_VERSION = 2;
export const STATISTICS_PROTOCOL_VERSION = 3;
export type NumericArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Int8Array | Uint8Array;
export type ScaleKind = "linear" | "log";
export type Domain = [number, number];
export type LayerKind = "line" | "scatter" | "heatmap" | "surface" | "scatter3d" | "hist" | "bar" | "boxplot";
export type Orientation = 'vertical' | 'horizontal';
export type BarMode = 'group' | 'stack' | 'overlay';
export interface HistogramSpecOptions {bins: number | number[]; range?: Domain; density: boolean; cumulative: boolean}
export interface BarSpecOptions {orientation: Orientation; barWidth: number}
export interface BoxplotSpecOptions {orientation: Orientation; whis: number; showfliers: boolean; boxWidth: number}
export type StatisticalOptions = HistogramSpecOptions | BarSpecOptions | BoxplotSpecOptions;
export type RepresentationMode = "auto" | "points" | "density";
export interface DataDescriptor {
  id: string; dtype: "float64" | "float32" | "int32" | "uint32" | "int16" | "uint16" | "int8" | "uint8";
  shape: number[]; version: number; byteLength: number;
}
export interface LayerStyle {
  color?: string; size?: number; width?: number; opacity?: number; label?: string;
  colormap?: "viridis" | "magma"; representation?: RepresentationMode;
  colorDomain?: Domain;
}
export interface LayerSpec {
  id: string; kind: LayerKind; data: Record<string, string>; style: LayerStyle; visible: boolean;
  panelId?: string;
  categorical?: {x?: true; y?: true};
  options?: StatisticalOptions;
}
export interface ViewSpec {
  kind: "2d" | "3d"; xScale: ScaleKind; yScale: ScaleKind; zScale: ScaleKind;
  xDomain?: Domain; yDomain?: Domain; zDomain?: Domain;
  xLabel: string; yLabel: string; zLabel: string;
  camera: {azimuth: number; elevation: number; distance: number};
  pan3d?: [number, number];
}
export interface ViewState {view: ViewSpec; panelViews?: Record<string, ViewSpec>}
export interface ViewBookmark extends ViewState {name: string; note?: string}
export interface GridLayout {rows: number; cols: number; shareX: boolean; shareY: boolean}
/** The main panel uses FigureSpec.view; only secondary panels store a view. */
export interface PanelSpec {id: string; row: number; col: number; title: string; view?: ViewSpec}
export interface PanelEntry {id: string; row: number; col: number; title: string; view: ViewSpec}
export interface AnnotationStyle {color?: string; width?: number; opacity?: number; fontSize?: number}
export interface AnnotationOptions extends AnnotationStyle {x?: number; y?: number; text?: string}
export interface AnnotationSpec {
  id: string; kind: 'text' | 'hline' | 'vline'; panelId?: string;
  x?: number; y?: number; text?: string; style: AnnotationStyle;
}
export interface FigureSpec {
  protocolVersion: number; id: string; title: string; width: number; height: number;
  view: ViewSpec; layers: LayerSpec[];
  bookmarks?: ViewBookmark[];
  layout?: GridLayout;
  panels?: PanelSpec[];
  annotations?: AnnotationSpec[];
  /** Axis identity is data semantics, not bookmark state. Keys are axis:panel or axis:shared. */
  categories?: Record<string, string[]>;
  barModes?: Record<string, BarMode>;
}
export interface Snapshot {figure: FigureSpec; sources: DataDescriptor[]}
export interface DataEntry {descriptor: DataDescriptor; values: NumericArray}
export type DataStore = Map<string, DataEntry>;
export interface Bounds {x: Domain; y: Domain}
export interface Query {
  bounds: Bounds; width: number; height: number; xScale: ScaleKind; yScale: ScaleKind;
  pointBudget: number; mode: RepresentationMode; previous?: "points" | "density";
}
export interface RepresentationInfo {
  kind: "points" | "density" | "line" | "grid" | "surface" | "hist" | "bar" | "boxplot";
  total: number; visible: number; rendered: number; exact: boolean; method: string;
  valid?: number; omitted?: number; rangeExcluded?: number;
}
export interface PointsResult {kind: "points"; indices: Uint32Array; info: RepresentationInfo}
export interface DensityResult {kind: "density"; counts: Uint32Array; columns: number; rows: number; max: number; bounds: Bounds; info: RepresentationInfo}
export interface LineResult {kind: "line"; segments: Uint32Array[]; info: RepresentationInfo}
export type PointPlan = PointsResult | DensityResult;
export type Selection =
  | {kind: "points"; layerId: string; panelId?: string; indices: number[]; count: number; truncated: boolean}
  | {kind: "density"; layerId: string; panelId?: string; bounds: Bounds; count: number}
  | {kind: "bars" | "bins" | "boxes"; layerId: string; panelId?: string; indices: number[]; count: number; truncated: boolean};
export interface BackendCapabilities {name: string; supports3d: boolean; rasterExport: boolean; vectorExport: boolean}
export interface FigureOptions {title?: string; width?: number; height?: number; kind?: "2d" | "3d"}
export interface SubplotsOptions extends Omit<FigureOptions, 'kind'> {rows: number; cols: number; shareX?: boolean; shareY?: boolean}
