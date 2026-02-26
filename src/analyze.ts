/**
 * pg-toolkit analyze — Detect N+1 query patterns and suggest CTE + JSON_AGG optimizations.
 *
 * Scans database schema for:
 * - Many-to-one relationships (foreign keys)
 * - EAV-pattern tables (entity_id + key/name + value columns)
 * - Tables with multiple FKs pointing to the same parent
 */

export interface AnalyzeWarning {
  type: 'n_plus_1_risk' | 'eav_pattern' | 'multi_fk_parent';
  severity: 'high' | 'medium' | 'low';
  table: string;
  parentTable?: string;
  description: string;
  suggestion: string;
  sql?: string;
}

export interface AnalyzeResult {
  database: string;
  analyzedAt: string;
  tablesScanned: number;
  warnings: AnalyzeWarning[];
}

interface FkInfo {
  constraintName: string;
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
}

interface ColumnInfo {
  tableName: string;
  columnName: string;
  dataType: string;
  isNullable: boolean;
}

const EAV_ENTITY_PATTERNS = /^(entity|item|record|submission|object|resource|parent)[_]?id$/i;
const EAV_KEY_PATTERNS = /^(key|name|attribute|field|property|type|kind|label)[_]?(name|key|id)?$/i;
const EAV_VALUE_PATTERNS = /^(value|data|content|payload|text)$/i;

function detectEav(tableName: string, columns: ColumnInfo[]): AnalyzeWarning | null {
  const colNames = columns.map((c) => c.columnName);

  const entityCol = colNames.find((c) => EAV_ENTITY_PATTERNS.test(c));
  const keyCol = colNames.find((c) => EAV_KEY_PATTERNS.test(c));
  const valueCol = colNames.find((c) => EAV_VALUE_PATTERNS.test(c));

  if (entityCol && keyCol && valueCol) {
    return {
      type: 'eav_pattern',
      severity: 'high',
      table: tableName,
      description: `Table "${tableName}" looks like an EAV table (entity=${entityCol}, key=${keyCol}, value=${valueCol}). Querying parent + this table typically causes N+1.`,
      suggestion: `Use CTE + JSON_AGG to aggregate rows by "${entityCol}" in a single query.`,
      sql: `WITH aggregated AS (
  SELECT
    "${entityCol}",
    JSON_AGG(JSON_BUILD_OBJECT('${keyCol}', "${keyCol}", '${valueCol}', "${valueCol}")) AS attrs
  FROM "${tableName}"
  GROUP BY "${entityCol}"
)
SELECT p.*, COALESCE(a.attrs, '[]'::json) AS attrs
FROM <parent_table> p
LEFT JOIN aggregated a ON a."${entityCol}" = p.id;`,
    };
  }
  return null;
}

function detectNPlus1FromFks(fks: FkInfo[]): AnalyzeWarning[] {
  // Group FKs by parent table
  const parentToChildren = new Map<string, FkInfo[]>();
  for (const fk of fks) {
    const list = parentToChildren.get(fk.parentTable) || [];
    list.push(fk);
    parentToChildren.set(fk.parentTable, list);
  }

  const warnings: AnalyzeWarning[] = [];

  for (const [parentTable, children] of parentToChildren) {
    for (const fk of children) {
      // Skip self-references
      if (fk.childTable === parentTable) continue;

      warnings.push({
        type: 'n_plus_1_risk',
        severity: 'medium',
        table: fk.childTable,
        parentTable,
        description: `"${fk.childTable}".${fk.childColumn} → "${parentTable}".${fk.parentColumn}. Loading ${parentTable} list + ${fk.childTable} details per row = N+1.`,
        suggestion: `Use CTE + JSON_AGG to pre-aggregate "${fk.childTable}" rows per "${fk.childColumn}".`,
        sql: `WITH child_agg AS (
  SELECT "${fk.childColumn}", JSON_AGG(t.*) AS children
  FROM "${fk.childTable}" t
  GROUP BY "${fk.childColumn}"
)
SELECT p.*, COALESCE(c.children, '[]'::json) AS ${fk.childTable}
FROM "${parentTable}" p
LEFT JOIN child_agg c ON c."${fk.childColumn}" = p."${fk.parentColumn}";`,
      });
    }

    // Multiple child tables pointing to same parent
    const uniqueChildren = new Set(children.map((c) => c.childTable));
    if (uniqueChildren.size > 2) {
      warnings.push({
        type: 'multi_fk_parent',
        severity: 'low',
        table: parentTable,
        description: `"${parentTable}" has ${uniqueChildren.size} child tables referencing it. Loading all children per row compounds N+1.`,
        suggestion: `Consider multiple CTEs in a single query to fetch all child data at once.`,
      });
    }
  }

  return warnings;
}

export async function analyze(connectionString: string): Promise<AnalyzeResult> {
  // Dynamic import pg to avoid hard dependency
  const pg = await import('pg');
  const Pool = pg.default?.Pool || pg.Pool;
  const pool = new Pool({ connectionString });

  try {
    // Get database name
    const dbResult = await pool.query('SELECT current_database() AS db');
    const database = dbResult.rows[0].db;

    // Get all columns
    const colResult = await pool.query(`
      SELECT table_name, column_name, data_type, is_nullable = 'YES' AS is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);

    const columnsByTable = new Map<string, ColumnInfo[]>();
    for (const row of colResult.rows) {
      const list = columnsByTable.get(row.table_name) || [];
      list.push({
        tableName: row.table_name,
        columnName: row.column_name,
        dataType: row.data_type,
        isNullable: row.is_nullable,
      });
      columnsByTable.set(row.table_name, list);
    }

    // Get foreign keys
    const fkResult = await pool.query(`
      SELECT
        tc.constraint_name,
        tc.table_name AS child_table,
        kcu.column_name AS child_column,
        ccu.table_name AS parent_table,
        ccu.column_name AS parent_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);

    const fks: FkInfo[] = fkResult.rows.map((r: any) => ({
      constraintName: r.constraint_name,
      childTable: r.child_table,
      childColumn: r.child_column,
      parentTable: r.parent_table,
      parentColumn: r.parent_column,
    }));

    // Detect patterns
    const warnings: AnalyzeWarning[] = [];

    // EAV detection
    for (const [tableName, columns] of columnsByTable) {
      const eav = detectEav(tableName, columns);
      if (eav) warnings.push(eav);
    }

    // N+1 from FK relationships
    warnings.push(...detectNPlus1FromFks(fks));

    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    warnings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return {
      database,
      analyzedAt: new Date().toISOString(),
      tablesScanned: columnsByTable.size,
      warnings,
    };
  } finally {
    await pool.end();
  }
}

export function formatAnalyzeResult(result: AnalyzeResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);

  const lines: string[] = [];
  lines.push(`🔍 N+1 Analysis for "${result.database}"`);
  lines.push(`   Scanned ${result.tablesScanned} tables at ${result.analyzedAt}`);
  lines.push('');

  if (result.warnings.length === 0) {
    lines.push('✅ No N+1 patterns detected.');
    return lines.join('\n');
  }

  lines.push(`⚠️  Found ${result.warnings.length} potential issue(s):\n`);

  const severityIcon = { high: '🔴', medium: '🟡', low: '🔵' };

  for (const w of result.warnings) {
    lines.push(`${severityIcon[w.severity]} [${w.severity.toUpperCase()}] ${w.type}`);
    lines.push(`   ${w.description}`);
    lines.push(`   💡 ${w.suggestion}`);
    if (w.sql) {
      lines.push('   📝 Suggested SQL:');
      for (const sqlLine of w.sql.split('\n')) {
        lines.push(`      ${sqlLine}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
