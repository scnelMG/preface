import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CheckUnavailable, createValidatorServer } from './server.mjs';

const listen = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = (server) => new Promise((resolve) => server.close(resolve));
const post = (base, body = '{}') => fetch(`${base}/internal/ai/v1/morph`, {
  method: 'POST', headers: { 'x-internal-secret': 'synthetic-secret' }, body,
});

test('형상 검사 중에도 헬스에 응답하고 두 번째 편집은 거절하지 않고 차례를 기다린다', async () => {
  let started, release;
  const running = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const server = createValidatorServer('synthetic-secret', 'example.invalid', async (input) => {
    order.push(input.n);
    if (input.n === 1) { started(); await gate; }
    return { valid: true };
  });
  const base = await listen(server);
  try {
    assert.equal((await fetch(`${base}/internal/ai/v1/morph`, { method: 'POST' })).status, 401);
    const first = post(base, '{"n":1}');
    await running;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const second = post(base, '{"n":2}');
    const third = post(base, '{"n":3}');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(order, [1]);
    release();
    assert.deepEqual([(await first).status, (await second).status, (await third).status], [200, 200, 200]);
    assert.deepEqual(order, [1, 2, 3]);
  } finally {
    release();
    await close(server);
  }
});

test('기다리는 요청이 가득 찼거나 차례가 너무 늦으면 503 BUSY를 주고 슬롯은 그대로 돈다', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const server = createValidatorServer('synthetic-secret', 'example.invalid', async () => {
    calls += 1;
    if (calls === 1) await gate;
    return { valid: true };
  }, { queueWaitMs: 100, queueMax: 1 });
  const base = await listen(server);
  try {
    const first = post(base);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const late = post(base); // waits 100 ms, then gives up
    await new Promise((resolve) => setTimeout(resolve, 20));
    const full = await post(base); // one already waiting
    assert.equal(full.status, 503);
    assert.deepEqual(await full.json(), { error: 'EDIT_VALIDATOR_BUSY' });
    assert.equal((await late).status, 503);
    release();
    assert.equal((await first).status, 200);
    assert.equal((await post(base)).status, 200);
    assert.equal(calls, 2);
  } finally {
    release();
    await close(server);
  }
});

test('검사기 자체가 답하지 못하면 503 UNAVAILABLE, 입력 검사 실패면 422로 나눈다', async () => {
  const server = createValidatorServer('synthetic-secret', 'example.invalid', async (input) => {
    if (input.fail === 'checker') throw new CheckUnavailable('edit worker error');
    throw Error('asset checksum mismatch');
  });
  const base = await listen(server);
  try {
    const down = await post(base, '{"fail":"checker"}');
    assert.equal(down.status, 503);
    assert.deepEqual(await down.json(), { error: 'EDIT_VALIDATOR_UNAVAILABLE' });
    const invalid = await post(base, '{"fail":"input"}');
    assert.equal(invalid.status, 422);
    assert.deepEqual(await invalid.json(), { error: 'EDIT_VALIDATION_FAILED' });
    assert.equal((await post(base, 'not json')).status, 422);
  } finally {
    await close(server);
  }
});

test('눈·코·복합 경로를 각각의 검사로 고정한다', async () => {
  const kinds = [];
  const server = createValidatorServer('synthetic-secret', 'example.invalid', async (input) => {
    kinds.push(input.kind);
    return { valid: true };
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['morph', 'eye', 'composite']) {
      const response = await fetch(`${base}/internal/ai/v1/${route}`, {
        method: 'POST', headers: { 'x-internal-secret': 'synthetic-secret' },
        body: JSON.stringify({ kind: route === 'eye' ? 'nose' : 'eye' }),
      });
      assert.equal(response.status, 200);
    }
    assert.deepEqual(kinds, ['nose', 'eye', 'composite']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
