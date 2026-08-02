import { afterEach, describe, expect, it } from 'vitest';
import {
  getSearchBackend,
  webResearchAvailable,
  toSafeQuery,
  isAllowedUrl,
  OFFICIAL_DOC_DOMAINS,
} from '@/lib/research/web-search';

/**
 * Feature 008 US4 — web search backend (FR-025/FR-027/FR-030).
 *
 * Two properties matter more than the search itself:
 *
 * 1. PRIVACY (FR-030). Only derived capability keywords may leave the system.
 *    Raw request text can name employers, products, or internal systems, so the
 *    reduction is enforced at this boundary rather than trusted to callers.
 *
 * 2. OFFICIAL SOURCES (FR-025, constitution Principle I). No vendor publishes a
 *    general web-search API, so "official" is satisfied at the source level —
 *    and the allow-check is applied to RESULTS, so a backend that ignores a
 *    domain hint still cannot smuggle a non-official source into grounding.
 */

const KEYS = ['TAVILY_API_KEY', 'BRAVE_API_KEY', 'WEB_RESEARCH_ENABLED'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('backend selection (FR-027)', () => {
  it('is disabled when no credential is configured', () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
    delete process.env.WEB_RESEARCH_ENABLED;
    expect(getSearchBackend().id).toBe('disabled');
    expect(webResearchAvailable()).toBe(false);
  });

  it('prefers Tavily when both are configured', () => {
    process.env.TAVILY_API_KEY = 'tvly-x';
    process.env.BRAVE_API_KEY = 'brave-x';
    expect(getSearchBackend().id).toBe('tavily');
  });

  it('falls back to Brave when only Brave is configured', () => {
    delete process.env.TAVILY_API_KEY;
    process.env.BRAVE_API_KEY = 'brave-x';
    expect(getSearchBackend().id).toBe('brave');
  });

  it('can be switched off without removing credentials', () => {
    process.env.TAVILY_API_KEY = 'tvly-x';
    process.env.WEB_RESEARCH_ENABLED = 'false';
    expect(getSearchBackend().id).toBe('disabled');
  });

  it('the disabled backend is a silent no-op, so callers need no branch', async () => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.BRAVE_API_KEY;
    const backend = getSearchBackend();
    await expect(backend.search('anything', { allowDomains: [] })).resolves.toEqual([]);
    await expect(backend.fetchPage('https://example.com')).resolves.toBe('');
  });
});

describe('toSafeQuery — privacy boundary (FR-030)', () => {
  it('joins short capability keywords', () => {
    expect(toSafeQuery(['multi region', 'disaster recovery'])).toBe('multi region disaster recovery');
  });

  it('lowercases and trims', () => {
    expect(toSafeQuery(['  Multi-Region  '])).toBe('multi-region');
  });

  it('drops pasted prose rather than truncating it', () => {
    // A long "keyword" is almost always raw user text that slipped through; it
    // is discarded, not trimmed, so no fragment of it can be transmitted.
    const prose = 'we need this for the acme corp internal billing platform rollout next quarter';
    expect(toSafeQuery([prose])).toBe('');
  });

  it('drops terms carrying identifiers or markup', () => {
    expect(toSafeQuery(['alice@example.com'])).toBe('');
    expect(toSafeQuery(['<script>'])).toBe('');
    expect(toSafeQuery(['{secret}'])).toBe('');
  });

  it('caps how many terms are sent', () => {
    const many = Array.from({ length: 30 }, (_, i) => `term${i}`);
    expect(toSafeQuery(many).split(' ')).toHaveLength(6);
  });

  it('returns empty when nothing survives, so no search is issued', () => {
    expect(toSafeQuery([])).toBe('');
    expect(toSafeQuery(['a', ''])).toBe('');
  });
});

describe('isAllowedUrl — official sources only (FR-025)', () => {
  it('accepts official documentation domains and their subdomains', () => {
    expect(isAllowedUrl('https://docs.aws.amazon.com/lambda/latest/dg/welcome.html', OFFICIAL_DOC_DOMAINS)).toBe(true);
    expect(isAllowedUrl('https://www.mongodb.com/docs/atlas/', OFFICIAL_DOC_DOMAINS)).toBe(true);
    expect(isAllowedUrl('https://learn.microsoft.com/azure/', OFFICIAL_DOC_DOMAINS)).toBe(true);
  });

  it('rejects everything else, including lookalikes', () => {
    for (const url of [
      'https://random-blog.example.com/aws-tips',
      'https://stackoverflow.com/questions/1',
      // Suffix matching must be anchored on a dot, or this would pass.
      'https://notaws.amazon.com.evil.test/x',
      'https://docs.aws.amazon.com.evil.test/x',
    ]) {
      expect(isAllowedUrl(url, OFFICIAL_DOC_DOMAINS), url).toBe(false);
    }
  });

  it('rejects malformed urls rather than throwing', () => {
    expect(isAllowedUrl('not a url', OFFICIAL_DOC_DOMAINS)).toBe(false);
    expect(isAllowedUrl('', OFFICIAL_DOC_DOMAINS)).toBe(false);
  });
});
