import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Jimp, JimpMime } from 'jimp';
import { Config, apply as applyPlugin } from '../lib/index.js';

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

function createHost({ maxImagesPerMessage = 20, measureOverview = false } = {}) {
  const state = { definition: undefined, saveCalls: 0, saved: [] };
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
    tools: {
      register(definition) {
        state.definition = definition;
        return () => {};
      },
    },
    attachments: {
      imageLimits: { maxImagesPerMessage },
      async saveImages(images) {
        state.saveCalls += 1;
        const refs = [];
        for (const image of images) {
          let width = 100;
          let height = 100;
          if (measureOverview && image.name.endsWith('-overview.png')) {
            const decoded = await Jimp.read(image.data);
            width = decoded.width;
            height = decoded.height;
          }
          const index = state.saved.length;
          state.saved.push({ name: image.name, width, height });
          refs.push({
            attachmentId: 'test-' + index,
            mediaType: image.mediaType,
            bytes: image.data.byteLength,
            width,
            height,
            name: image.name,
          });
        }
        return refs;
      },
    },
  };
  return { ctx, state };
}

async function writePng(t, width, height, decorate) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-vision-tiler-live-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const image = new Jimp({ width, height, color: 0xffffffff });
  if (decorate) decorate(image);
  const path = join(directory, 'source.png');
  await writeFile(path, await image.getBuffer(JimpMime.png, { compressionLevel: 9 }));
  return path;
}

function executionContext() {
  return { signal: new AbortController().signal, deferContext() {} };
}

async function execute(state, path, args = {}) {
  return state.definition.execute(
    { path, mode: 'document', batch_index: 0, ...args },
    executionContext(),
  );
}

function overviewSavedSince(state, start) {
  return state.saved
    .slice(start)
    .find((image) => image.name.endsWith('-overview.png'));
}

test('execute reads targetTilePixels at call time', async (t) => {
  const path = await writePng(t, 900, 1200);
  const { ctx, state } = createHost();
  const config = Config({
    targetTilePixels: 262144,
    defaultStrategy: 'uniform',
    detailCropCount: 0,
  });
  applyPlugin(ctx, config);

  const first = await execute(state, path);
  assert.equal(first.plan.tileWidth, 512);
  assert.equal(first.plan.totalTiles, 6);

  config.targetTilePixels[VOLATILE_WRITE](589824);
  const second = await execute(state, path);
  assert.equal(second.plan.tileWidth, 768);
  assert.equal(second.plan.totalTiles, 4);
});

test('execute reads overlapRatio and minOverlapPixels at call time', async (t) => {
  const path = await writePng(t, 900, 1200);
  const { ctx, state } = createHost();
  const config = Config({
    targetTilePixels: 589824,
    overlapRatio: 0.3,
    minOverlapPixels: 1,
    defaultStrategy: 'uniform',
    detailCropCount: 0,
  });
  applyPlugin(ctx, config);

  assert.equal((await execute(state, path)).plan.overlapX, 230);

  config.overlapRatio[VOLATILE_WRITE](0.05);
  assert.equal((await execute(state, path)).plan.overlapX, 38);

  config.overlapRatio[VOLATILE_WRITE](0);
  config.minOverlapPixels[VOLATILE_WRITE](10);
  assert.equal((await execute(state, path)).plan.overlapX, 10);
});

test('execute reads maxTotalTiles at call time', async (t) => {
  const path = await writePng(t, 500, 500);
  const { ctx, state } = createHost();
  const config = Config({
    targetTilePixels: 16384,
    maxTotalTiles: 256,
    defaultStrategy: 'uniform',
    detailCropCount: 0,
  });
  applyPlugin(ctx, config);

  const first = await execute(state, path);
  assert.equal(first.plan.totalTiles, 49);
  assert.equal(state.saveCalls, 1);

  config.maxTotalTiles[VOLATILE_WRITE](1);
  await assert.rejects(execute(state, path), /exceeding maxTotalTiles=1/);
  assert.equal(state.saveCalls, 1);
});

test('execute reads maxImagesPerBatch at call time and clamps it to the attachment limit', async (t) => {
  const path = await writePng(t, 900, 1200);
  const { ctx, state } = createHost();
  const config = Config({
    targetTilePixels: 589824,
    maxImagesPerBatch: 2,
    includeOverview: true,
    defaultStrategy: 'uniform',
    detailCropCount: 0,
  });
  applyPlugin(ctx, config);

  assert.equal((await execute(state, path)).images.length, 2);

  config.maxImagesPerBatch[VOLATILE_WRITE](20);
  assert.equal((await execute(state, path)).images.length, 5);

  ctx.attachments.imageLimits.maxImagesPerMessage = 3;
  assert.equal((await execute(state, path)).images.length, 3);

  config.maxImagesPerBatch[VOLATILE_WRITE](2);
  assert.equal((await execute(state, path)).images.length, 2);
});

test('execute reads includeOverview and overviewMaxEdge at call time', async (t) => {
  const path = await writePng(t, 900, 1200);
  const { ctx, state } = createHost({ measureOverview: true });
  const config = Config({
    targetTilePixels: 589824,
    overviewMaxEdge: 400,
    includeOverview: true,
    defaultStrategy: 'uniform',
    detailCropCount: 0,
  });
  applyPlugin(ctx, config);

  let start = state.saved.length;
  const first = await execute(state, path);
  assert.equal(first.images[0].kind, 'overview');
  let overview = overviewSavedSince(state, start);
  assert.ok(overview);
  assert.deepEqual([overview.width, overview.height], [300, 400]);

  config.includeOverview[VOLATILE_WRITE](false);
  start = state.saved.length;
  const second = await execute(state, path);
  assert.equal(second.images.some((image) => image.kind === 'overview'), false);
  assert.equal(overviewSavedSince(state, start), undefined);

  config.includeOverview[VOLATILE_WRITE](true);
  config.overviewMaxEdge[VOLATILE_WRITE](300);
  start = state.saved.length;
  const third = await execute(state, path);
  assert.equal(third.images[0].kind, 'overview');
  overview = overviewSavedSince(state, start);
  assert.ok(overview);
  assert.deepEqual([overview.width, overview.height], [225, 300]);
});

test('execute reads defaultStrategy at call time', async (t) => {
  const path = await writePng(t, 900, 1200);
  const { ctx, state } = createHost();
  const config = Config({ defaultStrategy: 'uniform', detailCropCount: 0 });
  applyPlugin(ctx, config);

  assert.equal((await execute(state, path)).plan.strategy, 'uniform');

  config.defaultStrategy[VOLATILE_WRITE]('adaptive');
  assert.equal((await execute(state, path)).plan.strategy, 'adaptive');
});

test('execute reads detailCropCount and detailCropSide at call time', async (t) => {
  const path = await writePng(t, 1200, 1800, (image) => {
    image.composite(new Jimp({ width: 500, height: 350, color: 0x111111ff }), 650, 1200);
  });
  const { ctx, state } = createHost();
  const config = Config({
    defaultStrategy: 'adaptive',
    detailCropCount: 0,
    detailCropSide: 256,
  });
  applyPlugin(ctx, config);

  const first = await execute(state, path);
  assert.equal(first.plan.detailTiles, 0);
  assert.equal(first.images.some((image) => image.kind === 'detail'), false);

  config.detailCropCount[VOLATILE_WRITE](2);
  const second = await execute(state, path);
  assert.equal(second.plan.detailTiles, 2);
  assert.deepEqual(
    second.images.filter((image) => image.kind === 'detail').map((image) => image.tile.width),
    [256, 256],
  );

  config.detailCropSide[VOLATILE_WRITE](512);
  const third = await execute(state, path);
  assert.equal(third.plan.detailTiles, 2);
  assert.deepEqual(
    third.images.filter((image) => image.kind === 'detail').map((image) => image.tile.width),
    [512, 512],
  );
});
