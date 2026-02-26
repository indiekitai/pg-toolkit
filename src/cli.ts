/**
 * pg-toolkit CLI — unified entry point for all IndieKit PG tools.
 */

import { inspect } from '@indiekitai/pg-inspect';
import { diff } from '@indiekitai/pg-diff';
import { PgMonitor } from '@indiekitai/pg-top';
import { execFileSync } from 'node:child_process';

const VERSION = '0.1.0';

const HELP = `
pg-toolkit v${VERSION} — Unified PostgreSQL toolkit

Usage:
  pg-toolkit <command> [options] [connection-string...]

Commands:
  inspect   Inspect database schema (tables, views, functions, etc.)
  diff      Compare two database schemas and generate migration SQL
  top       Real-time activity monitor (like top for Postgres)
  analyze   Detect N+1 query patterns and suggest CTE + JSON_AGG optimizations
  health    Run health checks (requires pg-health)
  types     Generate TypeScript types from schema (requires pg2ts)
  mcp       Start unified MCP server

Run 'pg-toolkit <command> --help' for command-specific help.
`.trim();

// ─── Helpers ──────────────────────────────────────────────

function getConnStr(args: string[]): string {
  const url = args.find((a) => !a.startsWith('-'));
  return url || process.env.DATABASE_URL || '';
}

function die(msg: string): never {
  console.error('Error: ' + msg);
  process.exit(1);
}

function mapToObj(map: Map<string, any>): Record<string, any> {
  const obj: Record<string, any> = {};
  for (const [k, v] of map) obj[k] = serialize(v);
  return obj;
}

function serialize(val: any): any {
  if (val instanceof Map) return mapToObj(val);
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

// ─── Subcommands ──────────────────────────────────────────

const INSPECT_FILTERS = [
  'tables', 'views', 'functions', 'indexes', 'sequences',
  'enums', 'extensions', 'triggers', 'constraints', 'schemas',
  'privileges', 'types', 'domains', 'collations', 'rls',
] as const;

async function cmdInspect(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`pg-toolkit inspect — Inspect PostgreSQL schema

Usage: pg-toolkit inspect [options] <connection-string>

Options:
  --tables, --views, --functions, --indexes, --sequences,
  --enums, --extensions, --triggers, --constraints, --schemas,
  --privileges, --types, --domains, --collations, --rls
      Filter to specific object types

  --summary    Show summary counts only
  --json       JSON output (default)`);
    return;
  }

  const connStr = getConnStr(args);
  if (!connStr) die('Connection string required. Usage: pg-toolkit inspect <connection-string>');

  const result = await inspect(connStr);
  const filters = INSPECT_FILTERS.filter((f) => args.includes(`--${f}`));
  const summary = args.includes('--summary');

  if (summary) {
    const counts: Record<string, number> = {};
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      const val = (result as any)[key];
      if (val instanceof Map) counts[key] = val.size;
      else if (Array.isArray(val)) counts[key] = val.length;
    }
    console.log(JSON.stringify(counts, null, 2));
    return;
  }

  if (filters.length > 0) {
    const out: Record<string, any> = {};
    for (const f of filters) {
      const val = (result as any)[f];
      if (val) out[f] = serialize(val);
    }
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(JSON.stringify(serialize(result), null, 2));
  }
}

async function cmdDiff(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`pg-toolkit diff — Compare two PostgreSQL schemas

Usage: pg-toolkit diff [options] <from_url> <to_url>

Options:
  --json       JSON output (machine-readable)
  --safe       Omit DROP statements`);
    return;
  }

  const urls = args.filter((a) => !a.startsWith('-'));
  if (urls.length < 2) die('Two connection strings required. Usage: pg-toolkit diff <from_url> <to_url>');

  const jsonMode = args.includes('--json');
  const safe = args.includes('--safe');
  const ignoreExtVersions = args.includes('--ignore-extension-versions');

  const result = await diff(urls[0], urls[1], { safe, ignoreExtensionVersions: ignoreExtVersions });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.sql) {
      console.log(result.sql);
    } else {
      console.log('No differences found.');
    }
  }
}

async function cmdTop(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`pg-toolkit top — Real-time PostgreSQL activity monitor

Usage: pg-toolkit top [options] <connection-string>

Options:
  --refresh <seconds>   Refresh interval (default: 2)
  --no-idle             Hide idle connections
  --snapshot            Single snapshot, then exit
  --json                Output as JSON (with --snapshot)`);
    return;
  }

  const connStr = getConnStr(args);
  if (!connStr) die('Connection string required. Usage: pg-toolkit top <connection-string>');

  let refreshInterval = 2;
  let noIdle = false;
  let snapshot = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--refresh' && args[i + 1]) refreshInterval = Number(args[++i]);
    else if (args[i] === '--no-idle') noIdle = true;
    else if (args[i] === '--snapshot') snapshot = true;
    else if (args[i] === '--json') json = true;
  }

  const monitor = new PgMonitor({
    connectionString: connStr,
    refreshInterval,
    noIdle,
    snapshot,
    json,
  });

  await monitor.start();
}

function cmdHealth(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`pg-toolkit health — PostgreSQL health checks (delegates to pg-health)

Usage: pg-toolkit health <connection-string>

Requires pg-health to be installed (pip install pg-health or available in PATH).`);
    return;
  }

  const connStr = getConnStr(args);
  if (!connStr) die('Connection string required.');

  try {
    execFileSync('pg-health', [connStr], { stdio: 'inherit' });
  } catch {
    console.error('pg-health not found. Install it: pip install pg-health');
    process.exit(1);
  }
}

function cmdTypes(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`pg-toolkit types — Generate TypeScript types from PostgreSQL schema

Usage: pg-toolkit types <connection-string>

Requires pg2ts to be installed and available in PATH.`);
    return;
  }

  const connStr = getConnStr(args);
  if (!connStr) die('Connection string required.');

  try {
    execFileSync('pg2ts', [connStr], { stdio: 'inherit' });
  } catch {
    console.error('pg2ts not found. Install it or check PATH.');
    process.exit(1);
  }
}

async function cmdAnalyze(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`pg-toolkit analyze — Detect N+1 query patterns and suggest optimizations

Usage: pg-toolkit analyze [options] <connection-string>

Options:
  --json       JSON output (default: human-readable)

Scans table structures and foreign keys to detect:
  - EAV (Entity-Attribute-Value) pattern tables
  - Many-to-one relationships prone to N+1
  - Tables with multiple child tables

Suggests CTE + JSON_AGG rewrites for each finding.`);
    return;
  }

  const connStr = getConnStr(args);
  if (!connStr) die('Connection string required. Usage: pg-toolkit analyze <connection-string>');

  const { analyze, formatAnalyzeResult } = await import('./analyze.js');
  const result = await analyze(connStr);
  const jsonMode = args.includes('--json');
  console.log(formatAnalyzeResult(result, jsonMode));
}

// ─── Router ───────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case 'inspect': return cmdInspect(rest);
    case 'diff': return cmdDiff(rest);
    case 'top': return cmdTop(rest);
    case 'analyze': return cmdAnalyze(rest);
    case 'health': return cmdHealth(rest);
    case 'types': return cmdTypes(rest);
    case 'mcp': {
      const { startMcpServer } = await import('./mcp.js');
      return startMcpServer();
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
