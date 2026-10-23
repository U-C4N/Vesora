import {numericReader} from './data';
import type {DataEntry} from './types';
import type {DensityResult, LineResult, NumericArray, PointPlan, Query} from './types';
import {createNormalizer, validateDomain} from './scales';
import type {LineIndexCache} from './line-index';
import type {ScatterIndexCache} from './scatter-index';

const CHUNK_SIZE = 65_536;

export function validateQuery(query: Query): void {
  validateDomain(query.bounds.x, query.xScale);
  validateDomain(query.bounds.y, query.yScale);
  if (!Number.isFinite(query.width) || !Number.isFinite(query.height) || query.width <= 0 || query.height <= 0) throw new RangeError('Viewport dimensions must be positive.');
  if (!Number.isSafeInteger(query.pointBudget) || query.pointBudget < 1) throw new RangeError('pointBudget must be a positive integer.');
  if (!['auto', 'points', 'density'].includes(query.mode)) throw new RangeError('Unknown representation mode.');
}

interface Coordinates {length:number;chunks:readonly NumericArray[]}
function coordinates(input:NumericArray|DataEntry):Coordinates {
  if(ArrayBuffer.isView(input)){const values=input as NumericArray;return {length:values.length,chunks:[values]};}
  const entry=input as DataEntry;
  if(entry.chunks)return {length:entry.descriptor.shape[0],chunks:entry.chunks};
  const values=entry.values;return {length:values.length,chunks:[values]};
}

/** Storage boundaries never become cooperative yields or line-segment boundaries. */
class AlignedCoordinates {
  private xIndex=0;private yIndex=0;private xStart=0;private yStart=0;
  constructor(private x:Coordinates,private y:Coordinates){}
  span(start:number,end:number):{x:NumericArray;y:NumericArray;xOffset:number;yOffset:number;length:number}{
    while(this.xIndex<this.x.chunks.length&&this.xStart+this.x.chunks[this.xIndex].length<=start)this.xStart+=this.x.chunks[this.xIndex++].length;
    while(this.yIndex<this.y.chunks.length&&this.yStart+this.y.chunks[this.yIndex].length<=start)this.yStart+=this.y.chunks[this.yIndex++].length;
    const x=this.x.chunks[this.xIndex],y=this.y.chunks[this.yIndex];
    const xOffset=start-this.xStart,yOffset=start-this.yStart;
    const length=Math.min(end-start,(x?.length??0)-xOffset,(y?.length??0)-yOffset);
    if(length<=0)throw new RangeError('Coordinate chunks do not cover their declared shape.');
    return {x,y,xOffset,yOffset,length};
  }
}

function validateInputs(x: Coordinates, y: Coordinates, query: Query): void {
  if (x.length !== y.length) throw new RangeError('Coordinate arrays must have equal lengths.');
  if (x.length > 0xffff_ffff) throw new RangeError('A chunk may contain at most 2^32 - 1 coordinates.');
  validateQuery(query);
}

function visible(px: number, py: number): boolean {return px >= 0 && px <= 1 && py >= 0 && py <= 1;}

/** Cooperative steps are used by workers and the asynchronous fallback. */
export function* scatterSteps(xInput: NumericArray|DataEntry, yInput: NumericArray|DataEntry, query: Query, index?:ScatterIndexCache, workerOwned=false): Generator<void, PointPlan> {
  const x=coordinates(xInput),y=coordinates(yInput);
  validateInputs(x, y, query);
  if(index&&!ArrayBuffer.isView(xInput)&&!ArrayBuffer.isView(yInput)){
    const indexed=yield* index.plan(xInput as DataEntry,yInput as DataEntry,query,workerOwned);if(indexed)return indexed;
  }
  const normalizeX=createNormalizer(query.bounds.x,query.xScale),normalizeY=createNormalizer(query.bounds.y,query.yScale);
  const columns = Math.max(1, Math.min(1024, Math.ceil(query.width / 4)));
  const rows = Math.max(1, Math.min(1024, Math.ceil(query.height / 4)));
  const counts = new Uint32Array(columns * rows);
  let count = 0, max = 0;
  const aggregation=new AlignedCoordinates(x,y);
  for (let start = 0; start < x.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, x.length);
    for(let offset=start;offset<end;){
      const span=aggregation.span(offset,end),xs=span.x,ys=span.y,xOffset=span.xOffset,yOffset=span.yOffset;
      for(let j=0;j<span.length;j++){
        const px = normalizeX(xs[xOffset+j]), py = normalizeY(ys[yOffset+j]);
        if (!visible(px, py)) continue;
        count++;
        const column = Math.min(columns - 1, Math.floor(px * columns)), row = Math.min(rows - 1, Math.floor(py * rows));
        const cellCount = ++counts[row * columns + column];
        if (cellCount > max) max = cellCount;
      }
      offset+=span.length;
    }
    yield;
  }
  const threshold = Math.max(1, Math.min(query.pointBudget, query.width * query.height / 8));
  const density = query.mode === 'density' || (query.mode === 'auto' && (count > query.pointBudget || count > threshold * (query.previous === 'density' ? 0.6 : 1)));
  if (density) {
    let occupied = 0;
    for (let i = 0; i < counts.length; i++) if (counts[i]) occupied++;
    const result: DensityResult = {
      kind: 'density', counts, columns, rows, max, bounds: {x: [...query.bounds.x], y: [...query.bounds.y]},
      info: {kind: 'density', total: x.length, visible: count, rendered: occupied, exact: true, method: 'count aggregation (screen-space cells; all visible samples counted)'},
    };
    return result;
  }
  if (count > query.pointBudget) throw new RangeError(`Exact point rendering requires ${count} points, exceeding the point budget of ${query.pointBudget}. Use auto/density or raise the budget.`);
  const indices = new Uint32Array(count);
  let cursor = 0;
  const extraction=new AlignedCoordinates(x,y);
  for (let start = 0; start < x.length; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, x.length);
    for(let offset=start;offset<end;){
      const span=extraction.span(offset,end),xs=span.x,ys=span.y,xOffset=span.xOffset,yOffset=span.yOffset;
      for(let j=0;j<span.length;j++){
        if (visible(normalizeX(xs[xOffset+j]), normalizeY(ys[yOffset+j]))) indices[cursor++] = offset+j;
      }
      offset+=span.length;
    }
    yield;
  }
  return {kind: 'points', indices, info: {kind: 'points', total: x.length, visible: count, rendered: count, exact: true, method: 'original points'}};
}

// Liang–Barsky clipping in transformed space includes edges with both ends offscreen.
function intersects(ax: number, ay: number, bx: number, by: number): boolean {
  if (visible(ax, ay) || visible(bx, by)) return true;
  if ((ax < 0 && bx < 0) || (ax > 1 && bx > 1) || (ay < 0 && by < 0) || (ay > 1 && by > 1)) return false;
  let low = 0, high = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy], q = [ax, 1 - ax, ay, 1 - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {if (q[i] < 0) return false; continue;}
    const ratio = q[i] / p[i];
    if (p[i] < 0) low = Math.max(low, ratio); else high = Math.min(high, ratio);
    if (low > high) return false;
  }
  return true;
}

/** Reduce consecutive pixel-column runs, retaining extrema in source order. */
export function* lineSteps(xInput: NumericArray|DataEntry, yInput: NumericArray|DataEntry, query: Query, sorted = false, index?:LineIndexCache): Generator<void, LineResult> {
  const x=coordinates(xInput),y=coordinates(yInput);
  validateInputs(x, y, query);
  if(index&&!ArrayBuffer.isView(xInput)&&!ArrayBuffer.isView(yInput)){
    const indexed=yield* index.plan(xInput as DataEntry,yInput as DataEntry,query,sorted);
    if(indexed)return indexed;
  }
  const normalizeX=createNormalizer(query.bounds.x,query.xScale),normalizeY=createNormalizer(query.bounds.y,query.yScale);
  const segments: Uint32Array[] = [];
  let segment: number[] = [];
  let first = -1, last = -1, min = -1, max = -1, minY = Infinity, maxY = -Infinity, column = NaN;
  let rendered = 0, candidates = 0, count = 0, lastAdded = -1;
  function flushBucket(): void {
    if (first < 0) return;
    const retained = [...new Set([first, min, max, last])].sort((a, b) => a - b);
    for (const index of retained) {
      if (segment[segment.length - 1] === index) continue;
      if (rendered + segment.length >= query.pointBudget) throw new RangeError('Line topology exceeds the vertex budget after extrema-preserving reduction. Increase pointBudget or query a smaller viewport.');
      segment.push(index);
    }
    first = last = min = max = -1; minY = Infinity; maxY = -Infinity;
  }
  function finishSegment(): void {
    flushBucket();
    if (segment.length) {segments.push(Uint32Array.from(segment)); rendered += segment.length;}
    segment = []; column = NaN; lastAdded = -1;
  }
  function add(index: number, px: number, py: number): void {
    if (lastAdded === index) return;
    lastAdded = index; candidates++;
    const nextColumn = Math.floor(Math.max(-1, Math.min(query.width, px * query.width)));
    if (nextColumn !== column) {flushBucket(); column = nextColumn;}
    if (first < 0) first = index;
    last = index;
    if (py < minY) {min = index; minY = py;}
    if (py > maxY) {max = index; maxY = py;}
  }
  let previous = -1, previousX = NaN, previousY = NaN;
  let begin=0,limit=x.length;
  if(sorted){
    // Random access is limited to the logarithmic viewport-bound search.
    const reader=numericReader(xInput);
    const bound=(value:number,upper:boolean)=>{let lo=0,hi=x.length;while(lo<hi){const mid=lo+Math.floor((hi-lo)/2),coordinate=reader.get(mid);if(coordinate<value||upper&&coordinate===value)lo=mid+1;else hi=mid;}return lo;};
    begin=Math.max(0,bound(query.bounds.x[0],false)-1);limit=Math.min(x.length,bound(query.bounds.x[1],true)+1);
  }
  const traversal=new AlignedCoordinates(x,y);
  for (let start = begin; start < limit; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, limit);
    for(let offset=start;offset<end;){
      const span=traversal.span(offset,end),xs=span.x,ys=span.y,xOffset=span.xOffset,yOffset=span.yOffset;
      for(let j=0;j<span.length;j++){
        const i=offset+j,px = normalizeX(xs[xOffset+j]), py = normalizeY(ys[yOffset+j]);
        if (!Number.isFinite(px) || !Number.isFinite(py)) {finishSegment(); previous = -1; continue;}
        const isVisible = visible(px, py);
        if (isVisible) count++;
        if (previous >= 0 && intersects(previousX, previousY, px, py)) {
          add(previous, previousX, previousY); add(i, px, py);
        } else {
          finishSegment();
          if (isVisible) add(i, px, py);
        }
        previous = i; previousX = px; previousY = py;
      }
      offset+=span.length;
    }
    yield;
  }
  finishSegment();
  return {kind: 'line', segments, info: {kind: 'line', total: x.length, visible: count, rendered, exact: rendered === candidates, method: 'ordered first/min/max/last per consecutive pixel column; gaps and crossing segments preserved'}};
}

function finish<T>(steps: Generator<void, T>): T {
  while (true) {const step = steps.next(); if (step.done) return step.value;}
}
export function planScatter(x: NumericArray, y: NumericArray, query: Query): PointPlan {return finish(scatterSteps(x, y, query));}
export function planLine(x: NumericArray, y: NumericArray, query: Query): LineResult {return finish(lineSteps(x, y, query));}

export async function runSteps<T>(steps: Generator<void, T>, cancelled: () => boolean = () => false): Promise<T> {
  while (true) {
    if (cancelled()) throw new DOMException('Query cancelled.', 'AbortError');
    const step = steps.next();
    if (step.done) return step.value;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}
