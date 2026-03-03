[English](README.md) | [中文](README.zh-CN.md)

# pg-toolkit

**TypeScript 开发者的 PostgreSQL 瑞士军刀。**

一个 CLI 搞定数据库的诊断、检查、Diff、监控和类型生成。

🔍 **20+ 项健康检查**，带评分和自动生成修复 SQL
🔄 **Schema Diff**，输出可直接运行的迁移 SQL
🤖 **AI Agent 就绪**，通过 MCP 接入 Claude、Cursor 或任何 MCP 客户端

## 快速开始

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

## 命令

### `doctor` —— 诊断、评分、修复

对数据库运行 20+ 项检查，生成 0-100 的健康分数，并输出可执行的修复 SQL。

```bash
pg-toolkit doctor postgres://localhost/mydb
pg-toolkit doctor postgres://localhost/mydb --ci --threshold 70   # 不健康时让 CI 失败
pg-toolkit doctor postgres://localhost/mydb --output fix.sql      # 保存修复脚本
pg-toolkit doctor postgres://localhost/mydb --json                # 机器可读
```

### `inspect` —— 查看 Schema 全貌

表、视图、函数、索引、枚举、触发器、约束、RLS 策略 —— 一条命令全部展示。

```bash
pg-toolkit inspect postgres://localhost/mydb
pg-toolkit inspect --tables --indexes postgres://localhost/mydb
pg-toolkit inspect --summary postgres://localhost/mydb            # 仅显示计数
```

### `diff` —— 对比 Schema，生成迁移 SQL

指向两个数据库，获取 `ALTER`、`CREATE` 和 `DROP` 语句来完成迁移。

```bash
pg-toolkit diff postgres://localhost/dev postgres://localhost/prod
pg-toolkit diff --safe postgres://localhost/dev postgres://localhost/prod   # 不含 DROP
pg-toolkit diff postgres://dev postgres://prod | psql postgres://prod      # 直接应用
```

### `top` —— 实时活动监控

数据库版的 `htop`。实时查看活跃查询、锁和连接统计。

```bash
pg-toolkit top postgres://localhost/mydb
pg-toolkit top --refresh 1 --no-idle postgres://localhost/mydb
pg-toolkit top --snapshot --json postgres://localhost/mydb        # 单次快照
```

### `types` —— PostgreSQL → TypeScript

从数据库 Schema 生成 TypeScript 接口。

```bash
pg-toolkit types postgres://localhost/mydb
```

## 编程式 API

```typescript
import { doctor, inspect, diff } from '@indiekitai/pg-toolkit';

const report = await doctor({ connectionString: 'postgres://localhost/mydb' });
console.log(report.overallScore); // 82
console.log(report.fixes);        // SQL 修复语句

const schema = await inspect('postgres://localhost/mydb');

const migration = await diff(devUrl, prodUrl, { safe: true });
console.log(migration.sql); // ALTER TABLE ..., CREATE INDEX ...
```

## AI Agent / MCP

所有工具都可作为 MCP Server 使用。添加到你的 Agent 配置：

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

暴露 `pg_doctor`、`inspect_schema`、`diff_schemas` 和 `pg_activity` 作为 MCP 工具。可配合 Claude、Cursor、Windsurf 及任何兼容 MCP 的 Agent 使用。

## 对比

| 功能 | pg-toolkit | pgcli | migra | prisma |
|------|---|---|---|---|
| 健康检查 + 评分 | ✅ 20+ 项检查 | ❌ | ❌ | ❌ |
| 自动生成修复 SQL | ✅ | ❌ | ❌ | ❌ |
| Schema 检查 | ✅ | ✅ 部分 | ❌ | ✅ introspect |
| Schema Diff → SQL | ✅ | ❌ | ✅ | ✅ migrate diff |
| 实时活动监控 | ✅ | ❌ | ❌ | ❌ |
| TypeScript 生成 | ✅ | ❌ | ❌ | ✅ 内置 |
| MCP / AI Agent 支持 | ✅ | ❌ | ❌ | ❌ |
| CI 模式（退出码） | ✅ | ❌ | ✅ | ✅ |
| 一条 `npx` 命令 | ✅ | pip install | pip install | npm + 配置 |

pg-toolkit 将原本需要 3-4 个独立工具才能完成的工作整合到一条 `npx` 命令中。

## 许可证

MIT
