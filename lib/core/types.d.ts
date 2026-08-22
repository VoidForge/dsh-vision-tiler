export type TilingMode = 'auto' | 'document' | 'diagram' | 'photo';
export type TilingStrategy = 'uniform' | 'adaptive';
export interface TileRect {
    id: string;
    row: number;
    column: number;
    left: number;
    top: number;
    width: number;
    height: number;
    role?: 'coverage' | 'detail';
    densityScore?: number;
}
export interface CoverageAudit {
    totalPixels: number;
    coveredPixels: number;
    uncoveredPixels: number;
    duplicatedPixels: number;
    coverageRatio: number;
    duplicatedRatio: number;
    maxCoverageDepth: number;
}
export interface TilePlan {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    overlapX: number;
    overlapY: number;
    rows: number;
    columns: number;
    tiles: TileRect[];
    audit: CoverageAudit;
}
export interface TilePlannerOptions {
    targetTilePixels?: number;
    overlapRatio?: number;
    minOverlapPixels?: number;
    maxTotalTiles?: number;
}
export interface ImageTilerOptions extends TilePlannerOptions {
    mode?: TilingMode;
    strategy?: TilingStrategy;
    detailCropCount?: number;
    detailCropSide?: number;
    batchIndex?: number;
    maxImagesPerBatch?: number;
    includeOverview?: boolean;
    overviewMaxEdge?: number;
    pngCompressionLevel?: number;
    signal?: AbortSignal;
}
export interface PreparedImage {
    kind: 'overview' | 'tile' | 'detail';
    name: string;
    mediaType: 'image/png';
    data: Uint8Array;
    tile?: TileRect;
}
export interface PreparedImageBatch {
    imageSetId: string;
    sourceBytes: number;
    originalWidth: number;
    originalHeight: number;
    plan: TilePlan;
    strategy: TilingStrategy;
    detailTiles: TileRect[];
    batchIndex: number;
    batchCount: number;
    remainingBatchIndices: number[];
    tileIds: string[];
    estimatedVisionTokenCap: number;
    images: PreparedImage[];
}
//# sourceMappingURL=types.d.ts.map