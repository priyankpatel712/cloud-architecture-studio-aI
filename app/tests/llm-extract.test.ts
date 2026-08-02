import { describe, expect, it } from 'vitest';
import { extractJson, stripJsonAnnotations } from '@/lib/llm';

/**
 * Reasoning-model output sanitization (creation-flow reliability fix):
 * <think> blocks and stray prose around the JSON must not fail the turn.
 */
describe('extractJson', () => {
  it('passes plain JSON through untouched', () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it('strips <think> blocks before the JSON', () => {
    const raw = '<think>\nLet me plan the architecture...\n</think>\n{"reply":"ok","add":[]}';
    expect(JSON.parse(extractJson(raw))).toEqual({ reply: 'ok', add: [] });
  });

  it('slices surrounding prose down to the outermost object', () => {
    const raw = 'Here is the plan:\n{"reply":"ok"}\nHope this helps!';
    expect(JSON.parse(extractJson(raw))).toEqual({ reply: 'ok' });
  });

  it('handles multiple think blocks and nested braces', () => {
    const raw = '<think>a</think>{"x":{"y":[1,2]}}<think>b</think>';
    expect(JSON.parse(extractJson(raw))).toEqual({ x: { y: [1, 2] } });
  });

  it('returns the cleaned text as-is when no object is present (parse still fails upstream)', () => {
    expect(extractJson('no json here')).toBe('no json here');
  });
});

/**
 * Regression for a live failure observed during feature 006 validation:
 * NVIDIA Nemotron returned prose + a fenced JSON block annotated with
 * `// comments` and trailing commas, which JSON.parse rightly rejects.
 * `stripJsonAnnotations` (the lenient fallback in llmJson) must recover the
 * annotated-but-otherwise-valid case while leaving string contents untouched.
 */
describe('stripJsonAnnotations', () => {
  it('recovers the observed Nemotron output: prose + fenced JSON with // comments', () => {
    const modelOutput = [
      "Here is the JSON edit plan to fulfill the user's request:",
      '```json',
      '{',
      '  "reply": "Added DynamoDB.",',
      '  "moreNeeded": true,',
      '  "add": [',
      '    {',
      '      "serviceId": "aws-dynamodb",',
      '      "config": {',
      '        "storage": "25",  // Default for small MVP',
      '        "writes": "0.01"  // Extremely low for MVP, adjust as needed',
      '      },',
      '      "monthlyCostUsd": 5  // Indicative, based on minimal setup',
      '    },',
      '  ],',
      '  "remove": [], "update": [], "edges": []',
      '}',
      '```',
    ].join('\n');
    const parsed = JSON.parse(stripJsonAnnotations(extractJson(modelOutput)));
    expect(parsed.add[0].config.storage).toBe('25');
    expect(parsed.add[0].monthlyCostUsd).toBe(5);
    expect(parsed.moreNeeded).toBe(true);
  });

  it('never strips // or /* sequences INSIDE string values', () => {
    const input = '{ "url": "https://example.com/a//b", "glob": "src/**/*.ts", "note": "a /* not a comment */ b" }';
    const parsed = JSON.parse(stripJsonAnnotations(input));
    expect(parsed.url).toBe('https://example.com/a//b');
    expect(parsed.glob).toBe('src/**/*.ts');
    expect(parsed.note).toBe('a /* not a comment */ b');
  });

  it('never removes a literal ",]" or ",}" inside a string value', () => {
    const input = '{ "label": "pairs: [a,] and {b,}", "list": [1,] }';
    const parsed = JSON.parse(stripJsonAnnotations(input));
    expect(parsed.label).toBe('pairs: [a,] and {b,}');
    expect(parsed.list).toEqual([1]);
  });

  it('removes block comments and trailing commas', () => {
    const input = '{ /* header */ "a": 1, "b": [1, 2, 3,] }';
    expect(JSON.parse(stripJsonAnnotations(input))).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it('handles escaped quotes inside strings without losing string state', () => {
    const input = '{ "a": "say \\"hi\\" // not a comment", "b": 2 } // tail';
    const parsed = JSON.parse(stripJsonAnnotations(input));
    expect(parsed.a).toBe('say "hi" // not a comment');
    expect(parsed.b).toBe(2);
  });

  it('leaves genuinely malformed output malformed (strict gate preserved)', () => {
    expect(() => JSON.parse(stripJsonAnnotations('{ "a": <truncated'))).toThrow();
  });
});
