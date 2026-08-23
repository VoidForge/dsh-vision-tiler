interface JimpLike {
    readonly width: number;
    readonly height: number;
    readonly bitmap: {
        data: Uint8Array;
        width: number;
        height: number;
    };
    clone(): unknown;
    greyscale(): unknown;
    resize(options: {
        w: number;
        h: number;
        mode?: unknown;
    }): unknown;
    crop(options: {
        x: number;
        y: number;
        w: number;
        h: number;
    }): unknown;
    flip(options: {
        horizontal: boolean;
        vertical: boolean;
    }): unknown;
    rotate(degrees: number): unknown;
    getBuffer(mime: string, options?: {
        compressionLevel?: number;
    }): Promise<Buffer>;
}
/**
 * A deliberately small boundary around Jimp. Jimp's plugin-composed generic
 * instance type is not stable across method return types, while this wrapper
 * exposes only the raster operations the tiler needs.
 */
export declare class RasterImage {
    private image;
    private constructor();
    static from(value: unknown): RasterImage;
    get width(): number;
    get height(): number;
    get bitmap(): JimpLike['bitmap'];
    clone(): RasterImage;
    greyscale(): this;
    resize(width: number, height: number): this;
    crop(options: {
        x: number;
        y: number;
        w: number;
        h: number;
    }): this;
    flip(horizontal: boolean, vertical: boolean): this;
    rotate(degrees: number): this;
    getBuffer(compressionLevel: number): Promise<Buffer>;
}
export declare function applyOrientation(image: RasterImage, orientation?: number): RasterImage;
export declare function readImage(input: Uint8Array): Promise<RasterImage>;
export declare function resizeToFit(image: RasterImage, maxWidth: number, maxHeight: number): RasterImage;
export declare function encodePng(image: RasterImage, compressionLevel: number): Promise<Buffer>;
export {};
//# sourceMappingURL=image-codec.d.ts.map