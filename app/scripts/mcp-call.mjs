// Call one tool on an MCP server command with JSON args from argv.
// Usage: node scripts/mcp-call.mjs "<command>" <tool> '<json-args>'
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const [command, tool, rawArgs] = process.argv.slice(2);
const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
const [cmd, ...args] = parts.map((p) => p.replaceAll('"', ''));

const env = { ...getDefaultEnvironment() };
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;

const transport = new StdioClientTransport({ command: cmd, args, env });
const client = new Client({ name: 'mcp-call', version: '0.0.1' });
setTimeout(() => { console.error('TIMEOUT'); process.exit(2); }, 180_000);

await client.connect(transport);
const result = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) });
const text = (Array.isArray(result.content) ? result.content : [])
  .filter((c) => c?.type === 'text')
  .map((c) => c.text)
  .join('\n');
console.log('ISERROR:', Boolean(result.isError));
console.log(text.slice(0, 1200));
await client.close().catch(() => {});
process.exit(0);
