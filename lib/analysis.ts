export const analysisSchema = {
  type: 'object',
  properties: {
    category: { type: 'string', enum: ['sales', 'support', 'billing', 'unknown'] },
    priority: { type: 'string', enum: ['normal', 'high'] },
    draft: { type: 'string' },
    needs_review: { type: 'boolean' },
  },
  required: ['category', 'priority', 'draft', 'needs_review'],
  additionalProperties: false,
} as const;

export type AnalysisResult = {
  category: 'sales' | 'support' | 'billing' | 'unknown';
  priority: 'normal' | 'high';
  draft: string;
  needs_review: boolean;
};

export function validateAnalysisResult(value: unknown): value is AnalysisResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = ['category', 'priority', 'draft', 'needs_review'];
  return Object.keys(item).length === keys.length && keys.every((key) => key in item)
    && ['sales', 'support', 'billing', 'unknown'].includes(String(item.category))
    && ['normal', 'high'].includes(String(item.priority))
    && typeof item.draft === 'string'
    && typeof item.needs_review === 'boolean';
}
