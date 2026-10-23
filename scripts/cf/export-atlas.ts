/**
 * One-off copy of the MongoDB Atlas `DX-ERP` database into D1.
 *
 *   node --env-file=.env.local --import tsx scripts/cf/export-atlas.ts      # writes .data/atlas.sql
 *   npx wrangler d1 execute dx-erp --local  --file .data/atlas.sql          # or --remote
 *
 * Read-only against MongoDB. Refuses to run against any database other than `DX-ERP` (the `D4-ERP`
 * database on the same cluster belongs to another live app). The output contains personal data and
 * lives in the git-ignored `.data/` folder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getTableColumns, getTableName, is, type Column } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { MongoClient, ObjectId } from "mongodb";
import * as models from "../../src/lib/models/_tables";

const SOURCE_DB = "DX-ERP";
/** Not migrated: sign-ins, rate-limit counters, job locks and the MongoDB-era backup index. */
const SKIP = new Set(["sessions", "loginattempts", "systemjobs", "backups"]);

type Doc = Record<string, unknown>;

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** ObjectId → hex, Date → ISO, recursively (the `json()` column format). */
function plainJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function toDriver(column: Column, raw: unknown): unknown {
  let value = raw;
  if (value === undefined || value === null) {
    if (column.default !== undefined) value = column.default;
    else if (column.defaultFn) value = column.defaultFn();
    else return null;
  }
  if (column.columnType === "SQLiteCustomColumn") return JSON.stringify(plainJson(value));
  if (value instanceof ObjectId) return value.toHexString();
  return column.mapToDriverValue(value);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || SOURCE_DB;
  if (!uri) throw new Error("MONGODB_URI is not set (run with --env-file=.env.local).");
  if (dbName !== SOURCE_DB) throw new Error(`Refusing to read "${dbName}": only ${SOURCE_DB} is migrated.`);

  const client = new MongoClient(uri, { readPreference: "secondaryPreferred" });
  await client.connect();
  const mongo = client.db(dbName);

  const lines: string[] = ["PRAGMA defer_foreign_keys = on;"];
  const report: string[] = [];
  const tables = Object.values(models).filter((v): v is SQLiteTable => is(v, SQLiteTable));

  for (const table of tables) {
    const name = getTableName(table);
    if (SKIP.has(name)) continue;
    const columns = Object.entries(getTableColumns(table));
    const docs = (await mongo.collection(name).find({}).toArray()) as Doc[];
    lines.push(`DELETE FROM \`${name}\`;`);
    for (const doc of docs) {
      const names: string[] = [];
      const values: string[] = [];
      for (const [key, column] of columns) {
        const v = toDriver(column, doc[key]);
        if (v === null && column.notNull) {
          throw new Error(`${name} ${String(doc._id)}: required column "${key}" is missing`);
        }
        names.push(`\`${column.name}\``);
        values.push(sqlLiteral(v));
      }
      lines.push(`INSERT INTO \`${name}\` (${names.join(", ")}) VALUES (${values.join(", ")});`);
    }
    report.push(`${name}=${docs.length}`);
  }

  await client.close();
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/atlas.sql", `${lines.join("\n")}\n`);
  console.log(`Wrote .data/atlas.sql\n${report.join("  ")}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
