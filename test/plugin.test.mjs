import assert from 'node:assert/strict';
import test from 'node:test';
import { Config, apply as applyPlugin } from '../lib/index.js';

function captureRegistration() {
  const state = { definition: undefined, options: undefined };
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
        return images;
      },
    },
  };
  return { ctx, state };
}

function modelPredicate(state) {
  return (model) => state.options.when({ modelSelection: { provider: 'deepseek', model } });
}

test('Config fills the documented defaults', () => {
  const config = Config({});
  assert.deepEqual(config.models, ['deepseek-flash', 'deepseek-v4.1']);
  assert.equal(config.overviewMaxEdge, 800);
  assert.equal(config.defaultStrategy, 'adaptive');
  assert.equal(config.targetTilePixels, 589824);
});

test('Config rejects targetTilePixels below the planner minimum', () => {
  assert.throws(() => Config({ targetTilePixels: 4 }), /targetTilePixels/);
});

test('apply registers segment_image with a model-selection predicate', () => {
  const { ctx, state } = captureRegistration();
  applyPlugin(ctx, {});
  assert.equal(state.definition.name, 'segment_image');
  assert.equal(typeof state.options.when, 'function');

  const when = modelPredicate(state);
  assert.equal(when('deepseek-v4.1-flash-1017'), true);
  assert.equal(when('deepseek-v4-flash'), false);
  assert.equal(when('gpt-5.5'), false);
});

test('an empty models allowlist registers the tool but hides it from every model', () => {
  const { ctx, state } = captureRegistration();
  applyPlugin(ctx, { models: [] });
  assert.equal(state.definition.name, 'segment_image');

  const when = modelPredicate(state);
  for (const model of ['deepseek-flash', 'deepseek-v4.1-flash-1017', 'gpt-5.5']) {
    assert.equal(when(model), false, model);
  }
});

test('a changed models allowlist gates the tool to the configured ids', () => {
  const { ctx, state } = captureRegistration();
  applyPlugin(ctx, { models: ['gpt-5.5'] });
  assert.equal(state.definition.name, 'segment_image');

  const when = modelPredicate(state);
  assert.equal(when('gpt-5.5'), true);
  assert.equal(when('deepseek-flash'), false);
});

test('Config accepts the cordis.patch.yml config and fills the default models', () => {
  const config = Config({
    targetTilePixels: 589824,
    minOverlapPixels: 64,
    maxTotalTiles: 256,
    maxImagesPerBatch: 20,
    includeOverview: true,
    overviewMaxEdge: 800,
    defaultStrategy: 'adaptive',
    detailCropCount: 1,
    detailCropSide: 512,
  });

  assert.equal(config.targetTilePixels, 589824);
  assert.equal(config.minOverlapPixels, 64);
  assert.equal(config.maxTotalTiles, 256);
  assert.equal(config.maxImagesPerBatch, 20);
  assert.equal(config.includeOverview, true);
  assert.equal(config.overviewMaxEdge, 800);
  assert.equal(config.defaultStrategy, 'adaptive');
  assert.equal(config.detailCropCount, 1);
  assert.equal(config.detailCropSide, 512);
  assert.deepEqual(config.models, ['deepseek-flash', 'deepseek-v4.1']);
});
