import assert from 'node:assert/strict';
import test from 'node:test';
import { watchRefresh } from '../../src/client/refresh.js';

test('foreground polling refreshes immediately, pauses when hidden and disposes its listener and timer', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const interval of [15000, 300000]) {
    let count = 0;
    const doc = new EventTarget();
    doc.visibilityState = 'visible';
    const stop = watchRefresh(() => count++, interval, doc);
    assert.equal(count, 1);
    t.mock.timers.tick(interval - 1);
    assert.equal(count, 1);
    t.mock.timers.tick(1);
    assert.equal(count, 2);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    t.mock.timers.tick(interval * 10);
    assert.equal(count, 2);
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(count, 3);
    stop();
    doc.dispatchEvent(new Event('visibilitychange'));
    t.mock.timers.tick(interval * 10);
    assert.equal(count, 3);
  }
});
