import { describe, expect, it } from 'vitest';
import {
  buildConversationContext,
  CONTEXT_CHAR_BUDGET,
  type ContextMessage,
} from '@/lib/generate/conversation-context';

/**
 * Feature 008 US1 — conversation context (FR-001).
 *
 * Root causes R1/R2/R5: today only the router sees history, and it sees only
 * `role === 'user'` messages. The assistant's own replies and the "Direct canvas
 * edit" system messages are dropped, so a follow-up is interpreted with no idea
 * what was just built or what the user changed by hand. These tests pin the
 * three line kinds that fix that, and the budget that keeps it affordable.
 */

const user = (text: string): ContextMessage => ({ role: 'user', text });
const assistant = (text: string, editsApplied?: string[]): ContextMessage => ({
  role: 'assistant',
  text,
  ...(editsApplied ? { editsApplied } : {}),
});
const canvasEdit = (summary: string): ContextMessage => ({
  role: 'system',
  text: `Direct canvas edit: ${summary}`,
});

describe('buildConversationContext — line kinds', () => {
  it('returns an empty string when there is no history', () => {
    expect(buildConversationContext([])).toBe('');
  });

  it('renders user messages', () => {
    expect(buildConversationContext([user('add a cache')])).toContain('USER: add a cache');
  });

  it('renders what the assistant actually changed, not its prose', () => {
    // editsApplied is the durable, factual record of the turn; the prose reply
    // is chatty and burns budget without adding grounding.
    const out = buildConversationContext([
      user('add a queue'),
      assistant('Sure! I have added an SQS queue between the API and the worker.', [
        'added aws-sqs',
        'connected 2 services',
      ]),
    ]);
    expect(out).toContain('ASSISTANT: applied added aws-sqs, connected 2 services');
    expect(out).not.toContain('Sure!');
  });

  it('falls back to the assistant reply when a turn changed nothing', () => {
    const out = buildConversationContext([assistant('That service is already in the design.')]);
    expect(out).toContain('ASSISTANT: That service is already in the design.');
  });

  it('includes manual canvas edits — the dead channel this feature revives (R2)', () => {
    const out = buildConversationContext([
      user('build an api'),
      assistant('Done.', ['added aws-lambda']),
      canvasEdit('removed aws-lambda'),
    ]);
    expect(out).toContain('CANVAS EDIT (manual): removed aws-lambda');
  });

  it('ignores system messages that are not canvas edits', () => {
    const out = buildConversationContext([
      { role: 'system', text: 'Some unrelated system note' },
      user('hello'),
    ]);
    expect(out).not.toContain('Some unrelated system note');
    expect(out).toContain('USER: hello');
  });

  it('skips messages with no usable content', () => {
    const out = buildConversationContext([user(''), user('   '), user('real')]);
    expect(out.split('\n').filter(Boolean)).toHaveLength(1);
    expect(out).toContain('USER: real');
  });
});

describe('buildConversationContext — ordering and budget', () => {
  it('renders oldest-first so the model reads the conversation forwards', () => {
    const out = buildConversationContext([user('first'), user('second'), user('third')]);
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
    expect(out.indexOf('second')).toBeLessThan(out.indexOf('third'));
  });

  it('stays within the character budget on a long conversation', () => {
    const many = Array.from({ length: 200 }, (_, i) => user(`request number ${i} ${'x'.repeat(200)}`));
    const out = buildConversationContext(many);
    expect(out.length).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGET);
  });

  it('drops the OLDEST turns when over budget — recency is what a follow-up needs', () => {
    const many = [
      user(`ancient ${'x'.repeat(400)}`),
      ...Array.from({ length: 40 }, (_, i) => user(`middle ${i} ${'y'.repeat(200)}`)),
      user('the newest request'),
    ];
    const out = buildConversationContext(many);
    expect(out).toContain('the newest request');
    expect(out).not.toContain('ancient');
  });

  it('truncates a single oversized message rather than dropping it entirely', () => {
    const out = buildConversationContext([user('z'.repeat(5000))]);
    expect(out.length).toBeLessThanOrEqual(CONTEXT_CHAR_BUDGET);
    expect(out).toContain('USER: zzz');
  });

  it('honours an explicit smaller budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => user(`request ${i}`));
    const out = buildConversationContext(many, { maxChars: 120 });
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain('request 49');
  });
});
