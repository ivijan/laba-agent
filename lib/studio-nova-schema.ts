import { jsonSchema, type JSONSchema7 } from 'ai';
import rawSchema from '../materials/dane/schemat_wyniku.json';

export type StudioNovaAnalysis = {
  category: 'sales' | 'support' | 'billing' | 'unknown';
  priority: 'normal' | 'high';
  draft: string;
  needs_review: boolean;
};

const schemaDefinition = rawSchema as JSONSchema7;

export function isStudioNovaAnalysis(value: unknown): value is StudioNovaAnalysis {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  const requiredKeys = ['category', 'priority', 'draft', 'needs_review'];
  if (Object.keys(record).length !== requiredKeys.length) return false;
  if (!requiredKeys.every((key) => Object.hasOwn(record, key))) return false;

  return (
    ['sales', 'support', 'billing', 'unknown'].includes(String(record.category)) &&
    ['normal', 'high'].includes(String(record.priority)) &&
    typeof record.draft === 'string' &&
    typeof record.needs_review === 'boolean'
  );
}

export const STUDIO_NOVA_RESULT_SCHEMA = jsonSchema<StudioNovaAnalysis>(schemaDefinition, {
  validate(value) {
    return isStudioNovaAnalysis(value)
      ? { success: true, value }
      : { success: false, error: new Error('Wynik nie spełnia schematu Studio Nova.') };
  },
});
