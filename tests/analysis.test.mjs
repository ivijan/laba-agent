import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateAnalysisResult } from '../lib/analysis.ts';

const valid = {
  category: 'sales',
  priority: 'normal',
  draft: 'Konsultacja trwa 45 minut i kosztuje 150 zł brutto.',
  needs_review: false,
};
const malformedExamples = JSON.parse(
  readFileSync(new URL('../materials/dane/niepoprawne_wyniki.json', import.meta.url), 'utf8'),
);

test('accepts the complete schema result', () => {
  assert.equal(validateAnalysisResult(valid), true);
});

test('rejects the local malformed examples (missing field, wrong type, invalid enum, extra field)', () => {
  assert.equal(malformedExamples.length, 4);
  for (const value of malformedExamples) assert.equal(validateAnalysisResult(value), false);
});

test('rejects malformed JSON values and wrong priority types', () => {
  const cases = [
    { ...valid, priority: 'urgent' },
    { ...valid, draft: 123 },
    null,
    [],
  ];

  for (const value of cases) assert.equal(validateAnalysisResult(value), false);
});
