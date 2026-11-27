import assert from 'node:assert/strict';
import test from 'node:test';
import { Config, apply as applyPlugin } from '../lib/index.js';

const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write');

const CONFIG_KEYS = [
  'targetTilePixels',
  'overlapRatio',
  'minOverlapPixels',
  'maxTotalTiles',
  'maxImagesPerBatch',
  'includeOverview',
  'overviewMaxEdge',
  'defaultStrategy',
  'detailCropCount',
  'detailCropSide',
  'models',
];

const CONFIG_DEFAULTS = {
  targetTilePixels: 589824,
  overlapRatio: undefined,
  minOverlapPixels: 64,
  maxTotalTiles: 256,
  maxImagesPerBatch: 20,
  includeOverview: true,
  overviewMaxEdge: 800,
  defaultStrategy: 'adaptive',
  detailCropCount: undefined,
  detailCropSide: 512,
  models: ['deepseek-flash', 'deepseek-v4.1'],
};

function captureRegistration() {
  const state = {
    definition: undefined,
    options: undefined,
    injectCalls: [],
    effectLabels: [],
    configureCalls: [],
  };
  const fiber = { role: 'outer-fiber' };
  const ctx = {
    fiber,
    inject(services, callback) {
      state.injectCalls.push(services);
      callback({
        settings: {
          configure(presentation, owner) {
            state.configureCalls.push({ presentation, owner });
            return () => {};
          },
        },
        effect(execute, label) {
          state.effectLabels.push(label);
          const dispose = execute();
          return typeof dispose === 'function' ? dispose : () => {};
        },
      });
    },
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
  return { ctx, state, fiber };
}

function modelPredicate(state) {
  return (model) => state.options.when({ modelSelection: { provider: 'deepseek', model } });
}

test('Config({}) returns a live reference for every field', () => {
  const config = Config({});
  assert.deepEqual(Object.keys(config).sort(), [...CONFIG_KEYS].sort());
  for (const key of CONFIG_KEYS) {
    const reference = config[key];
    assert.equal(typeof reference.get, 'function', key);
    assert.equal(typeof reference[VOLATILE_WRITE], 'function', key);
  }
});

test('Config({}) yields the documented defaults', () => {
  const config = Config({});
  for (const [key, expected] of Object.entries(CONFIG_DEFAULTS)) {
    assert.deepEqual(config[key].get(), expected, key);
  }
});

test('Config leaves overlapRatio and detailCropCount undefined when absent', () => {
  const config = Config({});
  assert.equal(config.overlapRatio.get(), undefined);
  assert.equal(config.detailCropCount.get(), undefined);
});

test('Config freezes the parsed models reference', () => {
  const config = Config({});
  const models = config.models.get();
  assert.equal(Array.isArray(models), true);
  assert.equal(Object.isFrozen(models), true);

  const custom = Config({ models: ['gpt-5.5'] });
  assert.deepEqual(Array.from(custom.models.get()), ['gpt-5.5']);
  assert.equal(Object.isFrozen(custom.models.get()), true);
});

test('Config marks every schema field volatile', () => {
  assert.ok(Config.dict, 'Config exposes its object schema');
  assert.deepEqual(Object.keys(Config.dict).sort(), [...CONFIG_KEYS].sort());
  for (const key of CONFIG_KEYS) {
    assert.equal(Config.dict[key].meta?.volatile, true, key);
  }
});

test('Config rejects targetTilePixels below the planner minimum', () => {
  assert.throws(() => Config({ targetTilePixels: 4 }), /targetTilePixels/);
});

test('Config rejects an overviewMaxEdge outside the schema bounds', () => {
  for (const overviewMaxEdge of [0, 800.5, 5000]) {
    assert.throws(
      () => Config({ overviewMaxEdge }),
      /overviewMaxEdge/,
      String(overviewMaxEdge),
    );
  }
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

  assert.equal(config.targetTilePixels.get(), 589824);
  assert.equal(config.overlapRatio.get(), undefined);
  assert.equal(config.minOverlapPixels.get(), 64);
  assert.equal(config.maxTotalTiles.get(), 256);
  assert.equal(config.maxImagesPerBatch.get(), 20);
  assert.equal(config.includeOverview.get(), true);
  assert.equal(config.overviewMaxEdge.get(), 800);
  assert.equal(config.defaultStrategy.get(), 'adaptive');
  assert.equal(config.detailCropCount.get(), 1);
  assert.equal(config.detailCropSide.get(), 512);
  assert.deepEqual(config.models.get(), ['deepseek-flash', 'deepseek-v4.1']);
});

test('apply registers segment_image with a model-selection predicate', () => {
  const { ctx, state } = captureRegistration();
  applyPlugin(ctx, Config({}));
  assert.equal(state.definition.name, 'segment_image');
  assert.equal(typeof state.options.when, 'function');

  const when = modelPredicate(state);
  assert.equal(when('deepseek-v4.1-flash-1017'), true);
  assert.equal(when('deepseek-v4-flash'), false);
  assert.equal(when('gpt-5.5'), false);
});

test('apply registers the settings page policy through ctx.inject on the outer fiber', () => {
  const { ctx, state, fiber } = captureRegistration();
  applyPlugin(ctx, Config({}));

  assert.deepEqual(state.injectCalls, [['settings']]);
  assert.ok(state.effectLabels.length >= 1);
  assert.equal(typeof state.effectLabels[0], 'string');
  assert.equal(state.configureCalls.length, 1);
  assert.deepEqual(state.configureCalls[0].presentation, { auto: false });
  assert.equal(state.configureCalls[0].owner, fiber);
});

test('apply registers the tool when the optional settings service is absent', () => {
  const state = { definition: undefined };
  const ctx = {
    fiber: {},
    inject() {},
    tools: {
      register(definition) {
        state.definition = definition;
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
  assert.doesNotThrow(() => applyPlugin(ctx, Config({})));
  assert.equal(state.definition.name, 'segment_image');
});

test('an empty models allowlist registers the tool but hides it from every model', () => {
  const { ctx, state } = captureRegistration();
  applyPlugin(ctx, Config({ models: [] }));
  assert.equal(state.definition.name, 'segment_image');

  const when = modelPredicate(state);
  for (const model of ['deepseek-flash', 'deepseek-v4.1-flash-1017', 'gpt-5.5']) {
    assert.equal(when(model), false, model);
  }
});

test('a changed models allowlist gates the tool to the configured ids', () => {
  const { ctx, state } = captureRegistration();
  applyPlugin(ctx, Config({ models: ['gpt-5.5'] }));
  assert.equal(state.definition.name, 'segment_image');

  const when = modelPredicate(state);
  assert.equal(when('gpt-5.5'), true);
  assert.equal(when('deepseek-flash'), false);
});

test('when reads the live models reference on every evaluation', () => {
  const config = Config({ models: ['deepseek-flash'] });
  const { ctx, state } = captureRegistration();
  applyPlugin(ctx, config);
  const when = modelPredicate(state);

  assert.equal(when('deepseek-flash'), true);
  assert.equal(when('gpt-5.5'), false);

  config.models[VOLATILE_WRITE](['gpt-5.5']);
  assert.equal(when('deepseek-flash'), false);
  assert.equal(when('gpt-5.5'), true);
});
