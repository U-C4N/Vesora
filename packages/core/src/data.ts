import type {DataDescriptor, DataEntry, DataStore, NumericArray} from './types';

const constructors = {
  float64: Float64Array, float32: Float32Array, int32: Int32Array, uint32: Uint32Array,
  int16: Int16Array, uint16: Uint16Array, int8: Int8Array, uint8: Uint8Array,
} as const;
const names = new Map<Function, DataDescriptor['dtype']>(Object.entries(constructors).map(([name, ctor]) => [ctor, name as DataDescriptor['dtype']]));
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Preserve typed source storage. Ordinary arrays are represented as float64. */
export function toNumericArray(input: ArrayLike<number>): NumericArray {
  if (ArrayBuffer.isView(input)) {
    if (!names.has(input.constructor)) throw new TypeError('Expected a supported numeric typed array (8/16/32-bit integers or float32/64).');
    return input as NumericArray;
  }
  if (!Number.isSafeInteger(input.length) || input.length < 0) throw new TypeError('Expected a numeric array.');
  for (let i = 0; i < input.length; i++) if (typeof input[i] !== 'number') throw new TypeError(`Non-numeric value at index ${i}.`);
  return Float64Array.from(input);
}

export function validateDescriptor(descriptor: DataDescriptor): void {
  if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id) throw new TypeError('Data id must be a nonempty string.');
  if (!Object.hasOwn(constructors, descriptor.dtype)) throw new TypeError(`Unsupported dtype: ${descriptor.dtype}`);
  if (!Number.isSafeInteger(descriptor.version) || descriptor.version < 0) throw new RangeError('Data version must be a nonnegative safe integer.');
  if (!Array.isArray(descriptor.shape) || descriptor.shape.length === 0) throw new TypeError('Data shape must have at least one dimension.');
  let count = 1;
  for (const size of descriptor.shape) {
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('Shape dimensions must be nonnegative safe integers.');
    count *= size;
    if (!Number.isSafeInteger(count)) throw new RangeError('Shape is too large.');
  }
  const expected = count * constructors[descriptor.dtype].BYTES_PER_ELEMENT;
  if (!Number.isSafeInteger(expected) || descriptor.byteLength !== expected) throw new RangeError('Byte length does not match shape and dtype.');
}

export function describeData(id: string, values: NumericArray, shape: number[] = [values.length], version = 0): DataDescriptor {
  const dtype = names.get(values.constructor);
  if (!dtype) throw new TypeError('Unsupported numeric typed array.');
  const descriptor = {id, dtype, shape: [...shape], version, byteLength: values.byteLength};
  validateDescriptor(descriptor);
  return descriptor;
}

/** Wire buffers are always little-endian, independently of the host. */
export function decodeData(descriptor: DataDescriptor, buffer: ArrayBuffer): NumericArray {
  validateDescriptor(descriptor);
  if (buffer.byteLength !== descriptor.byteLength) throw new RangeError('Received data buffer has the wrong byte length.');
  const Constructor = constructors[descriptor.dtype];
  if (littleEndian || Constructor.BYTES_PER_ELEMENT === 1) return new Constructor(buffer);
  const copy = buffer.slice(0), bytes = new Uint8Array(copy), size = Constructor.BYTES_PER_ELEMENT;
  for (let offset = 0; offset < bytes.length; offset += size) {
    for (let i = 0; i < size / 2; i++) {
      const a = offset + i, b = offset + size - 1 - i;
      [bytes[a], bytes[b]] = [bytes[b], bytes[a]];
    }
  }
  return new Constructor(copy);
}

export class DataRegistry {
  readonly store: DataStore = new Map();
  get size(): number {return this.store.size;}
  get(id: string): DataEntry {
    const entry = this.store.get(id);
    if (!entry) throw new Error(`Unknown data source: ${id}`);
    return entry;
  }
  has(id: string): boolean {return this.store.has(id);}
  set(id: string, values: NumericArray, shape: number[] = [values.length], version?: number): DataEntry {
    const previous = this.store.get(id);
    const descriptor = describeData(id, values, shape, version ?? (previous ? previous.descriptor.version + 1 : 0));
    if (previous && descriptor.version <= previous.descriptor.version) throw new RangeError('A data update must increase its version.');
    const entry = {descriptor, values};
    this.store.set(id, entry);
    return entry;
  }
  register(descriptor: DataDescriptor, buffer: ArrayBuffer): DataEntry {
    const values = decodeData(descriptor, buffer);
    return this.set(descriptor.id, values, descriptor.shape, descriptor.version);
  }
  entries(): IterableIterator<[string, DataEntry]> {return this.store.entries();}
  release(id: string): void {this.store.delete(id);}
  clear(): void {this.store.clear();}
}
