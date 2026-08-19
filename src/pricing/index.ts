export const PRICING: Record<string, { in: number; out: number }> = {
  // USD per 1,000,000 tokens
  // OpenAI
  'gpt-4o': { in: 5, out: 15 },
  'gpt-4o-mini': { in: 0.150, out: 0.600 },
  
  // Anthropic
  'claude-3-5-sonnet-20240620': { in: 3, out: 15 },
  
  // Gemini
  'gemini-1.5-pro': { in: 3.5, out: 10.5 },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
  
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
