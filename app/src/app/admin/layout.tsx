import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { isAdminRole } from '@/lib/rbac';
import { AdminShell } from '@/components/admin/AdminShell';

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session || !isAdminRole(session.role)) redirect('/login');

  return (
    <AdminShell user={{ name: session.name, email: session.email, role: session.role }}>
      {children}
    </AdminShell>
  );
}
