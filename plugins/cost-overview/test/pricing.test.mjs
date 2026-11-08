import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRICING_RETRY_MS,
  PRICING_TTL_MS,
  parsePricing,
  pricingTtl,
} from '../src/pricing.js';

function html(rows) {
  return `<table>${rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</table>`;
}

const officialRows = [
  ['模型', 'deepseek-flash (1)', 'deepseek-v4-pro'],
  ['价格 (2)', '百万tokens输入 （缓存命中）', '空闲时段', '0.02元', '0.15元'],
  ['高峰时段', '0.04元', '0.30元'],
  ['百万tokens输入 （缓存未命中）', '空闲时段', '1元', '4.5元'],
  ['高峰时段', '2元', '9.0元'],
  ['百万tokens输出', '空闲时段', '4元', '13.5元'],
  ['高峰时段', '8元', '27.0元'],
];

const toolRows = [
  ['Search', '每 1,000 次成功请求', '5元'],
  ['Fetch', '每 1,000 次成功请求', '5元'],
];

const expectedTable = {
  'deepseek-flash': {
    label: 'DeepSeek-V4.1-Flash',
    hit: [0.02, 0.04],
    miss: [1, 2],
    output: [4, 8],
  },
  'deepseek-v4-pro': {
    label: 'DeepSeek-V4-Pro',
    hit: [0.15, 0.3],
    miss: [4.5, 9],
    output: [13.5, 27],
  },
};

test('parses the current official table shape', () => {
  const parsed = parsePricing(html([...officialRows, ...toolRows]));
  assert.deepEqual(parsed.table, expectedTable);
  assert.deepEqual(parsed.toolPrices, { search: 0.005, fetch: 0.005 });
});

test('maps price columns by the header, not by fixed positions', () => {
  const reordered = [
    ['模型', 'deepseek-v4-pro', 'deepseek-flash (1)'],
    ['价格 (2)', '百万tokens输入 （缓存命中）', '空闲时段', '0.15元', '0.02元'],
    ['高峰时段', '0.30元', '0.04元'],
    ['百万tokens输入 （缓存未命中）', '空闲时段', '4.5元', '1元'],
    ['高峰时段', '9.0元', '2元'],
    ['百万tokens输出', '空闲时段', '13.5元', '4元'],
    ['高峰时段', '27.0元', '8元'],
  ];
  assert.deepEqual(parsePricing(html([...reordered, ...toolRows])).table, expectedTable);
});

test('ignores an added model column without shifting Flash or Pro', () => {
  const threeModels = [
    ['模型', 'deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-lite'],
    ['价格 (2)', '百万tokens输入 （缓存命中）', '空闲时段', '0.02元', '0.15元', '0.01元'],
    ['高峰时段', '0.04元', '0.30元', '0.02元'],
    ['百万tokens输入 （缓存未命中）', '空闲时段', '1元', '4.5元', '0.5元'],
    ['高峰时段', '2元', '9.0元', '1元'],
    ['百万tokens输出', '空闲时段', '4元', '13.5元', '2元'],
    ['高峰时段', '8元', '27.0元', '4元'],
  ];
  const parsed = parsePricing(html([...threeModels, ...toolRows]));
  assert.deepEqual(parsed.table, expectedTable);
});

test('fails closed when a window row does not match the header model count', () => {
  const mismatched = [
    ['模型', 'deepseek-flash', 'deepseek-v4-pro'],
    ['价格 (2)', '百万tokens输入 （缓存命中）', '空闲时段', '0.02元', '0.15元', '0.30元'],
    ['高峰时段', '0.04元', '0.30元'],
    ['百万tokens输入 （缓存未命中）', '空闲时段', '1元', '4.5元'],
    ['高峰时段', '2元', '9.0元'],
    ['百万tokens输出', '空闲时段', '4元', '13.5元'],
    ['高峰时段', '8元', '27.0元'],
  ];
  assert.equal(parsePricing(html(mismatched)), undefined);
});

test('fails closed when a peak value is not exactly twice off-peak', () => {
  const wrongRatio = structuredClone(officialRows);
  wrongRatio[2][1] = '0.05元';
  assert.equal(parsePricing(html(wrongRatio)), undefined);
});

test('reads Search and Fetch prices independently', () => {
  const split = [
    ['Search', '每 1,000 次成功请求', '5元'],
    ['Fetch', '每 1,000 次成功请求', '3元'],
  ];
  assert.deepEqual(parsePricing(html([...officialRows, ...split])).toolPrices, {
    search: 0.005,
    fetch: 0.003,
  });
});

test('uses a single tool price for the missing tool', () => {
  const parsed = parsePricing(html([...officialRows, ['Search', '每 1,000 次成功请求', '5元']]));
  assert.deepEqual(parsed.toolPrices, { search: 0.005, fetch: 0.005 });
});

test('reports no tool prices when the page omits the rows', () => {
  const parsed = parsePricing(html(officialRows));
  assert.equal(parsed.toolPrices, undefined);
});

test('retries quickly until the first success and after a failed refresh', () => {
  assert.equal(pricingTtl({ at: 0, error: undefined }), PRICING_RETRY_MS);
  assert.equal(pricingTtl({ at: 1, error: undefined }), PRICING_TTL_MS);
  assert.equal(pricingTtl({ at: 1, error: 'network' }), PRICING_RETRY_MS);
  assert.equal(pricingTtl({ at: 0, error: 'parse' }), PRICING_RETRY_MS);
});
