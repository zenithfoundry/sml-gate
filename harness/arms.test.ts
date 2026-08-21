import { describe, expect, it } from '@jest/globals';
import { deriveArms, GradedResult } from './arms.js';

describe('arms derivation', () => {
  it('correctly derives arms from mocked data', () => {
    // 4 tasks:
    // T1: SLM right, API right, armB defer (right)
    // T2: SLM wrong, API right, armB escalate (right)
    // T3: SLM wrong, API right, armB defer (wrong)
    // T4: SLM right, API wrong, armB escalate (wrong)
    const results: GradedResult[] = [
      { taskId: '1', route: 'defer_local', slmCorrect: true, apiCorrect: true, armBCorrect: true, armBRoute: 'defer_local', armBCost: 0, apiCost: 10, armBInTokens: 0, armBOutTokens: 0, apiInTokens: 0, apiOutTokens: 0 },
      { taskId: '2', route: 'escalate', slmCorrect: false, apiCorrect: true, armBCorrect: true, armBRoute: 'escalate', armBCost: 10, apiCost: 10, armBInTokens: 0, armBOutTokens: 0, apiInTokens: 0, apiOutTokens: 0 },
      { taskId: '3', route: 'defer_local', slmCorrect: false, apiCorrect: true, armBCorrect: false, armBRoute: 'defer_local', armBCost: 0, apiCost: 10, armBInTokens: 0, armBOutTokens: 0, apiInTokens: 0, apiOutTokens: 0 },
      { taskId: '4', route: 'escalate', slmCorrect: true, apiCorrect: false, armBCorrect: false, armBRoute: 'escalate', armBCost: 10, apiCost: 10, armBInTokens: 0, armBOutTokens: 0, apiInTokens: 0, apiOutTokens: 0 }
    ];

    const arms = deriveArms(results);

    // all_slm: 2/4 = 0.5
    expect(arms.allSlm.accuracy).toBe(0.5);
    expect(arms.allSlm.cost).toBe(0);

    // armA: 3/4 = 0.75
    expect(arms.armA.accuracy).toBe(0.75);
    expect(arms.armA.cost).toBe(40);

    // armB: 2/4 correct (T1, T2), 2 escalated (T2, T4) => rate 0.5, cost 20
    expect(arms.armB.accuracy).toBe(0.5);
    expect(arms.armB.routingRate).toBe(0.5);
    expect(arms.armB.cost).toBe(20);

    // Random at f=0.5: 0.5 * 0.5 + 0.5 * 0.75 = 0.25 + 0.375 = 0.625
    expect(arms.randomAtF(0.5)).toBe(0.625);

    // Oracle at f=0.5: Escalate the 2 SLM-wrong tasks (T2, T3) -> both API right.
    // Total right: T2(api=1), T3(api=1), T1(slm=1), T4(slm=1) => 4/4 = 1.0
    expect(arms.oracleAtF(0.5)).toBe(1.0);

    // Oracle should always be >= random
    for (let f = 0; f <= 1; f += 0.1) {
      expect(arms.oracleAtF(f)).toBeGreaterThanOrEqual(arms.randomAtF(f));
      expect(arms.randomAtF(f)).toBeGreaterThanOrEqual(arms.allSlm.accuracy - 0.001); // within float tol if armA >= slm
    }
  });
});
