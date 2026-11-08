import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBase, numeric, walletsOf } from '../src/balance.js';

const fallback = 'https://api.deepseek.com';

test('normalizes every protocol suffix combination', () => {
  assert.equal(normalizeBase(undefined, fallback), fallback);
  assert.equal(normalizeBase('', fallback), fallback);
  assert.equal(normalizeBase('https://api.deepseek.com/anthropic', fallback), fallback);
  assert.equal(normalizeBase('https://api.deepseek.com/anthropic/', fallback), fallback);
  assert.equal(normalizeBase('https://api.deepseek.com/anthropic/v1', fallback), fallback);
  assert.equal(normalizeBase('https://api.deepseek.com/v1/anthropic', fallback), fallback);
  assert.equal(normalizeBase('https://api.deepseek.com/v1/', fallback), fallback);
  assert.equal(normalizeBase('https://gateway.example.com/deepseek/v1', fallback), 'https://gateway.example.com/deepseek');
});

test('normalizes the balance wallets', () => {
  assert.deepEqual(walletsOf({
    is_available: true,
    balance_infos: [{
      currency: 'CNY',
      total_balance: '1.23',
      granted_balance: '0.23',
      topped_up_balance: '1.00',
    }],
  }), [{ currency: 'CNY', total: 1.23, toppedUp: 1, granted: 0.23 }]);

  assert.deepEqual(walletsOf({
    balance_infos: [{
      total_balance: '0.00',
      granted_balance: '0.00',
      top_up_balance: '0.00',
    }],
  }), [{ currency: 'CNY', total: 0, toppedUp: 0, granted: 0 }]);
});

test('handles an absent or malformed balance response', () => {
  assert.deepEqual(walletsOf(null), []);
  assert.deepEqual(walletsOf({}), []);
  assert.deepEqual(walletsOf({ balance_infos: 'nope' }), []);
});

test('numeric parses decimal strings and rejects junk', () => {
  assert.equal(numeric('1.5'), 1.5);
  assert.equal(numeric(2), 2);
  assert.equal(numeric('nope'), 0);
  assert.equal(numeric(undefined), 0);
  assert.equal(numeric(Infinity), 0);
});
