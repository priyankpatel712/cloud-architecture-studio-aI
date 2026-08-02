import type { KnowledgeSeed } from '@/lib/knowledge/types';

/**
 * MongoDB Atlas best-practice rules (feature 008 US3, FR-018/FR-038).
 * Live inside the Atlas plugin per constitution Principle II — see
 * providers/aws/rules.ts for the reasoning.
 */
export const MONGODB_RULES: KnowledgeSeed[] = [
  {
    title: 'Clusters live in a project container',
    content:
      'An Atlas cluster always sits inside an Atlas project container. When the design has a VPC, application access goes through a private endpoint or peering rather than the public internet.',
    keywords: ['atlas', 'cluster', 'mongodb', 'project', 'peering', 'private endpoint', 'vpc'],
  },
  {
    title: 'Vector search sits alongside the cluster',
    content:
      'Semantic, vector, or embedding search uses Atlas Vector Search alongside the existing cluster — not a separate database.',
    keywords: ['vector', 'embedding', 'semantic search', 'rag', 'similarity', 'atlas search', 'ai'],
  },
];
