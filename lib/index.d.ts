import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { TilingStrategy } from './core/types.js';
/** A configuration value whose current value can change without remounting the plugin. */
interface Live<T> {
    get(): T;
}
export interface Config {
    targetTilePixels: Live<number>;
    overlapRatio: Live<number | undefined>;
    minOverlapPixels: Live<number>;
    maxTotalTiles: Live<number>;
    maxImagesPerBatch: Live<number>;
    includeOverview: Live<boolean>;
    overviewMaxEdge: Live<number>;
    defaultStrategy: Live<TilingStrategy>;
    detailCropCount: Live<number | undefined>;
    detailCropSide: Live<number>;
    models: Live<readonly string[]>;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    targetTilePixels: z<number, number, "volatile-defined">;
    overlapRatio: z<number, number, "volatile">;
    minOverlapPixels: z<number, number, "volatile-defined">;
    maxTotalTiles: z<number, number, "volatile-defined">;
    maxImagesPerBatch: z<number, number, "volatile-defined">;
    includeOverview: z<boolean, boolean, "volatile-defined">;
    overviewMaxEdge: z<number, number, "volatile-defined">;
    defaultStrategy: z<"uniform" | "adaptive", "uniform" | "adaptive", "volatile-defined">;
    detailCropCount: z<number, number, "volatile">;
    detailCropSide: z<number, number, "volatile-defined">;
    models: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    targetTilePixels: z<number, number, "volatile-defined">;
    overlapRatio: z<number, number, "volatile">;
    minOverlapPixels: z<number, number, "volatile-defined">;
    maxTotalTiles: z<number, number, "volatile-defined">;
    maxImagesPerBatch: z<number, number, "volatile-defined">;
    includeOverview: z<boolean, boolean, "volatile-defined">;
    overviewMaxEdge: z<number, number, "volatile-defined">;
    defaultStrategy: z<"uniform" | "adaptive", "uniform" | "adaptive", "volatile-defined">;
    detailCropCount: z<number, number, "volatile">;
    detailCropSide: z<number, number, "volatile-defined">;
    models: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, "plain">;
export declare const name = "dsh-vision-tiler";
export declare const inject: string[];
export declare function apply(ctx: Context, config: Config): void;
export {};
//# sourceMappingURL=index.d.ts.map