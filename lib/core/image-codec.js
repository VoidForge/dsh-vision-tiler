import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import decodeWebp, { init as initWebpDecode } from '@jsquash/webp/decode.js';
import exifr from 'exifr';
import { Jimp, JimpMime, ResizeStrategy } from 'jimp';
const require = createRequire(import.meta.url);
let webpDecoderReady;
function asJimpLike(value) {
    return value;
}
/**
 * A deliberately small boundary around Jimp. Jimp's plugin-composed generic
 * instance type is not stable across method return types, while this wrapper
 * exposes only the raster operations the tiler needs.
 */
export class RasterImage {
    image;
    constructor(image) {
        this.image = image;
    }
    static from(value) {
        return new RasterImage(asJimpLike(value));
    }
    get width() {
        return this.image.width;
    }
    get height() {
        return this.image.height;
    }
    get bitmap() {
        return this.image.bitmap;
    }
    clone() {
        return RasterImage.from(this.image.clone());
    }
    greyscale() {
        this.image = asJimpLike(this.image.greyscale());
        return this;
    }
    resize(width, height) {
        this.image = asJimpLike(this.image.resize({ w: width, h: height, mode: ResizeStrategy.BICUBIC }));
        return this;
    }
    crop(options) {
        this.image = asJimpLike(this.image.crop(options));
        return this;
    }
    flip(horizontal, vertical) {
        this.image = asJimpLike(this.image.flip({ horizontal, vertical }));
        return this;
    }
    rotate(degrees) {
        this.image = asJimpLike(this.image.rotate(degrees));
        return this;
    }
    getBuffer(compressionLevel) {
        return this.image.getBuffer(JimpMime.png, { compressionLevel });
    }
}
function isWebp(input) {
    return input.byteLength >= 12
        && String.fromCharCode(...input.subarray(0, 4)) === 'RIFF'
        && String.fromCharCode(...input.subarray(8, 12)) === 'WEBP';
}
async function ensureWebpDecoder() {
    webpDecoderReady ??= (async () => {
        const wasmPath = require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm');
        const wasmModule = await WebAssembly.compile(await readFile(wasmPath));
        const initialise = initWebpDecode;
        await initialise(wasmModule);
    })();
    await webpDecoderReady;
}
async function readWebp(input) {
    await ensureWebpDecoder();
    const arrayBuffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    const decoded = await decodeWebp(arrayBuffer);
    return RasterImage.from(Jimp.fromBitmap({
        width: decoded.width,
        height: decoded.height,
        data: Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
    }));
}
export function applyOrientation(image, orientation) {
    if (orientation === undefined || orientation === 1)
        return image;
    const transform = exifr.rotations[orientation];
    if (transform === undefined)
        return image;
    if (transform.scaleX < 0)
        image.flip(true, false);
    if (transform.scaleY < 0)
        image.flip(false, true);
    if (transform.deg !== 0)
        image.rotate(transform.deg);
    return image;
}
export async function readImage(input) {
    const buffer = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const image = isWebp(input) ? await readWebp(input) : RasterImage.from(await Jimp.read(buffer));
    const orientation = await exifr.orientation(buffer).catch(() => undefined);
    applyOrientation(image, orientation);
    if (image.width * image.height > 100_000_000) {
        throw new RangeError('image exceeds the 100,000,000 pixel safety limit');
    }
    return image;
}
export function resizeToFit(image, maxWidth, maxHeight) {
    const resized = image.clone();
    const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
    if (scale < 1) {
        resized.resize(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    }
    return resized;
}
export async function encodePng(image, compressionLevel) {
    return image.getBuffer(compressionLevel);
}
//# sourceMappingURL=image-codec.js.map