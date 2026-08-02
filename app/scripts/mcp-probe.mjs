// Probe an MCP server command: connect over stdio, list tools, print them.
// Usage: node scripts/mcp-probe.mjs "<command>" [toolToDescribe]
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const command = process.argv[2];
const describe = process.argv[3];
if (!command) {
  console.error('usage: node scripts/mcp-probe.mjs "<command>" [tool]');
  process.exit(1);
}
const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
const [cmd, ...args] = parts.map((p) => p.replaceAll('"', ''));

const transport = new StdioClientTransport({ command: cmd, args });
const client = new Client({ name: 'mcp-probe', version: '0.0.1' });
const timer = setTimeout(() => {
  console.error('TIMEOUT after 180s');
  process.exit(2);
}, 180_000);

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log('TOOLS:', tools.map((t) => t.name).join(', '));
  if (describe) {
    const t = tools.find((x) => x.name === describe);
    console.log('SCHEMA:', JSON.stringify(t?.inputSchema ?? null));
  }
} catch (e) {
  console.error('CONNECT/LIST FAILED:', e?.message ?? e);
  process.exit(3);
} finally {
  clearTimeout(timer);
  await client.close().catch(() => {});
  process.exit(0);
}
