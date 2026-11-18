import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const context = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = path.join(context, 'edit-validator', 'Dockerfile');

function stageImage(root) {
  const copies = fs.readFileSync(dockerfile, 'utf8').split(/\r?\n/)
    .map((line) => /^COPY\s+(\S+)\s+(\S+)$/.exec(line)).filter(Boolean);
  assert.ok(copies.length > 0, 'no Dockerfile COPY instructions');
  for (const [, source, target] of copies) {
    const from = path.resolve(context, source);
    const destination = path.resolve(root, target);
    const to = source.endsWith('/') ? destination
      : target.endsWith('/') ? path.join(destination, path.basename(source)) : destination;
    assert.ok(from.startsWith(context + path.sep), 'COPY source outside build context');
    assert.ok(to.startsWith(root + path.sep), 'COPY target outside image root');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
}

function startWorker(filename, kind) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(filename, { workerData: { input: { kind }, allowedHost: 'synthetic.invalid' } });
    let received;
    worker.once('message', (message) => { received = message; });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code === 0 && received !== undefined) resolve(received);
      else reject(Error(`worker exited ${code} without a response`));
    });
  });
}

test('Dockerfile 복사 목록으로 만든 이미지에서 코·눈 worker가 모듈을 읽고 요청을 처리한다', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preface-validator-image-'));
  try {
    stageImage(root);
    const worker = path.join(root, 'edit-validator', 'worker.mjs');
    for (const kind of ['nose', 'eye']) {
      const response = await startWorker(worker, kind);
      assert.deepEqual(response, { error: true }); // 합성 빈 요청은 검사 단계에서 거절한다.
    }
  } finally {
    const temp = fs.realpathSync(os.tmpdir());
    assert.ok(fs.realpathSync(root).startsWith(temp + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
