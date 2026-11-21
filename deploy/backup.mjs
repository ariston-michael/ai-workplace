import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function backupDatabase(file, destination) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`); return destination; } finally { db.close(); }
}
if (process.argv[1]?.endsWith("backup.mjs")) {
  const file = process.env.WORKPLACE_DB_PATH;
  if (!file || !path.posix.normalize(file).startsWith("/var/lib/ai-workplace/")) throw new Error("Expected the persistent deployment database.");
  const dir = "/var/lib/ai-workplace/backups";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  console.log(backupDatabase(file, path.join(dir, `workplace-${new Date().toISOString().replaceAll(":", "-")}.db`)));
}
