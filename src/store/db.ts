import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Db = Database.Database;

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const ddl = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(ddl);
  return db;
}

export function closeDb(db: Db): void {
  db.close();
}
