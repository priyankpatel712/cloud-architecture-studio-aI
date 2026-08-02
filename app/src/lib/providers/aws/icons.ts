import manifest from './icon-manifest.json';

/**
 * Dynamic official-icon resolution (follow-up to 003: dynamic AI service catalog).
 *
 * `icon-manifest.json` is generated from the complete official AWS Architecture
 * Icons service set (300 icons, shipped at /icons/aws/svc/*.svg — see
 * public/icons/aws/README.md for provenance). Keys are the icon file names
 * lowercased and stripped of non-alphanumerics (e.g. "amazonroute53").
 *
 * This lets AI-added services that have no curated catalog entry still render
 * their official icon and official category color: we normalize the service's
 * display name ("Route 53") or slug id ("aws-route53") the same way and match.
 */

const entries = manifest as Record<string, { file: string; color: string }>;

/** Lowercase, strip non-alphanumerics, drop marketing prefixes. */
function normalize(q: string): string {
  const flat = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  return flat.replace(/^(amazon|aws)/, '');
}

// Pre-strip manifest keys once; keep the shortest file per stripped key so
// "s3" prefers AmazonSimpleStorageService over AmazonS3onOutposts.
const stripped = new Map<string, { file: string; color: string }>();
for (const [key, val] of Object.entries(entries)) {
  const s = key.replace(/^(amazon|aws)/, '');
  const prev = stripped.get(s);
  if (!prev || val.file.length < prev.file.length) stripped.set(s, val);
}

export interface OfficialIcon {
  url: string;
  color: string;
}

/**
 * Best-effort official icon for a service name or slug id. Exact normalized
 * match first, then prefix containment (shortest candidate wins). Null when
 * nothing plausibly matches — callers fall back to a category accent + glyph.
 */
export function officialAwsIcon(query: string): OfficialIcon | null {
  const q = normalize(query);
  if (!q) return null;
  const exact = stripped.get(q);
  if (exact) return { url: `/icons/aws/svc/${exact.file}`, color: exact.color };
  let best: { key: string; val: { file: string; color: string } } | null = null;
  for (const [key, val] of stripped) {
    if (key.startsWith(q) || q.startsWith(key)) {
      if (!best || key.length < best.key.length) best = { key, val };
    }
  }
  return best ? { url: `/icons/aws/svc/${best.val.file}`, color: best.val.color } : null;
}
