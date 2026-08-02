import { describe, expect, it } from 'vitest';
import { fallbackRoute, sanitizeRoute } from '@/lib/generate/router';

/**
 * Dynamic tool/mode router (Anthropic routing pattern). The LLM verdict is
 * untrusted (same NIM guided_json unreliability as every other call) —
 * sanitizeRoute coerces shapes and enforces the mode→providers coupling
 * code-side; fallbackRoute preserves the pre-router behavior when no verdict
 * is available.
 */

import type { ProviderId } from '@/lib/providers/types';

const fresh: { currentMode: null; currentProviders: ProviderId[]; canvasProviders: ProviderId[] } = {
  currentMode: null,
  currentProviders: [],
  canvasProviders: [],
};

describe('fallbackRoute', () => {
  it('brand-new conversation defaults to cloud with every cloud provider (pre-router behavior)', () => {
    expect(fallbackRoute(fresh)).toEqual({ mode: 'cloud', providers: ['aws', 'mongodb'], reason: '' });
  });

  it('keeps the sticky tools when the conversation has them', () => {
    const d = fallbackRoute({ currentMode: 'cloud', currentProviders: ['aws'], canvasProviders: [] });
    expect(d.providers).toEqual(['aws']);
  });

  it('follows what is already drawn when nothing is sticky', () => {
    const d = fallbackRoute({ currentMode: 'cloud', currentProviders: [], canvasProviders: ['mongodb'] });
    expect(d.providers).toEqual(['mongodb']);
  });

  it('a sticky generic mode stays generic with the system toolset', () => {
    const d = fallbackRoute({ currentMode: 'hld', currentProviders: ['system'], canvasProviders: ['system'] });
    expect(d).toEqual({ mode: 'hld', providers: ['system'], reason: '' });
  });
});

describe('sanitizeRoute', () => {
  it('passes a well-formed cloud verdict through', () => {
    const d = sanitizeRoute({ mode: 'cloud', providers: ['aws'], reason: 'AWS named' }, fresh);
    expect(d).toEqual({ mode: 'cloud', providers: ['aws'], reason: 'AWS named' });
  });

  it('hld/lld modes always get exactly the system toolset, whatever the model listed', () => {
    for (const mode of ['hld', 'lld'] as const) {
      const d = sanitizeRoute({ mode, providers: ['aws', 'mongodb', 'system'], reason: '' }, fresh);
      expect(d.mode).toBe(mode);
      expect(d.providers).toEqual(['system']);
    }
  });

  it('cloud mode drops the system pseudo-provider and keeps only cloud providers', () => {
    const d = sanitizeRoute({ mode: 'cloud', providers: ['system', 'mongodb'], reason: '' }, fresh);
    expect(d.providers).toEqual(['mongodb']);
  });

  it('cloud mode with no valid providers falls back to sticky/canvas/all-cloud', () => {
    const d = sanitizeRoute({ mode: 'cloud', providers: ['gcp'], reason: '' }, { ...fresh, currentProviders: ['aws'] });
    expect(d.providers).toEqual(['aws']);
    const d2 = sanitizeRoute({ mode: 'cloud', providers: [], reason: '' }, fresh);
    expect(d2.providers).toEqual(['aws', 'mongodb']);
  });

  it('an invalid mode falls back to the sticky mode (or cloud)', () => {
    expect(sanitizeRoute({ mode: 'uml', providers: [] }, fresh).mode).toBe('cloud');
    expect(sanitizeRoute({ mode: 42, providers: [] }, { ...fresh, currentMode: 'lld' }).mode).toBe('lld');
  });

  it('survives completely wrong shapes', () => {
    for (const junk of [null, undefined, 'text', 42, []]) {
      const d = sanitizeRoute(junk, fresh);
      expect(d.mode).toBe('cloud');
      expect(d.providers).toEqual(['aws', 'mongodb']);
    }
  });

  it('truncates an over-long reason', () => {
    const d = sanitizeRoute({ mode: 'cloud', providers: ['aws'], reason: 'x'.repeat(500) }, fresh);
    expect(d.reason).toHaveLength(200);
  });
});
