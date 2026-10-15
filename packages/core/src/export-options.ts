import type {ExportPNGOptions} from './types';

export const MAX_EXPORT_PIXELS = 32_000_000;

/** Keep export requests JSON-safe. Host-specific GPU limits are checked by the renderer. */
export function validateExportPNGOptions(input: ExportPNGOptions = {}): ExportPNGOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('PNG options must be an object');
  for (const key of Object.keys(input)) if (!['width', 'height', 'scale', 'source'].includes(key)) throw new TypeError(`Unknown PNG option ${key}`);
  if(input.source!==undefined&&!['accepted','displayed'].includes(input.source))throw new TypeError('PNG source must be accepted or displayed');
  if ((input.width === undefined) !== (input.height === undefined)) throw new RangeError('PNG width and height must be supplied together');
  for (const key of ['width', 'height'] as const) {
    const value = input[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (key === 'width' ? 200 : 180))) throw new RangeError('PNG dimensions must be safe integers of at least 200 × 180');
  }
  if (input.scale !== undefined && (!Number.isFinite(input.scale) || input.scale <= 0)) throw new RangeError('PNG scale must be positive and finite');
  if (input.width !== undefined && input.scale !== undefined) validateExportRaster(input.width, input.height!, input.scale);
  return {...input};
}

export function validateExportRaster(width: number, height: number, scale: number): {width: number; height: number} {
  const rasterWidth = Math.round(width * scale), rasterHeight = Math.round(height * scale);
  if (![rasterWidth, rasterHeight].every(value => Number.isSafeInteger(value) && value > 0) || rasterWidth * rasterHeight > MAX_EXPORT_PIXELS) throw new RangeError('PNG raster dimensions must be positive safe integers within the 32000000-pixel area limit');
  return {width: rasterWidth, height: rasterHeight};
}
