import { describe, it, expect, vi } from 'vitest';

// Test the pure detection logic by importing internals indirectly via the module
// We'll test formatAnalyzeResult and the CLI integration

import { formatAnalyzeResult } from '../analyze.js';
import type { AnalyzeResult } from '../analyze.js';

describe('formatAnalyzeResult', () => {
  const baseResult: AnalyzeResult = {
    database: 'testdb',
    analyzedAt: '2026-02-26T00:00:00.000Z',
    tablesScanned: 5,
    warnings: [],
  };

  it('shows no issues when warnings empty', () => {
    const out = formatAnalyzeResult(baseResult, false);
    expect(out).toContain('No N+1 patterns detected');
    expect(out).toContain('testdb');
  });

  it('outputs valid JSON in json mode', () => {
    const out = formatAnalyzeResult(baseResult, true);
    const parsed = JSON.parse(out);
    expect(parsed.database).toBe('testdb');
    expect(parsed.warnings).toEqual([]);
  });

  it('formats warnings with severity icons', () => {
    const result: AnalyzeResult = {
      ...baseResult,
      warnings: [
        {
          type: 'eav_pattern',
          severity: 'high',
          table: 'field_values',
          description: 'EAV table detected',
          suggestion: 'Use CTE + JSON_AGG',
        },
        {
          type: 'n_plus_1_risk',
          severity: 'medium',
          table: 'comments',
          parentTable: 'posts',
          description: 'FK relationship',
          suggestion: 'Aggregate with CTE',
          sql: 'SELECT 1;',
        },
      ],
    };
    const out = formatAnalyzeResult(result, false);
    expect(out).toContain('🔴');
    expect(out).toContain('🟡');
    expect(out).toContain('EAV table detected');
    expect(out).toContain('SELECT 1;');
    expect(out).toContain('2 potential issue(s)');
  });
});

describe('CLI analyze subcommand', () => {
  it('shows analyze help', async () => {
    const { execFileSync } = await import('node:child_process');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const CLI = resolve(__dirname, '../../dist/cli.js');

    const out = execFileSync('node', [CLI, 'analyze', '--help'], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    expect(out).toContain('Detect N+1');
    expect(out).toContain('JSON_AGG');
    expect(out).toContain('EAV');
  });
});
