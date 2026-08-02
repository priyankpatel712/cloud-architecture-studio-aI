import 'server-only';
import { llmAvailable, llmJson, LlmAbortError } from '@/lib/llm';
import type { ProviderId } from '@/lib/providers/types';

/**
 * Dynamic tool/mode router (Anthropic "Building effective agents" routing
 * pattern): ONE cheap structured LLM call that classifies the incoming request
 * — using the new message plus compressed prior-conversation context — into a
 * diagram mode and the provider toolsets to attach for this turn:
 *
 * - mode 'cloud': provider-specific architecture (AWS / MongoDB Atlas nodes,
 *   official MCP guidance, live pricing). providers ⊆ {aws, mongodb}.
 * - mode 'hld':   generic high-level system design (C4 L1/L2 vocabulary —
 *   clients, edge, services, data, messaging). providers = ['system'].
 * - mode 'lld':   generic low-level design (C4 L3 — modules, components,
 *   controllers, repositories, layers). providers = ['system'].
 *
 * Sticky-context rules (research-grounded): follow-ups inherit the
 * conversation's current mode/providers unless the new message explicitly
 * pivots; an explicit user chip-pin is never overridden (the route only calls
 * this for mode when tools are pinned); a brand-new ambiguous request defaults
 * to 'cloud' with every cloud provider — the studio's home turf — so existing
 * behavior is preserved unless the user asks for generic design.
 *
 * The router CLASSIFIES ONLY — it never generates diagram content, and its
 * output is untrusted (sanitizeRoute coerces, and the mode→providers coupling
 * is enforced code-side, never taken from the model).
 */

export type DesignMode = 'cloud' | 'hld' | 'lld';

export interface RouteDecision {
  mode: DesignMode;
  providers: ProviderId[];
  /** one short sentence for the trace step; '' when defaulted */
  reason: string;
}

export interface RouteInput {
  /** the new user message */
  text: string;
  /** recent PRIOR user messages, oldest first (compressed conversation context) */
  history: string[];
  /** the conversation's sticky mode; null for a brand-new conversation */
  currentMode: DesignMode | null;
  /** the conversation's sticky attached tools */
  currentProviders: ProviderId[];
  /** providers of nodes already on the canvas */
  canvasProviders: ProviderId[];
  signal?: AbortSignal;
}

const CLOUD_PROVIDERS: ProviderId[] = ['aws', 'mongodb'];

const ROUTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'providers', 'reason'],
  properties: {
    mode: {
      type: 'string',
      enum: ['cloud', 'hld', 'lld'],
      description:
        'cloud: provider-specific cloud architecture (AWS/MongoDB services, pricing). hld: generic high-level system design (no vendor). lld: generic low-level code design (modules/classes/layers).',
    },
    providers: {
      type: 'array',
      items: { type: 'string', enum: ['aws', 'mongodb', 'system'] },
      description: 'Toolsets to attach. cloud mode: the cloud providers the request/conversation needs. hld/lld mode: exactly ["system"].',
    },
    reason: { type: 'string', description: 'One short sentence explaining the routing decision, shown in the working trace.' },
  },
} as const;

/**
 * Deterministic fallback (no LLM, router failure, or empty verdict): keep the
 * conversation's sticky tools; else follow what is already drawn; else attach
 * every cloud provider (the pre-router auto-attach behavior).
 */
export function fallbackRoute(input: Pick<RouteInput, 'currentMode' | 'currentProviders' | 'canvasProviders'>): RouteDecision {
  const sticky = input.currentProviders.filter((p) => p !== 'system');
  const canvas = input.canvasProviders.filter((p) => p !== 'system');
  const mode = input.currentMode ?? 'cloud';
  if (mode !== 'cloud') return { mode, providers: ['system'], reason: '' };
  const providers = sticky.length > 0 ? sticky : canvas.length > 0 ? canvas : CLOUD_PROVIDERS;
  return { mode: 'cloud', providers, reason: '' };
}

/** Coerce an untrusted router verdict; enforce the mode→providers coupling code-side. */
export function sanitizeRoute(raw: unknown, input: Pick<RouteInput, 'currentMode' | 'currentProviders' | 'canvasProviders'>): RouteDecision {
  const p = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mode: DesignMode = p.mode === 'hld' || p.mode === 'lld' || p.mode === 'cloud' ? p.mode : fallbackRoute(input).mode;
  const reason = typeof p.reason === 'string' ? p.reason.slice(0, 200) : '';

  // Generic design modes always run on the system vocabulary alone — no cloud
  // MCPs/pricing attached, regardless of what the model listed.
  if (mode !== 'cloud') return { mode, providers: ['system'], reason };

  const listed = Array.isArray(p.providers) ? p.providers : [];
  const providers = CLOUD_PROVIDERS.filter((id) => listed.includes(id));
  if (providers.length === 0) return { ...fallbackRoute({ ...input, currentMode: 'cloud' }), reason };
  return { mode: 'cloud', providers, reason };
}

export async function routeToolsAndMode(input: RouteInput): Promise<RouteDecision> {
  if (!llmAvailable()) return fallbackRoute(input);
  const history = input.history.slice(-4).map((t) => (t.length > 300 ? `${t.slice(0, 300)}…` : t));
  try {
    const raw = await llmJson<unknown>({
      system: [
        'You route requests for a diagram studio that generates three kinds of architecture diagrams.',
        'Classify the NEW user message (with the conversation context) into:',
        '- mode "cloud": the user wants a provider-specific cloud architecture — AWS and/or MongoDB',
        '  Atlas services, deployable infrastructure, costs. Attach the cloud providers the request',
        '  names or clearly implies (both when unclear which).',
        '- mode "hld": a generic/provider-neutral HIGH-LEVEL system design — "system design",',
        '  "architecture diagram" with no vendor, interview-style designs (clients, load balancer,',
        '  services, cache, queue, database). providers: ["system"].',
        '- mode "lld": a generic LOW-LEVEL design — classes, modules, components, layers, API',
        '  internals, "class diagram", "low level design". providers: ["system"].',
        'Rules:',
        '- STICKY: a follow-up that just refines the current diagram (add/change/remove something)',
        '  inherits the current mode and providers — do NOT switch modes unless the new message',
        '  explicitly pivots ("now as a generic HLD", "make this an AWS architecture", "show the',
        '  low-level design of the payment service").',
        '- A named vendor always wins: mentioning AWS/Amazon services → cloud with aws; MongoDB/',
        '  Atlas → cloud with mongodb (both named → both).',
        '- PASTED CODE/IaC is an import request: Terraform/CloudFormation/CDK with aws resources',
        '  (provider "aws", resource "aws_...") → cloud with aws; mongodbatlas resources → cloud',
        '  with mongodb; SQL DDL (CREATE TABLE) or application source code → lld (its structure is',
        '  a low-level design); vendor-neutral docker-compose/k8s manifests → hld.',
        '- Brand-new conversation and genuinely ambiguous → cloud with both cloud providers.',
        '- reason: one short sentence for the user-visible trace.',
      ].join('\n'),
      user: [
        input.currentMode ? `Current conversation mode: ${input.currentMode}; attached tools: ${input.currentProviders.join(', ') || '(none)'}.` : 'Brand-new conversation.',
        input.canvasProviders.length > 0 ? `The canvas already has ${input.canvasProviders.join(' + ')} elements on it.` : 'The canvas is empty.',
        history.length > 0 ? `Earlier user requests (oldest first):\n${history.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : '',
        `NEW user message: ${input.text}`,
      ].filter(Boolean).join('\n\n'),
      schema: ROUTE_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 300,
      role: 'route',
      signal: input.signal,
    });
    return sanitizeRoute(raw, input);
  } catch (e) {
    if (e instanceof LlmAbortError) throw e;
    console.error('[router] tool/mode routing failed, using fallback:', e);
    return fallbackRoute(input);
  }
}
