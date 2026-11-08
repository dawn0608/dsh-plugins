import assert from 'node:assert/strict';
import test from 'node:test';
import {
  foldCost,
  isPeak,
  resolveModel,
  searchUnits,
} from '../src/cost.js';

const table = {
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
const toolPrices = { search: 0.005, fetch: 0.005 };
const OFFPEAK = Date.parse('2026-11-05T20:00:00+08:00');
const PEAK = Date.parse('2026-11-05T09:30:00+08:00');

function usage(overrides = {}) {
  return {
    inputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 0,
    outputTokens: 1_000_000,
    ...overrides,
  };
}

function message(model, tokens, time = OFFPEAK) {
  return {
    type: 'assistant/message',
    time,
    data: {
      message: { source: { provider: 'deepseek-official', model } },
      usage: tokens,
    },
  };
}

function header(model, time = OFFPEAK) {
  return {
    type: 'request/header',
    time,
    data: { header: { config: { provider: 'deepseek-official', model } } },
  };
}

function toolCall(callId, name, args) {
  return { type: 'tool/call', time: OFFPEAK, data: { callId, name, arguments: args } };
}

function toolResult(callId, error) {
  return {
    type: 'tool/result',
    time: OFFPEAK,
    data: { message: { toolCallId: callId }, ...(error === undefined ? {} : { error }) },
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('prices Flash off-peak and peak with the official buckets', () => {
  const off = foldCost([message('deepseek-flash', usage())], table, toolPrices);
  close(off.total, 5.02);
  assert.equal(off.calls, 1);
  assert.equal(off.models.length, 1);
  assert.equal(off.models[0].key, 'deepseek-flash');
  close(off.models[0].offpeakCost, 5.02);
  close(off.models[0].peakCost, 0);

  const peak = foldCost([message('deepseek-flash', usage(), PEAK)], table, toolPrices);
  close(peak.total, 10.04);
  assert.equal(peak.calls, 1);
  close(peak.models[0].peakCost, 10.04);
  close(peak.models[0].offpeakCost, 0);
});

test('prices Pro with its own table', () => {
  const off = foldCost([message('deepseek-v4-pro', usage())], table, toolPrices);
  close(off.total, 18.15);
  assert.equal(off.models[0].key, 'deepseek-v4-pro');
  close(off.models[0].offpeakCost, 18.15);

  const peak = foldCost([message('deepseek-v4-pro', usage(), PEAK)], table, toolPrices);
  close(peak.total, 36.3);
});

test('charges cacheWrite at the cache-miss rate', () => {
  const result = foldCost([
    message('deepseek-flash', usage({ cacheWriteTokens: 1_000_000 })),
  ], table, toolPrices);
  close(result.total, 6.02);
  assert.equal(result.models[0].tokens.cacheWrite, 1_000_000);
});

test('groups multiple models and counts every call', () => {
  const result = foldCost([
    message('deepseek-flash', usage()),
    message('deepseek-v4-pro', usage()),
    message('deepseek-flash', usage({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 })),
  ], table, toolPrices);
  assert.equal(result.calls, 3);
  assert.equal(result.models.length, 2);
  close(result.total, 5.02 + 18.15);
  assert.equal(result.models[0].key, 'deepseek-flash');
  assert.equal(result.models[1].key, 'deepseek-v4-pro');
});

test('bills a retired attempt from its recorded stream', () => {
  const result = foldCost([
    header('deepseek-flash'),
    {
      type: 'assistant/attempt',
      time: PEAK,
      data: {
        turn: 1,
        step: 1,
        stream: [
          { type: 'chunk', chunk: { type: 'usage', usage: usage({ outputTokens: 0 }) } },
          { type: 'chunk', chunk: { type: 'usage', usage: usage() } },
        ],
      },
    },
  ], table, toolPrices);
  assert.equal(result.calls, 1);
  close(result.total, 10.04);
});

test('bills compaction summaries with their own model and usage', () => {
  const result = foldCost([{
    type: 'compaction/summary',
    time: OFFPEAK,
    data: { model: 'deepseek-v4-pro', usage: usage() },
  }], table, toolPrices);
  assert.equal(result.calls, 1);
  close(result.total, 18.15);
  assert.equal(result.models[0].key, 'deepseek-v4-pro');
});

test('falls back to the request header when a settled message has no model', () => {
  const result = foldCost([
    header('deepseek-v4-pro'),
    {
      type: 'assistant/message',
      time: OFFPEAK,
      data: {
        message: { source: { provider: 'deepseek-official' } },
        usage: usage(),
      },
    },
  ], table, toolPrices);
  close(result.total, 18.15);
  assert.equal(result.models[0].key, 'deepseek-v4-pro');
});

test('keeps an unknown model id and prices it with the Flash table', () => {
  const result = foldCost([message('gpt-4o-pro', usage())], table, toolPrices);
  close(result.total, 5.02);
  assert.deepEqual(result.unknownModels, ['gpt-4o-pro']);
  assert.equal(result.models[0].key, 'gpt-4o-pro');
  assert.equal(result.models[0].label, 'gpt-4o-pro');
});

test('counts one Search request per unique query', () => {
  const result = foldCost([
    toolCall('s1', 'web_search', '{"queries":["a","a","b"]}'),
    toolResult('s1'),
  ], table, toolPrices);
  assert.equal(result.toolRequests, 2);
  close(result.toolCost, 0.01);
  close(result.total, 0.01);
});

test('counts a web_fetch as one request', () => {
  const result = foldCost([
    toolCall('f1', 'web_fetch', '{"url":"https://example.com"}'),
    toolResult('f1'),
  ], table, toolPrices);
  assert.equal(result.toolRequests, 1);
  close(result.toolCost, 0.005);
});

test('does not bill a failed or unpaired web tool call', () => {
  assert.equal(foldCost([
    toolCall('s1', 'web_search', '{"queries":["a"]}'),
    toolResult('s1', { name: 'SearchError', code: 'SEARCH_FAILED' }),
  ], table, toolPrices).toolRequests, 0);

  assert.equal(foldCost([
    toolCall('s2', 'web_search', '{"queries":["a"]}'),
  ], table, toolPrices).toolRequests, 0);

  assert.equal(foldCost([
    toolResult('missing'),
  ], table, toolPrices).toolRequests, 0);
});

test('uses independent Search and Fetch prices', () => {
  const result = foldCost([
    toolCall('s1', 'web_search', '{"queries":["a"]}'),
    toolResult('s1'),
    toolCall('f1', 'web_fetch', '{"url":"https://example.com"}'),
    toolResult('f1'),
  ], table, { search: 0.005, fetch: 0.002 });
  assert.equal(result.toolRequests, 2);
  close(result.toolCost, 0.007);
});

test('ignores events without provider usage', () => {
  const result = foldCost([
    message('deepseek-flash', undefined),
    { type: 'assistant/message', time: OFFPEAK, data: { message: {} } },
  ], table, toolPrices);
  assert.equal(result.calls, 0);
  assert.equal(result.total, 0);
  assert.deepEqual(result.models, []);
});

test('resolves DeepSeek ids and leaves foreign ids unknown', () => {
  assert.equal(resolveModel('deepseek-flash', table).key, 'deepseek-flash');
  assert.equal(resolveModel('deepseek-v4-pro', table).key, 'deepseek-v4-pro');
  assert.equal(resolveModel('deepseek-chat', table).key, 'deepseek-flash');
  assert.equal(resolveModel('deepseek-reasoner', table).key, 'deepseek-flash');
  assert.equal(resolveModel('deepseek/deepseek-flash', table).key, 'deepseek-flash');
  assert.equal(resolveModel('deepseek-v4-pro-0813', table).key, 'deepseek-v4-pro');

  const custom = resolveModel('gpt-4o-pro', table);
  assert.equal(custom.key, 'gpt-4o-pro');
  assert.equal(custom.label, 'gpt-4o-pro');
  assert.equal(custom.unknown, true);
  assert.equal(resolveModel('deepseek-coder', table).unknown, true);
  assert.equal(resolveModel('', table).key, 'unknown');
  assert.equal(resolveModel('', table).label, '');
});

test('detects the Beijing peak windows and weekends', () => {
  assert.equal(isPeak(PEAK), true);
  assert.equal(isPeak(OFFPEAK), false);
  assert.equal(isPeak(Date.parse('2026-11-05T09:00:00+08:00')), true);
  assert.equal(isPeak(Date.parse('2026-11-05T08:59:00+08:00')), false);
  assert.equal(isPeak(Date.parse('2026-11-05T11:59:00+08:00')), true);
  assert.equal(isPeak(Date.parse('2026-11-05T12:00:00+08:00')), false);
  assert.equal(isPeak(Date.parse('2026-11-05T13:59:00+08:00')), false);
  assert.equal(isPeak(Date.parse('2026-11-05T14:00:00+08:00')), true);
  assert.equal(isPeak(Date.parse('2026-11-05T17:59:00+08:00')), true);
  assert.equal(isPeak(Date.parse('2026-11-05T18:00:00+08:00')), false);
  assert.equal(isPeak(Date.parse('2026-11-07T09:30:00+08:00')), false);
});

test('searchUnits mirrors the web tool validation and dedupe', () => {
  assert.equal(searchUnits('web_search', '{"queries":["a","a"]}'), 1);
  assert.equal(searchUnits('web_search', '{"queries":["a","b"]}'), 2);
  assert.equal(searchUnits('web_search', '{"queries":[]}'), 1);
  assert.equal(searchUnits('web_search', 'not json'), 1);
  assert.equal(searchUnits('web_fetch', '{"url":"https://example.com"}'), 1);
});

test('does not bill web tools marked as failed on the durable result message', () => {
  const result = foldCost([
    toolCall('search', 'web_search', '{"queries":["a","b"]}'),
    {
      type: 'tool/result',
      time: OFFPEAK,
      data: { message: { toolCallId: 'search', isError: true } },
    },
    toolCall('fetch', 'web_fetch', '{"url":"https://example.com"}'),
    {
      type: 'tool/result',
      time: OFFPEAK,
      data: { message: { toolCallId: 'fetch', isError: false } },
    },
  ], table, toolPrices);
  assert.equal(result.toolRequests, 1);
  close(result.toolCost, 0.005);
});
