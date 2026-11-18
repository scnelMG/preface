import { parentPort, workerData } from 'node:worker_threads';
import { validateEdit, fetchSignedAsset } from './validate.mjs';
import { checkNoseEdit } from '../engine/glb-nose.mjs';
import { validateEyeEdit } from './validate-eye.mjs';
import { validateCompositeEdit } from './validate-composite.mjs';

const { input, allowedHost } = workerData;
const started = performance.now();
const timing = { mesh: 0, rig: 0, check: 0 };
let message;
try {
  const result = input.kind === 'composite' ? await validateCompositeEdit(input, async (url) => {
    const start = performance.now();
    try { return await fetchSignedAsset(url, allowedHost,
      url === input.meshUrl ? 200 * 1024 * 1024 : 32 * 1024 * 1024); }
    finally { timing[url === input.meshUrl ? 'mesh' : 'rig'] += performance.now() - start; }
  }) : input.kind === 'eye' ? await validateEyeEdit(input, async (url) => {
    const start = performance.now();
    try { return await fetchSignedAsset(url, allowedHost,
      url === input.meshUrl ? 200 * 1024 * 1024 : 32 * 1024 * 1024); }
    finally { timing[url === input.meshUrl ? 'mesh' : 'rig'] += performance.now() - start; }
  }) : await validateEdit(input, async (url) => {
    const start = performance.now();
    try {
      return await fetchSignedAsset(url, allowedHost,
        url === input.meshUrl ? 200 * 1024 * 1024 : 32 * 1024 * 1024);
    } finally {
      timing[url === input.meshUrl ? 'mesh' : 'rig'] += performance.now() - start;
    }
  }, (...args) => {
    const start = performance.now();
    try { return checkNoseEdit(...args); }
    finally { timing.check += performance.now() - start; }
  });
  message = { result };
} catch {
  message = { error: true };
} finally {
  console.info('edit_validator stageMs mesh=%d rig=%d check=%d total=%d',
    Math.round(timing.mesh), Math.round(timing.rig), Math.round(timing.check), Math.round(performance.now() - started));
}
parentPort.postMessage(message);
