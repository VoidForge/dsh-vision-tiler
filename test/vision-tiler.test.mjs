import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Jimp, JimpMime } from 'jimp';
import { isJsonValue } from '@deepseek-ai/dsh-util-values';
import { Config, apply as applyPlugin } from '../lib/index.js';
import { applyOrientation, RasterImage } from '../lib/core/image-codec.js';
import { auditCoverage, planTiles, prepareImageBatch } from '../lib/core/index.js';

async function solidPng(width, height, color = 0xffffffff) {
  return new Jimp({ width, height, color }).getBuffer(JimpMime.png, { compressionLevel: 9 });
}

const WEBP_16_BY_12 = Buffer.from(
  'UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoQAAwAAgA0JaACdLoABGaAAP7udn/3BmfV2OH9zY5xbIYAAAA=',
  'base64',
);

test('planner covers every source pixel and overlaps internal seams', () => {
  const plan = planTiles(5000, 3200);
  assert.equal(plan.audit.coverageRatio, 1);
  assert.equal(plan.audit.uncoveredPixels, 0);
  assert.ok(plan.audit.duplicatedPixels > 0);
  assert.ok(plan.tiles.every((tile) => tile.width * tile.height <= 768 * 768));
  assert.equal(plan.tiles[0].id, 'R01C01');
  assert.equal(plan.tiles.at(-1).left + plan.tiles.at(-1).width, 5000);
  assert.equal(plan.tiles.at(-1).top + plan.tiles.at(-1).height, 3200);
});

test('small image remains one complete tile', () => {
  const plan = planTiles(300, 200);
  assert.equal(plan.tiles.length, 1);
  assert.deepEqual(plan.tiles[0], {
    id: 'R01C01', row: 0, column: 0, left: 0, top: 0, width: 300, height: 200,
  });
  assert.equal(plan.audit.coverageRatio, 1);
  assert.equal(plan.audit.duplicatedPixels, 0);
});

test('coverage audit detects a missing quadrant exactly', () => {
  const audit = auditCoverage(100, 100, [
    { left: 0, top: 0, width: 50, height: 50 },
    { left: 50, top: 0, width: 50, height: 50 },
    { left: 0, top: 50, width: 50, height: 50 },
  ]);
  assert.equal(audit.coveredPixels, 7500);
  assert.equal(audit.uncoveredPixels, 2500);
  assert.equal(audit.coverageRatio, 0.75);
});

test('planner fails closed when tile count exceeds configured safety cap', () => {
  assert.throws(
    () => planTiles(10_000, 10_000, { maxTotalTiles: 10 }),
    /exceeding maxTotalTiles/,
  );
});

test('image preparation makes deterministic, bounded batches', async () => {
  const source = await solidPng(2400, 1600, 0xf8f8f8ff);
  const first = await prepareImageBatch(source, { strategy: 'uniform', maxImagesPerBatch: 5, batchIndex: 0 });
  const second = await prepareImageBatch(source, { strategy: 'uniform', maxImagesPerBatch: 5, batchIndex: 1 });

  assert.equal(first.imageSetId, second.imageSetId);
  assert.equal(first.plan.audit.coverageRatio, 1);
  assert.equal(first.images.length, 5);
  assert.equal(first.images[0].kind, 'overview');
  assert.deepEqual(first.remainingBatchIndices, [1, 2]);
  assert.deepEqual(second.remainingBatchIndices, [2]);
  assert.equal(new Set([...first.tileIds, ...second.tileIds]).size, 8);

  for (const image of first.images) {
    const decoded = await Jimp.read(image.data);
    assert.equal(image.width, decoded.width);
    assert.equal(image.height, decoded.height);
    assert.ok(decoded.width <= 800);
    assert.ok(decoded.height <= 800);
  }
});

test('adaptive strategy preserves base coverage and adds ordered dense-region detail crops', async () => {
  const sourceImage = new Jimp({ width: 1200, height: 1800, color: 0xffffffff });
  sourceImage.composite(new Jimp({ width: 500, height: 350, color: 0x111111ff }), 650, 1200);
  const source = await sourceImage.getBuffer(JimpMime.png, { compressionLevel: 9 });
  const prepared = await prepareImageBatch(source, {
    mode: 'document',
    strategy: 'adaptive',
    detailCropCount: 2,
    maxImagesPerBatch: 20,
  });

  assert.equal(prepared.strategy, 'adaptive');
  assert.equal(prepared.plan.audit.coverageRatio, 1);
  assert.equal(prepared.plan.audit.uncoveredPixels, 0);
  assert.equal(prepared.detailTiles.length, 2);
  assert.ok(prepared.detailTiles.every((tile) => tile.role === 'detail'));
  assert.ok(prepared.detailTiles.every((tile) => tile.id.startsWith('D')));
  assert.ok(prepared.images.some((image) => image.kind === 'detail'));
});

test('WebP input is decoded through the bundled WASM path', async () => {
  const prepared = await prepareImageBatch(WEBP_16_BY_12, { strategy: 'uniform' });
  assert.equal(prepared.originalWidth, 16);
  assert.equal(prepared.originalHeight, 12);
  assert.equal(prepared.plan.audit.coverageRatio, 1);
  assert.equal(prepared.plan.audit.uncoveredPixels, 0);
  assert.equal(prepared.images.length, 2);
});

test('EXIF orientation transforms preserve the expected dimensions', () => {
  const portrait = RasterImage.from(new Jimp({ width: 2, height: 3, color: 0xffffffff }));
  const rotated = applyOrientation(portrait, 6);
  assert.equal(rotated.width, 3);
  assert.equal(rotated.height, 2);
});

test('DSH plugin registers a tool that publishes image attachment blocks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-vision-tiler-'));
  const path = join(directory, 'sample.png');
  await writeFile(path, await solidPng(900, 1200));

  let definition;
  const ctx = {
    fiber: { role: 'test-fiber' },
    inject(services, callback) {
      callback({
        settings: { configure: () => () => {} },
        effect(execute) {
          const dispose = execute();
          return typeof dispose === 'function' ? dispose : () => {};
        },
      });
    },
    tools: { register(value) { definition = value; return () => {}; } },
    attachments: {
      imageLimits: { maxImagesPerMessage: 20 },
      async saveImages(images) {
        return images.map((image, index) => ({
          attachmentId: `test-${index}`,
          mediaType: image.mediaType,
          bytes: image.data.byteLength,
          width: 768,
          height: 768,
          name: image.name,
        }));
      },
    },
  };
  applyPlugin(ctx, Config({}));
  assert.equal(definition.name, 'segment_image');

  const args = { path, mode: 'document', batch_index: 0 };
  const value = await definition.execute(args, {
    signal: new AbortController().signal,
    deferContext() {},
  });
  const blocks = definition.output.render(args, value);
  assert.equal(isJsonValue(value), true);
  assert.equal(value.plan.coverageRatio, 1);
  assert.equal(value.plan.uncoveredPixels, 0);
  assert.ok(blocks.some((block) => block.type === 'image'));
  assert.match(blocks[0].text, /几何覆盖率 100\.0000%/);
});
