import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { isJsonValue } from '@deepseek-ai/dsh-session';
import { apply as applyPlugin } from '../lib/index.js';
import { auditCoverage, planTiles, prepareImageBatch } from '../lib/core/index.js';

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
  const source = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#f8f8f8' },
  }).png().toBuffer();
  const first = await prepareImageBatch(source, { strategy: 'uniform', maxImagesPerBatch: 5, batchIndex: 0 });
  const second = await prepareImageBatch(source, { strategy: 'uniform', maxImagesPerBatch: 5, batchIndex: 1 });

  assert.equal(first.imageSetId, second.imageSetId);
  assert.equal(first.plan.audit.coverageRatio, 1);
  assert.equal(first.images.length, 5);
  assert.equal(first.images[0].kind, 'overview');
  assert.deepEqual(first.remainingBatchIndices, [1, 2]);
  assert.deepEqual(second.remainingBatchIndices, [2]);
  assert.equal(new Set([...first.tileIds, ...second.tileIds]).size, 8);
  assert.equal(first.estimatedVisionTokenCap, 5 * 384);

  for (const image of first.images) {
    const metadata = await sharp(image.data).metadata();
    assert.ok((metadata.width ?? 0) <= 800);
    assert.ok((metadata.height ?? 0) <= 800);
  }
});

test('adaptive strategy preserves base coverage and adds ordered dense-region detail crops', async () => {
  const source = await sharp({
    create: { width: 1200, height: 1800, channels: 3, background: '#ffffff' },
  })
    .composite([
      { input: await sharp({ create: { width: 500, height: 350, channels: 3, background: '#111111' } }).png().toBuffer(), left: 650, top: 1200 },
    ])
    .png()
    .toBuffer();
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

test('DSH plugin registers a tool that publishes image attachment blocks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-vision-tiler-'));
  const path = join(directory, 'sample.png');
  await writeFile(path, await sharp({
    create: { width: 900, height: 1200, channels: 3, background: '#ffffff' },
  }).png().toBuffer());

  let definition;
  const ctx = {
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
  applyPlugin(ctx);
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
