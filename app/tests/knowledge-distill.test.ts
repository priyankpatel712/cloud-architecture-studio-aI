import { describe, expect, it } from 'vitest';
import { isProjectSpecific } from '@/lib/knowledge/types';

/**
 * Feature 008 US3 — lesson privacy (FR-021).
 *
 * Distilled lessons are stored once and then injected into OTHER projects'
 * generations. A lesson that carried a project name, a quoted phrase from
 * someone's request, or a node id would leak that content across project
 * boundaries the first time it was reused.
 *
 * The distiller prompt asks for a general rule, but a prompt is a request, not a
 * guarantee — so this check runs before storage. Enforcing at WRITE time is the
 * point: a lesson that never contains project data cannot leak it later,
 * regardless of who reads the store afterwards.
 */

describe('isProjectSpecific — rejects', () => {
  it('canvas node ids', () => {
    expect(isProjectSpecific('Connect n4 to n7 for ordering.')).toBe(true);
    expect(isProjectSpecific('The N12 lambda was missing.')).toBe(true);
  });

  it('quoted literals lifted from a user request', () => {
    expect(isProjectSpecific('When the user says "our Acme billing pipeline", add a queue.')).toBe(true);
  });

  it('database identifiers', () => {
    expect(isProjectSpecific('Project 507f1f77bcf86cd799439011 needed a cache.')).toBe(true);
  });

  it('URLs, emails, and IP addresses', () => {
    expect(isProjectSpecific('See https://internal.example.com/design for context.')).toBe(true);
    expect(isProjectSpecific('Ask alice@example.com about the schema.')).toBe(true);
    expect(isProjectSpecific('The origin was 10.0.1.42.')).toBe(true);
  });
});

describe('isProjectSpecific — accepts genuinely general lessons', () => {
  const good = [
    'When a request mentions real-time notifications, include a push or streaming path.',
    'Requests describing spiky or bursty load need a queue between producer and consumer.',
    'A stated compliance requirement implies encryption at rest and a WAF at the edge.',
    'High availability requires at least two availability zones behind a load balancer.',
    'Analytics workloads should not query the transactional database directly.',
  ];

  it('lets a reusable rule through', () => {
    for (const lesson of good) {
      expect(isProjectSpecific(lesson), `should be reusable: "${lesson}"`).toBe(false);
    }
  });

  it('does not mistake ordinary numbers for identifiers', () => {
    // "two AZs" and "3 replicas" are general; only ids and addresses are not.
    expect(isProjectSpecific('Use at least 2 availability zones and 3 replicas.')).toBe(false);
  });
});
