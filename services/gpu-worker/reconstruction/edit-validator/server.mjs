import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const authenticated = (value, secret) => {
  if (typeof value !== 'string') return false;
  const expected = Buffer.from(secret), supplied = Buffer.from(value);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};

const respond = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

/** The checker itself could not answer (worker failed to start or crashed, timed out). Callers may retry; 503. */
export class CheckUnavailable extends Error {}

const runCheck = (input, allowedHost) => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { input, allowedHost } });
  let finished = false;
  const finish = async (error, result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try {
      await worker.terminate(); // Keep the slot occupied until the old mesh check has stopped.
    } catch {
      process.exit(1); // Unknown worker state: restart rather than admit another edit check.
      return;
    }
    if (error) reject(error);
    else resolve(result);
  };
  const timer = setTimeout(() => void finish(new CheckUnavailable('edit check timeout')), 45000);
  // The worker reports its own validation failures as { error: true }: that is the input's fault (422).
  // A worker that cannot load or dies is the checker's fault (503), e.g. a module missing from the image.
  worker.once('message', (message) => void finish(message.error ? Error('edit check failed') : null, message.result));
  worker.once('error', () => void finish(new CheckUnavailable('edit worker error')));
  worker.once('exit', (code) => void finish(new CheckUnavailable(`edit worker exited: ${code}`)));
});

/**
 * One expensive mesh check at a time (CPU-bound; the EC2 host is shared with api and DB). Later requests wait in
 * arrival order instead of being refused, so one generation's 11 checks and user edits take turns
 * (S15P31B204-592). A request that cannot get the slot within waitMs, or arrives while maxWaiting are already
 * waiting, gets 503 EDIT_VALIDATOR_BUSY.
 */
function checkSlot(waitMs, maxWaiting) {
  let busy = false;
  const waiting = [];
  const acquire = () => new Promise((resolve) => {
    if (!busy) { busy = true; return resolve(true); }
    if (waiting.length >= maxWaiting) return resolve(false);
    const entry = { resolve, timer: null };
    entry.timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(entry), 1);
      resolve(false);
    }, waitMs);
    waiting.push(entry);
  });
  const release = () => {
    const next = waiting.shift();
    if (!next) { busy = false; return; }
    clearTimeout(next.timer);
    next.resolve(true); // The slot passes straight to the next request and stays busy.
  };
  return { acquire, release };
}

const envInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
};

export function createValidatorServer(secret, allowedHost, check = runCheck, {
  queueWaitMs = envInt('EDIT_VALIDATOR_QUEUE_WAIT_MS', 30000),
  queueMax = envInt('EDIT_VALIDATOR_QUEUE_MAX', 16),
} = {}) {
  if (!secret || !allowedHost) throw Error('edit validator secret and asset host required');
  const slot = checkSlot(queueWaitMs, queueMax);
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { status: 'ok' });
    if (req.method !== 'POST' || !['/internal/ai/v1/morph', '/internal/ai/v1/eye', '/internal/ai/v1/composite'].includes(req.url)) return respond(res, 404, { error: 'NOT_FOUND' });
    if (!authenticated(req.headers['x-internal-secret'], secret)) return respond(res, 401, { error: 'UNAUTHORIZED' });
    const started = performance.now();
    let input, waited = 0;
    try {
      // Read the small body before waiting so the wait does not count against server.requestTimeout.
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16 * 1024) throw Error('request too large');
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      input.kind = req.url === '/internal/ai/v1/eye' ? 'eye' : req.url === '/internal/ai/v1/composite' ? 'composite' : 'nose';
    } catch {
      return respond(res, 422, { error: 'EDIT_VALIDATION_FAILED' });
    }
    if (!(await slot.acquire())) {
      console.info('edit_validator busy waitMs=%d', Math.round(performance.now() - started));
      return respond(res, 503, { error: 'EDIT_VALIDATOR_BUSY' });
    }
    waited = performance.now() - started;
    try {
      const result = await check(input, allowedHost);
      return respond(res, 200, result);
    } catch (error) {
      // Never include presigned URLs, face data, or internal parser errors in responses or logs.
      if (error instanceof CheckUnavailable) return respond(res, 503, { error: 'EDIT_VALIDATOR_UNAVAILABLE' });
      return respond(res, 422, { error: 'EDIT_VALIDATION_FAILED' });
    } finally {
      slot.release();
      console.info('edit_validator durationMs=%d waitMs=%d', Math.round(performance.now() - started), Math.round(waited));
    }
  });
  server.requestTimeout = 5000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  createValidatorServer(process.env.EDIT_VALIDATOR_SECRET, process.env.EDIT_ASSET_HOST)
    .listen(3001, '0.0.0.0');
}
