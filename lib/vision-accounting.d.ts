/** Published provider cap on vision tokens for one image. */
export declare const MAX_IMAGE_VISION_TOKENS = 1024;
/** Provider per-side request limit, applied by DSH to every request image. */
export declare const MAX_REQUEST_IMAGE_SIDE = 4096;
/** The part of @deepseek-ai/dsh-llm-deepseek this plugin calls. */
export interface VisionAccountingApi {
    deepSeekImageTokens: unknown;
    deepSeekRequestImageDimensions: unknown;
    REQUEST_IMAGE_MAX_DIMENSION: unknown;
}
/**
 * Throw when the installed package no longer provides what this plugin calls. Pure and
 * injectable so a test can feed a stub instead of the real package.
 */
export declare function verifyVisionAccounting(api: VisionAccountingApi, version: string): void;
/** Check the installed package once, at plugin load. */
export declare function assertVisionAccounting(): void;
/** Vision tokens DeepSeek charges for one image as DSH sends it. */
export declare function providerVisionTokens(width: number, height: number): number;
/**
 * Throw before attachments are saved when DSH would project or downscale an image that carries
 * source detail, because the model would then see it at a lower resolution than the tool reports.
 * The provider upscaling an image below its 544x544 floor is allowed.
 */
export declare function assertImageSentUnchanged(kind: 'tile' | 'detail', width: number, height: number): void;
//# sourceMappingURL=vision-accounting.d.ts.map