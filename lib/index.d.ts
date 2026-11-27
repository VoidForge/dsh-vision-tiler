import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
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
    models?: string[];
}
export declare const Config: z<Config>;
export declare const name = "dsh-vision-tiler";
export declare const inject: string[];
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map