import 'server-only';
import { llmAvailable, llmJson, LlmError } from '@/lib/llm';
import { Architecture, type ArchitectureDoc } from '@/lib/models/Architecture';
import { AIConversation } from '@/lib/models/AIConversation';
import type { ProjectDocument } from '@/lib/projects';
import {
  degradedWalkthrough,
  sanitizeWalkthrough,
  walkthroughFacts,
  MAX_WALKTHROUGH_STEPS,
  type WalkthroughArch,
  type WalkthroughReport,
} from './walkthrough-core';

/**
 * Step-by-step client walkthrough: the narrative behind the "Client report"
 * PDF. Same version-stamped cache/degrade/persist shape as the other two
 * reports in report.ts (Architecture.reportWalkthrough/-Version). The pure
 * pieces (facts, sanitize, degraded fallback) live in walkthrough-core.ts.
 */

type LlmWalkthrough = Pick<WalkthroughReport, 'introduction' | 'steps' | 'conclusion'>;

const WALKTHROUGH_SCHEMA = {
  type: 'object',
  properties: {
    introduction: {
      type: 'string',
      description: '2-4 plain-language sentences: what this solution does for the client and how the walkthrough is organized.',
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short client-facing step title (e.g. "Visitors reach the site securely").' },
          explanation: {
            type: 'string',
            description: '2-4 plain-language sentences explaining this stage. Briefly explain any technical term you must use.',
          },
          nodeIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'The EXACT service ids (from the facts) this step covers — the diagram section shown beside the step is rendered from these ids.',
          },
        },
        required: ['title', 'explanation', 'nodeIds'],
        additionalProperties: false,
      },
    },
    conclusion: { type: 'string', description: '2-3 sentences wrapping up the solution and suggesting next steps.' },
  },
  required: ['introduction', 'steps', 'conclusion'],
  additionalProperties: false,
};

/**
 * Return the cached walkthrough when it matches the current architecture
 * version, else generate, persist, and return a fresh one. A walkthrough whose
 * steps all failed validation (invented node ids, empty prose) degrades to the
 * diagram-derived fallback instead of shipping sections that point nowhere.
 */
export async function getOrGenerateWalkthrough(
  project: ProjectDocument,
  arch: ArchitectureDoc,
  opts?: { refresh?: boolean; signal?: AbortSignal }
): Promise<{ report: WalkthroughReport; cached: boolean }> {
  const cached = arch.reportWalkthrough as WalkthroughReport | null;
  if (!opts?.refresh && cached && arch.reportWalkthroughVersion === arch.version && !cached.degraded) {
    return { report: cached, cached: true };
  }

  const core = arch as unknown as WalkthroughArch;
  const convo = arch.generatedFrom
    ? await AIConversation.findById(arch.generatedFrom).select('flow.brief.requestText').lean()
    : null;
  const requestText = convo?.flow?.brief?.requestText ?? '';

  let report: WalkthroughReport;
  if (!llmAvailable()) {
    report = degradedWalkthrough(core);
  } else {
    try {
      const out = await llmJson<LlmWalkthrough>({
        system: [
          'You are a solutions consultant writing a step-by-step walkthrough of an AWS + MongoDB Atlas architecture',
          'for a client-facing PDF report. Each step is printed with the exact diagram section it explains.',
          'Order the steps the way a request or piece of data actually moves through the system: entry, processing,',
          'storage, response — then supporting concerns (monitoring, backups) last.',
          `Write 4-8 steps (never more than ${MAX_WALKTHROUGH_STEPS}). Plain language for a business reader; briefly explain any technical term you must use.`,
          'Every step MUST list the service ids it covers, copied EXACTLY from the facts — steps citing unknown ids are discarded.',
          'Every service in the facts should appear in at least one step.',
          'Ground every statement ONLY in the provided facts — never invent services or capabilities that are not listed.',
          'NEVER state a dollar figure — real costs are added separately from the actual estimate.',
        ].join('\n'),
        user: [
          requestText ? `ORIGINAL CLIENT REQUEST:\n${requestText}\n` : '',
          `ARCHITECTURE FACTS:\n${walkthroughFacts(core)}`,
          `\nProject region: ${project.defaultRegion ?? 'us-east-1'}.`,
        ].join('\n'),
        schema: WALKTHROUGH_SCHEMA,
        role: 'report',
        signal: opts?.signal,
      });
      const clean = sanitizeWalkthrough(out, core);
      if (clean) {
        report = { ...clean, degraded: false, generatedAt: new Date().toISOString() };
      } else {
        console.error('[report] walkthrough had no valid steps after sanitize — returning degraded walkthrough');
        report = degradedWalkthrough(core);
      }
    } catch (e) {
      // A failed generation must not block the export — fall back honestly.
      if (!(e instanceof LlmError)) throw e;
      console.error('[report] walkthrough generation failed, returning degraded walkthrough:', e.message);
      report = degradedWalkthrough(core);
    }
  }

  // Cache only real (non-degraded) walkthroughs so a later retry can upgrade.
  if (!report.degraded) {
    await Architecture.updateOne(
      { _id: arch._id },
      { $set: { reportWalkthrough: report, reportWalkthroughVersion: arch.version } }
    );
  }
  return { report, cached: false };
}
