'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Sparkles, MoreVertical, Copy, Archive, ArchiveRestore, Share2, Trash2, Loader2, X,
  Search, ArrowUp, ArrowDown, ChevronsUpDown, TriangleAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PROVIDERS, formatUSD } from '@/lib/catalog';
import { cn } from '@/lib/cn';

/**
 * Projects list (US5, FR-022) as a data table: sortable columns, search, and
 * checkbox selection with a confirmed bulk delete for owners. Shared-with
 * projects stay read-only — they can be opened but never selected/deleted.
 * Deletion fans out over the existing per-project DELETE (ownership checks and
 * the architecture/chat/estimate/export cascade live server-side).
 */

interface ApiProject {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'archived';
  providers: ('aws' | 'mongodb' | 'system')[];
  services: number;
  monthly: number;
  owned: boolean;
  updatedAt: string;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const filters = ['All', 'Active', 'Draft', 'Archived'] as const;
type Filter = (typeof filters)[number];

type SortKey = 'name' | 'status' | 'services' | 'monthly' | 'updatedAt';
interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const STATUS_BADGE: Record<ApiProject['status'], { variant: 'success' | 'outline' | 'neutral'; label: string }> = {
  active: { variant: 'success', label: 'Active' },
  draft: { variant: 'outline', label: 'Draft' },
  archived: { variant: 'neutral', label: 'Archived' },
};

const PROVIDER_SHORT: Record<ApiProject['providers'][number], string> = {
  aws: 'AWS',
  mongodb: 'Atlas',
  system: 'System',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'updatedAt', dir: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load projects.');
      setProjects((await res.json()).projects);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = projects.filter(
      (p) =>
        (filter === 'All' || p.status === filter.toLowerCase()) &&
        (q === '' || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        case 'services':
          return (a.services - b.services) * dir;
        case 'monthly':
          return (a.monthly - b.monthly) * dir;
        default:
          return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * dir;
      }
    });
  }, [projects, filter, query, sort]);

  // The effective selection is derived as (checked ∩ owned-and-visible): rows
  // hidden by a filter/search stop counting immediately — bulk delete can never
  // include something the user can no longer see — and re-appear checked when
  // unhidden.
  const selectableIds = useMemo(() => visible.filter((p) => p.owned).map((p) => p.id), [visible]);
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((id) => selectableIds.includes(id))),
    [selected, selectableIds]
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => effectiveSelected.has(id));
  const someSelected = effectiveSelected.size > 0 && !allSelected;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'updatedAt' ? 'desc' : 'asc' }));

  const openConfirm = (ids: string[]) => {
    setDeleteErrors([]);
    setConfirmIds(ids);
  };

  async function deleteConfirmed() {
    if (!confirmIds || confirmIds.length === 0) return;
    setDeleting(true);
    setDeleteErrors([]);
    const byId = new Map(projects.map((p) => [p.id, p]));
    const results = await Promise.allSettled(
      confirmIds.map(async (id) => {
        const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`${byId.get(id)?.name ?? id}: ${(await res.json().catch(() => ({}))).error ?? 'delete failed'}`);
        return id;
      })
    );
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    setDeleting(false);
    setSelected(new Set());
    await load();
    if (failed.length > 0) {
      setDeleteErrors(failed.map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason))));
    } else {
      setConfirmIds(null);
    }
  }

  const totalMonthly = projects.reduce((s, p) => s + p.monthly, 0);
  const confirmProjects = (confirmIds ?? []).map((id) => projects.find((p) => p.id === id)).filter(Boolean) as ApiProject[];

  return (
    <div className="mx-auto max-w-6xl space-y-6 animate-rise">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        subtitle={
          loading
            ? 'Loading…'
            : `${projects.length} architecture${projects.length === 1 ? '' : 's'} · ${formatUSD(totalMonthly)} combined monthly estimate.`
        }
        actions={
          <Button asChild>
            <Link href="/projects/new">
              <Sparkles size={18} /> New architecture
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="h-9 w-56 pl-9 text-sm"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={
                filter === f
                  ? 'rounded-full bg-[var(--color-secondary-container)] px-4 py-1.5 text-sm font-medium text-[var(--color-on-secondary-container)]'
                  : 'rounded-full border border-[var(--color-outline-variant)] px-4 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-low)]'
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-2xl border border-[#f2b8b5] bg-[#fcece9] px-4 py-3 text-sm text-[#8c1d18]">{error}</p>
      )}

      <div className="overflow-hidden rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-surface-variant)] bg-[var(--color-surface-container-low)]/60">
              <th scope="col" className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={allSelected ? 'Deselect all projects' : 'Select all projects'}
                  checked={allSelected}
                  disabled={selectableIds.length === 0}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4 cursor-pointer rounded accent-[var(--color-primary)] disabled:cursor-default"
                />
              </th>
              <SortableHeader label="Project" sortKey="name" sort={sort} onSort={toggleSort} />
              <SortableHeader label="Status" sortKey="status" sort={sort} onSort={toggleSort} className="w-28" />
              <th scope="col" className="hidden w-36 px-4 py-3 font-medium text-[var(--color-text-secondary)] lg:table-cell">
                Providers
              </th>
              <SortableHeader label="Services" sortKey="services" sort={sort} onSort={toggleSort} className="hidden w-24 text-right md:table-cell" align="right" />
              <SortableHeader label="Monthly" sortKey="monthly" sort={sort} onSort={toggleSort} className="w-28 text-right" align="right" />
              <SortableHeader label="Updated" sortKey="updatedAt" sort={sort} onSort={toggleSort} className="hidden w-28 md:table-cell" />
              <th scope="col" className="w-12 px-2 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0, 1, 2, 3].map((i) => (
                <tr key={i} className="border-b border-[var(--color-surface-variant)] last:border-b-0">
                  <td className="px-4 py-4" colSpan={8}>
                    <div className="h-4 animate-pulse rounded-full bg-[var(--color-surface-container-high)]" style={{ width: `${70 - i * 12}%` }} />
                  </td>
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-14 text-center">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {query.trim()
                      ? 'No projects match your search'
                      : filter === 'All'
                        ? 'No projects yet'
                        : `No ${filter.toLowerCase()} projects`}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    {query.trim()
                      ? 'Try a different name, or clear the search.'
                      : 'Describe a system on the New architecture page and the AI will design it with you.'}
                  </p>
                </td>
              </tr>
            ) : (
              visible.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  selected={effectiveSelected.has(p.id)}
                  onToggle={() => toggleOne(p.id)}
                  onDelete={() => openConfirm([p.id])}
                  onChanged={load}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Selection action bar — appears only while rows are checked. */}
      {effectiveSelected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] py-2 pl-5 pr-2 shadow-xl animate-rise">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">
            {effectiveSelected.size} selected
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
          >
            Clear
          </button>
          <Button variant="danger" size="sm" onClick={() => openConfirm([...effectiveSelected])}>
            <Trash2 size={14} /> Delete {effectiveSelected.size === 1 ? 'project' : `${effectiveSelected.size} projects`}
          </Button>
        </div>
      )}

      <Modal
        open={confirmIds !== null}
        onClose={() => !deleting && setConfirmIds(null)}
        title={`Delete ${confirmProjects.length === 1 ? `"${confirmProjects[0]?.name}"` : `${confirmProjects.length} projects`}?`}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-2xl bg-[var(--color-error-container)]/50 p-3 text-[13px] leading-snug text-[var(--color-on-error-container)]">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <p>
              This permanently deletes {confirmProjects.length === 1 ? 'the project' : 'each project'} along with its
              architecture, chat thread, cost estimates, and export history. This cannot be undone.
            </p>
          </div>
          {confirmProjects.length > 1 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-2xl border border-[var(--color-surface-variant)] p-3">
              {confirmProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="truncate font-medium text-[var(--color-text-primary)]">{p.name}</span>
                  <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                    {p.services} service{p.services === 1 ? '' : 's'} · {formatUSD(p.monthly)}/mo
                  </span>
                </li>
              ))}
            </ul>
          )}
          {deleteErrors.length > 0 && (
            <div className="rounded-2xl border border-[#f2b8b5] bg-[#fcece9] px-3 py-2 text-xs text-[#8c1d18]">
              <p className="font-medium">Some projects could not be deleted:</p>
              <ul className="mt-1 list-inside list-disc">
                {deleteErrors.map((msg) => (
                  <li key={msg}>{msg}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmIds(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={deleteConfirmed} disabled={deleting || confirmProjects.length === 0}>
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete {confirmProjects.length === 1 ? 'project' : `${confirmProjects.length} projects`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onSort: (key: SortKey) => void;
  className?: string;
  align?: 'right';
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className={cn('px-4 py-3 font-medium text-[var(--color-text-secondary)]', className)}
    >
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 rounded transition-colors hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]',
          active && 'text-[var(--color-text-primary)]',
          align === 'right' && 'flex-row-reverse'
        )}
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
        ) : (
          <ChevronsUpDown size={13} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

function ProjectRow({
  project,
  selected,
  onToggle,
  onDelete,
  onChanged,
}: {
  project: ApiProject;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onChanged: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // 007 1.3 — public read-only link state (path or null), loaded when the
  // share panel opens; 'unknown' until the first fetch resolves.
  const [publicLink, setPublicLink] = useState<string | null | 'unknown'>('unknown');
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const status = STATUS_BADGE[project.status];

  useEffect(() => {
    if (!shareOpen) return;
    const t = setTimeout(() => {
      setPublicLink('unknown');
      fetch(`/api/projects/${project.id}/share-link`)
        .then((res) => (res.ok ? res.json() : { path: null }))
        .then((data) => setPublicLink(data.path ?? null))
        .catch(() => setPublicLink(null));
    }, 0);
    return () => clearTimeout(t);
  }, [shareOpen, project.id]);

  const copyToClipboard = async (kind: 'link' | 'embed') => {
    if (typeof publicLink !== 'string') return;
    const url = `${window.location.origin}${publicLink}`;
    const text = kind === 'link' ? url : `<iframe src="${url}?embed=1" width="960" height="600" style="border:0"></iframe>`;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  const setLink = async (method: 'POST' | 'DELETE') => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/share-link`, { method });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? 'Could not update the public link.');
        return;
      }
      setPublicLink(data.path ?? null);
    } catch {
      setActionError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  async function act(fn: () => Promise<Response>) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setActionError((await res.json()).error ?? 'Action failed.');
        return false;
      }
      setMenuOpen(false);
      onChanged();
      return true;
    } catch {
      setActionError('Could not reach the server.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  const duplicate = () => act(() => fetch(`/api/projects/${project.id}/duplicate`, { method: 'POST' }));
  const setStatus = (status: 'active' | 'archived') =>
    act(() =>
      fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
    );
  const share = async () => {
    if (!shareEmail.trim()) return;
    const ok = await act(() =>
      fetch(`/api/projects/${project.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: shareEmail.trim() }),
      })
    );
    if (ok) {
      setShareOpen(false);
      setShareEmail('');
    }
  };

  return (
    <tr
      className={cn(
        'border-b border-[var(--color-surface-variant)] transition-colors last:border-b-0',
        selected ? 'bg-[var(--color-secondary-container)]/30' : 'hover:bg-[var(--color-surface-container-low)]/60'
      )}
    >
      <td className="px-4 py-3.5">
        <input
          type="checkbox"
          aria-label={project.owned ? `Select ${project.name}` : `${project.name} is shared with you — only the owner can delete it`}
          checked={selected}
          disabled={!project.owned}
          onChange={onToggle}
          title={project.owned ? undefined : 'Shared with you — only the owner can delete it'}
          className="h-4 w-4 cursor-pointer rounded accent-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40"
        />
      </td>
      <td className="max-w-0 px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Link
            href={`/studio?project=${project.id}`}
            className="truncate font-medium text-[var(--color-text-primary)] hover:underline"
          >
            {project.name}
          </Link>
          {!project.owned && (
            <Badge size="sm" variant="neutral" className="shrink-0">
              Shared
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-[var(--color-text-secondary)]">
          {project.description || 'No description yet.'}
        </p>
      </td>
      <td className="px-4 py-3.5">
        <Badge size="sm" variant={status.variant}>
          {status.label}
        </Badge>
      </td>
      <td className="hidden px-4 py-3.5 lg:table-cell">
        <div className="flex flex-wrap items-center gap-1">
          {project.providers.length === 0 ? (
            <span className="text-xs text-[var(--color-text-secondary)]">—</span>
          ) : (
            project.providers.map((pr) => (
              <span
                key={pr}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-outline-variant)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: PROVIDERS[pr].accent }} />
                {PROVIDER_SHORT[pr]}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="hidden px-4 py-3.5 text-right tabular-nums text-[var(--color-text-primary)] md:table-cell">
        {project.services}
      </td>
      <td className="px-4 py-3.5 text-right font-mono text-[13px] font-medium tabular-nums text-[var(--color-text-primary)]">
        {formatUSD(project.monthly)}
        <span className="text-[10px] font-normal text-[var(--color-text-secondary)]">/mo</span>
      </td>
      <td className="hidden px-4 py-3.5 text-xs text-[var(--color-text-secondary)] md:table-cell" title={new Date(project.updatedAt).toLocaleString()}>
        {relativeTime(project.updatedAt)}
      </td>
      <td className="relative px-2 py-3.5">
        {project.owned && (
          <>
            <button
              aria-label={`Actions for ${project.name}`}
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((o) => !o);
                setShareOpen(false);
                setActionError(null);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-container-high)]"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <MoreVertical size={15} />}
            </button>
            {menuOpen && (
              <>
                <button
                  aria-label="Close menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-2 top-11 z-20 w-52 rounded-2xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] p-1.5 shadow-lg">
                  {shareOpen ? (
                    <div className="p-1.5">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--color-text-primary)]">Share (read-only)</span>
                        <button aria-label="Close share" onClick={() => setShareOpen(false)}>
                          <X size={13} className="text-[var(--color-text-secondary)]" />
                        </button>
                      </div>
                      <Input
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && share()}
                        placeholder="teammate@company.com"
                        className="mb-1.5 h-8 text-xs"
                        autoFocus
                      />
                      {actionError && <p className="mb-1.5 text-[11px] text-[#8c1d18]">{actionError}</p>}
                      <Button size="sm" className="h-7 w-full text-xs" onClick={share} disabled={busy || !shareEmail.trim()}>
                        Share
                      </Button>
                      {/* 007 1.3 — public read-only link (token = credential, revocable). */}
                      <div className="mt-2 border-t border-[var(--color-surface-variant)] pt-2">
                        <p className="mb-1.5 text-[11px] font-medium text-[var(--color-text-primary)]">Public link (view-only)</p>
                        {publicLink === 'unknown' ? (
                          <p className="text-[11px] text-[var(--color-text-secondary)]">Checking…</p>
                        ) : publicLink ? (
                          <div className="space-y-1">
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" className="h-7 flex-1 text-[11px]" onClick={() => copyToClipboard('link')}>
                                {copied === 'link' ? 'Copied!' : 'Copy link'}
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 flex-1 text-[11px]" onClick={() => copyToClipboard('embed')}>
                                {copied === 'embed' ? 'Copied!' : 'Copy embed'}
                              </Button>
                            </div>
                            <button
                              onClick={() => setLink('DELETE')}
                              disabled={busy}
                              className="w-full text-left text-[11px] font-medium text-[var(--color-error)] hover:underline"
                            >
                              Revoke public link
                            </button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" className="h-7 w-full text-[11px]" onClick={() => setLink('POST')} disabled={busy}>
                            Create public link
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {actionError && <p className="px-2 py-1 text-[11px] text-[#8c1d18]">{actionError}</p>}
                      <MenuItem icon={<Copy size={14} />} label="Duplicate" onClick={duplicate} />
                      <MenuItem icon={<Share2 size={14} />} label="Share…" onClick={() => setShareOpen(true)} />
                      {project.status === 'archived' ? (
                        <MenuItem icon={<ArchiveRestore size={14} />} label="Unarchive" onClick={() => setStatus('active')} />
                      ) : (
                        <MenuItem icon={<Archive size={14} />} label="Archive" onClick={() => setStatus('archived')} />
                      )}
                      <MenuItem
                        icon={<Trash2 size={14} />}
                        label="Delete"
                        destructive
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete();
                        }}
                      />
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs font-medium transition-colors hover:bg-[var(--color-surface-container-low)]',
        destructive ? 'text-[var(--color-error)]' : 'text-[var(--color-text-primary)]'
      )}
    >
      {icon} {label}
    </button>
  );
}
