export interface TechLeadStackAdapter {
  // Stub for TLS adapter integration
}

export const tlsPreservePatterns: RegExp[] = [
  /^## MinimumCD/i,
  /^## Quality/i,
  /^Phase \d/i,
  /^cost:/i,
  /^modes:/i,
];
