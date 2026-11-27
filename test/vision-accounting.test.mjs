import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Jimp, JimpMime } from 'jimp';
import { deepSeekImageTokens } from '@deepseek-ai/dsh-llm-deepseek';
import { apply as applyPlugin } from '../lib/index.js';
import {
  assertImageSentUnchanged,
  assertVisionAccounting,
  providerVisionTokens,
  verifyVisionAccounting,
} from '../lib/vision-accounting.js';

const packageRequire = createRequire(import.meta.url);
const installedVersion = packageRequire('@deepseek-ai/dsh-llm-deepseek/package.json').version;

function accountingStub(overrides = {}) {
  return {
    deepSeekImageTokens() {},
    deepSeekRequestImageDimensions() {},
    REQUEST_IMAGE_MAX_DIMENSION: 4096,
    ...overrides,
  };
}

async function solidPng(width, height, color = 0xffffffff) {
  return new Jimp({ width, height, color }).getBuffer(JimpMime.png, { compressionLevel: 9 });
}

async function writeSourceImage(t, width, height, color) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-vision-tiler-accounting-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'source.png');
  await writeFile(path, await solidPng(width, height, color));
  return path;
}

function executionContext() {
  return { signal: new AbortController().signal, deferContext() {} };
}

function createHost({ normalizeDimensions = (dimensions) => dimensions } = {}) {
  const state = { definition: undefined, options: undefined, saveCalls: 0, saved: [] };
  const ctx = {
    tools: {
      register(definition, options) {
        state.definition = definition;
        state.options = options;
        return () => {};
      },
    },
    attachments: {
      imageLimits: { maxImagesPerMessage: 20 },
      async saveImages(images) {
        state.saveCalls += 1;
        const refs = [];
        for (const image of images) {
          const decoded = await Jimp.read(image.data);
          const dimensions = normalizeDimensions(
            { width: decoded.width, height: decoded.height },
            image,
          );
          const index = state.saved.length;
          state.saved.push({
            name: image.name,
            width: dimensions.width,
            height: dimensions.height,
            preparedWidth: decoded.width,
            preparedHeight: decoded.height,
          });
          refs.push({
            attachmentId: `test-${index}`,
            mediaType: image.mediaType,
            bytes: image.data.byteLength,
            width: dimensions.width,
            height: dimensions.height,
            name: image.name,
          });
        }
        return refs;
      },
    },
  };
  return { ctx, state };
}

test('assertVisionAccounting accepts the installed DeepSeek accounting', () => {
  assert.doesNotThrow(() => assertVisionAccounting());
});

test('verifyVisionAccounting accepts a stub with both functions and a request limit', () => {
  assert.doesNotThrow(() => verifyVisionAccounting(accountingStub(), installedVersion));
});

test('verifyVisionAccounting accepts a different positive request limit without probing its value', () => {
  assert.doesNotThrow(() => verifyVisionAccounting(
    accountingStub({ REQUEST_IMAGE_MAX_DIMENSION: 2048 }),
    installedVersion,
  ));
});

test('verifyVisionAccounting rejects a missing member and names the installed version', () => {
  for (const member of ['deepSeekImageTokens', 'deepSeekRequestImageDimensions', 'REQUEST_IMAGE_MAX_DIMENSION']) {
    const stub = accountingStub();
    delete stub[member];
    assert.throws(
      () => verifyVisionAccounting(stub, '0.0.0-stub'),
      /@deepseek-ai\/dsh-llm-deepseek 0\.0\.0-stub/,
      member,
    );
  }
});

test('verifyVisionAccounting rejects an invalid request limit and names the installed version', () => {
  for (const limit of ['4096', 0, -1, NaN, Infinity]) {
    assert.throws(
      () => verifyVisionAccounting(
        accountingStub({ REQUEST_IMAGE_MAX_DIMENSION: limit }),
        '0.0.0-stub',
      ),
      /@deepseek-ai\/dsh-llm-deepseek 0\.0\.0-stub/,
      String(limit),
    );
  }
});

test('providerVisionTokens returns the DeepSeek reference prices without exceeding the cap', () => {
  const cases = [
    [100, 100, 184],
    [512, 512, 184],
    [565, 800, 302],
    [768, 768, 382],
    [800, 800, 422],
    [1024, 1024, 652],
    [1219, 1420, 992],
    [1302, 1302, 994],
    [1920, 1080, 968],
    [2000, 2000, 994],
    [9000, 1, 832],
    [8192, 100, 240],
  ];
  for (const [width, height, expected] of cases) {
    const actual = providerVisionTokens(width, height);
    assert.equal(actual, expected, `${width}x${height}`);
    assert.ok(actual <= 1024, `${width}x${height} prices ${actual} tokens`);
  }
});

test('providerVisionTokens prices 1219x1420 after projection, not at the source size', () => {
  assert.equal(deepSeekImageTokens(1219, 1420), 959);
  assert.equal(providerVisionTokens(1219, 1420), 992);
});

test('providerVisionTokens applies the 4096 px per-side cap', () => {
  assert.equal(providerVisionTokens(9000, 1), 832);
  assert.equal(providerVisionTokens(8192, 100), 240);
});

test('assertImageSentUnchanged accepts tile and detail images DSH sends unchanged', () => {
  for (const kind of ['tile', 'detail']) {
    assert.doesNotThrow(() => assertImageSentUnchanged(kind, 1302, 1302));
    assert.doesNotThrow(() => assertImageSentUnchanged(kind, 512, 512));
  }
});

test('assertImageSentUnchanged rejects resized or oversized tile and detail images', () => {
  for (const kind of ['tile', 'detail']) {
    assert.throws(() => assertImageSentUnchanged(kind, 1303, 1303), RangeError);
    assert.throws(() => assertImageSentUnchanged(kind, 8192, 100), RangeError);
  }
});

test('segment_image rejects a coverage tile DSH would resize before saving attachments', async (t) => {
  const path = await writeSourceImage(t, 2000, 2000);
  const { ctx, state } = createHost();
  applyPlugin(ctx, { targetTilePixels: 4_000_000 });
  assert.ok(state.definition);

  await assert.rejects(
    state.definition.execute({ path, mode: 'document', batch_index: 0 }, executionContext()),
    RangeError,
  );
  assert.equal(state.saveCalls, 0);
});

test('segment_image prices each emitted image and caps the batch at 1024 tokens per image', async (t) => {
  const path = await writeSourceImage(t, 900, 1200);
  const { ctx, state } = createHost();
  applyPlugin(ctx, {});
  assert.ok(state.definition);

  const value = await state.definition.execute(
    { path, mode: 'document', batch_index: 0 },
    executionContext(),
  );
  assert.equal(state.saveCalls, 1);
  assert.equal(state.saved.length, value.images.length);
  assert.ok(value.images.length > 1);

  const overview = value.images.find((image) => image.kind === 'overview');
  assert.ok(overview);
  const overviewImage = state.saved.find((image) => image.name === overview.name);
  assert.ok(overviewImage);
  assert.notEqual(overviewImage.width, overviewImage.height);
  assert.equal(Math.max(overviewImage.width, overviewImage.height), 800);

  const overviewTokens = providerVisionTokens(overviewImage.width, overviewImage.height);
  const tileTokens = state.saved
    .filter((image) => image.name !== overview.name)
    .reduce((total, image) => total + providerVisionTokens(image.width, image.height), 0);
  assert.equal(value.batch.estimatedVisionTokens, overviewTokens + tileTokens);
  assert.equal(value.batch.visionTokenCap, value.images.length * 1024);
  assert.equal('estimatedVisionTokenCap' in value.batch, false);
});

test('segment_image prices normalized attachment refs instead of prepared dimensions', async (t) => {
  const path = await writeSourceImage(t, 900, 1200);
  const { ctx, state } = createHost({
    normalizeDimensions: () => ({ width: 100, height: 100 }),
  });
  applyPlugin(ctx, {});
  assert.ok(state.definition);

  const value = await state.definition.execute(
    { path, mode: 'document', batch_index: 0 },
    executionContext(),
  );
  assert.equal(state.saved.length, value.images.length);
  assert.ok(state.saved.every((image) => image.width === 100 && image.height === 100));

  const refTokens = state.saved
    .reduce((total, image) => total + providerVisionTokens(image.width, image.height), 0);
  const preparedTokens = state.saved
    .reduce((total, image) => total + providerVisionTokens(image.preparedWidth, image.preparedHeight), 0);
  assert.notEqual(refTokens, preparedTokens);
  assert.equal(value.batch.estimatedVisionTokens, refTokens);
});

test('segment_image prices an overview ref normalized to the DSH pixel budget', async (t) => {
  const path = await writeSourceImage(t, 1100, 3872);
  const { ctx, state } = createHost({
    normalizeDimensions: (dimensions, image) => (
      image.name.endsWith('-overview.png') ? { width: 1091, height: 3842 } : dimensions
    ),
  });
  applyPlugin(ctx, { overviewMaxEdge: 4096 });
  assert.ok(state.definition);

  const value = await state.definition.execute(
    { path, mode: 'document', batch_index: 0 },
    executionContext(),
  );
  const overview = state.saved.find((image) => image.name.endsWith('-overview.png'));
  assert.ok(overview);
  assert.deepEqual([overview.width, overview.height], [1091, 3842]);
  assert.deepEqual([overview.preparedWidth, overview.preparedHeight], [1100, 3872]);

  const refTokens = state.saved
    .reduce((total, image) => total + providerVisionTokens(image.width, image.height), 0);
  const preparedTokens = state.saved
    .reduce((total, image) => total + providerVisionTokens(image.preparedWidth, image.preparedHeight), 0);
  assert.notEqual(refTokens, preparedTokens);
  assert.equal(value.batch.estimatedVisionTokens, refTokens);
});

test('segment_image sends a projected overview and prices it at the request dimensions', async (t) => {
  const path = await writeSourceImage(t, 4000, 1000);
  const { ctx, state } = createHost();
  applyPlugin(ctx, { overviewMaxEdge: 4096 });
  assert.ok(state.definition);
  assert.throws(() => assertImageSentUnchanged('tile', 4000, 1000), RangeError);

  const value = await state.definition.execute(
    { path, mode: 'document', batch_index: 0 },
    executionContext(),
  );
  const overview = value.images.find((image) => image.kind === 'overview');
  assert.ok(overview);
  const overviewImage = state.saved.find((image) => image.name === overview.name);
  assert.ok(overviewImage);
  assert.deepEqual([overviewImage.width, overviewImage.height], [4000, 1000]);

  const expected = state.saved
    .reduce((total, image) => total + providerVisionTokens(image.width, image.height), 0);
  assert.equal(value.batch.estimatedVisionTokens, expected);
});

test('apply rejects a non-positive, fractional, or non-finite overviewMaxEdge', () => {
  for (const overviewMaxEdge of [NaN, 0, -5, 800.5]) {
    const { ctx, state } = createHost();
    assert.throws(
      () => applyPlugin(ctx, { overviewMaxEdge }),
      RangeError,
      String(overviewMaxEdge),
    );
    assert.equal(state.definition, undefined, String(overviewMaxEdge));
  }
});

test('apply rejects an overviewMaxEdge above the 4096 px request limit', () => {
  const { ctx, state } = createHost();
  assert.throws(() => applyPlugin(ctx, { overviewMaxEdge: 5000 }), RangeError);
  assert.equal(state.definition, undefined);
});

test('apply accepts an overviewMaxEdge at the 4096 px request limit', () => {
  const { ctx, state } = createHost();
  assert.doesNotThrow(() => applyPlugin(ctx, { overviewMaxEdge: 4096 }));
  assert.ok(state.definition);
});
