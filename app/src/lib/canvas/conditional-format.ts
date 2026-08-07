import type { EdgeColor, FormatRule, FormatRuleField, FormatRuleOp } from '@/lib/canvas/model';

/**
 * Conditional formatting engine (Lucid-parity data linking).
 *
 * Rules color service nodes from the data they already carry — monthly cost,
 * provider, category, serviceId, or display name — instead of a manual accent
 * per node. "Highlight everything over $100/mo" stays true as prices change,
 * because evaluation happens at render time against live node data; nothing is
 * written onto the nodes.
 *
 * FIRST MATCH WINS, in stored rule order — one node, one accent, and the user
 * controls precedence by reordering (deleting/re-adding) rules. A matched rule
 * outranks a manual accent override: a data-driven signal that silently lost
 * to a cosmetic choice would make rules look broken.
 *
 * Pure — imports types only; unit-testable in isolation.
 */

export const RULE_FIELDS: { id: FormatRuleField; label: string; numeric: boolean }[] = [
  { id: 'cost', label: 'Monthly cost ($)', numeric: true },
  { id: 'provider', label: 'Provider', numeric: false },
  { id: 'category', label: 'Category', numeric: false },
  { id: 'serviceId', label: 'Service id', numeric: false },
  { id: 'name', label: 'Display name', numeric: false },
];

export const RULE_OPS: { id: FormatRuleOp; label: string; numeric: boolean }[] = [
  { id: 'gt', label: '>', numeric: true },
  { id: 'gte', label: '≥', numeric: true },
  { id: 'lt', label: '<', numeric: true },
  { id: 'lte', label: '≤', numeric: true },
  { id: 'eq', label: 'is', numeric: false },
  { id: 'neq', label: 'is not', numeric: false },
  { id: 'contains', label: 'contains', numeric: false },
];

const FIELD_IDS = new Set(RULE_FIELDS.map((f) => f.id));
const OP_IDS = new Set(RULE_OPS.map((o) => o.id));
const ACCENTS = new Set(['primary', 'success', 'warning', 'danger']);

/** Hard cap mirrored by the zod save schema — a styling system, not a database. */
export const FORMAT_RULE_LIMIT = 20;

export interface RuleSubject {
  cost: number;
  serviceId: string;
  provider?: string;
  category?: string;
  displayName?: string;
}

let ruleSeq = 0;
export function newFormatRuleId(): string {
  ruleSeq = (ruleSeq + 1) % 1000;
  return `fr${Date.now().toString(36)}${ruleSeq}`;
}

function fieldValue(subject: RuleSubject, field: FormatRuleField): string | number {
  switch (field) {
    case 'cost': return subject.cost;
    case 'provider': return subject.provider ?? '';
    case 'category': return subject.category ?? '';
    case 'serviceId': return subject.serviceId;
    case 'name': return subject.displayName ?? '';
  }
}

function matches(rule: FormatRule, subject: RuleSubject): boolean {
  const actual = fieldValue(subject, rule.field);
  const isNumericOp = rule.op === 'gt' || rule.op === 'gte' || rule.op === 'lt' || rule.op === 'lte';
  if (isNumericOp) {
    // Numeric comparison — both sides must parse; a rule like `provider > 3`
    // simply never matches rather than coercing garbage.
    const left = typeof actual === 'number' ? actual : Number(actual);
    const right = Number(rule.value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (rule.op === 'gt') return left > right;
    if (rule.op === 'gte') return left >= right;
    if (rule.op === 'lt') return left < right;
    return left <= right;
  }
  const left = String(actual).trim().toLowerCase();
  const right = rule.value.trim().toLowerCase();
  if (rule.op === 'eq') return left === right;
  if (rule.op === 'neq') return left !== right && right.length > 0;
  return right.length > 0 && left.includes(right);
}

/** The accent of the FIRST matching rule, or null when nothing matches. */
export function evaluateFormatRules(subject: RuleSubject, rules: readonly FormatRule[]): Exclude<EdgeColor, 'default'> | null {
  for (const rule of rules) {
    if (matches(rule, subject)) return rule.accent;
  }
  return null;
}

/** Coerce untrusted/legacy stored rules into the valid shape; drops what can't be salvaged. */
export function sanitizeFormatRules(raw: unknown): FormatRule[] {
  if (!Array.isArray(raw)) return [];
  const out: FormatRule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const field = r.field as FormatRuleField;
    const op = r.op as FormatRuleOp;
    const accent = r.accent as FormatRule['accent'];
    const value = typeof r.value === 'string' ? r.value : typeof r.value === 'number' ? String(r.value) : null;
    if (!FIELD_IDS.has(field) || !OP_IDS.has(op) || !ACCENTS.has(accent) || value === null) continue;
    out.push({
      ruleId: typeof r.ruleId === 'string' && r.ruleId ? r.ruleId : newFormatRuleId(),
      field,
      op,
      value: value.slice(0, 120),
      accent,
    });
    if (out.length >= FORMAT_RULE_LIMIT) break;
  }
  return out;
}

/** One-line human description, for the rules list UI. */
export function describeRule(rule: FormatRule): string {
  const field = RULE_FIELDS.find((f) => f.id === rule.field)?.label ?? rule.field;
  const op = RULE_OPS.find((o) => o.id === rule.op)?.label ?? rule.op;
  return `${field} ${op} ${rule.value}`;
}
