/**
 * @fileoverview Plan registry for determining estimated token budgets and authoritative window lengths.
 * 
 * IMPORTANT MAINTAINER WARNING:
 * Providers change these limits often. Re-verify the numbers against the cited sources!
 * 
 * Sources:
 *   claude  : https://support.anthropic.com/en/articles/11014257-about-claude-max-plan-usage
 *   chatgpt : https://help.openai.com          (search "ChatGPT usage limits")
 *   gemini  : https://support.google.com/gemini/answer/16275805
 */

export interface SubscriptionPlan {
  provider: 'claude' | 'chatgpt' | 'gemini';
  windowMinutes: number;
  estTokensPerWindow: number;
  isEstimate: true;
  source: string;
  verifiedOn: string;
  note?: string;
}

export type RawPlanDef = {
  provider: 'claude' | 'chatgpt' | 'gemini';
  windowMinutes: number;
} & (
  | { msgsPerWindow: number }
  | { multiplier: number, baselineMsgs?: number }
);

// Define raw constants as pinned by research
const RAW_PLANS: Record<string, RawPlanDef> = {
  // CLAUDE — 5h rolling window + weekly cap
  'claude-pro':      { provider: 'claude', windowMinutes: 300, msgsPerWindow: 45 },
  'claude-max-5x':   { provider: 'claude', windowMinutes: 300, msgsPerWindow: 225 },
  'claude-max-20x':  { provider: 'claude', windowMinutes: 300, msgsPerWindow: 900 },

  // CHATGPT — 3h rolling window
  'chatgpt-go':      { provider: 'chatgpt', windowMinutes: 180, multiplier: 1, baselineMsgs: 160 },
  'chatgpt-plus':    { provider: 'chatgpt', windowMinutes: 180, multiplier: 1, baselineMsgs: 160 },
  'chatgpt-pro-5x':  { provider: 'chatgpt', windowMinutes: 180, multiplier: 5, baselineMsgs: 160 },
  'chatgpt-pro-20x': { provider: 'chatgpt', windowMinutes: 180, multiplier: 20, baselineMsgs: 160 },

  // GEMINI — 5h compute-based rolling window + weekly
  'gemini-plus':     { provider: 'gemini', windowMinutes: 300, multiplier: 2 },
  'gemini-pro':      { provider: 'gemini', windowMinutes: 300, multiplier: 4 },
  'gemini-ultra':    { provider: 'gemini', windowMinutes: 300, multiplier: 20 },
};

const SOURCES: Record<'claude' | 'chatgpt' | 'gemini', string> = {
  claude: 'https://support.anthropic.com/en/articles/11014257-about-claude-max-plan-usage',
  chatgpt: 'https://help.openai.com',
  gemini: 'https://support.google.com/gemini/answer/16275805'
};

/**
 * Returns a fully resolved subscription plan based on dynamic token assumptions.
 */
export function getSubscriptionPlan(
  planKey: string,
  avgTokensPerMessage: number,
  geminiStandardTokens: number
): SubscriptionPlan {
  const raw = RAW_PLANS[planKey];
  if (!raw) {
    throw new Error(`Unknown plan key: '${planKey}'. Valid keys: ${Object.keys(RAW_PLANS).join(', ')}`);
  }

  let estTokensPerWindow = 0;

  if (raw.provider === 'claude') {
    const r = raw as { msgsPerWindow: number };
    estTokensPerWindow = Math.round(r.msgsPerWindow * avgTokensPerMessage);
  } else if (raw.provider === 'chatgpt') {
    const r = raw as { multiplier: number, baselineMsgs: number };
    estTokensPerWindow = Math.round(r.baselineMsgs * r.multiplier * avgTokensPerMessage);
  } else if (raw.provider === 'gemini') {
    const r = raw as { multiplier: number };
    estTokensPerWindow = Math.round(geminiStandardTokens * r.multiplier);
  }

  return {
    provider: raw.provider,
    windowMinutes: raw.windowMinutes,
    estTokensPerWindow,
    isEstimate: true,
    source: SOURCES[raw.provider],
    verifiedOn: '2026-09-09'
  };
}

export function isValidPlanKey(planKey: string): boolean {
  return planKey in RAW_PLANS;
}

export function getValidPlanKeys(): string[] {
  return Object.keys(RAW_PLANS);
}
