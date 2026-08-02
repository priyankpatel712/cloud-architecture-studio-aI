import { describe, expect, it } from 'vitest';
import { toTerraform } from '@/lib/export/terraform';
import type { ExportNode } from '@/lib/export/serialize';

/** One-way Terraform export (007 roadmap 3.3). */
describe('toTerraform', () => {
  const nodes: ExportNode[] = [
    { nodeId: 'n1', serviceId: 'aws-lambda', provider: 'aws', displayName: 'Order Handler', config: { memory: 1024 } },
    { nodeId: 'n2', serviceId: 'aws-s3', provider: 'aws', config: {} },
    { nodeId: 'n3', serviceId: 'atlas-cluster', provider: 'mongodb', config: { tier: 'M10', nodes: 3 } },
    { nodeId: 'n4', serviceId: 'sys-cache', provider: 'system', displayName: 'Session Cache', config: {} },
    { nodeId: 'n5', serviceId: 'aws-textract', provider: 'aws', displayName: 'Textract', config: {} },
  ];
  const edges = [{ source: 'n1', target: 'n2', label: 'writes' }];
  const tf = toTerraform({ name: 'Shop', nodes, edges, defaultRegion: 'eu-west-1' });

  it('declares only the providers actually present, with the project region', () => {
    expect(tf).toContain('hashicorp/aws');
    expect(tf).toContain('mongodb/mongodbatlas');
    expect(tf).toContain('region = "eu-west-1"');
  });

  it('maps catalog services to resources and carries sizing from configs', () => {
    expect(tf).toContain('resource "aws_lambda_function" "order_handler"');
    expect(tf).toContain('memory_size   = 1024');
    expect(tf).toContain('resource "aws_s3_bucket"');
    expect(tf).toContain('resource "mongodbatlas_advanced_cluster"');
    expect(tf).toContain('instance_size = "M10"');
  });

  it('emits TODO markers for unmapped services and comments for generic components', () => {
    expect(tf).toContain('no Terraform mapping for aws-textract');
    expect(tf).toContain('Generic design components');
    expect(tf).toContain('Session Cache');
  });

  it('records the diagram connections as wiring comments', () => {
    expect(tf).toContain('Order Handler -> aws-s3 (writes)');
  });

  it('omits provider blocks entirely for a pure generic diagram', () => {
    const generic = toTerraform({
      name: 'HLD',
      nodes: [{ nodeId: 'g1', serviceId: 'sys-service', provider: 'system', config: {} }],
      edges: [],
    });
    expect(generic).not.toContain('hashicorp/aws');
    expect(generic).not.toContain('mongodbatlas');
  });
});
