import { describe, expect, it } from 'vitest';
import { toDiagramsCode } from '@/lib/generate/topology-crosscheck';
import type { ArchContainer, ArchEdge, ArchNode } from '@/lib/generate/orchestrator';

/**
 * Feature 008 FR-040 — advisory topology cross-check.
 *
 * Only the pure renderer is tested here; the MCP round-trip needs a live
 * subprocess. What matters about the renderer is that a FAILURE IT PRODUCES IS
 * ABOUT THE TOPOLOGY. If it emitted invalid Python for a perfectly good design,
 * the advisory note would report our own codegen bug as an architecture
 * problem — the exact failure mode that makes an advisory rung worse than none.
 */

const node = (nodeId: string, serviceId: string, containerId?: string | null): ArchNode => ({
  nodeId,
  serviceId,
  provider: 'aws',
  category: 'compute',
  position: { x: 0, y: 0 },
  config: {},
  cost: 0,
  costBasis: 'indicative',
  containerId: containerId ?? null,
});

const edge = (source: string, target: string): ArchEdge => ({ edgeId: `${source}-${target}`, source, target });

const container = (containerId: string, label: string, parentContainerId?: string | null): ArchContainer => ({
  containerId,
  type: 'vpc',
  label,
  position: { x: 0, y: 0 },
  size: { width: 100, height: 100 },
  parentContainerId: parentContainerId ?? null,
});

describe('toDiagramsCode', () => {
  it('binds every node before drawing edges between them', () => {
    const code = toDiagramsCode([node('a', 'aws-lambda'), node('b', 'aws-dynamodb')], [edge('a', 'b')], []);
    expect(code).toContain('n0 = Blank("aws-lambda")');
    expect(code).toContain('n1 = Blank("aws-dynamodb")');
    expect(code.indexOf('n0 >> n1')).toBeGreaterThan(code.indexOf('n1 = Blank'));
  });

  it('drops edges whose endpoints are not in the graph', () => {
    // A dangling edge is our own validator's business, and a NameError from the
    // renderer would surface as "the topology cannot be drawn" — a true
    // statement about the wrong thing.
    const code = toDiagramsCode([node('a', 'aws-lambda')], [edge('a', 'ghost')], []);
    expect(code).not.toContain('ghost');
    expect(code).not.toContain('>>');
  });

  it('never interpolates node ids into identifiers', () => {
    // nodeIds come from model output; `n-1 = Blank(...)` is a syntax error.
    const code = toDiagramsCode([node('node-with-dashes', 'aws-s3')], [], []);
    expect(code).toContain('n0 = Blank(');
    expect(code).not.toContain('node-with-dashes =');
  });

  it('escapes labels rather than pasting them into a string literal', () => {
    const quoted = node('a', 'aws-lambda');
    quoted.displayName = 'API "gateway"\nsecond line';
    const code = toDiagramsCode([quoted], [], []);
    expect(code).toContain('\\"gateway\\"');
    expect(code).toContain('\\n');
    // The literal must stay on one line or the block structure breaks.
    expect(code.split('\n').filter((l) => l.includes('Blank('))).toHaveLength(1);
  });

  it('nests clusters and puts members inside them', () => {
    const code = toDiagramsCode(
      [node('a', 'aws-lambda', 'private'), node('b', 'aws-alb', 'vpc')],
      [],
      [container('vpc', 'VPC'), container('private', 'Private subnet', 'vpc')]
    );
    const lines = code.split('\n');
    const vpcAt = lines.findIndex((l) => l.includes('Cluster("VPC")'));
    const privateAt = lines.findIndex((l) => l.includes('Cluster("Private subnet")'));
    expect(vpcAt).toBeGreaterThan(-1);
    // Nested one level deeper than its parent.
    expect(lines[privateAt].search(/\S/)).toBeGreaterThan(lines[vpcAt].search(/\S/));
  });

  it('gives an empty cluster a body, since Python has no empty block', () => {
    const code = toDiagramsCode([], [], [container('vpc', 'VPC')]);
    expect(code).toContain('pass');
  });

  it('emits a valid body for an empty architecture', () => {
    expect(toDiagramsCode([], [], [])).toContain('    pass');
  });

  it('re-roots a cyclic parent chain instead of losing its nodes', () => {
    // Both clusters must still appear, and both must still bind their members —
    // otherwise the edges between them vanish and the render "succeeds" on a
    // graph we never actually gave it.
    const code = toDiagramsCode(
      [node('x', 'aws-lambda', 'a'), node('y', 'aws-s3', 'b')],
      [edge('x', 'y')],
      [container('a', 'A', 'b'), container('b', 'B', 'a')]
    );
    expect(code).toContain('Cluster("A")');
    expect(code).toContain('Cluster("B")');
    expect(code).toContain('n0 >> n1');
  });

  it('draws a node whose container is missing rather than dropping it', () => {
    const code = toDiagramsCode([node('a', 'aws-lambda', 'no-such-container')], [], []);
    expect(code).toContain('n0 = Blank("aws-lambda")');
  });
});
