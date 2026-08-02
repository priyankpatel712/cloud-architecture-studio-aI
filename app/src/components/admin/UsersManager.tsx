'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Search,
  Pencil,
  Trash2,
  Loader2,
  TriangleAlert,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { RoleBadge, StatusBadge } from '@/components/admin/RoleBadge';
import { initialsOf } from '@/lib/initials';
import { canManageRole, ROLE_LABELS, type Role } from '@/lib/rbac';
import { cn } from '@/lib/cn';

interface Row {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'suspended' | 'invited';
  organization: string;
  lastLoginAt: string | null;
  createdAt: string | null;
}

const STATUSES = ['active', 'suspended', 'invited'] as const;

export function UsersManager({
  actorRole,
  actorId,
  assignable,
}: {
  actorRole: Role;
  actorId: string;
  assignable: Role[];
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load users');
      setRows(data.users);
    } catch (e) {
      setNotice({ kind: 'error', text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Deferred so the initial fetch's setState never runs synchronously in the effect.
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) => r.name.toLowerCase().includes(term) || r.email.toLowerCase().includes(term)
    );
  }, [rows, q]);

  const canManage = (r: Row) => canManageRole(actorRole, r.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-rise">
      <PageHeader
        eyebrow="User module"
        title="Users"
        subtitle="Create accounts, assign roles, and control access. You can only manage roles below your own."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <UserPlus size={18} /> Add user
          </Button>
        }
      />

      {notice && (
        <div
          className={cn(
            'flex items-start gap-2 rounded-2xl px-4 py-3 text-sm',
            notice.kind === 'error'
              ? 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
              : 'bg-[#1e8e3e]/12 text-[#1e8e3e]'
          )}
        >
          {notice.kind === 'error' ? <TriangleAlert size={16} className="mt-0.5" /> : <CheckCircle2 size={16} className="mt-0.5" />}
          {notice.text}
        </div>
      )}

      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto h-4 w-4 text-[var(--color-text-secondary)]" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="pl-9" />
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-surface-variant)] text-left text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                <th className="p-4 font-medium">User</th>
                <th className="p-4 font-medium">Role</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Last login</th>
                <th className="p-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-[var(--color-text-secondary)]">
                    <Loader2 className="mx-auto animate-spin" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-[var(--color-text-secondary)]">
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const self = r.id === actorId;
                  const manage = canManage(r);
                  return (
                    <tr key={r.id} className="border-b border-[var(--color-surface-variant)] last:border-0">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-secondary-container)] text-xs font-semibold text-[var(--color-on-secondary-container)]">
                            {initialsOf(r.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 font-medium text-[var(--color-text-primary)]">
                              {r.name}
                              {self && <span className="text-[11px] font-normal text-[var(--color-text-secondary)]">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-[var(--color-text-secondary)]">{r.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4"><RoleBadge role={r.role} /></td>
                      <td className="p-4"><StatusBadge status={r.status} /></td>
                      <td className="p-4 font-mono text-xs text-[var(--color-text-secondary)]">
                        {r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleDateString() : 'Never'}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-end gap-1">
                          {manage || self ? (
                            <>
                              <button
                                onClick={() => setEditRow(r)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)] hover:text-[var(--color-text-primary)]"
                                aria-label={`Edit ${r.name}`}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                onClick={() => setDeleteRow(r)}
                                disabled={self || !manage}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-error)] transition-colors hover:bg-[var(--color-error-container)] disabled:cursor-not-allowed disabled:opacity-30"
                                aria-label={`Delete ${r.name}`}
                              >
                                <Trash2 size={16} />
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-[var(--color-text-secondary)]">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        assignable={assignable}
        onDone={(msg) => {
          setCreateOpen(false);
          setNotice({ kind: 'success', text: msg });
          load();
        }}
      />

      {editRow && (
        <EditUserModal
          row={editRow}
          isSelf={editRow.id === actorId}
          assignable={assignable}
          onClose={() => setEditRow(null)}
          onDone={(msg) => {
            setEditRow(null);
            setNotice({ kind: 'success', text: msg });
            load();
          }}
        />
      )}

      {deleteRow && (
        <DeleteUserModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDone={(msg) => {
            setDeleteRow(null);
            setNotice({ kind: 'success', text: msg });
            load();
          }}
        />
      )}
    </div>
  );
}

/* ---------------- modals ---------------- */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
      {children}
    </label>
  );
}

function CreateUserModal({
  open,
  onClose,
  assignable,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  assignable: Role[];
  onDone: (msg: string) => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' as Role, organization: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? 'Failed to create user.');
    onDone(`${data.user.name} was created.`);
    setForm({ name: '', email: '', password: '', role: 'user', organization: '' });
  }

  return (
    <Modal open={open} onClose={onClose} title="Add user">
      <form onSubmit={submit} className="space-y-4">
        {err && <p className="rounded-xl bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-on-error-container)]">{err}</p>}
        <Field label="Full name">
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Temporary password">
          <Input type="text" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {assignable.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Organization">
            <Input value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />} Create</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  row,
  isSelf,
  assignable,
  onClose,
  onDone,
}: {
  row: Row;
  isSelf: boolean;
  assignable: Role[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [form, setForm] = useState({ name: row.name, role: row.role, status: row.status, password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ensure the current role is selectable even if not otherwise assignable.
  const roleOptions = Array.from(new Set<Role>([row.role, ...assignable]));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const payload: Record<string, unknown> = { name: form.name };
    if (!isSelf) {
      payload.role = form.role;
      payload.status = form.status;
    }
    if (form.password) payload.password = form.password;
    const res = await fetch(`/api/users/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? 'Failed to update user.');
    onDone(`${data.user.name} was updated.`);
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${row.name}`}>
      <form onSubmit={submit} className="space-y-4">
        {err && <p className="rounded-xl bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-on-error-container)]">{err}</p>}
        {isSelf && (
          <p className="rounded-xl bg-[var(--color-surface-container-low)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
            You can&apos;t change your own role or status.
          </p>
        )}
        <Field label="Full name">
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select disabled={isSelf} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {roleOptions.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select disabled={isSelf} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Row['status'] })}>
              {STATUSES.map((s) => (
                <option key={s} value={s} className="capitalize">{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Reset password (optional)">
          <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to keep current" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />} Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteUserModal({
  row,
  onClose,
  onDone,
}: {
  row: Row;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/users/${row.id}`, { method: 'DELETE' });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? 'Failed to delete user.');
    onDone(`${row.name} was deleted.`);
  }

  return (
    <Modal open onClose={onClose} title="Delete user">
      <div className="space-y-4">
        {err && <p className="rounded-xl bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-on-error-container)]">{err}</p>}
        <p className="text-sm text-[var(--color-text-secondary)]">
          Permanently delete <strong className="text-[var(--color-text-primary)]">{row.name}</strong> ({row.email})?
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="danger" onClick={confirm} disabled={busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
