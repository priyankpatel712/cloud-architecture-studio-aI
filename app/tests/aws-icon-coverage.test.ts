import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AWS_EXTENDED_SERVICES,
  CURATED_ICON_FILES,
  EXTENDED_ICON_FILES,
  SKIPPED_ICON_FILES,
} from '@/lib/providers/aws/catalog-extended';
import { SERVICES } from '@/lib/catalog';

/**
 * "Nothing missing" guarantee: every official AWS Architecture Icon shipped in
 * public/icons/aws/svc is reachable from the studio palette — either through a
 * curated catalog service, an extended catalog entry, or an explicit skip with
 * a reason (theme variants). A new icon drop that adds files fails this test
 * until the extended catalog names them.
 */

const SVC_DIR = join(process.cwd(), 'public', 'icons', 'aws', 'svc');
const onDisk = readdirSync(SVC_DIR)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.replace(/\.svg$/, ''));

describe('AWS icon coverage', () => {
  it('accounts for every shipped official icon', () => {
    const claimed = new Set([...CURATED_ICON_FILES, ...EXTENDED_ICON_FILES, ...SKIPPED_ICON_FILES]);
    const missing = onDisk.filter((f) => !claimed.has(f));
    expect(missing, `icons on disk with no palette entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('references only icons that actually exist on disk', () => {
    const disk = new Set(onDisk);
    const stale = [...CURATED_ICON_FILES, ...EXTENDED_ICON_FILES, ...SKIPPED_ICON_FILES].filter(
      (f) => !disk.has(f)
    );
    expect(stale, `catalog references icons not on disk: ${stale.join(', ')}`).toEqual([]);
  });

  it('claims each icon exactly once across curated/extended/skipped', () => {
    const all = [...CURATED_ICON_FILES, ...EXTENDED_ICON_FILES, ...SKIPPED_ICON_FILES];
    const dupes = all.filter((f, i) => all.indexOf(f) !== i);
    expect(dupes, `icons claimed by more than one list: ${dupes.join(', ')}`).toEqual([]);
  });

  it('gives every service in the combined catalog a unique id', () => {
    const ids = SERVICES.map((s) => s.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate service ids: ${dupes.join(', ')}`).toEqual([]);
  });

  it('resolves an official accent color for every extended service', () => {
    for (const s of AWS_EXTENDED_SERVICES) {
      expect(s.accent, `${s.id} accent`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.iconUrl, `${s.id} iconUrl`).toMatch(/^\/icons\/aws\/svc\/.+\.svg$/);
    }
  });
});
