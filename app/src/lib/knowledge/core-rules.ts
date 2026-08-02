import type { KnowledgeSeed } from '@/lib/knowledge/types';

/**
 * Provider-AGNOSTIC generation rules (feature 008 US3, FR-018).
 *
 * Only rules that hold for every provider belong here. Anything naming a
 * vendor's services lives in that provider's plugin (`providers/<id>/rules.ts`)
 * so adding a provider never requires editing core — constitution Principle II.
 *
 * The modification-turn rules at the end exist because they encode the very
 * behavior this feature was built to fix: change only what was asked, ask when
 * a reference is ambiguous, and treat "undo" as a restore rather than a
 * redesign. Stating them as graded rules means a regression shows up in review
 * rather than in a user complaint.
 */
export const CORE_RULES: KnowledgeSeed[] = [
  {
    title: 'No empty containers',
    content:
      'Never leave a container with no children. If a change empties a container, remove the container too.',
    keywords: ['container', 'empty', 'group', 'boundary', 'cleanup'],
  },
  {
    title: 'Diagrams read left to right',
    content:
      'Lay the diagram out left to right: clients and edge on the left, compute in the middle, data stores on the right. Edges follow the direction of the request.',
    keywords: ['layout', 'flow', 'direction', 'readable', 'alignment', 'left to right'],
  },
  {
    title: 'Edges carry verbs',
    content:
      'Label edges with what actually happens — invokes, reads, writes, publishes, subscribes — so the diagram can be read without a legend.',
    keywords: ['edge', 'label', 'connection', 'verb', 'readable', 'flow'],
  },
  {
    title: 'Async requirements get a buffer',
    content:
      'When a requirement mentions queuing, buffering, decoupling, retries, or spiky load, put a queue or stream between producer and consumer rather than a direct edge.',
    keywords: ['queue', 'async', 'buffer', 'decouple', 'event', 'stream', 'retry', 'spike', 'burst'],
  },
  {
    title: 'Every node is connected',
    content:
      'Every node has at least one edge unless it is genuinely standalone. An orphaned node is almost always a missing connection.',
    keywords: ['edge', 'orphan', 'connected', 'isolated', 'node'],
  },
  {
    title: 'Modifications change only what was asked',
    content:
      'On a modification request, change only the elements the user referred to and the edges they imply. Never rebuild, re-layout, or remove parts of the diagram the request did not mention.',
    keywords: ['modify', 'change', 'edit', 'follow-up', 'scope', 'preserve', 'update'],
  },
  {
    title: 'Ambiguous references are questions, not guesses',
    content:
      'If a reference could mean two or more existing elements, ask one short clarifying question naming the candidates. Never pick one arbitrarily.',
    keywords: ['ambiguous', 'reference', 'which', 'clarify', 'unclear', 'that one'],
  },
  {
    title: 'Undo means restore',
    content:
      'A request to undo, revert, or go back means restoring a previous version — never generating a new design and never silently discarding current work.',
    keywords: ['undo', 'revert', 'go back', 'restore', 'previous', 'history'],
  },
];
