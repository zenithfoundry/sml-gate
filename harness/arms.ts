import { LedgerEvent } from '../src/ledger/index.js';


/**
 * Represents the evaluation outcome for a single task across different execution paths.
 */
export interface GradedResult {
  /** The unique identifier of the benchmarked task */
  taskId: string;
  /** The route that was actually taken (remnant from raw events, usually matches armBRoute) */
  route: LedgerEvent['route'];
  /** Whether the small local model (SLM) answered correctly when forced */
  slmCorrect: boolean;
  /** Whether the cloud API answered correctly when forced */
  apiCorrect: boolean;
  /** Whether the router (Arm B) answered correctly */
  armBCorrect: boolean;
  /** The specific routing decision made by the router (e.g., 'defer_local', 'escalate') */
  armBRoute: LedgerEvent['route'];
  /** The actual cost incurred by the router for this task */
  armBCost: number;
  armBInTokens: number;
  armBOutTokens: number;
  /** The cost that would have been incurred if forced to the cloud API */
  apiCost: number;
  apiInTokens: number;
  apiOutTokens: number;
}

/**
 * Aggregate performance statistics for a specific evaluation arm (strategy).
 */
export interface ArmStats {
  /** The overall accuracy (0.0 to 1.0) */
  accuracy: number;
  /** The fraction of tasks routed/escalated to the cloud API (0.0 to 1.0) */
  routingRate: number;
  /** The total cost incurred by this arm in USD */
  cost: number;
  inTokens: number;
  outTokens: number;
}

/**
 * Calculates the mathematical mean (average) of an array of numbers.
 */
export function computeMean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Creates a deterministic pseudo-random number generator (PRNG) using a 
 * basic Linear Congruential Generator (LCG) algorithm.
 * This ensures the random baseline and bootstrap sampling are perfectly reproducible.
 * 
 * @param seed The initial seed value
 * @returns A function that returns a pseudo-random float between 0 and 1
 */
export function seededRandom(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function() {
    s = s * 16807 % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Calculates the 95% confidence intervals for a given dataset using bootstrap resampling.
 * It repeatedly samples the data with replacement to estimate the distribution of the mean.
 * 
 * @param data The array of values (e.g., 1s and 0s for accuracy)
 * @param iterations The number of bootstrap samples to draw (default 1000)
 * @param seed The seed for the PRNG to ensure deterministic intervals
 * @returns A tuple containing the lower (2.5th percentile) and upper (97.5th percentile) bounds
 */
export function bootstrapCI(data: number[], iterations = 1000, seed = 42): [number, number] {
  if (data.length === 0) return [0, 0];
  const rng = seededRandom(seed);
  const means: number[] = [];
  const n = data.length;
  
  // Perform bootstrap resampling
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      sum += data[idx];
    }
    means.push(sum / n);
  }
  
  // Sort means to find percentiles
  means.sort((a, b) => a - b);
  return [means[Math.floor(iterations * 0.025)], means[Math.floor(iterations * 0.975)]];
}

/**
 * Analyzes the raw graded results to derive the performance metrics for the five distinct 
 * evaluation arms: all_slm, armA (API only), armB (router), random, and oracle.
 * 
 * @param results The array of graded task results
 * @returns An object containing the ArmStats for the main arms, curve functions for random/oracle, and Confidence Intervals.
 */
export function deriveArms(results: GradedResult[]): {
  allSlm: ArmStats,
  armA: ArmStats,
  armB: ArmStats,
  oracleAtF: (f: number) => number,
  randomAtF: (f: number) => number,
  CIs: Record<string, [number, number]>
} {
  // Convert boolean correctness to 1s and 0s for easier math
  const slmCorrect = results.map(r => r.slmCorrect ? 1 : 0);
  const apiCorrect = results.map(r => r.apiCorrect ? 1 : 0);
  const armBCorrect = results.map(r => r.armBCorrect ? 1 : 0);
  const armBCost = results.map(r => r.armBCost);
  const apiCost = results.map(r => r.apiCost);
  const armBInTokens = results.map(r => r.armBInTokens);
  const armBOutTokens = results.map(r => r.armBOutTokens);
  const apiInTokens = results.map(r => r.apiInTokens);
  const apiOutTokens = results.map(r => r.apiOutTokens);
  
  // Calculate if the router escalated the task to the cloud (1) or deferred locally (0)
  const armBEscalated = results.map(r => (r.armBRoute === 'defer_local' || r.armBRoute === 'condition') ? 0 : 1);

  // Compute baseline means
  const meanSlmAcc = computeMean(slmCorrect);
  const meanApiAcc = computeMean(apiCorrect);
  
  // Arm 1: all_slm (Forced local answers)
  const allSlm = { accuracy: meanSlmAcc, routingRate: 0, cost: 0, inTokens: 0, outTokens: 0 };
  
  // Arm 2: armA (Forced API cloud answers)
  const armA = { accuracy: meanApiAcc, routingRate: 1.0, cost: apiCost.reduce((a, b) => a + b, 0), inTokens: apiInTokens.reduce((a, b) => a + b, 0), outTokens: apiOutTokens.reduce((a, b) => a + b, 0) };
  
  // Arm 3: armB (The actual router logic)
  const armB = {
    accuracy: computeMean(armBCorrect),
    routingRate: computeMean(armBEscalated),
    cost: armBCost.reduce((a, b) => a + b, 0),
    inTokens: armBInTokens.reduce((a, b) => a + b, 0),
    outTokens: armBOutTokens.reduce((a, b) => a + b, 0)
  };

  /**
   * Arm 4: random_at_f
   * Simulates a dumb router that escalates a random fraction `f` of tasks to the cloud.
   * This forms the baseline straight line between all_slm and armA.
   */
  const randomAtF = (f: number) => (1 - f) * meanSlmAcc + f * meanApiAcc;
  
  /**
   * Arm 5: oracle_at_f
   * Simulates a perfect "cheater" router that knows exactly which tasks the SLM gets wrong 
   * and escalates those specific tasks to the API first, maximizing accuracy gains.
   */
  const n = results.length;
  // Calculate the accuracy gain for escalating each individual task
  const gains = results.map(r => (r.apiCorrect ? 1 : 0) - (r.slmCorrect ? 1 : 0));
  gains.sort((a, b) => b - a); // Sort descending (biggest gains first)
  
  const oracleAtF = (f: number) => {
    const kFloat = f * n;
    const k0 = Math.floor(kFloat); // Number of whole tasks to escalate
    const fraction = kFloat - k0; // Fractional part of a task (for smooth curve plotting)
    
    let acc = meanSlmAcc;
    // Escalate the best k0 tasks
    for (let i = 0; i < k0; i++) {
      acc += gains[i] / n;
    }
    // Add the fractional gain of the next task
    if (k0 < n) {
      acc += (gains[k0] * fraction) / n;
    }
    return acc;
  };

  // Calculate 95% Confidence Intervals for the primary arms
  const CIs = {
    allSlm: bootstrapCI(slmCorrect),
    armA: bootstrapCI(apiCorrect),
    armB: bootstrapCI(armBCorrect)
  };

  return { allSlm, armA, armB, oracleAtF, randomAtF, CIs };
}
