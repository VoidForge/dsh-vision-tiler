import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';
import exifr from 'exifr';
import { Jimp, JimpMime, ResizeStrategy } from 'jimp';

const require = createRequire(import.meta.url);
let webpDecoderReady: Promise<void> | undefined;

interface JimpLike {
  readonly width: number;
  readonly height: number;
  readonly bitmap: { data: Uint8Array; width: number; height: number };
  clone(): unknown;
  greyscale(): unknown;
  resize(options: { w: number; h: number; mode?: unknown }): unknown;
  crop(options: { x: number; y: number; w: number; h: number }): unknown;
  flip(options: { horizontal: boolean; vertical: boolean }): unknown;
  rotate(degrees: number): unknown;
  getBuffer(mime: string, options?: { compressionLevel?: number }): Promise<Buffer>;
}

function asJimpLike(value: unknown): JimpLike {
  return value as JimpLike;
}

/**
 * A deliberately small boundary around Jimp. Jimp's plugin-composed generic
 * instance type is not stable across method return types, while this wrapper
 * exposes only the raster operations the tiler needs.
 */
export class RasterImage {
  private constructor(private image: JimpLike) {}

  static from(value: unknown): RasterImage {
    return new RasterImage(asJimpLike(value));
  }

  get width(): number {
    return this.image.width;
  }

  get height(): number {
    return this.image.height;
  }

  get bitmap(): JimpLike['bitmap'] {
    return this.image.bitmap;
  }

  clone(): RasterImage {
    return RasterImage.from(this.image.clone());
  }

  greyscale(): this {
    this.image = asJimpLike(this.image.greyscale());
    return this;
  }

  resize(width: number, height: number): this {
    this.image = asJimpLike(this.image.resize({ w: width, h: height, mode: ResizeStrategy.BICUBIC }));
    return this;
  }

  crop(options: { x: number; y: number; w: number; h: number }): this {
    this.image = asJimpLike(this.image.crop(options));
    return this;
  }

  flip(horizontal: boolean, vertical: boolean): this {
    this.image = asJimpLike(this.image.flip({ horizontal, vertical }));
    return this;
  }

  rotate(degrees: number): this {
    this.image = asJimpLike(this.image.rotate(degrees));
    return this;
  }

  getBuffer(compressionLevel: number): Promise<Buffer> {
    return this.image.getBuffer(JimpMime.png, { compressionLevel });
  }
}

function isWebp(input: Uint8Array): boolean {
  return input.byteLength >= 12
    && String.fromCharCode(...input.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...input.subarray(8, 12)) === 'WEBP';
}

async function ensureWebpDecoder(): Promise<void> {
  webpDecoderReady ??= (async () => {
    const wasmPath = require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm');
    const wasmModule = await WebAssembly.compile(await readFile(wasmPath));
    const initialise = initWebpDecode as unknown as (module: WebAssembly.Module) => Promise<void>;
    await initialise(wasmModule);
  })();
  await webpDecoderReady;
}

async function readWebp(input: Uint8Array): Promise<RasterImage> {
  await ensureWebpDecoder();
  const arrayBuffer = input.buffer.slice(
    input.byteOffset,
    input.byteOffset + input.byteLength,
  ) as ArrayBuffer;
  const decoded = await decodeWebp(arrayBuffer);
  return RasterImage.from(Jimp.fromBitmap({
    width: decoded.width,
    height: decoded.height,
    data: Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
  }));
}

export function applyOrientation(image: RasterImage, orientation?: number): RasterImage {
  if (orientation === undefined || orientation === 1) return image;
  const transform = exifr.rotations[orientation];
  if (transform === undefined) return image;
  if (transform.scaleX < 0) image.flip(true, false);
  if (transform.scaleY < 0) image.flip(false, true);
  if (transform.deg !== 0) image.rotate(transform.deg);
  return image;
}

export async function readImage(input: Uint8Array): Promise<RasterImage> {
  const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const image = isWebp(input) ? await readWebp(input) : RasterImage.from(await Jimp.read(buffer));
  const orientation = await exifr.orientation(buffer).catch(() => undefined);
  applyOrientation(image, orientation);
  if (image.width * image.height > 100_000_000) {
    throw new RangeError('image exceeds the 100,000,000 pixel safety limit');
  }
  return image;
}

export function resizeToFit(image: RasterImage, maxWidth: number, maxHeight: number): RasterImage {
  const resized = image.clone();
  const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
  if (scale < 1) {
    resized.resize(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
  }
  return resized;
}

export async function encodePng(image: RasterImage, compressionLevel: number): Promise<Buffer> {
  return image.getBuffer(compressionLevel);
}
