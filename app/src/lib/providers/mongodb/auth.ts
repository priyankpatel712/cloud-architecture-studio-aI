import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

/**
 * MongoDB Atlas connection verification (FR-013). Programmatic API keys use HTTP
 * Digest auth against the Atlas Administration API; we verify the key is valid and
 * read-scoped by listing the organization + its projects, and store nothing but the
 * encrypted key material (caller encrypts — Constitution III).
 */

export class AtlasAuthError extends Error {}

const ACCEPT = 'application/vnd.atlas.2023-11-15+json';

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

function parseChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) {
    out[m[1]] = m[2] ?? m[3];
  }
  return out;
}

async function digestJson(
  url: string,
  publicKey: string,
  privateKey: string
): Promise<Record<string, unknown>> {
  const first = await fetch(url, { headers: { Accept: ACCEPT } });
  if (first.status !== 401) {
    if (first.ok) return (await first.json()) as Record<string, unknown>;
    throw new AtlasAuthError(`Atlas API returned ${first.status}.`);
  }
  const challengeHeader = first.headers.get('www-authenticate');
  if (!challengeHeader?.toLowerCase().startsWith('digest')) {
    throw new AtlasAuthError('Atlas API did not offer digest authentication.');
  }
  const c = parseChallenge(challengeHeader);
  const uri = new URL(url).pathname + new URL(url).search;
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const ha1 = md5(`${publicKey}:${c.realm}:${privateKey}`);
  const ha2 = md5(`GET:${uri}`);
  const response = c.qop
    ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${c.qop}:${ha2}`)
    : md5(`${ha1}:${c.nonce}:${ha2}`);
  const auth = [
    `Digest username="${publicKey}"`,
    `realm="${c.realm}"`,
    `nonce="${c.nonce}"`,
    `uri="${uri}"`,
    ...(c.qop ? [`qop=${c.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
    `response="${response}"`,
    ...(c.opaque ? [`opaque="${c.opaque}"`] : []),
    ...(c.algorithm ? [`algorithm=${c.algorithm}`] : []),
  ].join(', ');

  const second = await fetch(url, { headers: { Accept: ACCEPT, Authorization: auth } });
  if (second.status === 401) {
    throw new AtlasAuthError('Atlas rejected the API key. Check the public and private key.');
  }
  if (!second.ok) throw new AtlasAuthError(`Atlas API returned ${second.status}.`);
  return (await second.json()) as Record<string, unknown>;
}

export interface AtlasOrgInfo {
  orgId: string;
  orgName: string;
  projectsCount: number;
}

export async function verifyAtlasKey(publicKey: string, privateKey: string): Promise<AtlasOrgInfo> {
  const base = process.env.ATLAS_API_BASE || 'https://cloud.mongodb.com';
  const orgs = await digestJson(`${base}/api/atlas/v2/orgs`, publicKey, privateKey);
  const org = (orgs.results as { id: string; name: string }[] | undefined)?.[0];
  if (!org) throw new AtlasAuthError('This API key has no accessible organizations.');
  const groups = await digestJson(
    `${base}/api/atlas/v2/orgs/${org.id}/groups`,
    publicKey,
    privateKey
  );
  const projectsCount =
    typeof groups.totalCount === 'number'
      ? groups.totalCount
      : ((groups.results as unknown[] | undefined)?.length ?? 0);
  return { orgId: org.id, orgName: org.name, projectsCount };
}
