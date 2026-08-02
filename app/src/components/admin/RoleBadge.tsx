import { Badge } from '@/components/ui/Badge';
import { ROLE_LABELS, type Role } from '@/lib/rbac';

const variant: Record<Role, 'danger' | 'primary' | 'neutral'> = {
  super_admin: 'danger',
  admin: 'primary',
  user: 'neutral',
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <Badge variant={variant[role]} size="sm">
      {ROLE_LABELS[role]}
    </Badge>
  );
}

const statusVariant = {
  active: 'success',
  suspended: 'danger',
  invited: 'warning',
} as const;

export function StatusBadge({ status }: { status: 'active' | 'suspended' | 'invited' }) {
  return (
    <Badge variant={statusVariant[status]} size="sm" className="capitalize">
      {status}
    </Badge>
  );
}
