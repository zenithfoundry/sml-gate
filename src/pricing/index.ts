export const PRICING: Record<string, { in: number; out: number }> = {
  // USD per 1,000,000 tokens
  // OpenAI
  'gpt-5.6-sol': { in: 5, out: 30 },
  'gpt-5.6-luna': { in: 0.20, out: 1.20 },
  
  // Anthropic
  'claude-sonnet-5': { in: 2, out: 10 },
  
  // Gemini
  'gemini-3.7-flash': { in: 0.75, out: 3.75 },
  'gemini-3.6-flash': { in: 0.75, out: 3.75 },
  'gemini-3.5-flash': { in: 1.50, out: 9.00 },
  'gemini-3.5-flash-lite': { in: 0.30, out: 2.50 },
  'gemini-3.1-pro-preview': { in: 2.00, out: 12.00 },
  'gemini-2.5-pro': { in: 1.25, out: 10.00 },
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
  'gemini-2.5-flash-free': { in: 0, out: 0 }, // For free tier usage
  
  // To add more models, add their exact model ID strings here.
};

export const LOCAL_RATE = { in: 0, out: 0 };

export function isLocal(model: string): boolean {
  // Keep as ONLY a fallback guess. The real decision is explicit in the ledger caller.
  if (model.startsWith('local:')) return true;
  const lower = model.toLowerCase();
  return ['qwen', 'llama', 'gemma', 'phi', 'mistral', 'deepseek'].some(tag => lower.includes(tag));
}

export function ratesFor(model: string): { in: number; out: number } {
  if (model in PRICING) {
    return PRICING[model];
  }
  const known = Object.keys(PRICING).join(', ');
  const error = new Error(`Pricing missing for model: ${model}. Known API models are: ${known}`);
  error.name = 'PricingMissingError';
  throw error;
}

export function calculateCostUsd(model: string, inTok: number, outTok: number): number {
  let rate;
  if (isLocal(model)) {
    rate = LOCAL_RATE;
  } else {
    rate = ratesFor(model);
  }

  return (inTok * rate.in + outTok * rate.out) / 1e6;
}

export function safeCalculateCostUsd(model: string | undefined, inTok: number, outTok: number, fallbackModel = 'gemini-2.5-flash'): number {
  const target = model || fallbackModel;
  try {
    return calculateCostUsd(target, inTok, outTok);
  } catch {
    try {
      return calculateCostUsd(fallbackModel, inTok, outTok);
    } catch {
      return 0;
    }
  }
}

