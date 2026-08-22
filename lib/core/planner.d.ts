import type { CoverageAudit, TilePlan, TilePlannerOptions, TileRect } from './types.js';
export declare function auditCoverage(width: number, height: number, rectangles: readonly Pick<TileRect, 'left' | 'top' | 'width' | 'height'>[]): CoverageAudit;
export declare function planTiles(width: number, height: number, options?: TilePlannerOptions): TilePlan;
//# sourceMappingURL=planner.d.ts.map