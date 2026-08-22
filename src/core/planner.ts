import type {
  CoverageAudit,
  TilePlan,
  TilePlannerOptions,
  TileRect,
} from './types.js';

const DEFAULT_TARGET_TILE_PIXELS = 768 * 768;
const DEFAULT_OVERLAP_RATIO = 0.15;
const DEFAULT_MIN_OVERLAP_PIXELS = 64;
const DEFAULT_MAX_TOTAL_TILES = 256;

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function axisStarts(length: number, tileSize: number, overlap: number): number[] {
  if (length <= tileSize) return [0];

  const step = tileSize - overlap;
  if (step <= 0) throw new RangeError('overlap must be smaller than tile size');

  const starts: number[] = [];
  for (let start = 0; start + tileSize < length; start += step) {
    starts.push(start);
  }

  const finalStart = length - tileSize;
  if (starts.at(-1) !== finalStart) starts.push(finalStart);
  return starts;
}

export function auditCoverage(
  width: number,
  height: number,
  rectangles: readonly Pick<TileRect, 'left' | 'top' | 'width' | 'height'>[],
): CoverageAudit {
  assertPositiveInteger('width', width);
  assertPositiveInteger('height', height);

  const xs = [...new Set([0, width, ...rectangles.flatMap((rect) => [rect.left, rect.left + rect.width])])]
    .sort((a, b) => a - b);
  const ys = [...new Set([0, height, ...rectangles.flatMap((rect) => [rect.top, rect.top + rect.height])])]
    .sort((a, b) => a - b);
  const xIndex = new Map(xs.map((value, index) => [value, index]));
  const yIndex = new Map(ys.map((value, index) => [value, index]));
  const stride = ys.length + 1;
  const diff = new Int32Array((xs.length + 1) * stride);

  for (const rect of rectangles) {
    if (
      rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0 ||
      rect.left + rect.width > width || rect.top + rect.height > height
    ) {
      throw new RangeError('tile rectangle falls outside image bounds');
    }
    const x0 = xIndex.get(rect.left);
    const x1 = xIndex.get(rect.left + rect.width);
    const y0 = yIndex.get(rect.top);
    const y1 = yIndex.get(rect.top + rect.height);
    if (x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined) {
      throw new Error('coverage grid construction failed');
    }
    diff[x0 * stride + y0] += 1;
    diff[x1 * stride + y0] -= 1;
    diff[x0 * stride + y1] -= 1;
    diff[x1 * stride + y1] += 1;
  }

  let coveredPixels = 0;
  let duplicatedPixels = 0;
  let maxCoverageDepth = 0;
  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let yi = 0; yi < ys.length - 1; yi += 1) {
      const index = xi * stride + yi;
      const above = yi > 0 ? diff[index - 1] : 0;
      const left = xi > 0 ? diff[index - stride] : 0;
      const diagonal = xi > 0 && yi > 0 ? diff[index - stride - 1] : 0;
      const depth = diff[index] += above + left - diagonal;
      const area = (xs[xi + 1] - xs[xi]) * (ys[yi + 1] - ys[yi]);
      if (depth > 0) coveredPixels += area;
      if (depth > 1) duplicatedPixels += area;
      maxCoverageDepth = Math.max(maxCoverageDepth, depth);
    }
  }

  const totalPixels = width * height;
  const uncoveredPixels = totalPixels - coveredPixels;
  return {
    totalPixels,
    coveredPixels,
    uncoveredPixels,
    duplicatedPixels,
    coverageRatio: coveredPixels / totalPixels,
    duplicatedRatio: duplicatedPixels / totalPixels,
    maxCoverageDepth,
  };
}

export function planTiles(
  width: number,
  height: number,
  options: TilePlannerOptions = {},
): TilePlan {
  assertPositiveInteger('width', width);
  assertPositiveInteger('height', height);

  const targetTilePixels = options.targetTilePixels ?? DEFAULT_TARGET_TILE_PIXELS;
  const overlapRatio = options.overlapRatio ?? DEFAULT_OVERLAP_RATIO;
  const minOverlapPixels = options.minOverlapPixels ?? DEFAULT_MIN_OVERLAP_PIXELS;
  const maxTotalTiles = options.maxTotalTiles ?? DEFAULT_MAX_TOTAL_TILES;

  if (!Number.isFinite(targetTilePixels) || targetTilePixels < 16_384) {
    throw new RangeError('targetTilePixels must be at least 16384');
  }
  if (!Number.isFinite(overlapRatio) || overlapRatio < 0 || overlapRatio >= 0.5) {
    throw new RangeError('overlapRatio must be in [0, 0.5)');
  }
  assertPositiveInteger('minOverlapPixels', minOverlapPixels);
  assertPositiveInteger('maxTotalTiles', maxTotalTiles);

  const nominalSide = Math.max(128, Math.floor(Math.sqrt(targetTilePixels)));
  const tileWidth = Math.min(width, nominalSide);
  const tileHeight = Math.min(height, Math.max(128, Math.floor(targetTilePixels / tileWidth)));
  const overlapX = tileWidth === width
    ? 0
    : Math.min(tileWidth - 1, Math.max(minOverlapPixels, Math.round(tileWidth * overlapRatio)));
  const overlapY = tileHeight === height
    ? 0
    : Math.min(tileHeight - 1, Math.max(minOverlapPixels, Math.round(tileHeight * overlapRatio)));
  const xStarts = axisStarts(width, tileWidth, overlapX);
  const yStarts = axisStarts(height, tileHeight, overlapY);

  if (xStarts.length * yStarts.length > maxTotalTiles) {
    throw new RangeError(
      `image requires ${xStarts.length * yStarts.length} tiles, exceeding maxTotalTiles=${maxTotalTiles}`,
    );
  }

  const columnDigits = Math.max(2, String(xStarts.length).length);
  const rowDigits = Math.max(2, String(yStarts.length).length);
  const tiles: TileRect[] = [];
  for (let row = 0; row < yStarts.length; row += 1) {
    for (let column = 0; column < xStarts.length; column += 1) {
      tiles.push({
        id: `R${String(row + 1).padStart(rowDigits, '0')}C${String(column + 1).padStart(columnDigits, '0')}`,
        row,
        column,
        left: xStarts[column],
        top: yStarts[row],
        width: tileWidth,
        height: tileHeight,
      });
    }
  }

  const audit = auditCoverage(width, height, tiles);
  if (audit.uncoveredPixels !== 0) {
    throw new Error(`tile plan left ${audit.uncoveredPixels} pixels uncovered`);
  }

  return {
    width,
    height,
    tileWidth,
    tileHeight,
    overlapX,
    overlapY,
    rows: yStarts.length,
    columns: xStarts.length,
    tiles,
    audit,
  };
}
