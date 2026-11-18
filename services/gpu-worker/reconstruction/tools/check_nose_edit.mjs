// Check one complete nose-only state against the final skin GLB. Exit 0 only for a valid edit.
// Usage: node tools/check_nose_edit.mjs <model-dir> '<weights-json>'
import fs from 'node:fs';
import path from 'node:path';
import { checkNoseEdit } from '../engine/glb-nose.mjs';

const dir = process.argv[2];
if (!dir || !process.argv[3]) throw Error('model directory and weights JSON required');
const weights = JSON.parse(process.argv[3]);
const result = checkNoseEdit(
  fs.readFileSync(path.join(dir, 'head.glb')),
  JSON.parse(fs.readFileSync(path.join(dir, 'rig.json'), 'utf8')),
  weights,
);
console.log(JSON.stringify(result));
if (!result.valid) process.exitCode = 1;
