// Per-case validated parameter limits of the nose engine (same as the editor's scan), printed as JSON.
//   node tools/case_limits.mjs <caseDir>
import fs from 'node:fs';
import path from 'node:path';
import * as E from '../engine/nose-engine.mjs';
import { parseEditable } from '../engine/model-loader.mjs';
import { calibratedBridgeLimits } from '../engine/nose-profile-limits.mjs';
const dir = path.join(process.argv[2], 'avatar');
const json = JSON.parse(fs.readFileSync(path.join(dir, 'editable.json'), 'utf8'));
const b = fs.readFileSync(path.join(dir, 'editable.bin'));
const d = parseEditable(json, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const ed = E.createEditor(d.model, d.positions, d.normals, d.index);
const limits = { ...ed.caseLimits, dorsum_height: calibratedBridgeLimits(d, ed.rig, ed.caseLimits.dorsum_height) };
console.log(JSON.stringify({ engine: E.ENGINE_VERSION, limits }));
