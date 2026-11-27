/**
 * DeepSeek vision accounting taken from the host package.
 *
 * The plugin trusts the host's arithmetic. It checks only what crosses its boundary: that the
 * installed package still exports the functions and limit it calls, that user configuration
 * stays inside the provider's request limits, and that the images it hands to DSH will not be
 * resized.
 */
import { createRequire } from 'node:module';
import { longEdgeDimensions } from '@deepseek-ai/dsh-attachment';
import * as providerVision from '@deepseek-ai/dsh-llm-deepseek';
/** Published provider cap on vision tokens for one image. */
export const MAX_IMAGE_VISION_TOKENS = 1024;
/** Provider per-side request limit, applied by DSH to every request image. */
export const MAX_REQUEST_IMAGE_SIDE = providerVision.REQUEST_IMAGE_MAX_DIMENSION;
const SETTING_BY_KIND = {
    tile: 'targetTilePixels',
    detail: 'detailCropSide',
};
const packageRequire = createRequire(import.meta.url);
function installedVersion() {
    try {
        return packageRequire('@deepseek-ai/dsh-llm-deepseek/package.json').version ?? 'unknown';
    }
    catch {
        return 'unknown';
    }
}
/**
 * Throw when the installed package no longer provides what this plugin calls. Pure and
 * injectable so a test can feed a stub instead of the real package.
 */
export function verifyVisionAccounting(api, version) {
    const fail = (detail) => {
        throw new Error(`dsh-vision-tiler: ${detail}. Installed @deepseek-ai/dsh-llm-deepseek ${version} no longer `
            + 'provides the DeepSeek vision accounting this plugin calls. Update the plugin or install '
            + 'a supported DSH.');
    };
    if (typeof api.deepSeekImageTokens !== 'function')
        fail('deepSeekImageTokens is not exported as a function');
    if (typeof api.deepSeekRequestImageDimensions !== 'function') {
        fail('deepSeekRequestImageDimensions is not exported as a function');
    }
    const limit = api.REQUEST_IMAGE_MAX_DIMENSION;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
        fail(`REQUEST_IMAGE_MAX_DIMENSION is ${String(limit)}, expected a positive number`);
    }
}
/** Check the installed package once, at plugin load. */
export function assertVisionAccounting() {
    verifyVisionAccounting(providerVision, installedVersion());
}
/** Dimensions of one request image after the projection and per-side cap DSH applies. */
function requestTarget(width, height) {
    const projected = providerVision.deepSeekRequestImageDimensions(width, height);
    if (Math.max(projected.width, projected.height) <= MAX_REQUEST_IMAGE_SIDE)
        return projected;
    return longEdgeDimensions(width, height, MAX_REQUEST_IMAGE_SIDE);
}
/** Vision tokens DeepSeek charges for one image as DSH sends it. */
export function providerVisionTokens(width, height) {
    const sent = requestTarget(width, height);
    return providerVision.deepSeekImageTokens(sent.width, sent.height);
}
/**
 * Throw before attachments are saved when DSH would project or downscale an image that carries
 * source detail, because the model would then see it at a lower resolution than the tool reports.
 * The provider upscaling an image below its 544x544 floor is allowed.
 */
export function assertImageSentUnchanged(kind, width, height) {
    const sent = requestTarget(width, height);
    if (sent.width !== width || sent.height !== height) {
        const setting = SETTING_BY_KIND[kind];
        throw new RangeError(`${kind} ${width}x${height} would be projected to ${sent.width}x${sent.height} before the model `
            + `sees it; lower ${setting} so every image stays within the DeepSeek vision budget`);
    }
}
//# sourceMappingURL=vision-accounting.js.map