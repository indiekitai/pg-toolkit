/**
 * pg-toolkit doctor — Comprehensive PostgreSQL health diagnosis.
 *
 * Runs all checks, scores the database 0-100, generates fix SQL.
 */

import type { Pool as PoolType, PoolClient } from 'pg';

// ─── Types ────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  category: string;
  status: 'pass' | 'warn' | 'fail';
  score: number; // 0-100 for this check
  weight: number;
  message: string;
  details?: any;
  fixes?: string[]; // SQL statements to fix
}

export interface DoctorResult {
  database: string;
  timestamp: string;
  overallScore: number;
  checks: CheckResult[];
  fixes: string[];
  summary: { pass: number; warn: number; fail: number };
}

export interface DoctorOptions {
  connectionString: string;
  threshold?: number;
}

// ─── SQL Queries ──────────────────────────────────────────

const QUERIES = {
  connectionStats: `
    SELECT
      (SELECT count(*) FROM pg_stat_activity) AS total_connections,
      (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
      (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') AS idle_connections,
      (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') AS active_connections,
      (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction') AS idle_in_transaction
  `,

  cacheHitRatio: `
    SELECT
      COALESCE(sum(heap_blks_hit), 0) AS hit,
      COALESCE(sum(heap_blks_read), 0) AS read
    FROM pg_statio_user_tables
  `,

  indexCacheHitRatio: `
    SELECT
      COALESCE(sum(idx_blks_hit), 0) AS hit,
      COALESCE(sum(idx_blks_read), 0) AS read
    FROM pg_statio_user_indexes
  `,

  unusedIndexes: `
    SELECT
      schemaname || '.' || relname AS table,
      indexrelname AS index,
      pg_size_pretty(pg_relation_size(i.indexrelid)) AS size,
      pg_relation_size(i.indexrelid) AS size_bytes,
      idx_scan AS scans
    FROM pg_stat_user_indexes i
    JOIN pg_index pi ON i.indexrelid = pi.indexrelid
    WHERE idx_scan = 0
      AND NOT pi.indisunique
      AND NOT pi.indisprimary
      AND pg_relation_size(i.indexrelid) > 8192
    ORDER BY pg_relation_size(i.indexrelid) DESC
    LIMIT 20
  `,

  tableBloat: `
    SELECT
      schemaname || '.' || relname AS table,
      n_dead_tup,
      n_live_tup,
      CASE WHEN n_live_tup > 0
        THEN round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
        ELSE 0
      END AS dead_ratio,
      pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
      last_autovacuum,
      last_autoanalyze
    FROM pg_stat_user_tables
    WHERE n_live_tup + n_dead_tup > 1000
    ORDER BY dead_ratio DESC
    LIMIT 20
  `,

  longTransactions: `
    SELECT
      pid,
      now() - xact_start AS duration,
      EXTRACT(EPOCH FROM (now() - xact_start)) AS duration_seconds,
      state,
      LEFT(query, 200) AS query,
      usename,
      application_name
    FROM pg_stat_activity
    WHERE xact_start IS NOT NULL
      AND state != 'idle'
      AND now() - xact_start > interval '5 minutes'
    ORDER BY xact_start
    LIMIT 10
  `,

  locks: `
    SELECT
      blocked.pid AS blocked_pid,
      blocked.query AS blocked_query,
      blocking.pid AS blocking_pid,
      blocking.query AS blocking_query
    FROM pg_locks bl
    JOIN pg_stat_activity blocked ON bl.pid = blocked.pid
    JOIN pg_locks kl ON bl.locktype = kl.locktype
      AND bl.database IS NOT DISTINCT FROM kl.database
      AND bl.relation IS NOT DISTINCT FROM kl.relation
      AND bl.page IS NOT DISTINCT FROM kl.page
      AND bl.tuple IS NOT DISTINCT FROM kl.tuple
      AND bl.transactionid IS NOT DISTINCT FROM kl.transactionid
      AND bl.classid IS NOT DISTINCT FROM kl.classid
      AND bl.objid IS NOT DISTINCT FROM kl.objid
      AND bl.objsubid IS NOT DISTINCT FROM kl.objsubid
      AND bl.pid != kl.pid
    JOIN pg_stat_activity blocking ON kl.pid = blocking.pid
    WHERE NOT bl.granted
    LIMIT 10
  `,

  vacuumStatus: `
    SELECT
      schemaname || '.' || relname AS table,
      last_vacuum,
      last_autovacuum,
      last_analyze,
      last_autoanalyze,
      n_dead_tup,
      n_live_tup
    FROM pg_stat_user_tables
    WHERE last_autovacuum IS NULL
      AND n_dead_tup > 1000
    ORDER BY n_dead_tup DESC
    LIMIT 20
  `,

  slowQueries: `
    SELECT
      LEFT(query, 300) AS query,
      calls,
      round(total_exec_time::numeric, 2) AS total_time_ms,
      round(mean_exec_time::numeric, 2) AS mean_time_ms,
      round(max_exec_time::numeric, 2) AS max_time_ms,
      rows
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%'
      AND query NOT LIKE 'BEGIN%'
      AND query NOT LIKE 'COMMIT%'
      AND query NOT LIKE 'SET %'
    ORDER BY mean_exec_time DESC
    LIMIT 10
  `,

  missingIndexes: `
    SELECT
      schemaname || '.' || relname AS table,
      seq_scan,
      seq_tup_read,
      idx_scan,
      CASE WHEN seq_scan > 0
        THEN round(seq_tup_read::numeric / seq_scan, 0)
        ELSE 0
      END AS avg_rows_per_seq_scan,
      pg_size_pretty(pg_relation_size(relid)) AS size
    FROM pg_stat_user_tables
    WHERE seq_scan > 100
      AND seq_tup_read > 10000
      AND (idx_scan IS NULL OR idx_scan < seq_scan * 0.1)
      AND pg_relation_size(relid) > 1048576
    ORDER BY seq_tup_read DESC
    LIMIT 10
  `,

  databaseSize: `
    SELECT
      pg_size_pretty(pg_database_size(current_database())) AS size,
      current_database() AS name
  `,
};

// ─── Check functions ──────────────────────────────────────

async function checkConnections(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.connectionStats);
  const r = rows[0];
  const ratio = r.total_connections / r.max_connections;
  const idleInTxn = Number(r.idle_in_transaction);

  let score = 100;
  let status: CheckResult['status'] = 'pass';
  const messages: string[] = [];

  if (ratio > 0.9) { score = 20; status = 'fail'; messages.push(`Connection usage critical: ${r.total_connections}/${r.max_connections}`); }
  else if (ratio > 0.7) { score = 60; status = 'warn'; messages.push(`Connection usage high: ${r.total_connections}/${r.max_connections}`); }
  else { messages.push(`Connections: ${r.total_connections}/${r.max_connections}`); }

  if (idleInTxn > 5) { score = Math.min(score, 50); status = 'warn'; messages.push(`${idleInTxn} idle-in-transaction connections`); }

  return {
    name: 'Connection Health',
    category: 'connections',
    status, score, weight: 15,
    message: messages.join('; '),
    details: r,
  };
}

async function checkCacheHitRatio(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.cacheHitRatio);
  const { hit, read } = rows[0];
  const total = Number(hit) + Number(read);
  const ratio = total > 0 ? Number(hit) / total : 1;
  const pct = (ratio * 100).toFixed(2);

  let score = 100, status: CheckResult['status'] = 'pass';
  if (ratio < 0.9) { score = 30; status = 'fail'; }
  else if (ratio < 0.99) { score = 70; status = 'warn'; }

  return {
    name: 'Cache Hit Ratio',
    category: 'performance',
    status, score, weight: 20,
    message: `Table cache hit ratio: ${pct}%`,
    details: { hit: Number(hit), read: Number(read), ratio },
  };
}

async function checkUnusedIndexes(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.unusedIndexes);
  const fixes = rows.map((r: any) => `DROP INDEX IF EXISTS ${r.index}; -- ${r.size}, on ${r.table}`);

  let score = 100, status: CheckResult['status'] = 'pass';
  if (rows.length > 10) { score = 40; status = 'fail'; }
  else if (rows.length > 3) { score = 70; status = 'warn'; }
  else if (rows.length > 0) { score = 90; status = 'pass'; }

  return {
    name: 'Unused Indexes',
    category: 'indexes',
    status, score, weight: 10,
    message: rows.length === 0 ? 'No unused indexes found' : `${rows.length} unused indexes found`,
    details: rows,
    fixes: fixes.length > 0 ? fixes : undefined,
  };
}

async function checkTableBloat(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.tableBloat);
  const bloated = rows.filter((r: any) => Number(r.dead_ratio) > 20);
  const fixes = bloated.map((r: any) => `VACUUM FULL ${r.table}; -- ${r.dead_ratio}% dead tuples, ${r.total_size}`);

  let score = 100, status: CheckResult['status'] = 'pass';
  if (bloated.length > 5) { score = 30; status = 'fail'; }
  else if (bloated.length > 0) { score = 60; status = 'warn'; }

  return {
    name: 'Table Bloat',
    category: 'storage',
    status, score, weight: 15,
    message: bloated.length === 0 ? 'No significant table bloat' : `${bloated.length} tables with >20% dead tuples`,
    details: rows.slice(0, 10),
    fixes: fixes.length > 0 ? fixes : undefined,
  };
}

async function checkLongTransactions(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.longTransactions);

  let score = 100, status: CheckResult['status'] = 'pass';
  if (rows.length > 3) { score = 30; status = 'fail'; }
  else if (rows.length > 0) { score = 60; status = 'warn'; }

  return {
    name: 'Long Transactions',
    category: 'transactions',
    status, score, weight: 10,
    message: rows.length === 0 ? 'No long-running transactions' : `${rows.length} transactions running >5 minutes`,
    details: rows,
  };
}

async function checkLocks(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.locks);

  let score = 100, status: CheckResult['status'] = 'pass';
  if (rows.length > 3) { score = 20; status = 'fail'; }
  else if (rows.length > 0) { score = 60; status = 'warn'; }

  return {
    name: 'Lock Contention',
    category: 'locks',
    status, score, weight: 10,
    message: rows.length === 0 ? 'No blocked queries' : `${rows.length} blocked queries detected`,
    details: rows,
  };
}

async function checkVacuumStatus(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.vacuumStatus);
  const fixes = rows.map((r: any) => `VACUUM ANALYZE ${r.table}; -- ${r.n_dead_tup} dead tuples, never auto-vacuumed`);

  let score = 100, status: CheckResult['status'] = 'pass';
  if (rows.length > 5) { score = 40; status = 'fail'; }
  else if (rows.length > 0) { score = 70; status = 'warn'; }

  return {
    name: 'Vacuum Status',
    category: 'maintenance',
    status, score, weight: 10,
    message: rows.length === 0 ? 'All tables have been auto-vacuumed' : `${rows.length} tables never vacuumed with dead tuples`,
    details: rows,
    fixes: fixes.length > 0 ? fixes : undefined,
  };
}

async function checkSlowQueries(pool: PoolType): Promise<CheckResult> {
  try {
    const { rows } = await pool.query(QUERIES.slowQueries);
    const slow = rows.filter((r: any) => Number(r.mean_time_ms) > 1000);

    let score = 100, status: CheckResult['status'] = 'pass';
    if (slow.length > 5) { score = 40; status = 'fail'; }
    else if (slow.length > 0) { score = 70; status = 'warn'; }

    return {
      name: 'Slow Queries',
      category: 'performance',
      status, score, weight: 10,
      message: slow.length === 0 ? 'No slow queries (>1s avg)' : `${slow.length} queries with avg >1s`,
      details: rows.slice(0, 10),
    };
  } catch {
    return {
      name: 'Slow Queries',
      category: 'performance',
      status: 'pass', score: 100, weight: 10,
      message: 'pg_stat_statements not available (extension not enabled)',
    };
  }
}

async function checkMissingIndexes(pool: PoolType): Promise<CheckResult> {
  const { rows } = await pool.query(QUERIES.missingIndexes);
  const fixes = rows.map((r: any) => {
    const table = r.table;
    return `-- Table ${table}: ${r.seq_scan} seq scans, ${r.avg_rows_per_seq_scan} avg rows/scan, ${r.size}\n-- Consider adding an index based on your query patterns:\n-- CREATE INDEX CONCURRENTLY idx_${table.replace('.', '_')}_<column> ON ${table} (<column>);`;
  });

  let score = 100, status: CheckResult['status'] = 'pass';
  if (rows.length > 5) { score = 40; status = 'fail'; }
  else if (rows.length > 0) { score = 70; status = 'warn'; }

  return {
    name: 'Missing Indexes',
    category: 'indexes',
    status, score, weight: 10,
    message: rows.length === 0 ? 'No obvious missing indexes' : `${rows.length} tables with heavy sequential scans`,
    details: rows,
    fixes: fixes.length > 0 ? fixes : undefined,
  };
}

// ─── Main ─────────────────────────────────────────────────

export async function doctor(options: DoctorOptions): Promise<DoctorResult> {
  const pg = await import('pg');
  const Pool = pg.default?.Pool || pg.Pool;
  const pool = new Pool({ connectionString: options.connectionString });

  try {
    const { rows: [{ name: database }] } = await pool.query(QUERIES.databaseSize);

    const checks = await Promise.all([
      checkConnections(pool),
      checkCacheHitRatio(pool),
      checkUnusedIndexes(pool),
      checkTableBloat(pool),
      checkLongTransactions(pool),
      checkLocks(pool),
      checkVacuumStatus(pool),
      checkSlowQueries(pool),
      checkMissingIndexes(pool),
    ]);

    // Calculate weighted score
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const weightedScore = checks.reduce((s, c) => s + c.score * c.weight, 0);
    const overallScore = Math.round(weightedScore / totalWeight);

    // Collect all fixes
    const fixes = checks.flatMap(c => c.fixes || []);

    const summary = {
      pass: checks.filter(c => c.status === 'pass').length,
      warn: checks.filter(c => c.status === 'warn').length,
      fail: checks.filter(c => c.status === 'fail').length,
    };

    return { database, timestamp: new Date().toISOString(), overallScore, checks, fixes, summary };
  } finally {
    await pool.end();
  }
}

// ─── Formatters ───────────────────────────────────────────

export function formatDoctorResult(result: DoctorResult, format: 'text' | 'json' | 'markdown'): string {
  if (format === 'json') return JSON.stringify(result, null, 2);
  if (format === 'markdown') return formatMarkdown(result);
  return formatText(result);
}

function scoreEmoji(score: number): string {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🟡';
  return '🔴';
}

function statusIcon(status: CheckResult['status']): string {
  return status === 'pass' ? '✅' : status === 'warn' ? '⚠️' : '❌';
}

function formatText(r: DoctorResult): string {
  const lines: string[] = [];
  lines.push(`\n${scoreEmoji(r.overallScore)} PostgreSQL Doctor Report — ${r.database}`);
  lines.push(`  Score: ${r.overallScore}/100`);
  lines.push(`  Checked at: ${r.timestamp}`);
  lines.push(`  Results: ${r.summary.pass} pass, ${r.summary.warn} warn, ${r.summary.fail} fail\n`);

  for (const c of r.checks) {
    lines.push(`${statusIcon(c.status)} ${c.name} (${c.score}/100, weight ${c.weight})`);
    lines.push(`   ${c.message}`);
  }

  if (r.fixes.length > 0) {
    lines.push(`\n🔧 Fix Script (${r.fixes.length} statements):`);
    lines.push('─'.repeat(50));
    for (const fix of r.fixes) lines.push(fix);
    lines.push('─'.repeat(50));
  }

  lines.push('');
  return lines.join('\n');
}

function formatMarkdown(r: DoctorResult): string {
  const lines: string[] = [];
  lines.push(`# ${scoreEmoji(r.overallScore)} PostgreSQL Doctor Report\n`);
  lines.push(`**Database:** ${r.database}`);
  lines.push(`**Score:** ${r.overallScore}/100`);
  lines.push(`**Time:** ${r.timestamp}`);
  lines.push(`**Results:** ${r.summary.pass} pass, ${r.summary.warn} warn, ${r.summary.fail} fail\n`);

  lines.push('## Checks\n');
  lines.push('| Status | Check | Score | Message |');
  lines.push('|--------|-------|-------|---------|');
  for (const c of r.checks) {
    lines.push(`| ${statusIcon(c.status)} | ${c.name} | ${c.score}/100 | ${c.message} |`);
  }

  if (r.fixes.length > 0) {
    lines.push(`\n## 🔧 Fix Script (${r.fixes.length} statements)\n`);
    lines.push('```sql');
    for (const fix of r.fixes) lines.push(fix);
    lines.push('```');
  }

  lines.push('');
  return lines.join('\n');
}

export function generateFixSql(result: DoctorResult): string {
  const lines: string[] = [];
  lines.push(`-- pg-toolkit doctor fix script`);
  lines.push(`-- Database: ${result.database}`);
  lines.push(`-- Generated: ${result.timestamp}`);
  lines.push(`-- Score: ${result.overallScore}/100\n`);

  if (result.fixes.length === 0) {
    lines.push('-- No fixes needed. Database is healthy!');
  } else {
    lines.push('BEGIN;\n');
    for (const fix of result.fixes) {
      lines.push(fix);
    }
    lines.push('\nCOMMIT;');
  }

  lines.push('');
  return lines.join('\n');
}
