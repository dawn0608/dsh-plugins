import assert from 'node:assert/strict';
import test from 'node:test';
import { foldCost, resolveModel } from '../src/cost.js';

const row = { label: 'Flash', hit: [1, 1], miss: [2, 2], output: [3, 3] };
const table = { 'deepseek-flash': row };
const message = model => ({ type: 'assistant/message', time: Date.now(), data: {
  message: { source: { model } }, usage: { inputTokens: 1_000_000, outputTokens: 0 },
} });

test('unknown and look-alike names never inherit Flash prices', () => {
  for (const name of ['gpt-5', 'deepseek-future-flash', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-pro-custom', '']) {
    const model = resolveModel(name, table);
    assert.equal(model.unknown, true, name);
    assert.equal(model.miss, null, name);
  }
  assert.equal(resolveModel('deepseek-v4.1-flash', table).unknown, false);
  assert.equal(resolveModel('deepseek-v4-pro', table).unknown, true);
});

test('mixed bills retain only a known subtotal and null complete total', () => {
  const value = foldCost([message('deepseek-flash'), message('other-model')], table);
  assert.equal(value.pricingStatus, 'partial');
  assert.equal(value.total, null);
  assert.equal(value.knownSubtotal, 2);
  assert.equal(value.calls, 2);
  assert.equal(value.models[1].cost, null);
  assert.equal(value.models[1].tokens.uncached, 1_000_000);
});

test('unknown-only bills are unpriced rather than free', () => {
  const value = foldCost([message('other-model')], table);
  assert.equal(value.pricingStatus, 'unpriced');
  assert.equal(value.total, null);
  assert.equal(value.modelCost, null);
  assert.equal(value.models[0].prices, null);
});

test('invalid rows never contribute prices and known-only totals remain complete', () => {
  for (const invalid of [undefined, { ...row, hit: [NaN, 1] }, { ...row, miss: [-1, 2] }, { ...row, output: [1] }]) {
    const value = foldCost([message('deepseek-flash')], { 'deepseek-flash': invalid });
    assert.equal(value.total, null);
    assert.equal(value.pricingStatus, 'unpriced');
  }
  const value = foldCost([message('DeepSeek/deepseek-v4.1-flash')], table);
  assert.equal(value.total, 2);
  assert.equal(value.knownSubtotal, 2);
  assert.equal(value.pricingStatus, 'complete');
});
