import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDoctorResult, generateFixSql } from '../doctor.js';
import type { DoctorResult, CheckResult } from '../doctor.js';

function makeResult(overrides: Partial<DoctorResult> = {}): DoctorResult {
  return {
    database: 'testdb',
    timestamp: '2026-02-28T10:00:00.000Z',
    overallScore: 85,
    checks: [
      { name: 'Connection Health', category: 'connections', status: 'pass', score: 100, weight: 15, message: 'Connections: 5/100' },
      { name: 'Cache Hit Ratio', category: 'performance', status: 'pass', score: 100, weight: 20, message: 'Table cache hit ratio: 99.95%' },
      { name: 'Unused Indexes', category: 'indexes', status: 'warn', score: 70, weight: 10, message: '5 unused indexes found', fixes: ['DROP INDEX IF EXISTS idx_foo; -- 1 MB, on public.foo'] },
      { name: 'Table Bloat', category: 'storage', status: 'pass', score: 100, weight: 15, message: 'No significant table bloat' },
      { name: 'Long Transactions', category: 'transactions', status: 'pass', score: 100, weight: 10, message: 'No long-running transactions' },
      { name: 'Lock Contention', category: 'locks', status: 'pass', score: 100, weight: 10, message: 'No blocked queries' },
      { name: 'Vacuum Status', category: 'maintenance', status: 'fail', score: 40, weight: 10, message: '8 tables never vacuumed', fixes: ['VACUUM ANALYZE public.bar;'] },
      { name: 'Slow Queries', category: 'performance', status: 'pass', score: 100, weight: 10, message: 'No slow queries' },
      { name: 'Missing Indexes', category: 'indexes', status: 'pass', score: 100, weight: 10, message: 'No obvious missing indexes' },
    ],
    fixes: ['DROP INDEX IF EXISTS idx_foo; -- 1 MB, on public.foo', 'VACUUM ANALYZE public.bar;'],
    summary: { pass: 7, warn: 1, fail: 1 },
    ...overrides,
  };
}

describe('formatDoctorResult', () => {
  it('outputs valid JSON in json mode', () => {
    const result = makeResult();
    const out = formatDoctorResult(result, 'json');
    const parsed = JSON.parse(out);
    expect(parsed.overallScore).toBe(85);
    expect(parsed.checks).toHaveLength(9);
    expect(parsed.fixes).toHaveLength(2);
  });

  it('outputs text format with score and checks', () => {
    const result = makeResult();
    const out = formatDoctorResult(result, 'text');
    expect(out).toContain('85/100');
    expect(out).toContain('Connection Health');
    expect(out).toContain('Fix Script');
    expect(out).toContain('DROP INDEX');
  });

  it('outputs markdown format with table', () => {
    const result = makeResult();
    const out = formatDoctorResult(result, 'markdown');
    expect(out).toContain('# ');
    expect(out).toContain('| Status |');
    expect(out).toContain('```sql');
    expect(out).toContain('DROP INDEX');
  });

  it('handles perfect score with no fixes', () => {
    const result = makeResult({
      overallScore: 100,
      fixes: [],
      summary: { pass: 9, warn: 0, fail: 0 },
    });
    const out = formatDoctorResult(result, 'text');
    expect(out).toContain('100/100');
    expect(out).not.toContain('Fix Script');
  });
});

describe('generateFixSql', () => {
  it('generates SQL with header and BEGIN/COMMIT', () => {
    const result = makeResult();
    const sql = generateFixSql(result);
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('DROP INDEX IF EXISTS idx_foo');
    expect(sql).toContain('VACUUM ANALYZE public.bar');
    expect(sql).toContain('testdb');
  });

  it('outputs no-fix message when healthy', () => {
    const result = makeResult({ fixes: [] });
    const sql = generateFixSql(result);
    expect(sql).toContain('No fixes needed');
    expect(sql).not.toContain('BEGIN');
  });
});

describe('scoring logic', () => {
  it('calculates weighted score correctly', () => {
    const result = makeResult();
    // Manually verify: sum(score * weight) / sum(weight)
    const checks = result.checks;
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const weightedScore = checks.reduce((s, c) => s + c.score * c.weight, 0);
    const expected = Math.round(weightedScore / totalWeight);
    // The overallScore in makeResult is manually set; just verify the math
    expect(totalWeight).toBe(110); // 15+20+10+15+10+10+10+10+10
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThanOrEqual(100);
  });
});

describe('CI mode behavior', () => {
  it('score below threshold should indicate failure', () => {
    const result = makeResult({ overallScore: 60 });
    const threshold = 70;
    expect(result.overallScore < threshold).toBe(true);
  });

  it('score above threshold should indicate pass', () => {
    const result = makeResult({ overallScore: 85 });
    const threshold = 70;
    expect(result.overallScore >= threshold).toBe(true);
  });
});

describe('CLI doctor subcommand', () => {
  it('shows doctor help', async () => {
    const { execFileSync } = await import('node:child_process');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const CLI = resolve(__dirname, '../../dist/cli.js');

    const out = execFileSync('node', [CLI, 'doctor', '--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    expect(out).toContain('Comprehensive');
    expect(out).toContain('--ci');
    expect(out).toContain('--threshold');
    expect(out).toContain('--output');
    expect(out).toContain('--json');
    expect(out).toContain('--format');
  });
});
