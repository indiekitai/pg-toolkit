/**
 * @indiekitai/pg-toolkit — Unified PostgreSQL toolkit
 *
 * Re-exports from all IndieKit PG packages.
 */

// pg-inspect
export { PgInspector, inspect } from '@indiekitai/pg-inspect';
export type { ConnectionConfig } from '@indiekitai/pg-inspect';

// pg-diff
export { inspectSchema, computeDiff, diff } from '@indiekitai/pg-diff';
export type { DiffResult, DiffOptions } from '@indiekitai/pg-diff';

// analyze
export { analyze, formatAnalyzeResult } from './analyze.js';
export type { AnalyzeResult, AnalyzeWarning } from './analyze.js';

// pg-top
export { PgMonitor } from '@indiekitai/pg-top';
export type { Activity, DbStats, MonitorOptions } from '@indiekitai/pg-top';
