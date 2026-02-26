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

// pg-top
export { PgMonitor } from '@indiekitai/pg-top';
export type { Activity, DbStats, MonitorOptions } from '@indiekitai/pg-top';
