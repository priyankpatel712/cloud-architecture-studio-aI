import { getSession } from '@/lib/session';
import { assignableRoles } from '@/lib/rbac';
import { UsersManager } from '@/components/admin/UsersManager';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  // Session is guaranteed by the admin layout; assert for types.
  const session = (await getSession())!;
  return (
    <UsersManager
      actorRole={session.role}
      actorId={session.sub}
      assignable={assignableRoles(session.role)}
    />
  );
}
