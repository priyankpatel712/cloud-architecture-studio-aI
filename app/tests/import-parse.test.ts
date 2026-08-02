import { describe, expect, it } from 'vitest';
import { detectImportFormat, parseImport, parseMermaid, parseStudioJson, mapLabelToService } from '@/lib/import/parse';
import { toJsonDocument } from '@/lib/export/serialize';

/**
 * Diagram import (007 roadmap 1.2): studio-JSON round-trip fidelity and
 * deterministic Mermaid parsing (subgraphs → containers, keyword → system
 * catalog mapping, catalog-id labels round-trip to the real service).
 */

describe('detectImportFormat', () => {
  it('detects JSON, Mermaid (with and without frontmatter), and rejects noise', () => {
    expect(detectImportFormat('{"nodes":[]}')).toBe('json');
    expect(detectImportFormat('flowchart LR\n a --> b')).toBe('mermaid');
    expect(detectImportFormat('graph TD\n a --> b')).toBe('mermaid');
    expect(detectImportFormat('---\ntitle: x\n---\nflowchart LR\n a --> b')).toBe('mermaid');
    expect(detectImportFormat('hello world')).toBeNull();
    expect(detectImportFormat('')).toBeNull();
  });
});

describe('parseStudioJson', () => {
  const exported = toJsonDocument({
    name: 'Test',
    nodes: [
      { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws', category: 'Compute', config: { memory: 512 }, cost: 12, position: { x: 10, y: 20 }, containerId: 'c1' },
      { nodeId: 'n2', serviceId: 'atlas-cluster', provider: 'mongodb', config: { tier: 'M30' }, cost: 388, position: { x: 300, y: 20 }, displayName: 'Orders DB' },
    ],
    edges: [{ source: 'n1', target: 'n2', label: 'reads/writes' }],
    containers: [{ containerId: 'c1', type: 'vpc', label: 'VPC', position: { x: 0, y: 0 }, size: { width: 500, height: 400 } }],
    annotations: [{ annotationId: 'a1', kind: 'sticky', content: 'note', position: { x: 5, y: 5 }, size: { width: 200, height: 120 }, style: { color: 'yellow' } }],
  });

  it('round-trips our own export with full fidelity', () => {
    const { doc, format, warnings } = parseStudioJson(exported);
    expect(format).toBe('json');
    expect(warnings).toEqual([]);
    expect(doc.nodes).toHaveLength(2);
    const n1 = doc.nodes.find((n) => n.nodeId === 'n1')!;
    expect(n1.serviceId).toBe('aws-lambda');
    expect(n1.provider).toBe('aws');
    expect(n1.config).toEqual({ memory: 512 });
    expect(n1.containerId).toBe('c1');
    expect(n1.position).toEqual({ x: 10, y: 20 });
    expect(doc.nodes.find((n) => n.nodeId === 'n2')!.displayName).toBe('Orders DB');
    expect(doc.edges).toHaveLength(1);
    expect(doc.edges[0].label).toBe('reads/writes');
    expect(doc.containers).toHaveLength(1);
    expect(doc.annotations).toHaveLength(1);
    expect(doc.annotations[0].style?.color).toBe('yellow');
  });

  it('drops dangling references with warnings instead of failing', () => {
    const { doc, warnings } = parseStudioJson(
      JSON.stringify({
        format: 'cloud-architecture-studio/v1',
        nodes: [
          { nodeId: 'n1', serviceId: 'aws-s3', provider: 'aws', containerId: 'ghost' },
          { serviceId: 'broken-no-id' },
        ],
        edges: [
          { source: 'n1', target: 'missing' },
          { source: 'n1', target: 'n1' },
        ],
        containers: [{ containerId: 'c1', type: 'group', parentContainerId: 'ghost-parent' }],
      })
    );
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0].containerId).toBeNull();
    expect(doc.edges).toHaveLength(0);
    expect(doc.containers[0].parentContainerId).toBeNull();
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('infers provider from the serviceId slug when the declared provider is junk', () => {
    const { doc } = parseStudioJson(
      JSON.stringify({ format: 'cloud-architecture-studio/v1', nodes: [{ nodeId: 'n1', serviceId: 'sys-cache', provider: 'gcp' }], edges: [] })
    );
    expect(doc.nodes[0].provider).toBe('system');
  });

  it('rejects non-JSON and non-studio JSON with friendly errors', () => {
    expect(() => parseStudioJson('not json')).toThrow(/not valid JSON/);
    expect(() => parseStudioJson('{"foo": 1}')).toThrow(/not a studio export/);
    expect(() => parseImport('random text')).toThrow(/Unrecognized format/);
  });
});

describe('mapLabelToService', () => {
  it('maps an exact catalog serviceId label to the real service (our own Mermaid export round-trip)', () => {
    expect(mapLabelToService('aws-lambda', 'n1')).toEqual({ serviceId: 'aws-lambda', provider: 'aws' });
    expect(mapLabelToService('atlas-cluster', 'x')).toEqual({ serviceId: 'atlas-cluster', provider: 'mongodb' });
  });

  it('maps keywords to the generic system catalog', () => {
    expect(mapLabelToService('PostgreSQL', 'db').serviceId).toBe('sys-relational-db');
    expect(mapLabelToService('Redis Cache', 'c').serviceId).toBe('sys-cache');
    expect(mapLabelToService('Load Balancer', 'lb').serviceId).toBe('sys-load-balancer');
    expect(mapLabelToService('Order Queue', 'q').serviceId).toBe('sys-message-queue');
    expect(mapLabelToService('Mobile App', 'm').serviceId).toBe('sys-mobile-client');
  });

  it('falls back to a generic service', () => {
    expect(mapLabelToService('Order Processor Thing', 'x').serviceId).toBe('sys-service');
  });
});

describe('parseMermaid', () => {
  it('parses nodes, chained edges, and edge labels', () => {
    const { doc } = parseMermaid(
      ['flowchart LR', '  web[Web Client] -->|HTTPS| api[API Gateway] --> svc[Order Service]', '  svc --> db[(PostgreSQL)]'].join('\n')
    );
    expect(doc.nodes).toHaveLength(4);
    expect(doc.edges).toHaveLength(3);
    const web = doc.nodes.find((n) => n.nodeId === 'imp-web')!;
    expect(web.serviceId).toBe('sys-web-client');
    expect(doc.nodes.find((n) => n.nodeId === 'imp-db')!.serviceId).toBe('sys-relational-db');
    expect(doc.edges[0].label).toBe('HTTPS');
    // Every edge endpoint resolves to a node.
    const ids = new Set(doc.nodes.map((n) => n.nodeId));
    for (const e of doc.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('turns subgraphs into group containers with membership', () => {
    const { doc } = parseMermaid(
      ['flowchart LR', '  subgraph tier["Application Tier"]', '    svc[Order Service]', '  end', '  web[Web] --> svc'].join('\n')
    );
    expect(doc.containers).toHaveLength(1);
    expect(doc.containers[0].label).toBe('Application Tier');
    expect(doc.nodes.find((n) => n.nodeId === 'imp-svc')!.containerId).toBe(doc.containers[0].containerId);
    expect(doc.nodes.find((n) => n.nodeId === 'imp-web')!.containerId).toBeNull();
  });

  it('strips the cost suffix our own Mermaid export adds and keeps custom labels as display names', () => {
    const { doc } = parseMermaid(['flowchart LR', '  n1["aws-lambda<br/>$12.00/mo"] --> n2["My Special Service"]'].join('\n'));
    expect(doc.nodes.find((n) => n.nodeId === 'imp-n1')!.serviceId).toBe('aws-lambda');
    const custom = doc.nodes.find((n) => n.nodeId === 'imp-n2')!;
    expect(custom.serviceId).toBe('sys-service');
    expect(custom.displayName).toBe('My Special Service');
  });

  it('rejects text without a flowchart/graph header and empty diagrams', () => {
    expect(() => parseMermaid('sequenceDiagram\n  A->>B: hi')).toThrow(/flowchart/);
    expect(() => parseMermaid('flowchart LR')).toThrow(/No nodes/);
  });
});
