[English](README.md) | [中文](README.zh-CN.md)

# pg-toolkit

**The PostgreSQL Swiss Army knife for TypeScript developers.**

One CLI to diagnose, inspect, diff, monitor, and generate types for your Postgres databases.

🔍 **20+ health checks** with scoring and auto-generated fix SQL
🔄 **Schema diff** that outputs ready-to-run migration SQL
🤖 **AI-agent ready** via MCP — plug into Claude, Cursor, or any MCP client

## Quick Start

```bash
npx @indiekitai/pg-toolkit doctor postgres://localhost/mydb
```

```
🏥 Database Health Report — mydb
Overall Score: 82/100

✅ Cache Hit Ratio .............. 99.2%  (excellent)
⚠️  Unused Indexes .............. 3 found
✅ Connection Usage ............. 12/100
❌ Table Bloat .................. 2 tables need VACUUM
✅ Long Transactions ............ none
✅ Lock Contention .............. clear
⚠️  Vacuum Status ............... 1 table never vacuumed
✅ Slow Queries ................. p95 < 100ms

📋 Fix Script Generated → fix.sql (4 statements)
```

## Commands

### `doctor` — Diagnose, score, fix

Runs 20+ checks against your database, produces a 0–100 health score, and generates executable SQL to fix what it finds.

```bash
pg-toolkit doctor postgres://localhost/mydb
pg-toolkit doctor postgres://localhost/mydb --ci --threshold 70   # fail CI if unhealthy
pg-toolkit doctor postgres://localhost/mydb --output fix.sql      # save fixes
pg-toolkit doctor postgres://localhost/mydb --json                # machine-readable
```

### `inspect` — See everything in your schema

Tables, views, functions, indexes, enums, triggers, constraints, RLS policies — all in one command.

```bash
pg-toolkit inspect postgres://localhost/mydb
pg-toolkit inspect --tables --indexes postgres://localhost/mydb
pg-toolkit inspect --summary postgres://localhost/mydb            # just counts
```

### `diff` — Compare schemas, get migration SQL

Point it at two databases. Get `ALTER`, `CREATE`, and `DROP` statements to migrate one to the other.

```bash
pg-toolkit diff postgres://localhost/dev postgres://localhost/prod
pg-toolkit diff --safe postgres://localhost/dev postgres://localhost/prod   # no DROPs
pg-toolkit diff postgres://dev postgres://prod | psql postgres://prod      # apply directly
```

### `top` — Live activity monitor

Like `htop` for your database. See active queries, locks, and connection stats in real time.

```bash
pg-toolkit top postgres://localhost/mydb
pg-toolkit top --refresh 1 --no-idle postgres://localhost/mydb
pg-toolkit top --snapshot --json postgres://localhost/mydb        # single snapshot
```

### `types` — PostgreSQL → TypeScript

Generate TypeScript interfaces from your database schema.

```bash
pg-toolkit types postgres://localhost/mydb
```

## Programmatic API

```typescript
import { doctor, inspect, diff } from '@indiekitai/pg-toolkit';

const report = await doctor({ connectionString: 'postgres://localhost/mydb' });
console.log(report.overallScore); // 82
console.log(report.fixes);        // SQL fix statements

const schema = await inspect('postgres://localhost/mydb');

const migration = await diff(devUrl, prodUrl, { safe: true });
console.log(migration.sql); // ALTER TABLE ..., CREATE INDEX ...
```

## AI Agent / MCP

All tools are available as an MCP server. Add this to your agent config:

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

Exposes `pg_doctor`, `inspect_schema`, `diff_schemas`, and `pg_activity` as MCP tools. Works with Claude, Cursor, Windsurf, and any MCP-compatible agent.

## How it compares

| Feature | pg-toolkit | pgcli | migra | prisma |
|---|---|---|---|---|
| Health checks + scoring | ✅ 20+ checks | ❌ | ❌ | ❌ |
| Auto-generate fix SQL | ✅ | ❌ | ❌ | ❌ |
| Schema inspection | ✅ | ✅ partial | ❌ | ✅ introspect |
| Schema diff → SQL | ✅ | ❌ | ✅ | ✅ migrate diff |
| Live activity monitor | ✅ | ❌ | ❌ | ❌ |
| TypeScript generation | ✅ | ❌ | ❌ | ✅ built-in |
| MCP / AI-agent support | ✅ | ❌ | ❌ | ❌ |
| CI mode (exit codes) | ✅ | ❌ | ✅ | ✅ |
| Single `npx` command | ✅ | pip install | pip install | npm + config |

pg-toolkit combines what used to require 3–4 separate tools into one `npx` call.

## License

MIT
