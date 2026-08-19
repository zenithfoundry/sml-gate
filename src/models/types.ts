export class SlmFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlmFormatError';
  }
}

export type ClassifyCategory = 'classify' | 'extract' | 'format' | 'boolean' | 'short_factual' | 'trivial_edit' | 'other';
