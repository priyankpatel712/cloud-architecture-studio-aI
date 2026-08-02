import { describe, expect, it } from 'vitest';
import { toMermaid, toJsonDocument } from '@/lib/export/serialize';

const nodes = [
  { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws', cost: 12.5 },
  { nodeId: 'n2', serviceId: 'atlas-cluster', provider: 'mongodb', cost: 57 },
];
const edges = [{ source: 'n1', target: 'n2' }];

describe('export serialization (FR-024)', () => {
  it('produces a mermaid flowchart with provider subgraphs and costs', () => {
    const mmd = toMermaid('My App', nodes, edges);
    expect(mmd).toContain('flowchart LR');
    expect(mmd).toContain('title: My App');
    expect(mmd).toContain('subgraph aws["AWS"]');
    expect(mmd).toContain('subgraph mongodb["MongoDB Atlas"]');
    expect(mmd).toContain('n1["aws-lambda<br/>$12.50/mo"]');
    expect(mmd).toContain('n1 --> n2');
  });

  it('drops edges that reference unknown nodes', () => {
    const mmd = toMermaid('X', nodes, [{ source: 'n1', target: 'ghost' }]);
    expect(mmd).not.toContain('ghost');
  });

  it('produces a parseable JSON document with totals', () => {
    const doc = JSON.parse(toJsonDocument({ name: 'My App', nodes, edges }));
    expect(doc.format).toBe('cloud-architecture-studio/v1');
    expect(doc.estimate).toEqual({ monthly: 69.5, currency: 'USD' });
    expect(doc.nodes).toHaveLength(2);
    expect(doc.edges).toHaveLength(1);
  });

  // --- 002: containers/annotations (contracts/export-fidelity.md) ---

  const containers = [
    { containerId: 'c1', type: 'vpc', label: 'Main VPC', position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, parentContainerId: null },
    { containerId: 'c2', type: 'subnet', label: 'Private subnet', position: { x: 20, y: 20 }, size: { width: 200, height: 150 }, parentContainerId: 'c1' },
  ];
  const containedNodes = [
    { ...nodes[0], containerId: 'c2' },
    { ...nodes[1], containerId: null },
  ];
  const annotations = [
    { annotationId: 'a1', kind: 'sticky' as const, content: 'Remember to enable backups', position: { x: 0, y: 0 }, size: { width: 100, height: 60 } },
  ];

  it('nests mermaid subgraphs to mirror container structure (FR-007/SC-005)', () => {
    const mmd = toMermaid('My App', containedNodes, edges, containers);
    const vpcIdx = mmd.indexOf('subgraph c1["Main VPC"]');
    const subnetIdx = mmd.indexOf('subgraph c2["Private subnet"]');
    const nodeIdx = mmd.indexOf('n1["aws-lambda<br/>$12.50/mo"]');
    const subnetEndIdx = mmd.indexOf('end', subnetIdx);
    const vpcEndIdx = mmd.indexOf('end', subnetEndIdx + 1);
    // vpc opens before subnet, subnet opens before its node, node closes before subnet, subnet closes before vpc.
    expect(vpcIdx).toBeGreaterThanOrEqual(0);
    expect(subnetIdx).toBeGreaterThan(vpcIdx);
    expect(nodeIdx).toBeGreaterThan(subnetIdx);
    expect(nodeIdx).toBeLessThan(subnetEndIdx);
    expect(subnetEndIdx).toBeLessThan(vpcEndIdx);
    // The un-contained node (n2) still falls back to provider grouping.
    expect(mmd).toContain('subgraph mongodb["MongoDB Atlas"]');
  });

  it('round-trips a full document — containers/annotations/displayName survive JSON export (SC-005)', () => {
    const namedNodes = [{ ...containedNodes[0], displayName: 'Checkout Lambda' }, containedNodes[1]];
    const json = toJsonDocument({ name: 'My App', nodes: namedNodes, edges, containers, annotations });
    const doc = JSON.parse(json);
    expect(doc.containers).toEqual(containers);
    expect(doc.annotations).toEqual(annotations);
    expect(doc.nodes[0].displayName).toBe('Checkout Lambda');
    expect(doc.nodes[0].containerId).toBe('c2');
    // Re-serializing the parsed doc's own fields is lossless.
    expect(JSON.parse(toJsonDocument({ name: 'My App', nodes: namedNodes, edges, containers, annotations }))).toEqual(doc);
  });
});
