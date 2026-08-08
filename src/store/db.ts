import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Column-level migrations for tables that already existed before a column
 * was added to schema.sql. `CREATE TABLE IF NOT EXISTS` is a no-op against
 * an already-existing table — it does not retroactively add new columns —
 * so any database file created before a column existed in schema.sql needs
 * this to catch up (a real Electron user hit exactly this: "no column named
 * llm_backend" against a database created before that column was added).
 * This project has no other migration mechanism; this list is intentionally
 * explicit and hand-maintained rather than derived from parsing schema.sql,
 * so it stays auditable. Add a new entry here whenever schema.sql gains a
 * column on an EXISTING table — a brand-new TABLE needs no entry, since
 * `CREATE TABLE IF NOT EXISTS` already handles that correctly for both new
 * and pre-existing database files.
 */
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "projects", column: "llm_backend", ddl: "llm_backend TEXT NOT NULL DEFAULT 'local'" },
];

function applyColumnMigrations(db: Database.Database): void {
  for (const { table, column, ddl } of COLUMN_MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  }
}

/**
 * SQLite has no ALTER TABLE form that relaxes an existing column's NOT NULL
 * constraint (verified empirically: `ALTER TABLE t ALTER COLUMN x DROP NOT
 * NULL` is a plain syntax error on this project's SQLite version) — so a
 * pre-existing database created back when `domain` was required needs the
 * table-rebuild procedure SQLite's own documentation prescribes for this
 * exact situation: build a replacement table with the desired constraint,
 * copy every row across by explicit column name (never by position — a
 * table that already went through applyColumnMigrations() above may have
 * llm_backend physically appended after created_at, not in schema.sql's
 * declared order, since ALTER TABLE ADD COLUMN always appends), drop the
 * old table, and rename the replacement into place. Foreign keys are
 * disabled for the swap (a mid-rebuild moment where the old table is gone
 * and the new one isn't renamed yet would otherwise trip FK checks on
 * unrelated tables) and re-validated via `PRAGMA foreign_key_check` before
 * this returns, so a bug here fails loudly instead of silently corrupting
 * referential integrity.
 */
function migrateProjectsDomainNullable(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(projects)").all() as { name: string; notnull: number }[];
  const domainColumn = columns.find((c) => c.name === "domain");
  if (!domainColumn || domainColumn.notnull === 0) return; // already nullable, or table doesn't exist yet

  const foreignKeysWereOn = (db.pragma("foreign_keys", { simple: true }) as number) === 1;
  db.pragma("foreign_keys = OFF");
  try {
    const rebuild = db.transaction(() => {
      db.exec(`
        CREATE TABLE projects_new (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          domain TEXT,
          regulatory_context TEXT NOT NULL DEFAULT 'none',
          system_name TEXT,
          glossary TEXT,
          llm_backend TEXT NOT NULL DEFAULT 'local',
          created_at TEXT NOT NULL
        );
        INSERT INTO projects_new (id, name, domain, regulatory_context, system_name, glossary, llm_backend, created_at)
        SELECT id, name, domain, regulatory_context, system_name, glossary, llm_backend, created_at FROM projects;
        DROP TABLE projects;
        ALTER TABLE projects_new RENAME TO projects;
      `);
    });
    rebuild();
  } finally {
    if (foreignKeysWereOn) db.pragma("foreign_keys = ON");
  }

  const fkErrors = db.pragma("foreign_key_check") as unknown[];
  if (fkErrors.length > 0) {
    throw new Error(
      `migrateProjectsDomainNullable left foreign key violations: ${JSON.stringify(fkErrors)}`,
    );
  }
}

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const ddl = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(ddl);
  applyColumnMigrations(db);
  migrateProjectsDomainNullable(db);
  return db;
}

export function closeDb(db: Db): void {
  db.close();
}
