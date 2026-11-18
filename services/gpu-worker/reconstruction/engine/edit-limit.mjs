export const RELATIVE_EDIT_LEVELS = Object.freeze([0.1, 0.25, 0.5, 0.75, 1]);

/** Probe a single direction from neutral, stopping at the first failed sample. */
export function scanEditLimit(levels, check, start = 0) {
  let accepted = start;
  for (const level of levels) {
    const result = check(level);
    if (!result.valid) return { accepted, failedAt: level, reason: result.reason ?? null };
    accepted = level;
  }
  return { accepted, failedAt: null, reason: null };
}
