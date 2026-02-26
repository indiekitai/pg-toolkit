import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../../dist/cli.js');

function run(...args: string[]): string {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 10_000,
  }).trim();
}

describe('pg-toolkit CLI', () => {
  it('shows help with no args', () => {
    const out = run();
    expect(out).toContain('pg-toolkit');
    expect(out).toContain('inspect');
    expect(out).toContain('diff');
    expect(out).toContain('top');
  });

  it('shows version', () => {
    const out = run('--version');
    expect(out).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('shows inspect help', () => {
    const out = run('inspect', '--help');
    expect(out).toContain('--tables');
  });

  it('shows diff help', () => {
    const out = run('diff', '--help');
    expect(out).toContain('from_url');
  });

  it('shows top help', () => {
    const out = run('top', '--help');
    expect(out).toContain('--snapshot');
  });

  it('shows health help', () => {
    const out = run('health', '--help');
    expect(out).toContain('pg-health');
  });

  it('shows types help', () => {
    const out = run('types', '--help');
    expect(out).toContain('pg2ts');
  });

  it('errors on unknown command', () => {
    try {
      run('foobar');
      expect.unreachable();
    } catch (err: any) {
      expect(err.status).toBe(1);
    }
  });
});
