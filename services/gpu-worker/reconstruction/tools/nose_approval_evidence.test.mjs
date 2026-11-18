import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessNoseApproval } from './nose_approval_evidence.mjs';

test('단독 표본 통과만으로 승인하지 않고 복합 끝값 실패를 드러낸다', () => {
  const evidence = assessNoseApproval((weights) => {
    if (Object.keys(weights).some((code) => !['nose.bridge_height', 'nose.tip_projection'].includes(code))) {
      throw Error('unsupported edit weight');
    }
    return { valid: !(
      (weights['nose.bridge_height'] ?? 0) > 0.5 &&
      (weights['nose.tip_projection'] ?? 0) > 0.5
    ) };
  });
  assert.deepEqual(evidence.candidateRanges, {
    'nose.bridge_height': [-1, 1],
    'nose.tip_projection': [-1, 1],
  });
  assert.deepEqual(evidence.pairwiseFailures, [{
    weights: { 'nose.bridge_height': 1, 'nose.tip_projection': 1 },
    reason: 'unsafe final mesh',
  }]);
  assert.equal(evidence.approvedForService, false);
  assert.equal(evidence.visualAndNonTargetReviewRequired, true);
});

test('두 효과가 각각 안전해도 세 효과 복합 실패를 기록한다', () => {
  const codes = ['nose.bridge_height', 'nose.tip_projection', 'nose.tip_height'];
  const evidence = assessNoseApproval((weights) => {
    if (Object.keys(weights).some((code) => !codes.includes(code))) throw Error('unsupported edit weight');
    return { valid: Object.values(weights).filter((value) => value > 0).length < 3 };
  });
  assert.equal(evidence.pairwiseFailures.length, 0);
  assert.deepEqual(evidence.combinedFailures, [{
    weights: Object.fromEntries(codes.map((code) => [code, 1])),
    reason: 'unsafe final mesh',
  }]);
});
