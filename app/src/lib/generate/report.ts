import 'server-only';
import { llmAvailable, llmJson, LlmError } from '@/lib/llm';
import { resolveServiceDef } from '@/lib/catalog';
import { Architecture, type ArchitectureDoc } from '@/lib/models/Architecture';
import { AIConversation } from '@/lib/models/AIConversation';
import { CostEstimate } from '@/lib/models/CostEstimate';
import type { ProjectDocument } from '@/lib/projects';

/**
 * AI architecture report: how the diagram serves the original request, how a
 * request moves through it, each service's role, prioritized improvements, and
 * alternative approaches. Rendered in the Explain popup and the "diagram +
 * report" PDF export. Generated once per architecture version and cached on
 * the Architecture document; degrades to a deterministic summary when no LLM
 * is available (Constitution: degraded modes are honest, never fabricated).
 */

export interface ArchitectureReport {
  /** how the architecture addresses the user's request */
  overview: string;
  /** request-lifecycle narrative: entry → processing → storage → response */
  howItWorks: string;
  /** each service's role in THIS architecture (not a generic description) */
  services: { name: string; role: string }[];
  /** prioritized, actionable improvement recommendations */
  improvements: { title: string; detail: string; priority: 'high' | 'medium' | 'low' }[];
  /** alternative services/approaches worth considering, with trade-offs */
  alternatives: { title: string; detail: string }[];
  /** true when the LLM was unavailable and only deterministic facts are included */
  degraded: boolean;
  generatedAt: string;
}

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    overview: { type: 'string', description: "2-4 sentences: how this architecture addresses the user's request." },
    howItWorks: {
      type: 'string',
      description: 'One paragraph narrating a request/data item traveling through the architecture end to end.',
    },
    services: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string', description: "This service's specific job in THIS architecture, 1-2 sentences." },
        },
        required: ['name', 'role'],
        additionalProperties: false,
      },
    },
    improvements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: 'What to change, why, and the expected benefit. 1-3 sentences.' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'detail', 'priority'],
        additionalProperties: false,
      },
    },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: 'The alternative service/approach and its trade-offs versus the current choice.' },
        },
        required: ['title', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['overview', 'howItWorks', 'services', 'improvements', 'alternatives'],
  additionalProperties: false,
};

type LlmReport = Omit<ArchitectureReport, 'degraded' | 'generatedAt'>;

/** Compact, LLM-readable facts about the architecture. */
function architectureFacts(arch: ArchitectureDoc): string {
  const names = new Map<string, string>();
  const services = arch.nodes.map((n) => {
    const def = resolveServiceDef(n.serviceId, n as never);
    const name = n.displayName || def.name;
    names.set(n.nodeId, name);
    const config = Object.entries(n.config ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `- ${name} (${def.category}, ~$${n.cost}/mo${config ? `, config: ${config}` : ''})`;
  });
  const connections = arch.edges.map(
    (e) => `- ${names.get(e.source) ?? e.source} -> ${names.get(e.target) ?? e.target}${e.label ? ` (${e.label})` : ''}`
  );
  const guidance = Object.entries(arch.guidance ?? {})
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => `${k}: ${v}`);
  return [
    `SERVICES (${arch.nodes.length}):`,
    ...services,
    `\nCONNECTIONS (${arch.edges.length}):`,
    ...connections,
    ...(guidance.length ? ['\nDESIGN GUIDANCE:', ...guidance] : []),
  ].join('\n');
}

/** No-LLM fallback: honest deterministic summary, clearly marked degraded. */
function degradedReport(arch: ArchitectureDoc, requestText: string): ArchitectureReport {
  return {
    overview: requestText
      ? `This architecture was generated for: "${requestText.slice(0, 300)}". It comprises ${arch.nodes.length} services with ${arch.edges.length} connections.`
      : `This architecture comprises ${arch.nodes.length} services with ${arch.edges.length} connections.`,
    howItWorks: 'AI analysis is unavailable (no LLM configured) — the flow steps and per-service configuration below are derived directly from the diagram.',
    services: arch.nodes.map((n) => {
      const def = resolveServiceDef(n.serviceId, n as never);
      return { name: n.displayName || def.name, role: def.blurb };
    }),
    improvements: [],
    alternatives: [],
    degraded: true,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Return the cached report when it matches the current architecture version,
 * else generate, persist, and return a fresh one. `refresh` forces regeneration.
 */
export async function getOrGenerateReport(
  project: ProjectDocument,
  arch: ArchitectureDoc,
  opts?: { refresh?: boolean; signal?: AbortSignal }
): Promise<{ report: ArchitectureReport; cached: boolean }> {
  const cached = arch.report as ArchitectureReport | null;
  if (!opts?.refresh && cached && arch.reportVersion === arch.version && !cached.degraded) {
    return { report: cached, cached: true };
  }

  const convo = arch.generatedFrom
    ? await AIConversation.findById(arch.generatedFrom).select('flow.brief.requestText').lean()
    : null;
  const requestText = convo?.flow?.brief?.requestText ?? '';

  let report: ArchitectureReport;
  if (!llmAvailable()) {
    report = degradedReport(arch, requestText);
  } else {
    try {
      const out = await llmJson<LlmReport>({
        system: [
          'You are a senior cloud solutions architect reviewing an AWS + MongoDB Atlas architecture for a client report.',
          'Write clear, specific, non-generic prose grounded ONLY in the provided facts — never invent services that are not listed.',
          'For improvements: concrete, prioritized, actionable (security, reliability, cost, scalability). 3-6 items.',
          'For alternatives: other services or approaches that could replace or complement current choices, with honest trade-offs. 2-5 items.',
          'Use the exact service names from the facts. Keep the total response focused and readable.',
        ].join('\n'),
        user: [
          requestText ? `ORIGINAL USER REQUEST:\n${requestText}\n` : '',
          `ARCHITECTURE FACTS:\n${architectureFacts(arch)}`,
          `\nProject region: ${project.defaultRegion ?? 'us-east-1'}.`,
        ].join('\n'),
        schema: REPORT_SCHEMA,
        role: 'report',
        signal: opts?.signal,
      });
      report = { ...out, degraded: false, generatedAt: new Date().toISOString() };
    } catch (e) {
      // A failed generation must not block the export — fall back honestly.
      if (!(e instanceof LlmError)) throw e;
      console.error('[report] generation failed, returning degraded report:', e.message);
      report = degradedReport(arch, requestText);
    }
  }

  // Cache only real (non-degraded) reports so a later retry can upgrade.
  if (!report.degraded) {
    await Architecture.updateOne(
      { _id: arch._id },
      { $set: { report, reportVersion: arch.version } }
    );
  }
  return { report, cached: false };
}

/**
 * Client-proposal report: the same architecture, told for a business
 * audience — plain-language value, an investment story, and reliability/
 * scalability posture instead of a service-by-service technical breakdown.
 * Cached independently of the developer report (Architecture.reportClient/
 * reportClientVersion) with the same version-stamped cache/degrade/persist
 * shape as getOrGenerateReport.
 */
export interface ClientProposalReport {
  /** 2-4 plain-language sentences: what this solution does for the business */
  executiveSummary: string;
  /** capability -> business benefit, non-technical framing */
  businessValue: { title: string; detail: string }[];
  investmentSummary: {
    monthly: number;
    annual: number;
    basis: 'exact' | 'indicative';
    /** prose only — never a dollar figure; real numbers come from CostEstimate, not the LLM */
    highlights: string[];
  };
  /** plain-language HA/DR/security posture */
  reliabilityAndSecurity: string;
  scalabilityStory: string;
  /** business-framed next steps, not engineering trade-off jargon */
  recommendations: { title: string; detail: string }[];
  degraded: boolean;
  generatedAt: string;
}

type LlmClientReport = Omit<ClientProposalReport, 'degraded' | 'generatedAt' | 'investmentSummary'> & {
  investmentHighlights: string[];
};

const CLIENT_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    executiveSummary: { type: 'string', description: '2-4 plain-language sentences: what this solution does for the business, no jargon.' },
    businessValue: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: 'The business benefit in plain language, 1-2 sentences. No service names as the subject — frame around outcomes.' },
        },
        required: ['title', 'detail'],
        additionalProperties: false,
      },
    },
    investmentHighlights: {
      type: 'array',
      items: { type: 'string' },
      description: 'Prose observations about the investment (e.g. "scales with usage, no upfront hardware cost") — NEVER state a dollar amount, the real figures are added separately.',
    },
    reliabilityAndSecurity: { type: 'string', description: 'One paragraph, plain language: how this design stays available and keeps data safe.' },
    scalabilityStory: { type: 'string', description: 'One paragraph, plain language: how this design grows with demand.' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string', description: 'A business-framed next step and its expected benefit, 1-2 sentences.' },
        },
        required: ['title', 'detail'],
        additionalProperties: false,
      },
    },
  },
  required: ['executiveSummary', 'businessValue', 'investmentHighlights', 'reliabilityAndSecurity', 'scalabilityStory', 'recommendations'],
  additionalProperties: false,
};

function degradedClientProposal(arch: ArchitectureDoc, requestText: string, investmentSummary: ClientProposalReport['investmentSummary']): ClientProposalReport {
  return {
    executiveSummary: requestText
      ? `This proposal was prepared for: "${requestText.slice(0, 300)}". It comprises ${arch.nodes.length} managed services.`
      : `This proposal comprises ${arch.nodes.length} managed services.`,
    businessValue: [],
    investmentSummary,
    reliabilityAndSecurity: 'AI analysis is unavailable (no LLM configured) — a detailed reliability and security narrative could not be generated.',
    scalabilityStory: 'AI analysis is unavailable (no LLM configured) — a detailed scalability narrative could not be generated.',
    recommendations: [],
    degraded: true,
    generatedAt: new Date().toISOString(),
  };
}

export async function getOrGenerateClientProposal(
  project: ProjectDocument,
  arch: ArchitectureDoc,
  opts?: { refresh?: boolean; signal?: AbortSignal }
): Promise<{ report: ClientProposalReport; cached: boolean }> {
  const cached = arch.reportClient as ClientProposalReport | null;
  if (!opts?.refresh && cached && arch.reportClientVersion === arch.version && !cached.degraded) {
    return { report: cached, cached: true };
  }

  const [convo, estimate] = await Promise.all([
    arch.generatedFrom ? AIConversation.findById(arch.generatedFrom).select('flow.brief.requestText').lean() : Promise.resolve(null),
    CostEstimate.findOne({ projectId: project._id }).sort({ computedAt: -1 }).lean(),
  ]);
  const requestText = convo?.flow?.brief?.requestText ?? '';
  // Real numbers only ever come from the deterministic pricing chain — the LLM
  // never states a dollar figure (constitution cost-realism principle).
  const investmentSummary: ClientProposalReport['investmentSummary'] = {
    monthly: estimate?.monthly ?? 0,
    annual: estimate?.annual ?? 0,
    basis: estimate?.basis ?? 'indicative',
    highlights: [],
  };

  let report: ClientProposalReport;
  if (!llmAvailable()) {
    report = degradedClientProposal(arch, requestText, investmentSummary);
  } else {
    try {
      const out = await llmJson<LlmClientReport>({
        system: [
          'You are a solutions consultant writing a client-facing proposal for an AWS + MongoDB Atlas architecture.',
          'Write for a business stakeholder, not an engineer: plain language, benefit-first, no service names as',
          'the grammatical subject and no technical jargon (VPC, subnet, IAM, etc.) unless briefly explained.',
          'Ground every statement ONLY in the provided facts — never invent capabilities that are not listed.',
          'NEVER state a dollar figure yourself — investmentHighlights must be prose observations only, the real',
          'numbers are added separately from the actual cost calculation.',
          'For businessValue: 3-6 items, each a capability reframed as a business outcome.',
          'For recommendations: 2-5 business-framed next steps (not engineering trade-off jargon).',
        ].join('\n'),
        user: [
          requestText ? `ORIGINAL CLIENT REQUEST:\n${requestText}\n` : '',
          `ARCHITECTURE FACTS:\n${architectureFacts(arch)}`,
          `\nProject region: ${project.defaultRegion ?? 'us-east-1'}.`,
        ].join('\n'),
        schema: CLIENT_REPORT_SCHEMA,
        role: 'report',
        signal: opts?.signal,
      });
      const { investmentHighlights, ...rest } = out;
      report = {
        ...rest,
        investmentSummary: { ...investmentSummary, highlights: investmentHighlights },
        degraded: false,
        generatedAt: new Date().toISOString(),
      };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      console.error('[report] client-proposal generation failed, returning degraded report:', e.message);
      report = degradedClientProposal(arch, requestText, investmentSummary);
    }
  }

  if (!report.degraded) {
    await Architecture.updateOne(
      { _id: arch._id },
      { $set: { reportClient: report, reportClientVersion: arch.version } }
    );
  }
  return { report, cached: false };
}
