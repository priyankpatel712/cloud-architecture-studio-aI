'use client';
import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquarePlus, Check, RotateCcw, Trash2, Crosshair, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

/**
 * Comment threads panel (007 roadmap 2.2): pin-style discussions anchored to
 * a service/container or to the whole project. No realtime — refetches when
 * opened. Anyone with read access can comment; resolve/delete shows only for
 * the thread author or project owner (server enforces it too).
 */

export interface CommentThreadView {
  id: string;
  anchor: { kind: 'node' | 'container' | 'project'; targetId: string | null; targetLabel: string };
  resolved: boolean;
  canModerate: boolean;
  messages: { authorName: string; mine: boolean; text: string; createdAt: string }[];
  updatedAt: string;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function CommentsPanel({
  projectId,
  onClose,
  selection,
  onJumpTo,
}: {
  projectId: string;
  onClose: () => void;
  /** currently selected canvas element, offered as the anchor for a new thread */
  selection: { id: string; label: string; kind: 'node' | 'container' } | null;
  /** center the canvas on an anchored element */
  onJumpTo: (targetId: string) => void;
}) {
  const [threads, setThreads] = useState<CommentThreadView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load comments.');
      setThreads((await res.json()).threads);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load comments.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function createThread() {
    if (!draft.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: draft.trim(),
          anchor: selection
            ? { kind: selection.kind, targetId: selection.id, targetLabel: selection.label }
            : { kind: 'project' },
        }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? 'Could not post the comment.');
        return;
      }
      setDraft('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function reply(threadId: string) {
    const text = (replyDrafts[threadId] ?? '').trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/comments/${threadId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setReplyDrafts((d) => ({ ...d, [threadId]: '' }));
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function setResolved(threadId: string, resolved: boolean) {
    await fetch(`/api/projects/${projectId}/comments/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved }),
    });
    await load();
  }

  async function remove(threadId: string) {
    if (!window.confirm('Delete this comment thread?')) return;
    await fetch(`/api/projects/${projectId}/comments/${threadId}`, { method: 'DELETE' });
    await load();
  }

  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);

  const renderThread = (t: CommentThreadView) => (
    <div key={t.id} className={cn('rounded-2xl border border-[var(--color-surface-variant)] p-2.5', t.resolved && 'opacity-70')}>
      <div className="mb-1.5 flex items-center gap-1.5">
        {t.anchor.kind === 'project' ? (
          <Badge size="sm" variant="neutral">Project</Badge>
        ) : (
          <button
            onClick={() => t.anchor.targetId && onJumpTo(t.anchor.targetId)}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--color-outline-variant)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            title="Jump to this element"
          >
            <Crosshair size={10} /> {t.anchor.targetLabel || t.anchor.kind}
          </button>
        )}
        <span className="min-w-0 flex-1" />
        {t.canModerate && (
          <>
            <button
              aria-label={t.resolved ? 'Reopen thread' : 'Resolve thread'}
              title={t.resolved ? 'Reopen' : 'Resolve'}
              onClick={() => setResolved(t.id, !t.resolved)}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              {t.resolved ? <RotateCcw size={13} /> : <Check size={13} />}
            </button>
            <button
              aria-label="Delete thread"
              title="Delete"
              onClick={() => remove(t.id)}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-error)]"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        {t.messages.map((m, i) => (
          <div key={i} className="text-xs">
            <span className={cn('font-semibold', m.mine ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-primary)]')}>
              {m.mine ? 'You' : m.authorName}
            </span>
            <span className="ml-1.5 text-[10px] text-[var(--color-text-secondary)]">{relativeTime(m.createdAt)}</span>
            <p className="whitespace-pre-wrap text-[var(--color-text-primary)]">{m.text}</p>
          </div>
        ))}
      </div>
      {!t.resolved && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={replyDrafts[t.id] ?? ''}
            onChange={(e) => setReplyDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && reply(t.id)}
            placeholder="Reply…"
            className="h-7 min-w-0 flex-1 rounded-lg border border-[var(--color-outline-variant)] bg-transparent px-2 text-xs focus:border-[var(--color-primary)] focus:outline-none"
          />
          <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => reply(t.id)} disabled={busy || !(replyDrafts[t.id] ?? '').trim()}>
            Reply
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="absolute right-3 top-14 z-30 flex max-h-[calc(100%-5rem)] w-80 flex-col rounded-3xl border border-[var(--color-surface-variant)] bg-[var(--color-surface-container-lowest)] shadow-xl">
      <div className="flex items-center justify-between border-b border-[var(--color-surface-variant)] px-4 py-2.5">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Comments {open.length > 0 && <span className="text-[var(--color-text-secondary)]">({open.length})</span>}
        </h3>
        <button aria-label="Close comments" onClick={onClose} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
          <X size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {error && <p className="rounded-xl border border-[#f2b8b5] bg-[#fcece9] px-2.5 py-1.5 text-[11px] text-[#8c1d18]">{error}</p>}
        {loading ? (
          <p className="flex items-center gap-2 py-4 text-xs text-[var(--color-text-secondary)]">
            <Loader2 size={13} className="animate-spin" /> Loading comments…
          </p>
        ) : threads.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--color-text-secondary)]">
            No comments yet. Select an element to anchor your first note, or comment on the whole project.
          </p>
        ) : (
          <>
            {open.map(renderThread)}
            {resolved.length > 0 && (
              <button
                onClick={() => setShowResolved((s) => !s)}
                className="w-full text-left text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved thread{resolved.length === 1 ? '' : 's'}
              </button>
            )}
            {showResolved && resolved.map(renderThread)}
          </>
        )}
      </div>

      <div className="border-t border-[var(--color-surface-variant)] p-3">
        <p className="mb-1.5 text-[10px] text-[var(--color-text-secondary)]">
          {selection ? `Commenting on: ${selection.label}` : 'Commenting on the whole project (select an element to anchor)'}
        </p>
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createThread()}
            placeholder="Add a comment…"
            className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--color-outline-variant)] bg-transparent px-2 text-xs focus:border-[var(--color-primary)] focus:outline-none"
          />
          <Button size="sm" className="h-8 px-2.5 text-xs" onClick={createThread} disabled={busy || !draft.trim()}>
            <MessageSquarePlus size={13} /> Post
          </Button>
        </div>
      </div>
    </div>
  );
}
