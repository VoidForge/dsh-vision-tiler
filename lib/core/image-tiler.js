import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { auditCoverage, planTiles } from './planner.js';
const MODE_OVERLAP = {
    auto: 0.15,
    document: 0.18,
    diagram: 0.2,
    photo: 0.12,
};
function throwIfAborted(signal) {
    signal?.throwIfAborted();
}
function windowStarts(length, size) {
    if (length <= size)
        return [0];
    const step = Math.max(1, Math.floor(size / 2));
    const starts = [];
    for (let start = 0; start + size < length; start += step)
        starts.push(start);
    const finalStart = length - size;
    if (starts.at(-1) !== finalStart)
        starts.push(finalStart);
    return starts;
}
async function makeDensityMap(data, sourceWidth, sourceHeight) {
    const raw = await sharp(data)
        .resize({ width: 512, height: 2048, fit: 'inside', withoutEnlargement: true })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const width = raw.info.width;
    const height = raw.info.height;
    const values = new Float32Array(width * height);
    const integral = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y += 1) {
        let rowTotal = 0;
        for (let x = 0; x < width; x += 1) {
            const index = y * width + x;
            const pixel = raw.data[index];
            const darkness = Math.max(0, (238 - pixel) / 238);
            const horizontalEdge = x > 0 ? Math.abs(pixel - raw.data[index - 1]) / 255 : 0;
            const verticalEdge = y > 0 ? Math.abs(pixel - raw.data[index - width]) / 255 : 0;
            const value = darkness * 0.65 + Math.min(1, horizontalEdge + verticalEdge) * 0.35;
            values[index] = value;
            rowTotal += value;
            integral[(y + 1) * (width + 1) + x + 1] =
                integral[y * (width + 1) + x + 1] + rowTotal;
        }
    }
    return { width, height, sourceWidth, sourceHeight, values, integral };
}
function scaledBounds(map, rect) {
    const x0 = Math.max(0, Math.min(map.width - 1, Math.floor(rect.left * map.width / map.sourceWidth)));
    const y0 = Math.max(0, Math.min(map.height - 1, Math.floor(rect.top * map.height / map.sourceHeight)));
    const x1 = Math.max(x0 + 1, Math.min(map.width, Math.ceil((rect.left + rect.width) * map.width / map.sourceWidth)));
    const y1 = Math.max(y0 + 1, Math.min(map.height, Math.ceil((rect.top + rect.height) * map.height / map.sourceHeight)));
    return [x0, y0, x1, y1];
}
function densityScore(map, rect) {
    const [x0, y0, x1, y1] = scaledBounds(map, rect);
    const stride = map.width + 1;
    const total = map.integral[y1 * stride + x1] - map.integral[y0 * stride + x1]
        - map.integral[y1 * stride + x0] + map.integral[y0 * stride + x0];
    return total / ((x1 - x0) * (y1 - y0));
}
function seamScore(map, sourceY) {
    const center = Math.max(0, Math.min(map.height - 1, Math.round(sourceY * map.height / map.sourceHeight)));
    const radius = 2;
    let total = 0;
    let count = 0;
    for (let y = Math.max(0, center - radius); y <= Math.min(map.height - 1, center + radius); y += 1) {
        for (let x = 0; x < map.width; x += 1) {
            total += map.values[y * map.width + x];
            count += 1;
        }
    }
    return count === 0 ? 0 : total / count;
}
function makeContentAwarePlan(plan, map) {
    if (plan.rows <= 1 || plan.overlapY === 0) {
        return { ...plan, tiles: plan.tiles.map((tile) => ({ ...tile, role: 'coverage' })) };
    }
    const xStarts = [...new Set(plan.tiles.map((tile) => tile.left))].sort((a, b) => a - b);
    const nominalYStarts = [...new Set(plan.tiles.map((tile) => tile.top))].sort((a, b) => a - b);
    const adjustedYStarts = [nominalYStarts[0]];
    const radius = Math.max(16, Math.min(96, Math.floor(plan.overlapY * 0.75)));
    for (let index = 1; index < nominalYStarts.length - 1; index += 1) {
        const nominal = nominalYStarts[index];
        const previous = adjustedYStarts[index - 1];
        const nextNominal = nominalYStarts[index + 1];
        const low = Math.max(previous + 1, nominal - radius, nextNominal - plan.tileHeight);
        const high = Math.min(nominal + radius, previous + plan.tileHeight - 1, plan.height - plan.tileHeight);
        let best = nominal;
        let bestScore = Number.POSITIVE_INFINITY;
        for (let candidate = low; candidate <= high; candidate += 2) {
            const score = seamScore(map, candidate) + seamScore(map, candidate + plan.overlapY);
            if (score < bestScore || (score === bestScore && Math.abs(candidate - nominal) < Math.abs(best - nominal))) {
                best = candidate;
                bestScore = score;
            }
        }
        adjustedYStarts.push(best);
    }
    adjustedYStarts.push(nominalYStarts.at(-1) ?? 0);
    const tiles = [];
    for (let row = 0; row < adjustedYStarts.length; row += 1) {
        for (let column = 0; column < xStarts.length; column += 1) {
            tiles.push({
                id: `R${String(row + 1).padStart(2, '0')}C${String(column + 1).padStart(2, '0')}`,
                row,
                column,
                left: xStarts[column],
                top: adjustedYStarts[row],
                width: plan.tileWidth,
                height: plan.tileHeight,
                role: 'coverage',
            });
        }
    }
    const audit = auditCoverage(plan.width, plan.height, tiles);
    if (audit.uncoveredPixels !== 0) {
        return { ...plan, tiles: plan.tiles.map((tile) => ({ ...tile, role: 'coverage' })) };
    }
    return { ...plan, tiles, audit };
}
function intersectionOverUnion(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.left + a.width, b.left + b.width);
    const bottom = Math.min(a.top + a.height, b.top + b.height);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    if (intersection === 0)
        return 0;
    return intersection / (a.width * a.height + b.width * b.height - intersection);
}
function selectDetailTiles(width, height, map, requestedCount, requestedSide) {
    if (requestedCount <= 0)
        return [];
    const cropWidth = Math.min(width, requestedSide);
    const cropHeight = Math.min(height, requestedSide);
    if (cropWidth === width && cropHeight === height)
        return [];
    const candidates = windowStarts(width, cropWidth).flatMap((left) => windowStarts(height, cropHeight).map((top) => ({
        id: '',
        row: -1,
        column: -1,
        left,
        top,
        width: cropWidth,
        height: cropHeight,
        role: 'detail',
        densityScore: 0,
    })));
    for (const candidate of candidates)
        candidate.densityScore = densityScore(map, candidate);
    candidates.sort((a, b) => (b.densityScore ?? 0) - (a.densityScore ?? 0));
    const selected = [];
    for (const candidate of candidates) {
        if (selected.every((existing) => intersectionOverUnion(candidate, existing) < 0.35)) {
            selected.push(candidate);
            if (selected.length === requestedCount)
                break;
        }
    }
    selected.sort((a, b) => a.top - b.top || a.left - b.left);
    return selected.map((tile, index) => ({ ...tile, id: `D${String(index + 1).padStart(2, '0')}` }));
}
export async function prepareImageBatch(input, options = {}) {
    if (input.byteLength === 0)
        throw new Error('image is empty');
    throwIfAborted(options.signal);
    const mode = options.mode ?? 'auto';
    const strategy = options.strategy ?? 'adaptive';
    const batchIndex = options.batchIndex ?? 0;
    const maxImagesPerBatch = options.maxImagesPerBatch ?? 20;
    const includeOverview = options.includeOverview ?? true;
    const overviewMaxEdge = options.overviewMaxEdge ?? 800;
    const pngCompressionLevel = options.pngCompressionLevel ?? 9;
    const detailCropCount = options.detailCropCount ?? (strategy === 'adaptive' ? 1 : 0);
    const detailCropSide = options.detailCropSide ?? 512;
    if (!Number.isInteger(batchIndex) || batchIndex < 0)
        throw new RangeError('batchIndex must be a non-negative integer');
    if (!Number.isInteger(maxImagesPerBatch) || maxImagesPerBatch < 2)
        throw new RangeError('maxImagesPerBatch must be at least 2');
    if (!Number.isInteger(detailCropCount) || detailCropCount < 0 || detailCropCount > 16) {
        throw new RangeError('detailCropCount must be an integer from 0 to 16');
    }
    if (!Number.isInteger(detailCropSide) || detailCropSide < 256 || detailCropSide > 1024) {
        throw new RangeError('detailCropSide must be an integer from 256 to 1024');
    }
    const normalized = await sharp(input, { limitInputPixels: 100_000_000 })
        .rotate()
        .toColorspace('srgb')
        .png({ compressionLevel: pngCompressionLevel })
        .toBuffer({ resolveWithObject: true });
    throwIfAborted(options.signal);
    const width = normalized.info.width;
    const height = normalized.info.height;
    const overlapRatio = options.overlapRatio ?? MODE_OVERLAP[mode];
    const uniformPlan = planTiles(width, height, { ...options, overlapRatio });
    const shouldAdapt = strategy === 'adaptive' && (mode === 'auto' || mode === 'document');
    const densityMap = shouldAdapt && uniformPlan.tiles.length > 1
        ? await makeDensityMap(normalized.data, width, height)
        : undefined;
    const plan = densityMap ? makeContentAwarePlan(uniformPlan, densityMap) : {
        ...uniformPlan,
        tiles: uniformPlan.tiles.map((tile) => ({ ...tile, role: 'coverage' })),
    };
    const detailTiles = densityMap
        ? selectDetailTiles(width, height, densityMap, detailCropCount, detailCropSide)
        : [];
    const renderTiles = [...plan.tiles, ...detailTiles];
    const tilesPerBatch = maxImagesPerBatch - (includeOverview ? 1 : 0);
    const batchCount = Math.ceil(renderTiles.length / tilesPerBatch);
    if (batchIndex >= batchCount)
        throw new RangeError(`batchIndex ${batchIndex} is outside 0..${batchCount - 1}`);
    const planFingerprint = JSON.stringify({
        width,
        height,
        mode,
        strategy,
        targetTilePixels: options.targetTilePixels ?? 768 * 768,
        overlapRatio,
        minOverlapPixels: options.minOverlapPixels ?? 64,
        detailCropCount,
        detailCropSide,
    });
    const imageSetId = createHash('sha256').update(input).update(planFingerprint).digest('hex').slice(0, 16);
    const selectedTiles = renderTiles.slice(batchIndex * tilesPerBatch, (batchIndex + 1) * tilesPerBatch);
    const images = [];
    if (includeOverview) {
        const data = await sharp(normalized.data)
            .resize({ width: overviewMaxEdge, height: overviewMaxEdge, fit: 'inside', withoutEnlargement: true })
            .png({ compressionLevel: pngCompressionLevel })
            .toBuffer();
        images.push({ kind: 'overview', name: `${imageSetId}-overview.png`, mediaType: 'image/png', data });
    }
    const tileImages = await Promise.all(selectedTiles.map(async (tile) => {
        throwIfAborted(options.signal);
        const data = await sharp(normalized.data)
            .extract({ left: tile.left, top: tile.top, width: tile.width, height: tile.height })
            .png({ compressionLevel: pngCompressionLevel })
            .toBuffer();
        return {
            kind: tile.role === 'detail' ? 'detail' : 'tile',
            name: `${imageSetId}-${tile.id}.png`,
            mediaType: 'image/png',
            data,
            tile,
        };
    }));
    images.push(...tileImages);
    throwIfAborted(options.signal);
    const remainingBatchIndices = Array.from({ length: Math.max(0, batchCount - batchIndex - 1) }, (_, index) => batchIndex + index + 1);
    return {
        imageSetId,
        sourceBytes: input.byteLength,
        originalWidth: width,
        originalHeight: height,
        plan,
        strategy,
        detailTiles,
        batchIndex,
        batchCount,
        remainingBatchIndices,
        tileIds: selectedTiles.map((tile) => tile.id),
        estimatedVisionTokenCap: images.length * 384,
        images,
    };
}
//# sourceMappingURL=image-tiler.js.map