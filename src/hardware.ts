import os from 'node:os';
import { execSync } from 'node:child_process';

export interface HardwareInfo {
  totalRamGB: number;
  arch: string;
  platform: string;
  isAppleSilicon: boolean;
  accelerator: 'metal' | 'cuda' | 'cpu';
  unifiedMemory: boolean;
}

export function detectHardware(mockOs?: { totalmem: () => number; arch: () => string; platform: () => string }): HardwareInfo {
  const osModule = mockOs || os;
  const totalRamGB = Math.round(osModule.totalmem() / (1024 * 1024 * 1024));
  const arch = osModule.arch();
  const platform = osModule.platform();
  const isAppleSilicon = platform === 'darwin' && arch === 'arm64';
  
  let accelerator: 'metal' | 'cuda' | 'cpu' = 'cpu';
  if (isAppleSilicon) {
    accelerator = 'metal';
  } else {
    try {
      execSync('nvidia-smi', { stdio: 'ignore' });
      accelerator = 'cuda';
    } catch {
      // ignore
    }
  }

  const unifiedMemory = isAppleSilicon;

  return { totalRamGB, arch, platform, isAppleSilicon, accelerator, unifiedMemory };
}

export function recommendPreset(totalRamGB: number): string {
  if (totalRamGB >= 32) return 'ram-32';
  if (totalRamGB >= 24) return 'ram-24';
  if (totalRamGB >= 16) return 'ram-16';
  if (totalRamGB >= 12) return 'ram-12';
  if (totalRamGB >= 8) return 'ram-8';
  return 'ram-4';
}

export function recommendNumCtx(totalRamGB: number, dualModel: boolean = true): number {
  if (totalRamGB >= 24) return 8192;
  if (totalRamGB >= 16) return 4096;
  if (totalRamGB >= 8) return 2048;
  return 1024;
}

export const ramPresets: Record<string, { brain: string, gate: string }> = {
  'ram-4': { brain: 'qwen3.5:1.5b', gate: 'qwen3.5:0.5b' },
  'ram-8': { brain: 'qwen3.5:3b', gate: 'qwen3.5:0.5b' },
  'ram-12': { brain: 'qwen3:7b', gate: 'qwen3:1.7b' },
  'ram-16': { brain: 'qwen3:7b', gate: 'qwen3:1.7b' },
  'ram-24': { brain: 'qwen3:14b', gate: 'qwen3:1.7b' },
  'ram-32': { brain: 'qwen3:14b', gate: 'qwen3:1.7b' },
  'custom': { brain: 'qwen3:14b', gate: 'qwen3:1.7b' },
};

export function getPresetRank(preset: string): number {
  const match = preset.match(/^ram-(\d+)$/);
  if (match) return parseInt(match[1], 10);
  return 24; // custom defaults to 14b which is ram-24 level
}
