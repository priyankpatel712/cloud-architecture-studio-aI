import 'server-only';
import type { CommentThreadDoc } from '@/lib/models/CommentThread';

/** Client-facing thread shape (007 roadmap 2.2), shared by the comment routes. */
export function threadView(t: CommentThreadDoc, userId: string, projectOwnerId: string) {
  const anchor = t.anchor ?? { kind: 'project' as const, targetId: null, targetLabel: '' };
  return {
    id: String(t._id),
    anchor: { kind: anchor.kind ?? 'project', targetId: anchor.targetId ?? null, targetLabel: anchor.targetLabel ?? '' },
    resolved: t.resolved,
    canModerate: String(t.createdBy) === userId || projectOwnerId === userId,
    messages: t.messages.map((m) => ({
      authorName: m.authorName || 'Someone',
      mine: String(m.authorId) === userId,
      text: m.text,
      createdAt: m.createdAt,
    })),
    updatedAt: t.updatedAt,
  };
}
