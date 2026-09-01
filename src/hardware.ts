import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Represents the detected hardware capabilities of the host system.
 * This information is used to make smart defaults for memory-intensive operations.
 */
export interface HardwareInfo {
  /** Total system RAM in Gigabytes */
  totalRamGB: number;
  /** CPU architecture (e.g., 'x64', 'arm64') */
  arch: string;
  /** OS platform (e.g., 'darwin', 'linux', 'win32') */
  platform: string;
  /** True if running on Apple Silicon (M1/M2/M3/M4 chips) */
  isAppleSilicon: boolean;
  /** The primary hardware accelerator available for ML workloads */
  accelerator: 'metal' | 'cuda' | 'cpu';
  /** True if the system shares RAM between CPU and GPU (e.g., Apple Silicon) */
  unifiedMemory: boolean;
}


/**
 * Detects the host machine's hardware capabilities.
 * Determines total RAM, OS platform, and available ML accelerators.
 * 
 * @param mockOs - Optional mock OS module for unit testing.
 * @returns {HardwareInfo} An object detailing the host's hardware profile.
 * 
 * @example
 * const hw = detectHardware();
 * if (hw.accelerator === 'cuda') {
 *   console.log('NVIDIA GPU detected!');
 * }
 */
export function detectHardware(mockOs?: { totalmem: () => number; arch: () => string; platform: () => string }): HardwareInfo {
  const osModule = mockOs || os;
  const totalRamGB = Math.round(osModule.totalmem() / (1024 * 1024 * 1024));
  const arch = osModule.arch();
  const platform = osModule.platform();
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
  
  let accelerator: 'metal' | 'cuda' | 'cpu' = 'cpu';
  
  // Apple Silicon inherently supports Metal
  if (isAppleSilicon) {
    accelerator = 'metal';
  } else {
    // Attempt to detect NVIDIA GPUs by running nvidia-smi
    try {
      execSync('nvidia-smi', { stdio: 'ignore' });
      accelerator = 'cuda';
    } catch {
      // Ignore errors (e.g., command not found or no GPU), fallback to 'cpu' remains
    }
  }

  // Apple Silicon uses a unified memory architecture where CPU and GPU share the same RAM pool
  const unifiedMemory = isAppleSilicon;

  return { totalRamGB, arch, platform, isAppleSilicon, accelerator, unifiedMemory };
}

/**
 * Recommends a RAM preset based on the host's total physical memory.
 * Presets are mapped to specific model sizes to prevent OOM errors.
 * 
 * @param totalRamGB - The total physical RAM in gigabytes.
 * @returns {string} The recommended RAM preset key (e.g., 'ram-16').
 * 
 * @example
 * const preset = recommendPreset(24);
 * // returns 'ram-24'
 */
export function recommendPreset(totalRamGB: number): string {
  if (totalRamGB >= 32) return 'ram-32';
  if (totalRamGB >= 24) return 'ram-24';
  if (totalRamGB >= 16) return 'ram-16';
  if (totalRamGB >= 12) return 'ram-12';
  if (totalRamGB >= 8) return 'ram-8';
  return 'ram-4';
}

/**
 * Recommends a safe context window size (NUM_CTX) based on available RAM.
 * Ensures that there is enough memory to hold KV caches for both SLM models if running in dual-model mode.
 * 
 * @param totalRamGB - The total physical RAM in gigabytes.
 * @param dualModel - Whether the system is running both a brain and a gate model concurrently (defaults to true).
 * @returns {number} The recommended NUM_CTX context length.
 * 
 * @example
 * const numCtx = recommendNumCtx(16);
 * // returns 4096
 */
export function recommendNumCtx(totalRamGB: number, dualModel: boolean = true): number {
  if (totalRamGB >= 24) return 8192;
  if (totalRamGB >= 16) return 4096;
  if (totalRamGB >= 8) return 2048;
  return 1024;
}

/**
 * Pre-defined model pairs tailored to different RAM tiers.
 * Each preset specifies a 'brain' model (for complex reasoning) and a 'gate' model (for fast routing/classification).
 */
export const ramPresets: Record<string, { brain: string, gate: string }> = {
  'ram-4':  { brain: 'qwen3.5:1.5b', gate: 'qwen2.5-coder:0.5b' },
  'ram-8':  { brain: 'qwen3.5:3b',   gate: 'qwen2.5-coder:1.5b' },
  'ram-12': { brain: 'qwen3.5:7b',   gate: 'qwen2.5-coder:1.5b' },
  'ram-16': { brain: 'qwen3.5:9b',   gate: 'qwen2.5-coder:3b' },
  'ram-24': { brain: 'qwen3:14b',    gate: 'qwen2.5-coder:7b' },
  'ram-32': { brain: 'qwen3.5:32b',  gate: 'qwen2.5-coder:7b' },
  'custom': { brain: 'qwen3.5:9b',   gate: 'qwen2.5-coder:3b' },
};

/**
 * Parses a RAM preset string to extract its numeric ranking/size in GB.
 * This is used to logically compare if a user's configured preset is too demanding for their hardware.
 * 
 * @param preset - The RAM preset string (e.g., 'ram-16' or 'custom').
 * @returns {number} The numeric equivalent of the preset in GB.
 * 
 * @example
 * const rank = getPresetRank('ram-16');
 * // returns 16
 */
export function getPresetRank(preset: string): number {
  const match = preset.match(/^ram-(\d+)$/);
  if (match) return parseInt(match[1], 10);
  
  // Custom presets default to 14b models, which typically require a ram-24 class environment
  return 24; 
}
