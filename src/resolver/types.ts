export type RiskLevel = 'reversible' | 'low' | 'security' | 'destructive';

export type SourceKind = 'evidence' | 'convention' | 'self_consistency' | 'unresolved' | 'api';

export interface OpenDecision {
  id: string;
  question: string;
  kind: string;
}

export interface ResolvedItem {
  id: string;
  question: string;
  answer: string | null;
  confidence: number;
  source: SourceKind;
  evidence?: string;
  options?: string[];
  risk?: RiskLevel;
}

export interface EnrichedAskUserItem {
  id: string;
  question: string;
  recommendedAnswer: string | null;
  confidence: number;
  options: string[];
  evidence?: string;
}

export interface AutoAppliedItem {
  id: string;
  question: string;
  answer: string;
  note: string;
}

export interface ResolverOutput {
  autoApplied: AutoAppliedItem[];
  askUser: EnrichedAskUserItem[];
}
