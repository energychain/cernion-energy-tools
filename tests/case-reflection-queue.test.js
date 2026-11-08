'use strict';

const { createReflectionQueue } = require('../src/case-reflection-queue');

test('one runs per key; the latest waiting run follows once', async () => {
  const queue = createReflectionQueue();
  const order = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = queue.schedule('k', async () => {
    order.push('first');
    await gate;
  });
  expect(queue.schedule('k', async () => order.push('second'))).toBe(first);
  queue.schedule('k', async () => order.push('third'));
  queue.schedule('other', async () => order.push('other'));
  release();
  await first;
  await queue.settled('k');
  expect(order).toEqual(['first', 'other', 'third']);
  expect(queue.isRunning('k')).toBe(false);
});

test('a failed run does not block the follow-up', async () => {
  const queue = createReflectionQueue();
  const done = [];
  const failing = queue.schedule('k', async () => {
    throw new Error('down');
  });
  queue.schedule('k', async () => done.push('next'));
  await failing.catch(() => {});
  await queue.settled('k');
  expect(done).toEqual(['next']);
});
