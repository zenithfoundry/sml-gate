export class SlmFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlmFormatError';
  }
}

export class SlmTimeoutError extends Error {
  constructor(stage: string) {
    super(`SLM call timed out during stage: ${stage}`);
    this.name = 'SlmTimeoutError';
  }
}

export async function withSlmTimeout<T>(promise: Promise<T>, stage: string, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SlmTimeoutError(stage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

export type ClassifyCategory = 'classify' | 'extract' | 'format' | 'boolean' | 'short_factual' | 'trivial_edit' | 'other';
