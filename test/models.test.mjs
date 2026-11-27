import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MODEL_PREFIXES, modelMatches } from '../lib/models.js';

test('DEFAULT_MODEL_PREFIXES lists the DeepSeek model families', () => {
  assert.deepEqual(DEFAULT_MODEL_PREFIXES, ['deepseek-flash', 'deepseek-v4.1']);
});

test('modelMatches accepts the default DeepSeek families and versioned ids', () => {
  const models = [
    'deepseek-flash',
    'deepseek-v4.1-flash-1017',
    'deepseek-v4.1-pro',
    'openrouter/deepseek/deepseek-v4.1-flash-1017',
    'openrouter:deepseek-v4.1-flash-1017',
  ];
  for (const model of models) {
    assert.equal(modelMatches(DEFAULT_MODEL_PREFIXES, model), true, model);
  }
});

test('modelMatches rejects plain v4 ids, unrelated ids, and empty values', () => {
  for (const model of [
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'gpt-5.5',
    '',
    'xdeepseek-flash',
  ]) {
    assert.equal(modelMatches(DEFAULT_MODEL_PREFIXES, model), false, model);
  }
  assert.equal(modelMatches([], 'deepseek-flash'), false);
});

test('modelMatches supports the wildcard prefix', () => {
  assert.equal(modelMatches(['*'], 'gpt-5.5'), true);
  assert.equal(modelMatches(['*'], 'deepseek-flash'), true);
});

test('modelMatches ignores case in the model id and the prefixes', () => {
  assert.equal(modelMatches(DEFAULT_MODEL_PREFIXES, 'DEEPSEEK-FLASH'), true);
  assert.equal(modelMatches(DEFAULT_MODEL_PREFIXES, 'DeepSeek-V4.1-Flash-1017'), true);
  assert.equal(modelMatches(['DEEPSEEK-V4.1'], 'deepseek-v4.1-flash-1017'), true);
});
