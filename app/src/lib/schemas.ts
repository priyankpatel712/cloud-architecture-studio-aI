import { z } from 'zod';
import { LLM_PROVIDER_IDS } from '@/lib/llm-catalog';
import { ROLES } from '@/lib/rbac';
import { LLM_ROLES } from '@/lib/llm-roles';

/**
 * Request schemas validated at every route boundary (research R10).
 * Kept together so client forms can share shapes where practical.
 */

export const providerIdSchema = z.enum(['aws', 'mongodb', 'system']);

export const serviceConfigSchema = z.record(z.string(), z.union([z.string(), z.number()]));

export const serviceNodeSchema = z.object({
  nodeId: z.string().min(1).max(64),
  serviceId: z.string().min(1).max(64),
  provider: providerIdSchema,
  category: z.string().max(64).optional().default(''),
  position: z.object({ x: z.number(), y: z.number() }),
  config: serviceConfigSchema.default({}),
  cost: z.number().nonnegative().optional().default(0),
  costBasis: z.enum(['exact', 'indicative']).optional().default('indicative'),
  // 002 FR-013: rename only affects display; catalog identity + pricing unchanged.
  displayName: z.string().max(120).optional().default(''),
  containerId: z.string().max(64).nullable().optional().default(null),
  // 007 2.3 — optional accent override, same constrained tokens as edges.
  accent: z.enum(['default', 'primary', 'success', 'warning', 'danger']).optional(),
});

/** Constrained style tokens (002 data-model) — never free-form styling. */
export const edgeStyleSchema = z.object({
  geometry: z.enum(['orthogonal', 'straight', 'curved']).default('orthogonal'),
  pattern: z.enum(['solid', 'dashed']).default('solid'),
  arrowheads: z.enum(['none', 'end', 'both']).default('end'),
  color: z.enum(['default', 'primary', 'success', 'warning', 'danger']).default('default'),
});

export const serviceEdgeSchema = z.object({
  edgeId: z.string().min(1).max(64),
  source: z.string().min(1).max(64),
  target: z.string().min(1).max(64),
  /** Connection sides (002 canvas, any-side handles). Absent on documents saved
   * before side-selectable handles existed — and on every AI-generated edge —
   * so both stay optional forever; the canvas defaults them to right → left. */
  sourceHandle: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  targetHandle: z.enum(['top', 'right', 'bottom', 'left']).optional(),
  label: z.string().max(120).optional().default(''),
  style: edgeStyleSchema.optional().default({
    geometry: 'orthogonal',
    pattern: 'solid',
    arrowheads: 'end',
    color: 'default',
  }),
  waypoints: z.array(z.object({ x: z.number(), y: z.number() })).max(20).optional().default([]),
});

/** Typed boundary container (002 FR-005–007). */
export const containerSchema = z.object({
  containerId: z.string().min(1).max(64),
  type: z.string().min(1).max(32),
  label: z.string().max(120).optional().default(''),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number().min(40).max(20000), height: z.number().min(40).max(20000) }),
  parentContainerId: z.string().max(64).nullable().optional().default(null),
});

/** Note/sticky annotation (002 FR-014) — cost-free, provider-invisible. */
export const annotationSchema = z.object({
  annotationId: z.string().min(1).max(64),
  kind: z.enum(['text', 'sticky']).default('text'),
  content: z.string().max(2000).default(''),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number().min(40).max(4000), height: z.number().min(30).max(4000) }),
  style: z
    .object({ color: z.enum(['default', 'yellow', 'blue', 'green', 'pink']).default('default') })
    .optional()
    .default({ color: 'default' }),
  // 007 2.3 — persisted stacking order (bounded, integer).
  z: z.number().int().min(-100).max(100).optional(),
});

export const guidanceSchema = z
  .object({
    network: z.string().max(4000).default(''),
    security: z.string().max(4000).default(''),
    ha: z.string().max(4000).default(''),
    dr: z.string().max(4000).default(''),
    scaling: z.string().max(4000).default(''),
  })
  .partial();

/**
 * PUT /api/projects/[id]/architecture — optimistic concurrency via `version` (001 R9),
 * extended per 002 contracts/architecture-extensions.md. Structural rules enforced
 * here server-side: acyclic container tree, valid membership references.
 */
export const architecturePutSchema = z
  .object({
    nodes: z.array(serviceNodeSchema).max(300),
    edges: z.array(serviceEdgeSchema).max(600),
    containers: z.array(containerSchema).max(100).optional().default([]),
    annotations: z.array(annotationSchema).max(200).optional().default([]),
    guidance: guidanceSchema.optional(),
    version: z.number().int().positive(),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set(doc.containers.map((c) => c.containerId));
    if (ids.size !== doc.containers.length) {
      ctx.addIssue({ code: 'custom', path: ['containers'], message: 'duplicate containerId' });
    }
    // Parent references must exist and the tree must be acyclic (002 edge case).
    const parent = new Map(doc.containers.map((c) => [c.containerId, c.parentContainerId]));
    for (const c of doc.containers) {
      if (c.parentContainerId != null && !ids.has(c.parentContainerId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['containers'],
          message: `container ${c.containerId} references missing parent ${c.parentContainerId}`,
        });
        continue;
      }
      let cursor = c.parentContainerId ?? null;
      let hops = 0;
      while (cursor != null && hops <= doc.containers.length) {
        if (cursor === c.containerId) {
          ctx.addIssue({
            code: 'custom',
            path: ['containers'],
            message: `container tree cycle involving ${c.containerId}`,
          });
          break;
        }
        cursor = parent.get(cursor) ?? null;
        hops++;
      }
    }
    for (const n of doc.nodes) {
      if (n.containerId != null && !ids.has(n.containerId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes'],
          message: `node ${n.nodeId} references missing container ${n.containerId}`,
        });
      }
    }
  });

/** POST /api/pricing/estimate (contracts/pricing.md) */
export const pricingEstimateSchema = z.object({
  nodes: z
    .array(
      z.object({
        nodeId: z.string().max(64).optional(),
        serviceId: z.string().min(1).max(64),
        provider: providerIdSchema,
        config: serviceConfigSchema.default({}),
      })
    )
    .max(300),
  defaultRegion: z.string().max(32).optional(),
});

/**
 * 006 (contracts/guided-flow-protocol.md §1) — a structured response to an open
 * guided-flow round. `answers` resolve clarify/cost-question rounds;
 * `selectedOptionId` picks a pricing option; `skipAll` skips the whole round.
 */
export const interactionAnswerSchema = z.object({
  questionId: z.string().min(1).max(64),
  optionId: z.string().max(64).optional(),
  text: z.string().max(2000).optional(),
  skipped: z.boolean().optional(),
});

export const interactionResponseSchema = z.object({
  interactionId: z.string().min(1).max(64),
  answers: z.array(interactionAnswerSchema).max(20).default([]),
  skipAll: z.boolean().optional().default(false),
  selectedOptionId: z.string().max(32).optional(),
});

/**
 * POST /api/projects/[id]/chat/messages (contracts/generation.md; extended by
 * 006 contracts/guided-flow-protocol.md §1). Text may be empty when the message
 * is a pure interaction response (option clicks) — but never both empty.
 */
export const chatMessageSchema = z
  .object({
    // 10k chars: the detailed example briefs (lib/example-prompts.ts) run
    // 3–6k chars, and users edit them upward — 4k rejected real requests.
    text: z.string().max(10000).default(''),
    attachedTools: z.array(providerIdSchema).max(3).default([]),
    interactionResponse: interactionResponseSchema.optional(),
  })
  .refine((v) => v.text.trim().length > 0 || v.interactionResponse !== undefined, {
    message: 'Provide a message or an interaction response.',
  });

/**
 * PATCH /api/projects/[id]/cost-overrides (003 contracts/cost-overrides.md).
 * Field-specific messages satisfy FR-011 (specific, actionable rejection);
 * clear:true resets the line to system-computed (FR-009). At least one action
 * must be present — an empty patch is a validation error, not a no-op.
 */
export const costOverridePatchSchema = z
  .object({
    nodeId: z.string().min(1).max(64),
    quantityOverride: z
      .number({ message: 'Quantity must be a number.' })
      .finite('Quantity must be a finite number.')
      .positive('Quantity must be greater than zero.')
      .optional(),
    totalCostOverride: z
      .number({ message: 'Cost must be a number.' })
      .finite('Cost must be a finite number.')
      .nonnegative('Cost cannot be negative.')
      .optional(),
    clear: z.boolean().optional().default(false),
  })
  .refine((v) => v.clear || v.quantityOverride !== undefined || v.totalCostOverride !== undefined, {
    message: 'Provide quantityOverride, totalCostOverride, or clear.',
  });

/** POST /api/chat/start */
export const chatStartSchema = z.object({
  name: z.string().max(120).optional(),
});

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(''),
});

export const projectPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  defaultRegion: z.string().max(32).optional(),
});

export const shareSchema = z.object({ email: z.string().email() });
export const unshareSchema = z.object({ userId: z.string().min(1) });

/** POST /api/connections/mongodb — Atlas programmatic API key (FR-013) */
export const atlasConnectSchema = z.object({
  publicKey: z.string().min(1).max(64),
  privateKey: z.string().min(1).max(128),
});

export const profilePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  organization: z.string().max(120).optional(),
});

export const llmProviderIdSchema = z.enum([...LLM_PROVIDER_IDS]);

/**
 * Upper bound for a pasted provider API key. Most providers issue keys well
 * under 200 chars, but AWS Bedrock short-term API keys embed a whole session
 * token and routinely exceed 1,000 chars (observed live: a valid sandbox key
 * rejected by the previous 500-char cap). The bound exists only to keep
 * obviously-wrong pastes (a whole config file) out of the encrypted store.
 */
const LLM_API_KEY_MAX = 8192;

/**
 * PUT /api/settings/llm — app-wide AI provider config (Settings → AI Provider).
 * `apiKey` is write-only: blank keeps the stored key, `clearKey` removes it.
 */
export const llmSettingsPutSchema = z
  .object({
    provider: llmProviderIdSchema,
    model: z.string().max(200).optional().default(''),
    apiKey: z.string().max(LLM_API_KEY_MAX).optional().default(''),
    clearKey: z.boolean().optional().default(false),
    /** 008 FR-016 — tiering toggle and per-role model assignments live with the
     * rest of the AI config, not in env. */
    roleTieringEnabled: z.boolean().optional(),
    /**
     * Work class → `"provider/model"`. Keys are constrained to the known roles
     * so a typo is a 400 rather than a silently ignored setting that looks saved
     * in the UI. An empty value clears the override and restores tier defaults
     * (FR-015).
     *
     * `partialRecord`, NOT `record`: in Zod 4 a record with an enum key schema
     * is EXHAUSTIVE — it rejects any object missing one of the ten keys, which
     * made every settings save 400, since the UI sends only the roles the
     * operator actually pinned (usually none). Pinned by a test in
     * llm-settings-schema.test.ts; do not "simplify" this back to record.
     */
    roleModels: z.partialRecord(z.enum([...LLM_ROLES]), z.string().max(200)).optional(),
  })
  .refine((v) => !(v.clearKey && v.apiKey.trim()), {
    message: 'Provide a new key or clearKey, not both.',
  });

/** POST /api/settings/llm/test — dry-run a config before (or after) saving it. */
export const llmSettingsTestSchema = z.object({
  provider: llmProviderIdSchema,
  model: z.string().max(200).optional().default(''),
  apiKey: z.string().max(LLM_API_KEY_MAX).optional().default(''),
});

/** POST /api/settings/llm/models — list the provider's live model ids. */
export const llmModelsListSchema = z.object({
  provider: llmProviderIdSchema,
  apiKey: z.string().max(LLM_API_KEY_MAX).optional().default(''),
});

// ---------------------------------------------------------------------------
// 008 US5 — knowledge store administration
// (contracts/settings-knowledge.md). An operator edits the rules the generator
// reasons with, so the bounds here are the same ones the store itself enforces:
// a value accepted at this boundary must be storable, or the UI reports success
// on an edit Mongo then silently truncates.
// ---------------------------------------------------------------------------

/** GET /api/settings/knowledge — list filters. All optional; absent = no filter. */
export const knowledgeListQuerySchema = z.object({
  provider: z.enum(['aws', 'mongodb', 'system', 'any']).optional(),
  kind: z.enum(['rule', 'pattern', 'guidance', 'lesson', 'service-note']).optional(),
  source: z.enum(['seed', 'mcp', 'web', 'learned']).optional(),
  enabled: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

/**
 * PATCH /api/settings/knowledge/:id — the editable subset.
 *
 * `source`, `hash`, `usageCount` and `lastUsedAt` are absent by design: they are
 * provenance and earned trust, not opinions. Editing `content` recomputes the
 * hash server-side, which is why it is not accepted from the client either.
 */
export const knowledgePatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    content: z.string().trim().min(1).max(600, 'Knowledge content is capped at 600 characters.').optional(),
    keywords: z.array(z.string().trim().min(1).max(60)).min(1, 'Keep at least one keyword.').max(20).optional(),
    designMode: z.enum(['cloud', 'hld', 'lld', 'any']).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied.' });

/** POST /api/settings/knowledge/reseed */
export const knowledgeReseedSchema = z.object({
  prune: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Auth + user administration (security checklist #2 — strict schema at every
// boundary). Shared field shapes so every route enforces the same type, length,
// and format bounds. Length caps also blunt oversized-payload abuse.
// ---------------------------------------------------------------------------

/** RFC-ish email, trimmed + lowercased, hard length cap. */
const emailStrict = z
  .string()
  .trim()
  .max(320, 'Email is too long.')
  .email('Please enter a valid email address.')
  .toLowerCase();

/** A lookup email — non-empty, capped, normalized; format not required. */
const emailLoose = z.string().trim().toLowerCase().max(320);

/** New/changed password: min length is the only strength rule today, plus a cap. */
const passwordStrict = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(200, 'Password is too long.');

/** Single-use email token (hex) — bounded so a giant body is rejected early. */
const tokenStrict = z.string().min(1).max(256);

/** POST /api/auth/login */
export const loginSchema = z.object({
  email: emailLoose.min(1, 'Email is required.'),
  password: z.string().min(1, 'Password is required.').max(200),
});

/** POST /api/auth/register */
export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: emailStrict,
  password: passwordStrict,
});

/** POST /api/auth/forgot — email is optional; response is always ok (no enumeration). */
export const forgotSchema = z.object({
  email: emailLoose.optional().default(''),
});

/** POST /api/auth/verify/request — same lenient shape as forgot. */
export const verifyRequestSchema = z.object({
  email: emailLoose.optional().default(''),
});

/** POST /api/auth/reset */
export const resetSchema = z.object({
  email: emailLoose.min(1),
  token: tokenStrict,
  password: passwordStrict,
});

/** POST /api/auth/verify/confirm */
export const verifyConfirmSchema = z.object({
  email: emailLoose.min(1),
  token: tokenStrict,
});

/** POST /api/users — admin creates a user. */
export const userCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: emailStrict,
  password: passwordStrict,
  role: z.enum([...ROLES]).optional().default('user'),
  organization: z.string().trim().max(120).optional().default(''),
});

/** PATCH /api/users/[id] — admin edits a user (all fields optional). */
export const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  organization: z.string().trim().max(120).optional(),
  role: z.enum([...ROLES]).optional(),
  status: z.enum(['active', 'suspended', 'invited']).optional(),
  password: passwordStrict.optional(),
});
