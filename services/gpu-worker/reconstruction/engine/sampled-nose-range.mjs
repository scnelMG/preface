import { POC_MORPH_KEYS } from './effect-codes.mjs';

// Diagnostic envelope only. Every requested combined state still needs a final GLB check.
export function sampledNoseRanges(check, steps = 10, codes = Object.keys(POC_MORPH_KEYS)) {
  if (!Number.isInteger(steps) || steps < 1) throw Error('invalid sample count');
  if (!check({}).valid) throw Error('invalid neutral model');
  const ranges = {};
  const firstFailures = {};
  for (const code of codes) {
    if (!Object.hasOwn(POC_MORPH_KEYS, code)) throw Error('unknown nose effect');
    const sides = [-1, 1].map((sign, side) => {
      let last = 0;
      for (let i = 1; i <= steps; i++) {
        const weight = sign * i / steps;
        let result;
        try {
          result = check({ [code]: weight });
        } catch (error) {
          if (!['unsupported edit weight', 'unsupported edit direction'].includes(error.message)) throw error;
          result = { valid: false, reason: error.message };
        }
        if (result.valid !== true) {
          (firstFailures[code] ??= [null, null])[side] = { weight, ...result };
          break;
        }
        last = i / steps;
      }
      return sign * last;
    });
    if (sides[0] !== 0 || sides[1] !== 0) ranges[code] = sides;
  }
  return { ranges, firstFailures };
}
