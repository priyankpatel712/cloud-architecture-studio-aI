/**
 * Session memory (agentic-concepts: "Session Memory") — durable per-
 * conversation facts that survive transcript eviction.
 *
 * The rendered conversation context (conversation-context.ts) is a rolling
 * window: under its character budget, a decision made in turn 2 falls out of
 * view by turn 25. This module keeps the *distilled* state — decisions the
 * user confirmed, stated constraints and preferences, and each turn's coverage
 * outcome — as small structured entries persisted on the AIConversation, and
 * renders them as a block that is prepended to every stage's conversation
 * context (intent resolver, analyzer, planner). A constraint stated once
 * therefore keeps binding the planner for the whole session, no matter how
 * long the thread gets.
 *
 * Entries are DERIVED DETERMINISTICALLY from state the turn already computed
 * (the brief, the applied option, HITL decisions, the review verdict) — no
 * extra model call sits on the latency path to remember things.
 *
 * Pure and import-free — unit-testable in isolation.
 */

export type SessionMemoryKind = 'decision' | 'preference' | 'constraint' | 'outcome';

export interface SessionMemoryEntry {
  kind: SessionMemoryKind;
  text: string;
  /** 1-based user-turn index when the fact was recorded */
  turn: number;
}

/** Hard cap on stored entries — newest win, like the transcript window. */
export const SESSION_MEMORY_LIMIT = 40;

/** Ceiling on the rendered block, sized to sit beside the 1.5k transcript budget. */
export const SESSION_MEMORY_CHAR_BUDGET = 900;

const MAX_ENTRY_TEXT = 160;

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function sanitize(entry: SessionMemoryEntry): SessionMemoryEntry | null {
  const text = entry.text.trim();
  if (!text) return null;
  return {
    kind: entry.kind,
    text: text.length > MAX_ENTRY_TEXT ? `${text.slice(0, MAX_ENTRY_TEXT)}…` : text,
    turn: Math.max(1, Math.floor(entry.turn)),
  };
}

/**
 * Merge new entries into the stored list: deduplicated on (kind, normalized
 * text) with the newest occurrence kept, capped at SESSION_MEMORY_LIMIT with
 * the oldest entries evicted first. Outcome entries additionally supersede the
 * previous outcome — only the latest coverage result is worth remembering.
 */
export function mergeSessionMemory(
  existing: readonly SessionMemoryEntry[],
  added: readonly SessionMemoryEntry[]
): SessionMemoryEntry[] {
  const sanitizedAdded = added.map(sanitize).filter((e): e is SessionMemoryEntry => e !== null);
  const hasNewOutcome = sanitizedAdded.some((e) => e.kind === 'outcome');
  const base = existing
    .map(sanitize)
    .filter((e): e is SessionMemoryEntry => e !== null)
    .filter((e) => !(hasNewOutcome && e.kind === 'outcome'));

  const merged: SessionMemoryEntry[] = [];
  const seen = new Set<string>();
  // Walk newest-first so the most recent statement of a fact wins its slot.
  for (const e of [...sanitizedAdded.reverse(), ...base.reverse()]) {
    const key = `${e.kind}:${normalize(e.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(e);
    if (merged.length >= SESSION_MEMORY_LIMIT) break;
  }
  // Stored (and rendered) oldest-first, matching how the transcript reads.
  return merged.reverse();
}

/**
 * Derive this turn's durable entries from the consolidated brief. Constraints
 * and answered/defaulted scale assumptions bind future turns; explicit service
 * selections are decisions the planner must keep honoring.
 */
export function deriveBriefMemory(
  brief: {
    constraints?: readonly string[];
    scaleAssumptions?: readonly { key: string; value: string; source?: string }[];
    selections?: readonly { need?: string; serviceId: string }[];
  },
  turn: number
): SessionMemoryEntry[] {
  const entries: SessionMemoryEntry[] = [];
  for (const c of brief.constraints ?? []) {
    entries.push({ kind: 'constraint', text: c, turn });
  }
  for (const s of brief.scaleAssumptions ?? []) {
    if (!s.key) continue;
    entries.push({
      kind: 'preference',
      text: `${s.key}: ${s.value}${s.source === 'defaulted' ? ' (defaulted)' : ''}`,
      turn,
    });
  }
  for (const sel of brief.selections ?? []) {
    entries.push({
      kind: 'decision',
      text: `Selected ${sel.serviceId}${sel.need ? ` for ${sel.need}` : ''}`,
      turn,
    });
  }
  return entries;
}

/**
 * Render the stored entries as the prompt block prepended to the conversation
 * context. Returns '' when empty — callers omit the section entirely. Newest
 * entries survive the budget (walked backwards), rendered oldest-first.
 */
export function renderSessionMemory(
  entries: readonly SessionMemoryEntry[],
  maxChars = SESSION_MEMORY_CHAR_BUDGET
): string {
  if (entries.length === 0 || maxChars <= 0) return '';
  const header = 'SESSION MEMORY (durable decisions, constraints and preferences from this conversation — honor them unless the user changes them):';
  const kept: string[] = [];
  let used = header.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = sanitize(entries[i]);
    if (!e) continue;
    const line = `- [${e.kind}] ${e.text}`;
    const cost = line.length + 1;
    if (used + cost > maxChars) break;
    kept.push(line);
    used += cost;
  }
  if (kept.length === 0) return '';
  return [header, ...kept.reverse()].join('\n');
}
