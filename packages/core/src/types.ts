export const PROTOCOL_VERSION = 1;
export type NumericArray = Float64Array | Float32Array | Int32Array | Uint32Array | Int16Array | Uint16Array | Int8Array | Uint8Array;
export type ScaleKind = "linear" | "log";
export type Domain = [number, number];
export type LayerKind = "line" | "scatter" | "heatmap" | "surface" | "scatter3d";
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
}
export interface ViewSpec {
  kind: "2d" | "3d"; xScale: ScaleKind; yScale: ScaleKind; zScale: ScaleKind;
  xDomain?: Domain; yDomain?: Domain; zDomain?: Domain;
  xLabel: string; yLabel: string; zLabel: string;
  camera: {azimuth: number; elevation: number; distance: number};
  pan3d?: [number, number];
}
export interface ViewBookmark {name: string; note?: string; view: ViewSpec}
export interface FigureSpec {
  protocolVersion: number; id: string; title: string; width: number; height: number;
  view: ViewSpec; layers: LayerSpec[];
  bookmarks?: ViewBookmark[];
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
  kind: "points" | "density" | "line" | "grid" | "surface";
  total: number; visible: number; rendered: number; exact: boolean; method: string;
}
export interface PointsResult {kind: "points"; indices: Uint32Array; info: RepresentationInfo}
export interface DensityResult {kind: "density"; counts: Uint32Array; columns: number; rows: number; max: number; bounds: Bounds; info: RepresentationInfo}
export interface LineResult {kind: "line"; segments: Uint32Array[]; info: RepresentationInfo}
export type PointPlan = PointsResult | DensityResult;
export type Selection =
  | {kind: "points"; layerId: string; indices: number[]; count: number; truncated: boolean}
  | {kind: "density"; layerId: string; bounds: Bounds; count: number};
export interface BackendCapabilities {name: string; supports3d: boolean; rasterExport: boolean; vectorExport: boolean}
export interface FigureOptions {title?: string; width?: number; height?: number; kind?: "2d" | "3d"}
