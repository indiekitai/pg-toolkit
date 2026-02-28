/**
 * Unified MCP server — combines pg-inspect, pg-diff, and pg-top tools.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { inspect } from '@indiekitai/pg-inspect';
import { diff } from '@indiekitai/pg-diff';
import { PgMonitor } from '@indiekitai/pg-top';

function serialize(val: any): any {
  if (val instanceof Map) {
    const obj: Record<string, any> = {};
    for (const [k, v] of val) obj[k] = serialize(v);
    return obj;
  }
  if (Array.isArray(val)) return val.map(serialize);
  if (val && typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (typeof v === 'function' || k.startsWith('_')) continue;
      out[k] = serialize(v);
    }
    return out;
  }
  return val;
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'pg-toolkit',
    version: '0.2.0',
  });

  // ─── Inspect tools ──────────────────────────────────────

  server.tool(
    'inspect_schema',
    'Inspect PostgreSQL database schema — returns tables, views, functions, indexes, etc.',
    {
      connectionString: z.string().describe('PostgreSQL connection string'),
      filter: z.string().optional().describe('Filter: tables, views, functions, indexes, sequences, enums, extensions, triggers, constraints, schemas, privileges, types, domains, collations, rls'),
    },
    async ({ connectionString, filter }) => {
      const result = await inspect(connectionString);
      let output: any;
      if (filter && (result as any)[filter]) {
        output = serialize((result as any)[filter]);
      } else {
        output = serialize(result);
      }
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    },
  );

  // ─── Diff tools ─────────────────────────────────────────

  server.tool(
    'diff_schemas',
    'Compare two PostgreSQL databases and generate migration SQL',
    {
      fromUrl: z.string().describe('Source database connection string'),
      toUrl: z.string().describe('Target database connection string'),
      safe: z.boolean().optional().describe('Omit DROP statements'),
    },
    async ({ fromUrl, toUrl, safe }) => {
      const result = await diff(fromUrl, toUrl, { safe });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ─── Doctor tools ───────────────────────────────────────

  server.tool(
    'pg_doctor',
    'Run comprehensive PostgreSQL health diagnosis — scores database 0-100, checks connections, cache, indexes, bloat, locks, vacuum, slow queries. Returns fix SQL.',
    {
      connectionString: z.string().describe('PostgreSQL connection string'),
      format: z.enum(['json', 'text', 'markdown']).optional().describe('Output format (default: json)'),
    },
    async ({ connectionString, format }) => {
      const { doctor, formatDoctorResult } = await import('./doctor.js');
      const result = await doctor({ connectionString });
      const fmt = format || 'json';
      return { content: [{ type: 'text', text: formatDoctorResult(result, fmt) }] };
    },
  );

  // ─── Top tools ──────────────────────────────────────────

  server.tool(
    'pg_activity',
    'Get current PostgreSQL activity snapshot (connections, queries, locks)',
    {
      connectionString: z.string().describe('PostgreSQL connection string'),
    },
    async ({ connectionString }) => {
      const monitor = new PgMonitor({
        connectionString,
        refreshInterval: 1,
        snapshot: true,
        json: true,
        noIdle: false,
      });

      // Capture JSON output
      const chunks: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        chunks.push(String(chunk));
        return true;
      }) as any;

      try {
        await monitor.start();
      } finally {
        process.stdout.write = origWrite;
      }

      return { content: [{ type: 'text', text: chunks.join('') }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Direct execution
if (process.argv[1]?.endsWith('mcp.js') || process.argv.includes('--mcp')) {
  startMcpServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
