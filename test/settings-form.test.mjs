import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_STAGED,
  FIELDS,
  displayValue,
  editedOps,
  parseField,
  reconcileStaged,
  settleFailed,
  settleSaved,
  stageEdit,
} from '../lib/settings-form.js';

function field(key) {
  const spec = FIELDS.find((candidate) => candidate.key === key);
  assert.ok(spec, 'missing field ' + key);
  return spec;
}

test('a cleared number parses to an unset operation', () => {
  for (const spec of FIELDS.filter((candidate) => candidate.kind === 'number' || candidate.kind === 'integer')) {
    assert.deepEqual(parseField(spec, ''), { kind: 'unset' }, spec.key);
    assert.deepEqual(parseField(spec, '   '), { kind: 'unset' }, spec.key);

    const parsed = editedOps({ [spec.key]: '' });
    assert.equal(parsed.invalid, false, spec.key);
    assert.deepEqual(parsed.ops, [{ op: 'unset', path: [spec.key] }], spec.key);
  }
});

test('a cleared models textarea sets an empty allowlist', () => {
  const spec = field('models');
  assert.deepEqual(parseField(spec, ''), { kind: 'set', value: [] });
  assert.deepEqual(parseField(spec, '  \n\n '), { kind: 'set', value: [] });

  const parsed = editedOps({ models: '' });
  assert.equal(parsed.invalid, false);
  assert.deepEqual(parsed.ops, [{ op: 'set', path: ['models'], value: [] }]);
});

test('an invalid number blocks the whole edit list', () => {
  for (const [key, raw] of [
    ['targetTilePixels', 'abc'],
    ['overlapRatio', '0.5'],
    ['detailCropCount', '1.5'],
    ['detailCropSide', '255'],
  ]) {
    const parsed = editedOps({ [key]: raw });
    assert.equal(parsed.invalid, true, key);
    assert.deepEqual(parsed.ops, [], key);
  }

  const blocked = editedOps({ minOverlapPixels: '16', maxTotalTiles: 'not-a-number' });
  assert.equal(blocked.invalid, true);
  assert.deepEqual(blocked.ops, []);
});

test('overlapRatio accepts 0.18 and rejects 0.5', () => {
  const spec = field('overlapRatio');
  assert.deepEqual(parseField(spec, '0.18'), { kind: 'set', value: 0.18 });
  assert.deepEqual(parseField(spec, '0'), { kind: 'set', value: 0 });
  assert.deepEqual(parseField(spec, '0.499'), { kind: 'set', value: 0.499 });
  assert.equal(parseField(spec, '0.5').kind, 'invalid');
  assert.equal(parseField(spec, '-0.1').kind, 'invalid');
});

test('integer fields reject fractions and out-of-range values', () => {
  for (const spec of FIELDS.filter((candidate) => candidate.kind === 'integer')) {
    assert.equal(parseField(spec, String(spec.min + 0.5)).kind, 'invalid', spec.key + ' fraction');
    assert.equal(parseField(spec, String(spec.min - 1)).kind, 'invalid', spec.key + ' below min');
    assert.deepEqual(parseField(spec, String(spec.min)), { kind: 'set', value: spec.min }, spec.key + ' min');
    if (spec.max !== undefined) {
      assert.equal(parseField(spec, String(spec.max + 1)).kind, 'invalid', spec.key + ' above max');
      assert.deepEqual(parseField(spec, String(spec.max)), { kind: 'set', value: spec.max }, spec.key + ' max');
    }
  }
});

test('stageEdit captures the first revision and keeps it across later edits', () => {
  const firstSnapshot = {
    status: 'ready',
    value: { models: ['deepseek-flash'], includeOverview: true },
    revision: 3,
  };
  const first = stageEdit(EMPTY_STAGED, 'models', 'gpt-5.5', firstSnapshot);
  assert.deepEqual(first.edits, { models: 'gpt-5.5' });
  assert.equal(first.baseRevision, 3);
  assert.deepEqual(first.baseAccepted, firstSnapshot.value);

  const second = stageEdit(first, 'includeOverview', false, {
    status: 'ready',
    value: { models: ['gpt-5.5'], includeOverview: false },
    revision: 4,
  });
  assert.deepEqual(second.edits, { models: 'gpt-5.5', includeOverview: false });
  assert.equal(second.baseRevision, 3);
  assert.deepEqual(second.baseAccepted, firstSnapshot.value);
});

test('reconcileStaged advances the fence only when edited fields are unchanged', () => {
  const snapshot = {
    status: 'ready',
    value: { models: ['deepseek-flash'], includeOverview: true },
    revision: 3,
  };
  let staged = stageEdit(EMPTY_STAGED, 'models', 'gpt-5.5', snapshot);
  staged = stageEdit(staged, 'includeOverview', false, snapshot);

  const advanced = reconcileStaged(staged, {
    status: 'ready',
    value: { models: ['deepseek-flash'], includeOverview: true },
    revision: 4,
  });
  assert.equal(advanced.baseRevision, 4);
  assert.deepEqual(advanced.baseAccepted, { models: ['deepseek-flash'], includeOverview: true });
  assert.deepEqual(advanced.edits, staged.edits);

  const changedEdit = reconcileStaged(advanced, {
    status: 'ready',
    value: { models: ['gpt-5.5'], includeOverview: true },
    revision: 5,
  });
  assert.equal(changedEdit.baseRevision, 4);
  assert.deepEqual(changedEdit.edits, staged.edits);
  assert.deepEqual(changedEdit.baseAccepted, advanced.baseAccepted);

  const changedOtherEdit = reconcileStaged(advanced, {
    status: 'ready',
    value: { models: ['deepseek-flash'], includeOverview: false },
    revision: 6,
  });
  assert.equal(changedOtherEdit.baseRevision, 4);
  assert.deepEqual(changedOtherEdit.edits, staged.edits);
});

test('settleFailed keeps the edits and advances the fence', () => {
  const staged = stageEdit(EMPTY_STAGED, 'models', 'gpt-5.5', {
    status: 'ready',
    value: { models: ['deepseek-flash'] },
    revision: 2,
  });
  const current = {
    status: 'ready',
    value: { models: ['deepseek-flash'] },
    revision: 9,
  };

  const failed = settleFailed(staged, current);
  assert.deepEqual(failed.edits, { models: 'gpt-5.5' });
  assert.equal(failed.baseRevision, 9);
  assert.deepEqual(failed.baseAccepted, current.value);
});

test('settleSaved clears the staged form', () => {
  const staged = stageEdit(EMPTY_STAGED, 'models', 'gpt-5.5', {
    status: 'ready',
    value: { models: ['deepseek-flash'] },
    revision: 2,
  });
  assert.deepEqual(staged.edits, { models: 'gpt-5.5' });

  const saved = settleSaved();
  assert.deepEqual(saved, { edits: {}, baseRevision: undefined, baseAccepted: null });
});

test('displayValue formats each control kind', () => {
  assert.equal(displayValue(field('targetTilePixels'), 589824), '589824');
  assert.equal(displayValue(field('targetTilePixels'), undefined), '');
  assert.equal(displayValue(field('overlapRatio'), 0.18), '0.18');
  assert.equal(displayValue(field('overlapRatio'), undefined), '');
  assert.equal(displayValue(field('includeOverview'), true), true);
  assert.equal(displayValue(field('includeOverview'), false), false);
  assert.equal(displayValue(field('includeOverview'), undefined), false);
  assert.equal(displayValue(field('defaultStrategy'), 'uniform'), 'uniform');
  assert.equal(displayValue(field('defaultStrategy'), undefined), 'adaptive');
  assert.equal(displayValue(field('models'), ['deepseek-flash', 'deepseek-v4.1']), 'deepseek-flash\ndeepseek-v4.1');
  assert.equal(displayValue(field('models'), undefined), '');
});
