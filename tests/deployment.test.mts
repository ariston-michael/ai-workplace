import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateDeployment } from "../deploy/validate-env.mjs";
import { backupDatabase } from "../deploy/backup.mjs";

test("public demo startup rejects live modes, nonpersistent paths and insecure Auth0 configuration", () => {
  const valid = { PUBLIC_HOSTNAME: "office.example.com", APP_BASE_URL: "https://office.example.com", AUTH0_DOMAIN: "tenant.us.auth0.com", AUTH0_CLIENT_ID: "test-client", AUTH0_CLIENT_SECRET: "test-client-secret", AUTH0_SECRET: randomBytes(32).toString("hex"), PROCUREMENT_MODE: "sample", SMS_MODE: "simulated", WORKPLACE_DB_PATH: "/var/lib/ai-workplace/workplace.db" };
  assert.deepEqual(validateDeployment(valid), []);
  for (const change of [{ PROCUREMENT_MODE: "live" }, { SMS_MODE: "twilio" }, { WORKPLACE_DB_PATH: "/tmp/ephemeral.db" }, { WORKPLACE_DB_PATH: "/var/lib/ai-workplace/../../tmp/lost.db" }, { APP_BASE_URL: "http://office.example.com" }, { AUTH0_SECRET: "replace-me" }, { AUTH0_CLIENT_SECRET: "" }, { PUBLIC_HOSTNAME: "office..example.com" }]) assert.ok(validateDeployment({ ...valid, ...change }).length > 0);
});

test("deployment backup is a consistent standalone snapshot of a live WAL database", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "deployment-backup-"));
  const source = path.join(dir, "source.db"), destination = path.join(dir, "backup.db");
  const db = new DatabaseSync(source); db.exec("PRAGMA journal_mode=WAL; CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO evidence VALUES (1, 'saved report');");
  try {
    backupDatabase(source, destination);
    db.exec("INSERT INTO evidence VALUES (2, 'later report');");
    const copy = new DatabaseSync(destination, { readOnly: true });
    try { assert.equal(copy.prepare("SELECT COUNT(*) AS n FROM evidence").get()?.n, 1); assert.equal(copy.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok"); } finally { copy.close(); }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM evidence").get()?.n, 2);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
