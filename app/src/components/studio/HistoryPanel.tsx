'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Eye, RotateCcw, MessageSquareText, MousePointerClick, History } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

/**
 * Version-history panel (007 roadmap 1.1): browsable list of persisted diagram
 * versions with Preview (loads the snapshot onto the canvas, save disabled)
 * and owner-only Restore (append-only — restoring writes a NEW version).
 */

export interface VersionEntry {
  id: string;
  version: number;
  source: 'chat-turn' | 'direct-edit' | 'restore';
  summary: string[];
  counts: { nodes: number; edges: number; containers: number };
  createdAt: string;
}

export interface VersionSnapshotDoc {
  nodes: unknown[];
  edges: unknown[];
  containers: unknown[];
  annotations: unknown[];
  guidance: Record<string, string>;
}

const SOURCE_META: Record<VersionEntry['source'], { label: string; icon: React.ReactNode }> = {
  'chat-turn': { label: 'AI turn', icon: <MessageSquareText size={12} /> },
  'direct-edit': { label: 'Canvas edit', icon: <MousePointerClick size={12} /> },
  restore: { label: 'Restore', icon: <History size={12} /> },
};

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

export function HistoryPanel({
  open,
  onClose,
  projectId,
  currentVersion,
  canRestore,
  onPreview,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  currentVersion: number;
  /** owner-only — shared viewers can browse and preview but never restore */
  canRestore: boolean;
  /** load a snapshot onto the canvas in preview mode */
  onPreview: (entry: VersionEntry, snapshot: VersionSnapshotDoc) => void;
  /** a restore succeeded — reload the latest architecture */
  onRestored: (newVersion: number) => void;
}) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load the version history.');
      setVersions((await res.json()).versions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the version history.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [open, load]);

  async function fetchSnapshot(entry: VersionEntry): Promise<VersionSnapshotDoc | null> {
    const res = await fetch(`/api/projects/${projectId}/versions/${entry.id}`);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? 'Could not load that version.');
      return null;
    }
    return (await res.json()).snapshot as VersionSnapshotDoc;
  }

  async function preview(entry: VersionEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      const snapshot = await fetchSnapshot(entry);
      if (snapshot) {
        onPreview(entry, snapshot);
        onClose();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function restore(entry: VersionEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/versions/${entry.id}/restore`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Restore failed.');
        return;
      }
      onRestored(data.version as number);
      onClose();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Version history" size="lg">
      {error && (
        <p className="mb-3 rounded-2xl border border-[#f2b8b5] bg-[#fcece9] px-3 py-2 text-xs text-[#8c1d18]">{error}</p>
      )}
      {loading ? (
        <p className="flex items-center gap-2 py-6 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={15} className="animate-spin" /> Loading history…
        </p>
      ) : versions.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">
          No saved versions yet — versions are recorded every time the diagram is saved or an AI turn changes it.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {versions.map((v) => {
            const meta = SOURCE_META[v.source];
            const isCurrent = v.version === currentVersion;
            return (
              <li
                key={v.id}
                className="flex items-center gap-3 rounded-2xl border border-[var(--color-surface-variant)] px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-primary)]">v{v.version}</span>
                    {isCurrent && (
                      <Badge size="sm" variant="primary">
                        Current
                      </Badge>
                    )}
                    <Badge size="sm" variant="neutral" className="gap-1">
                      {meta.icon} {meta.label}
                    </Badge>
                    <span className="text-[11px] text-[var(--color-text-secondary)]" title={new Date(v.createdAt).toLocaleString()}>
                      {relativeTime(v.createdAt)}
                    </span>
                    <span className="text-[11px] text-[var(--color-text-secondary)]">
                      {v.counts.nodes} service{v.counts.nodes === 1 ? '' : 's'} · {v.counts.edges} connection{v.counts.edges === 1 ? '' : 's'}
                    </span>
                  </div>
                  {v.summary.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]" title={v.summary.join(', ')}>
                      {v.summary.join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => preview(v)} disabled={busyId !== null}>
                    {busyId === v.id ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Preview
                  </Button>
                  {canRestore && !isCurrent && (
                    <Button variant="outline" size="sm" onClick={() => restore(v)} disabled={busyId !== null}>
                      {busyId === v.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />} Restore
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
