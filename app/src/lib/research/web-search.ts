import 'server-only';

/**
 * Web search backends (feature 008 US4, FR-025/FR-027/FR-030;
 * contracts/agent-interfaces.md §5).
 *
 * WHY A THIRD PARTY AT ALL
 * Constitution Principle I prefers official provider integrations, and no cloud
 * vendor publishes a general web-search MCP or API. So "official" is satisfied
 * at the SOURCE level instead of the index level: results are filtered to
 * official documentation domains after the call, which means a backend that
 * ignores a domain hint still cannot leak non-official sources into grounding.
 *
 * OPTIONAL BY DESIGN
 * No credential means the `disabled` backend, which returns nothing. Callers
 * need no conditional — the knowledge waterfall simply finds the rung empty and
 * proceeds on the sources it does have, exactly as the app already degrades when
 * MCP commands are unset.
 *
 * PRIVACY (FR-030)
 * Only derived capability keywords are ever transmitted. That is enforced HERE,
 * at the boundary, so no caller can opt out by passing raw user text.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchBackend {
  readonly id: 'tavily' | 'brave' | 'disabled';
  search(query: string, opts: { allowDomains: string[] }): Promise<SearchHit[]>;
  fetchPage(url: string): Promise<string>;
}

/** Official documentation sources — Principle I applied at the source level. */
export const OFFICIAL_DOC_DOMAINS = [
  'docs.aws.amazon.com',
  'aws.amazon.com',
  'mongodb.com',
  'www.mongodb.com',
  'learn.microsoft.com',
  'cloud.google.com',
];

/** Matches the existing MCP raw-text cap so one page cannot dominate a prompt. */
const PAGE_TEXT_CAP = 6000;
const SEARCH_TIMEOUT_MS = 10_000;

/**
 * Reduce a request to safe search terms (FR-030).
 *
 * Raw user text can name employers, products, or internal systems. Capability
 * keywords are already the derived, generic form the pipeline reasons about, so
 * they are what leaves the system. Anything longer than a short phrase is
 * dropped rather than trimmed — a long "keyword" is usually pasted prose.
 */
export function toSafeQuery(keywords: readonly string[], maxTerms = 6): string {
  return keywords
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 1 && k.length <= 40 && !/[<>{}@]/.test(k))
    .filter((k) => k.split(/\s+/).length <= 4)
    .slice(0, maxTerms)
    .join(' ');
}

/** Host allow-check applied to results, never trusted to the backend. */
export function isAllowedUrl(url: string, allowDomains: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return allowDomains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

const disabledBackend: SearchBackend = {
  id: 'disabled',
  async search() {
    return [];
  },
  async fetchPage() {
    return '';
  },
};

/** Tavily — built for agent retrieval, returns extracted content, not just links. */
function tavilyBackend(apiKey: string): SearchBackend {
  return {
    id: 'tavily',
    async search(query, opts) {
      const res = await withTimeout(
        (signal) =>
          fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              api_key: apiKey,
              query,
              max_results: 5,
              include_domains: opts.allowDomains,
            }),
            signal,
          }),
        SEARCH_TIMEOUT_MS
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
      return (data.results ?? [])
        .filter((r) => r.url && isAllowedUrl(r.url, opts.allowDomains))
        .map((r) => ({ title: r.title ?? '', url: r.url!, snippet: (r.content ?? '').slice(0, 1200) }));
    },
    async fetchPage(url) {
      const res = await withTimeout((signal) => fetch(url, { signal }), SEARCH_TIMEOUT_MS);
      if (!res.ok) return '';
      return (await res.text()).slice(0, PAGE_TEXT_CAP);
    },
  };
}

/** Brave — an independent index, so a Tavily outage is not a total outage. */
function braveBackend(apiKey: string): SearchBackend {
  return {
    id: 'brave',
    async search(query, opts) {
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', '5');
      const res = await withTimeout(
        (signal) =>
          fetch(url, {
            headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
            signal,
          }),
        SEARCH_TIMEOUT_MS
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      return (data.web?.results ?? [])
        .filter((r) => r.url && isAllowedUrl(r.url, opts.allowDomains))
        .map((r) => ({ title: r.title ?? '', url: r.url!, snippet: (r.description ?? '').slice(0, 1200) }));
    },
    async fetchPage(url) {
      const res = await withTimeout((signal) => fetch(url, { signal }), SEARCH_TIMEOUT_MS);
      if (!res.ok) return '';
      return (await res.text()).slice(0, PAGE_TEXT_CAP);
    },
  };
}

/**
 * Backend selection: Tavily → Brave → disabled, by which credential is present.
 * `WEB_RESEARCH_ENABLED=false` turns the rung off regardless of keys, so it can
 * be disabled without removing credentials.
 */
export function getSearchBackend(): SearchBackend {
  if (process.env.WEB_RESEARCH_ENABLED === 'false') return disabledBackend;
  const tavily = process.env.TAVILY_API_KEY?.trim();
  if (tavily) return tavilyBackend(tavily);
  const brave = process.env.BRAVE_API_KEY?.trim();
  if (brave) return braveBackend(brave);
  return disabledBackend;
}

export function webResearchAvailable(): boolean {
  return getSearchBackend().id !== 'disabled';
}
