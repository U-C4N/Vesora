import {chunkEntry, retainChunks, streamValues} from './data';
import type {DataEntry, NumericArray, StreamState, StreamingOptions} from './types';

const BLOCK = 4096;
export function validateStreamingOptions(options: StreamingOptions): void {
  if (!options || !Number.isSafeInteger(options.maxPoints) || options.maxPoints < 1 || options.maxPoints > 0xffff_ffff)
    throw new RangeError('maxPoints must be a positive integer no greater than 2^32 - 1');
}
export function streamError(code: string, message: string): Error & {code: string} {
  return Object.assign(new Error(message), {code});
}
export function ownChunks(values: NumericArray, maxPoints: number): NumericArray[] {
  const chunks: NumericArray[] = [];
  for (let i = Math.max(0, values.length - maxPoints); i < values.length; i += BLOCK) chunks.push(values.slice(i, Math.min(values.length, i + BLOCK)) as NumericArray);
  return chunks;
}
export function streamEntry(entry: DataEntry, maxPoints: number, version = entry.descriptor.version): DataEntry {
  const length = Math.min(entry.descriptor.shape[0], maxPoints);
  const descriptor = {...entry.descriptor, version, shape: [length], byteLength: length * entry.values.BYTES_PER_ELEMENT};
  return chunkEntry(descriptor, ownChunks(entry.values, maxPoints));
}
export function appendEntry(entry: DataEntry, input: ArrayLike<number>, maxPoints: number): {entry: DataEntry; added: NumericArray} {
  const added = streamValues(input, entry.descriptor.dtype);
  const chunks = [...(entry.chunks ?? ownChunks(entry.values, maxPoints))];
  const incoming = ownChunks(added, maxPoints);
  // Preserve append deltas instead of repeatedly retransmitting an expanding
  // tail. Compact small batches only when chunk metadata would become excessive.
  const last = chunks[chunks.length - 1], first = incoming[0];
  if (chunks.length > 1024 && last && first && last.length + first.length <= BLOCK) {
    const joined = new (last.constructor as {new(length: number): NumericArray})(last.length + first.length);
    joined.set(last); joined.set(first, last.length); chunks[chunks.length - 1] = joined; incoming.shift();
  }
  const retained = retainChunks([...chunks, ...incoming], maxPoints);
  const length = Math.min(maxPoints, entry.descriptor.shape[0] + added.length);
  return {entry: chunkEntry({...entry.descriptor, version: entry.descriptor.version + 1, shape: [length], byteLength: length * added.BYTES_PER_ELEMENT}, retained), added};
}
export function lastValue(entry: DataEntry): number | undefined {
  const chunks = entry.chunks;
  if (chunks) {const last = chunks[chunks.length - 1]; return last?.[last.length - 1];}
  return entry.values[entry.values.length - 1];
}
export function validateStreamState(state: StreamState, length: number): void {
  validateStreamingOptions(state);
  if (typeof state.streamId !== 'string' || !state.streamId || ![state.nextSequence, state.revision, state.retained, state.evicted].every(value => Number.isSafeInteger(value) && value >= 0)
    || state.retained !== length || length > state.maxPoints || state.nextSequence - state.retained !== state.evicted)
    throw new RangeError('Invalid streaming metadata');
}
