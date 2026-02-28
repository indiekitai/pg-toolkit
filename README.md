# @indiekitai/pg-toolkit

Unified CLI for all IndieKit PostgreSQL tools. One command, all PG tools.

## Install

```bash
npm install -g @indiekitai/pg-toolkit
# or
npx @indiekitai/pg-toolkit <command>
```

## Commands

### `doctor` — Comprehensive health diagnosis

One command to run all PG diagnostics, output a complete report + executable fix script.

```bash
# Full diagnosis with human-readable output
pg-toolkit doctor postgresql://localhost/mydb

# CI mode — exit non-zero if score below threshold
pg-toolkit doctor --url postgresql://localhost/mydb --ci --threshold 70

# Output fix SQL to file
pg-toolkit doctor postgresql://localhost/mydb --output fix.sql

# JSON output (for programmatic consumption)
pg-toolkit doctor postgresql://localhost/mydb --json

# Markdown output (for PR comments)
pg-toolkit doctor postgresql://localhost/mydb --format markdown
```

**Checks performed:**
- Connection health (usage, idle-in-transaction)
- Cache hit ratio (table & index)
- Unused indexes (with `DROP INDEX` fixes)
- Table bloat (dead tuple ratio, `VACUUM FULL` fixes)
- Long-running transactions (>5 min)
- Lock contention (blocked queries)
- Vacuum status (never-vacuumed tables)
- Slow queries (via `pg_stat_statements`)
- Missing indexes (heavy sequential scans)

**Scoring:** Each check gets a 0-100 score with a weight. The overall score is a weighted average. Use `--ci --threshold 70` to fail CI pipelines when the database is unhealthy.

### `inspect` — Schema inspection

```bash
# Full schema dump
pg-toolkit inspect postgresql://localhost/mydb

# Filter to specific objects
pg-toolkit inspect --tables postgresql://localhost/mydb
pg-toolkit inspect --views --functions postgresql://localhost/mydb
pg-toolkit inspect --enums --types postgresql://localhost/mydb

# Summary counts
pg-toolkit inspect --summary postgresql://localhost/mydb
```

Filters: `--tables`, `--views`, `--functions`, `--indexes`, `--sequences`, `--enums`, `--extensions`, `--triggers`, `--constraints`, `--schemas`, `--privileges`, `--types`, `--domains`, `--collations`, `--rls`

### `diff` — Schema diff & migration SQL

```bash
# Generate migration SQL
pg-toolkit diff postgresql://localhost/old postgresql://localhost/new

# Safe mode (no DROP statements)
pg-toolkit diff --safe postgresql://localhost/old postgresql://localhost/new

# JSON output
pg-toolkit diff --json postgresql://localhost/old postgresql://localhost/new

# Pipe directly to psql
pg-toolkit diff postgres://localhost/old postgres://localhost/new | psql postgres://localhost/old
```

### `top` — Activity monitor

```bash
# Interactive TUI
pg-toolkit top postgresql://localhost/mydb

# Custom refresh rate, hide idle
pg-toolkit top --refresh 1 --no-idle postgresql://localhost/mydb

# Single snapshot as JSON
pg-toolkit top --snapshot --json postgresql://localhost/mydb
```

### `health` — Health checks

```bash
pg-toolkit health postgresql://localhost/mydb
```

Delegates to `pg-health` (must be installed separately via `pip install pg-health`).

### `types` — TypeScript type generation

```bash
pg-toolkit types postgresql://localhost/mydb
```

Delegates to `pg2ts` (must be installed separately).

### `mcp` — Unified MCP server

Start a single MCP server that combines all PG tools:

```bash
pg-toolkit mcp
```

MCP config for AI agents:

```json
{
  "mcpServers": {
    "pg-toolkit": {
      "command": "npx",
      "args": ["@indiekitai/pg-toolkit", "mcp"],
      "env": { "DATABASE_URL": "postgresql://localhost/mydb" }
    }
  }
}
```

Available MCP tools:
- `pg_doctor` — Run comprehensive health diagnosis with scoring
- `inspect_schema` — Inspect database schema
- `diff_schemas` — Compare two databases
- `pg_activity` — Get activity snapshot

## Programmatic API

```typescript
import { inspect, diff, PgMonitor, doctor } from '@indiekitai/pg-toolkit';

// Doctor — comprehensive diagnosis
const report = await doctor({ connectionString: 'postgresql://localhost/mydb' });
console.log(`Score: ${report.overallScore}/100, Fixes: ${report.fixes.length}`);

// Inspect
const schema = await inspect('postgresql://localhost/mydb');

// Diff
const result = await diff(fromUrl, toUrl, { safe: true });

// Monitor
const monitor = new PgMonitor({ connectionString: '...', snapshot: true, json: true });
```

## Packages

This toolkit wraps:
- [@indiekitai/pg-inspect](https://github.com/indiekitai/pg-inspect) — Schema inspection
- [@indiekitai/pg-diff](https://github.com/indiekitai/pg-diff) — Schema diff
- [@indiekitai/pg-top](https://github.com/indiekitai/pg-top) — Activity monitor

## License

MIT
