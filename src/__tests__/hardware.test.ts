import { detectHardware, recommendPreset, recommendNumCtx, getPresetRank, ramPresets } from '../hardware.js';

describe('hardware.ts', () => {
  it('detectHardware detects Apple Silicon', () => {
    const mockOs = {
      totalmem: () => 16 * 1024 * 1024 * 1024,
      arch: () => 'arm64',
      platform: () => 'darwin',
    };
    
    const hw = detectHardware(mockOs);
    expect(hw.totalRamGB).toBe(16);
    expect(hw.arch).toBe('arm64');
    expect(hw.platform).toBe('darwin');
    expect(hw.isAppleSilicon).toBe(true);
    expect(hw.accelerator).toBe('metal');
    expect(hw.unifiedMemory).toBe(true);
  });

  it('detectHardware detects non-Apple Silicon', () => {
    const mockOs = {
      totalmem: () => 32 * 1024 * 1024 * 1024,
      arch: () => 'x64',
      platform: () => 'linux',
    };
    
    const hw = detectHardware(mockOs);
    expect(hw.totalRamGB).toBe(32);
    expect(hw.arch).toBe('x64');
    expect(hw.platform).toBe('linux');
    expect(hw.isAppleSilicon).toBe(false);
    expect(hw.unifiedMemory).toBe(false);
    // Note: accelerator could be cuda or cpu depending on the host running the test, so we don't strictly test it here, or we accept either
    expect(['cpu', 'cuda']).toContain(hw.accelerator);
  });

  it('recommendPreset boundary checks', () => {
    expect(recommendPreset(3)).toBe('ram-4');
    expect(recommendPreset(8)).toBe('ram-8');
    expect(recommendPreset(12)).toBe('ram-12');
    expect(recommendPreset(15)).toBe('ram-12');
    expect(recommendPreset(16)).toBe('ram-16');
    expect(recommendPreset(24)).toBe('ram-24');
    expect(recommendPreset(64)).toBe('ram-32');
  });

  it('recommendNumCtx boundary checks', () => {
    expect(recommendNumCtx(4)).toBe(1024);
    expect(recommendNumCtx(8)).toBe(2048);
    expect(recommendNumCtx(15)).toBe(2048);
    expect(recommendNumCtx(16)).toBe(4096);
    expect(recommendNumCtx(24)).toBe(8192);
    expect(recommendNumCtx(64)).toBe(8192);
  });
  
  it('getPresetRank works correctly', () => {
    expect(getPresetRank('ram-4')).toBe(4);
    expect(getPresetRank('ram-12')).toBe(12);
    expect(getPresetRank('custom')).toBe(24);
  });

  it('ramPresets map to the correct re-calibrated models', () => {
    // Assert the specific models requested for the 24GB workhorse vs dedicated setups
    expect(ramPresets['ram-16'].brain).toBe('qwen3.5:9b');
    expect(ramPresets['ram-16'].gate).toBe('qwen2.5-coder:3b');
    
    expect(ramPresets['ram-24'].brain).toBe('qwen3:14b');
    expect(ramPresets['ram-24'].gate).toBe('qwen2.5-coder:7b');
  });
});
