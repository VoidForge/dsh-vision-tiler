import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools';
import { prepareImageBatch } from './core/image-tiler.js';
import type { TileRect, TilingMode, TilingStrategy } from './core/types.js';

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

interface StoredRenderedImage {
  kind: 'overview' | 'tile' | 'detail';
  name: string;
  attachment: ImageAttachmentRef;
  tile?: TileRect;
}

interface SegmentImageResult {
  imageSetId: string;
  source: string;
  original: { width: number; height: number; bytes: number };
  plan: {
    strategy: TilingStrategy;
    rows: number;
    columns: number;
    totalTiles: number;
    tileWidth: number;
    tileHeight: number;
    overlapX: number;
    overlapY: number;
    coverageRatio: number;
    uncoveredPixels: number;
    duplicatedRatio: number;
    detailTiles: number;
  };
  batch: {
    index: number;
    count: number;
    tileIds: string[];
    remainingIndices: number[];
    estimatedVisionTokenCap: number;
  };
  images: StoredRenderedImage[];
}

function renderResult(value: JsonValue): ContentBlock[] {
  const result = value as unknown as SegmentImageResult;
  const complete = result.batch.remainingIndices.length === 0 && result.batch.index === 0;
  const followup = result.batch.remainingIndices.length > 0
    ? `还需调用相同 path，并依次设置 batch_index=${result.batch.remainingIndices.join(', ')}。`
    : result.batch.index > 0
      ? '这是后续批次；只有确认此前批次也已读取，才能声称整图读取完成。'
      : '全部切片均在本批。';
  const lines = [
    `图像集 ${result.imageSetId}；原图 ${result.original.width}×${result.original.height}。`,
    `策略 ${result.plan.strategy}；几何覆盖率 ${(result.plan.coverageRatio * 100).toFixed(4)}%，未覆盖像素 ${result.plan.uncoveredPixels}；重叠覆盖 ${(result.plan.duplicatedRatio * 100).toFixed(2)}%。`,
    `基础覆盖切片 ${result.plan.totalTiles} 张，密集区域放大切片 ${result.plan.detailTiles} 张。`,
    `当前批次 ${result.batch.index + 1}/${result.batch.count}，包含切片：${result.batch.tileIds.join(', ')}。`,
    `本批视觉 token 理论上限约 ${result.batch.estimatedVisionTokenCap}。`,
    followup,
    '阅读要求：先看 OVERVIEW，再按坐标逐一检查 BASE 切片，最后用 DETAIL 放大切片复核小字；合并重叠重复内容。回答时列出 seen_tiles、edge_checks 和 uncertain_regions。',
    complete ? '本批包含整幅图像集。' : '不要在剩余批次读完前声称已完整读取整图。',
  ];
  const blocks: ContentBlock[] = [{ type: 'text', text: lines.join('\n') }];

  for (const image of result.images) {
    if (image.kind === 'overview') {
      blocks.push({ type: 'text', text: `OVERLAY/OVERVIEW：${image.name}` });
    } else if (image.tile) {
      const tile = image.tile;
      blocks.push({
        type: 'text',
        text: `${image.kind === 'detail' ? 'DETAIL' : 'BASE'} ${tile.id}：原图坐标 x=${tile.left}..${tile.left + tile.width - 1}, y=${tile.top}..${tile.top + tile.height - 1}`,
      });
    }
    blocks.push({ type: 'image', attachment: image.attachment });
  }
  return blocks;
}

export const name = 'dsh-vision-tiler';
export const inject = ['tools', 'attachments'];

export default function apply(ctx: Context, config: Config = {}): void {
  const configuredBatchSize = config.maxImagesPerBatch ?? 20;
  const maxImagesPerBatch = Math.min(
    configuredBatchSize,
    ctx.attachments.imageLimits.maxImagesPerMessage,
  );

  ctx.tools.register(defineTool({
    name: 'segment_image',
    description: [
      'Read a high-resolution local image without first downscaling the whole image.',
      'The tool returns an overview plus overlapping tiles with verified 100% geometric coverage.',
      'For batchCount > 1, call again with the same path and every remaining batch_index before claiming complete inspection.',
    ].join(' '),
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: 'Absolute path, or a path relative to the DSH workspace, to a PNG/JPEG/WebP/GIF image.',
      },
      mode: {
        type: 'string',
        enum: ['auto', 'document', 'diagram', 'photo'],
        description: 'Content type; adjusts overlap. Default: auto.',
      },
      batch_index: {
        type: 'integer',
        description: 'Zero-based batch to return. Start at 0 and request all remaining indices.',
      },
      strategy: {
        type: 'string',
        enum: ['uniform', 'adaptive'],
        description: 'uniform reproduces v1; adaptive shifts document seams toward whitespace and adds dense-region detail crops. Default: adaptive.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => renderResult(value),
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const absolutePath = resolve(args.path);
      const data = await readFile(absolutePath, { signal: exec.signal });
      const prepared = await prepareImageBatch(data, {
        mode: (args.mode ?? 'auto') as TilingMode,
        strategy: (args.strategy ?? config.defaultStrategy ?? 'adaptive') as TilingStrategy,
        batchIndex: args.batch_index ?? 0,
        targetTilePixels: config.targetTilePixels,
        overlapRatio: config.overlapRatio,
        minOverlapPixels: config.minOverlapPixels,
        maxTotalTiles: config.maxTotalTiles,
        maxImagesPerBatch,
        includeOverview: config.includeOverview ?? true,
        overviewMaxEdge: config.overviewMaxEdge,
        detailCropCount: config.detailCropCount,
        detailCropSide: config.detailCropSide,
        signal: exec.signal,
      });
      const refs = await ctx.attachments.saveImages(prepared.images.map((image) => ({
        data: image.data,
        mediaType: image.mediaType,
        name: image.name,
      })));
      const images = prepared.images.map((image, index): StoredRenderedImage => ({
        kind: image.kind,
        name: image.name,
        attachment: refs[index],
        tile: image.tile,
      }));
      const result: SegmentImageResult = {
        imageSetId: prepared.imageSetId,
        source: basename(absolutePath),
        original: {
          width: prepared.originalWidth,
          height: prepared.originalHeight,
          bytes: prepared.sourceBytes,
        },
        plan: {
          strategy: prepared.strategy,
          rows: prepared.plan.rows,
          columns: prepared.plan.columns,
          totalTiles: prepared.plan.tiles.length,
          tileWidth: prepared.plan.tileWidth,
          tileHeight: prepared.plan.tileHeight,
          overlapX: prepared.plan.overlapX,
          overlapY: prepared.plan.overlapY,
          coverageRatio: prepared.plan.audit.coverageRatio,
          uncoveredPixels: prepared.plan.audit.uncoveredPixels,
          duplicatedRatio: prepared.plan.audit.duplicatedRatio,
          detailTiles: prepared.detailTiles.length,
        },
        batch: {
          index: prepared.batchIndex,
          count: prepared.batchCount,
          tileIds: prepared.tileIds,
          remainingIndices: prepared.remainingBatchIndices,
          estimatedVisionTokenCap: prepared.estimatedVisionTokenCap,
        },
        images,
      };
      return result as unknown as JsonValue;
    },
  }));
}
