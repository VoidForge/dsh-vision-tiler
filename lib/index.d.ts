import type { Context } from '@deepseek-ai/cordis';
import type { TilingStrategy } from './core/types.js';
export interface Config {
    targetTilePixels?: number;
    overlapRatio?: number;
    minOverlapPixels?: number;
    maxTotalTiles?: number;
    maxImagesPerBatch?: number;
    includeOverview?: boolean;
    overviewMaxEdge?: number;
    defaultStrategy?: TilingStrategy;
    detailCropCount?: number;
    detailCropSide?: number;
}
export declare const name = "dsh-vision-tiler";
export declare const inject: string[];
export default function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map