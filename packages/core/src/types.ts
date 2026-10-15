export const PROTOCOL_VERSION = 1;
export const EXTENDED_PROTOCOL_VERSION = 2;
export const STATISTICS_PROTOCOL_VERSION = 3;
export const LINKED_PROTOCOL_VERSION = 4;
export const PRESENTATION_PROTOCOL_VERSION = 5;
export const QUALITY_PROTOCOL_VERSION = 6;
export const SCENE3D_PROTOCOL_VERSION = 7;
export type NumericArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Int8Array | Uint8Array;
export type ScaleKind = "linear" | "log" | "time";
export interface ThemeTokens {
  background: string; foreground: string; muted: string; grid: string; axis: string;
  tooltipBackground: string; tooltipForeground: string; selection: string; error: string;
  fontFamily: string; fontSize: number; palette: string[];
  titleFontSize?: number; labelFontSize?: number; tickFontSize?: number; legendFontSize?: number;
}
export type ThemeInput = 'light' | 'dark' | Partial<ThemeTokens>;
export type AxisFormat =
  | {kind: 'number' | 'percent'; locale?: string; options?: Intl.NumberFormatOptions}
  | {kind: 'currency'; currency: string; locale?: string; options?: Intl.NumberFormatOptions}
  | {kind: 'date'; locale?: string; timeZone?: string; options?: Intl.DateTimeFormatOptions};
export interface PresentationOptions {tooltip?: boolean; legend?: boolean}
export interface PointerPosition {x: number; y: number; clientX: number; clientY: number}
export type HoverMode = 'nearest' | 'x';
export interface XHoverItem {layerId: string; index: number; x: number; y: number; streamId?: string; sequence?: number}
export interface XHoverEvent {cursorX: number; panelId?: string; pointerPosition: PointerPosition; items: XHoverItem[]; frameId?:number; snapshotId?:string; dataRevision?:number}
export interface HoverEvent {
  kind: 'point' | 'bar' | 'bin' | 'box' | 'outlier' | 'density' | 'cell' | 'point3d' | 'surface' | 'segment3d';
  layerId: string; panelId?: string; index?: number; sourceIndex?: number;
  x?: number | string; y?: number | string; category?: number | string; value?: number;
  position?: number; pointerPosition: PointerPosition; [key: string]: unknown;
}
export interface ViewChangeEvent extends Omit<ViewSpec,'xDomain'|'yDomain'|'zDomain'> {
  xDomain: Domain | null; yDomain: Domain | null; zDomain: Domain | null;
  panelId?: string; panelViews?: Record<string, Omit<ViewSpec,'xDomain'|'yDomain'|'zDomain'> & {xDomain:Domain|null;yDomain:Domain|null;zDomain:Domain|null}>;
}
export interface FigureEventMap {
  slicechange: {targetLayerId:string;index:number;mode:'live'|'frozen';frameId:number;snapshotId?:string};
  framepending: InspectionState;
  selection: Selection; hover: HoverEvent | null; click: HoverEvent; xhover: XHoverEvent | null;
  viewchange: ViewChangeEvent;
  representation: Array<RepresentationInfo & {layerId: string; panelId?: string}>;
  error: {message: string; code?: string; phase?: string; recoverable?: boolean};
  runtimechange: {status: 'ready' | 'recovering' | 'fallback' | 'failed'};
  frame: InspectionState;
  inspectionchange: InspectionState;
}
export type Domain = [number, number];
export type LayerKind = "line" | "line3d" | "scatter" | "heatmap" | "surface" | "scatter3d" | "hist" | "bar" | "boxplot" | "band";
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
  colorbarLabel?: string;
  shading?: 'unlit' | 'smooth';
  wireframe?: boolean;
}
export type FillBetweenOptions = Pick<LayerStyle, 'color' | 'opacity' | 'label'>;
export interface ExportPNGOptions {width?: number; height?: number; scale?: number; source?: 'accepted' | 'displayed'}
export interface LayerSpec {
  id: string; kind: LayerKind; data: Record<string, string>; style: LayerStyle; visible: boolean;
  panelId?: string;
  categorical?: {x?: true; y?: true};
  options?: StatisticalOptions;
}
export interface ViewSpec {
  equalAspect?:boolean;
  kind: "2d" | "3d"; xScale: ScaleKind; yScale: ScaleKind; zScale: ScaleKind;
  xDomain?: Domain; yDomain?: Domain; zDomain?: Domain;
  xLabel: string; yLabel: string; zLabel: string;
  camera: {azimuth: number; elevation: number; distance: number};
  pan3d?: [number, number];
  /** Relative axis lengths of the orthographic plot box. Defaults to a cube. */
  boxAspect?: [number, number, number];
  xFormat?: AxisFormat; yFormat?: AxisFormat;
}
export interface ViewState {view: ViewSpec; panelViews?: Record<string, ViewSpec>}
export interface ViewBookmark extends ViewState {name: string; note?: string}
export interface GridLayout {rows: number; cols: number; shareX: boolean; shareY: boolean}
export type CameraPreset = 'isometric' | 'xy' | 'xz' | 'yz';
export interface SurfaceSliceSpec {sourceLayerId: string; targetLayerId: string; axis: 'x' | 'y'; index: number}
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
  inspection?: {capturedAt:string;frameId:number;snapshotId?:string;selection?:HoverEvent};
  protocolVersion: number; id: string; title: string; width: number; height: number;
  view: ViewSpec; layers: LayerSpec[];
  bookmarks?: ViewBookmark[];
  layout?: GridLayout;
  panels?: PanelSpec[];
  annotations?: AnnotationSpec[];
  /** Axis identity is data semantics, not bookmark state. Keys are axis:panel or axis:shared. */
  categories?: Record<string, string[]>;
  barModes?: Record<string, BarMode>;
  selectionLink?: SelectionLinkSpec;
  theme?: ThemeTokens;
  hoverMode?: HoverMode;
  slices?: SurfaceSliceSpec[];
}
/** Observation identity is the fixed, explicitly aligned source row ordinal. */
export interface SelectionLinkSpec {
  id: string; scatter: [string, string]; histogram: string;
  generation: number; sequence: number;
  selection?: {originLayerId: string; bounds: Bounds};
}
export interface LinkedSelection {
  mode?: 'live'|'frozen'; frameId?:number; snapshotId?:string; sourceRevision?:number;
  kind: 'linked'; linkId: string; generation: number; sequence: number;
  layerId: string; panelId?: string; bounds?: Bounds; active: boolean;
  count: number; total: number; fraction: number; indices: number[]; truncated: boolean;
}
export interface Snapshot {figure: FigureSpec; sources: DataDescriptor[]}
export interface DataEntry {descriptor: DataDescriptor; readonly values: NumericArray; readonly chunks?: readonly NumericArray[]; readonly materializedByteLength?:number}
export type DataStore = Map<string, DataEntry>;
export interface Bounds {x: Domain; y: Domain}
export interface Query {
  bounds: Bounds; width: number; height: number; xScale: ScaleKind; yScale: ScaleKind;
  pointBudget: number; mode: RepresentationMode; previous?: "points" | "density";
}
export interface RepresentationInfo {
  kind: "points" | "density" | "line" | "grid" | "surface" | "hist" | "bar" | "boxplot" | "band";
  total: number; visible: number; rendered: number; exact: boolean; method: string;
  valid?: number; omitted?: number; rangeExcluded?: number;
  /** Surface triangle counts; omitted vertices and omitted triangles are distinct. */
  totalTriangles?: number; omittedTriangles?: number;
}
export interface PointsResult {kind: "points"; indices: Uint32Array; info: RepresentationInfo}
export interface DensityResult {kind: "density"; counts: Uint32Array; columns: number; rows: number; max: number; bounds: Bounds; info: RepresentationInfo}
export interface LineResult {kind: "line"; segments: Uint32Array[]; info: RepresentationInfo}
export interface BandResult {kind: "band"; segments: Uint32Array[]; info: RepresentationInfo}
export type PointPlan = PointsResult | DensityResult;
export type Selection =
  | LinkedSelection
  | {kind: "points"; layerId: string; panelId?: string; indices: number[]; count: number; truncated: boolean; streamId?: string; revision?: number; sequences?: number[]}
  | {kind: "density"; layerId: string; panelId?: string; bounds: Bounds; count: number; streamId?: string; revision?: number}
  | {kind: "bars" | "bins" | "boxes"; layerId: string; panelId?: string; indices: number[]; count: number; truncated: boolean};
export interface BackendCapabilities {name: string; supports3d: boolean; rasterExport: boolean; vectorExport: boolean}
export interface StreamingOptions {maxPoints: number}
/** Runtime metadata is deliberately excluded from static scene serialization. */
export interface StreamState {streamId: string; maxPoints: number; nextSequence: number; revision: number; retained: number; evicted: number}
export interface AppendOptions {waitFor?: 'accepted' | 'rendered'}
export interface ReadyOptions {signal?: AbortSignal; timeoutMs?: number; target?: 'live' | 'displayed'}
export interface InspectionState {mode: 'live' | 'frozen'; acceptedRevision: number; displayedRevision: number; frameId: number; snapshotId?: string; capturedAt?: string; snapshotBytes: number; maxSnapshotBytes: number; displayedStreams: Record<string, StreamState>}
export interface RuntimeOptions {maxCacheBytes?: number; maxSourceBytes?: number; maxGeometryBytes?: number; maxSnapshotBytes?: number; workerStartupTimeoutMs?: number; workerStallTimeoutMs?: number}
export interface FigureOptions {title?: string; width?: number; height?: number; kind?: "2d" | "3d"; theme?: ThemeInput; runtime?: RuntimeOptions}
export interface SubplotsOptions extends Omit<FigureOptions, 'kind'> {rows: number; cols: number; shareX?: boolean; shareY?: boolean; kinds?: Array<Array<'2d'|'3d'>>}
