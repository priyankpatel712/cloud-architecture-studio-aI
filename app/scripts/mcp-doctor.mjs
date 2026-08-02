#!/usr/bin/env node
/**
 * MCP connectivity check (feature 008 US4, FR-028).
 *
 * Launches every server the registry reports as configured, lists its tools, and
 * says whether the tool the adapters intend to call is actually there.
 *
 * WHY THIS EXISTS. An MCP server is a subprocess started from a command string;
 * a typo, a missing runtime (`uvx`), or a renamed tool all fail the same silent
 * way — the generation turn degrades to indicative mode and nobody knows the
 * grounding was lost. This turns a silent degradation into an explicit report.
 *
 * USAGE
 *   node scripts/mcp-doctor.mjs
 *
 * Exit code is 0 even when servers fail: the app is designed to run without
 * them, so an unreachable server is information, not a build break.
 */

import { exit } from 'node:process';

const TIMEOUT_MS = 60_000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s (${label})`)), ms)),
  ]);
}

async function main() {
  const { mcpServers } = await import('../src/lib/providers/mcp-registry.ts');
  const { listMcpTools, closeMcpClients } = await import('../src/lib/providers/mcp-client.ts');

  const servers = mcpServers();
  if (servers.length === 0) {
    console.log('No MCP servers configured. Generation runs in clearly-labelled indicative mode.');
    exit(0);
  }

  console.log(`Checking ${servers.length} configured MCP server(s)…\n`);
  let reachable = 0;

  for (const server of servers) {
    process.stdout.write(`  ${server.id.padEnd(20)} ${server.provider}/${server.purpose}\n`);
    process.stdout.write(`  ${''.padEnd(20)} ${server.command}\n`);
    try {
      // First launch downloads the package, which is why the timeout is generous.
      const tools = await withTimeout(listMcpTools(server.command), TIMEOUT_MS, server.id);
      reachable++;
      const missing = server.tools.filter((t) => !tools.includes(t));
      console.log(`  ${''.padEnd(20)} ✓ connected — ${tools.length} tool(s)`);
      if (missing.length > 0) {
        // Reachable but wrong: the adapter will call a tool that is not there.
        console.log(`  ${''.padEnd(20)} ⚠ EXPECTED TOOL NOT FOUND: ${missing.join(', ')}`);
        console.log(`  ${''.padEnd(20)}   exposes: ${tools.slice(0, 12).join(', ')}${tools.length > 12 ? ' …' : ''}`);
      }
    } catch (e) {
      console.log(`  ${''.padEnd(20)} ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log('');
  }

  console.log(`${reachable}/${servers.length} reachable.`);
  // Shut the subprocesses down before exiting, or the first one to write to a
  // closed stdout dies with an EPIPE trace that reads like a script failure.
  await closeMcpClients();
  exit(0);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
