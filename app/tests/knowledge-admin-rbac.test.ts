import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Feature 008 US5 — knowledge administration (FR-032/FR-033;
 * contracts/settings-knowledge.md).
 *
 * These handlers edit the rules the generator reasons with, so the checks that
 * matter are the ones a hostile or mistaken client can reach: authorization,
 * the 600-character content cap, and the hash collision that would otherwise
 * merge two rules and lose an edit. The database and session are stubbed; what
 * is exercised is the handlers' own decision-making, not Mongo's.
 */

const session = { role: 'super_admin' as string, sub: 'user-1', verified: true };

vi.mock('@/lib/db', () => ({ connectDB: async () => undefined }));

vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return { ...actual, requireVerified: async () => ({ ...session }) };
});

interface FakeDoc {
  _id: string;
  kind: string;
  provider: string;
  designMode: string;
  title: string;
  content: string;
  keywords: string[];
  source: string;
  confidence: number;
  usageCount: number;
  lastUsedAt: Date | null;
  enabled: boolean;
  hash: string;
  save: () => Promise<void>;
}

const docs = new Map<string, FakeDoc>();
let existsResult: unknown = null;

vi.mock('@/lib/models/KnowledgeEntry', () => ({
  KnowledgeEntry: {
    findById: async (id: string) => docs.get(id) ?? null,
    exists: async () => existsResult,
    findByIdAndDelete: async (id: string) => {
      const doc = docs.get(id);
      docs.delete(id);
      return doc ?? null;
    },
    countDocuments: async () => docs.size,
    find: () => ({ sort: () => ({ limit: async () => [...docs.values()] }) }),
  },
}));

const { PATCH, DELETE } = await import('@/app/api/settings/knowledge/[id]/route');
const { GET } = await import('@/app/api/settings/knowledge/route');
const { contentHash } = await import('@/lib/knowledge/types');

const ID = '68a1f2c3d4e5f60718293a4b';
const MISSING_ID = '68a1f2c3d4e5f60718293a4c';

function seed(over: Partial<FakeDoc> = {}): FakeDoc {
  const base = {
    _id: ID,
    kind: 'rule',
    provider: 'aws',
    designMode: 'cloud',
    title: 'Databases stay private',
    content: 'Databases and caches live in private subnets and are never internet-exposed.',
    keywords: ['database', 'subnet'],
    source: 'seed',
    confidence: 1,
    usageCount: 12,
    lastUsedAt: null,
    enabled: true,
    hash: '',
    save: async () => undefined,
    ...over,
  } as FakeDoc;
  base.hash = contentHash({
    provider: base.provider as 'aws' | 'mongodb' | 'system' | 'any',
    designMode: base.designMode,
    content: base.content,
  });
  docs.set(base._id, base);
  return base;
}

const patch = (body: unknown, id = ID) =>
  PATCH(new Request('http://localhost/api/settings/knowledge/x', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  docs.clear();
  existsResult = null;
  session.role = 'super_admin';
});

describe('authorization is enforced server-side (FR-033)', () => {
  it('refuses an edit from a non-super-admin', async () => {
    seed();
    session.role = 'admin';
    const res = await patch({ enabled: false });
    expect(res.status).toBe(403);
    // And the entry is untouched — a rejected request must not half-apply.
    expect(docs.get(ID)!.enabled).toBe(true);
  });

  it('refuses a delete from a plain user', async () => {
    seed();
    session.role = 'user';
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(res.status).toBe(403);
    expect(docs.has(ID)).toBe(true);
  });

  it('still lets any verified user read, so trace citations can be inspected', async () => {
    seed();
    session.role = 'user';
    const res = await GET(new Request('http://localhost/api/settings/knowledge'));
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(1);
  });
});

describe('validation (422/400)', () => {
  it('rejects content over the 600-character store cap', async () => {
    seed();
    const res = await patch({ content: 'x'.repeat(601) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('600');
  });

  it('accepts content exactly at the cap', async () => {
    seed();
    expect((await patch({ content: 'x'.repeat(600) })).status).toBe(200);
  });

  it('rejects an empty keyword list, which would make the entry unretrievable', async () => {
    seed();
    expect((await patch({ keywords: [] })).status).toBe(400);
  });

  it('rejects an unknown design mode', async () => {
    seed();
    expect((await patch({ designMode: 'quantum' })).status).toBe(400);
  });

  it('rejects an empty patch rather than reporting a no-op as success', async () => {
    seed();
    expect((await patch({})).status).toBe(400);
  });

  it('rejects provenance fields outright — they are not opinions', async () => {
    seed();
    // `source` is not in the schema, so a body containing only it has no
    // recognised changes and is refused rather than silently ignored.
    expect((await patch({ source: 'seed' })).status).toBe(400);
  });

  it('rejects a malformed id as not-found rather than throwing', async () => {
    expect((await patch({ enabled: false }, 'not-an-object-id')).status).toBe(404);
  });

  it('404s an unknown id', async () => {
    seed();
    expect((await patch({ enabled: false }, MISSING_ID)).status).toBe(404);
  });
});

describe('content edits and the dedupe hash (409)', () => {
  it('recomputes the hash when content changes', async () => {
    const doc = seed();
    const before = doc.hash;
    const res = await patch({ content: 'Databases must never be reachable from the public internet.' });
    expect(res.status).toBe(200);
    expect(doc.hash).not.toBe(before);
  });

  it('recomputes the hash when design mode changes, since the hash covers it', async () => {
    const doc = seed();
    const before = doc.hash;
    expect((await patch({ designMode: 'hld' })).status).toBe(200);
    expect(doc.hash).not.toBe(before);
  });

  it('fails 409 rather than merging two entries that would say the same thing', async () => {
    const doc = seed();
    existsResult = { _id: 'someone-else' };
    const res = await patch({ content: 'Something another entry already says.' });
    expect(res.status).toBe(409);
    // The edit is discarded whole: a persisted content with a stale hash would
    // be retrievable but permanently un-editable.
    expect(doc.content).toContain('private subnets');
  });

  it('leaves the hash alone for a metadata-only edit', async () => {
    const doc = seed();
    const before = doc.hash;
    expect((await patch({ enabled: false, title: 'Renamed' })).status).toBe(200);
    expect(doc.hash).toBe(before);
    expect(doc.enabled).toBe(false);
  });

  it('lowercases keywords so retrieval matching stays case-insensitive', async () => {
    const doc = seed();
    await patch({ keywords: ['RDS', 'Private Subnet'] });
    expect(doc.keywords).toEqual(['rds', 'private subnet']);
  });
});

describe('deleting a seeded rule', () => {
  it('warns that seeding will restore it', async () => {
    seed({ source: 'seed' });
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(await res.json()).toEqual({ deleted: true, willReseed: true });
  });

  it('does not warn for a learned lesson, which stays gone', async () => {
    seed({ source: 'learned' });
    const res = await DELETE(new Request('http://localhost/x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: ID }),
    });
    expect(await res.json()).toEqual({ deleted: true, willReseed: false });
  });
});
