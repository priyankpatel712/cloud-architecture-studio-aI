import 'server-only';
import type { ConnectionDoc } from '@/lib/models/Connection';

/**
 * Public (client-safe) view of a CloudConnection — never includes the encrypted
 * secret fields (Constitution III). AWS expiry is computed at read time so every
 * surface can prompt re-authentication when the temporary session lapses (T037).
 */
export function toConnectionView(c: ConnectionDoc) {
  const expired =
    c.provider === 'aws' &&
    c.status === 'connected' &&
    c.sessionExpiresAt != null &&
    c.sessionExpiresAt.getTime() < Date.now();
  return {
    provider: c.provider,
    status: expired ? ('expired' as const) : c.status,
    accountId: c.accountId,
    alias: c.alias,
    region: c.region,
    permissionSet: c.permissionSet,
    sessionExpiresAt: c.sessionExpiresAt,
    orgId: c.orgId,
    orgName: c.orgName,
    projectsCount: c.projectsCount,
    updatedAt: c.updatedAt,
  };
}
