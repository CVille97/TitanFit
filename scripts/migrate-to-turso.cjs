const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createClient } = require("@libsql/client");

const ROOT = path.resolve(__dirname, "..");
const sourcePath = path.resolve(process.env.DB_PATH || path.join(ROOT, "server-data", "titanfit.db"));
const remoteUrl = process.env.TURSO_DATABASE_URL;
const remoteToken = process.env.TURSO_AUTH_TOKEN;
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm-empty-remote");
const quote = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

async function main() {
  if (!fs.existsSync(sourcePath)) throw new Error(`Local SQLite database not found: ${sourcePath}`);
  if (!remoteUrl || !remoteToken) throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the shell before running this script.");
  if (apply && !confirmed) throw new Error("Applying requires both --apply and --confirm-empty-remote.");

  const local = createClient({ url: pathToFileURL(sourcePath).href });
  const remote = createClient({ url: remoteUrl, authToken: remoteToken });
  try {
    const sourceIntegrity = await local.execute("PRAGMA integrity_check");
    if (sourceIntegrity.rows.length !== 1 || sourceIntegrity.rows[0].integrity_check !== "ok") {
      throw new Error("Local SQLite integrity_check did not return ok; migration stopped without writing to Turso.");
    }
    const schema = (await local.execute(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
      ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name
    `)).rows;
    const tables = schema.filter((entry) => entry.type === "table");
    const indexes = schema.filter((entry) => entry.type === "index");
    const tableNames = new Set(tables.map((table) => table.name));
    const counts = new Map();
    for (const table of tables) {
      const result = await local.execute(`SELECT COUNT(*) AS count FROM ${quote(table.name)}`);
      counts.set(table.name, Number(result.rows[0].count));
    }

    const remoteSchema = (await remote.execute(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
    `)).rows;
    const remoteTables = remoteSchema.filter((entry) => entry.type === "table");
    const extraTables = remoteTables.filter((table) => !tableNames.has(table.name));
    if (extraTables.length) throw new Error(`Remote has tables absent locally: ${extraTables.map((table) => table.name).join(", ")}. Nothing was changed.`);

    for (const table of remoteTables) {
      const localDefinition = tables.find((entry) => entry.name === table.name)?.sql;
      const normalize = (sql) => String(sql || "").replace(/\s+/g, " ").replace(/IF NOT EXISTS/gi, "").trim().toLowerCase();
      if (normalize(table.sql) !== normalize(localDefinition)) {
        throw new Error(`Remote schema differs for table ${table.name}. Nothing was changed.`);
      }
      const result = await remote.execute(`SELECT COUNT(*) AS count FROM ${quote(table.name)}`);
      if (Number(result.rows[0].count) !== 0) throw new Error(`Remote table ${table.name} is not empty. Nothing was changed.`);
    }

    for (const index of remoteSchema.filter((entry) => entry.type === "index")) {
      const localIndex = indexes.find((entry) => entry.name === index.name);
      const normalize = (sql) => String(sql || "").replace(/\s+/g, " ").trim().toLowerCase();
      if (!localIndex || normalize(index.sql) !== normalize(localIndex.sql)) {
        throw new Error(`Remote index ${index.name} differs from local. Nothing was changed.`);
      }
    }
    for (const index of indexes) {
      if (remoteSchema.some((entry) => entry.type === "index" && entry.name === index.name)) continue;
      // The schema is not fully ready until all application tables and indexes exist.
      if (remoteTables.length) throw new Error(`Remote schema is partially initialized (missing index ${index.name}). Nothing was changed.`);
    }

    console.log(`Local database: ${sourcePath}`);
    console.log(`Source integrity: ok; ${tables.length} tables, ${indexes.length} explicit indexes.`);
    for (const table of tables) console.log(`  ${table.name}: ${counts.get(table.name)} rows`);
    console.log(`Remote preflight: ${remoteTables.length === 0 ? "no application tables" : `${remoteTables.length} matching, empty tables`}; no remote rows will be overwritten.`);
    if (!apply) {
      console.log("Dry run only. No Turso schema or data was written.");
      console.log("To apply after reviewing this report, run: npm run migrate:turso -- --apply --confirm-empty-remote");
      return;
    }

    if (remoteTables.length === 0) {
      for (const table of tables) await remote.execute(table.sql);
      for (const index of indexes) await remote.execute(index.sql);
    }

    // Write parents before their children, based on each table's declared FKs.
    const dependencies = new Map();
    for (const table of tables) {
      const foreignKeys = await local.execute(`PRAGMA foreign_key_list(${quote(table.name)})`);
      dependencies.set(table.name, new Set(foreignKeys.rows.map((row) => row.table).filter((name) => tableNames.has(name) && name !== table.name)));
    }
    const orderedTables = [];
    const pending = new Set(tables.map((table) => table.name));
    while (pending.size) {
      const ready = [...pending].filter((name) => [...dependencies.get(name)].every((dependency) => !pending.has(dependency)));
      if (!ready.length) throw new Error("Could not order SQLite foreign-key dependencies safely.");
      for (const name of ready) { orderedTables.push(name); pending.delete(name); }
    }

    for (const tableName of orderedTables) {
      const columnsResult = await local.execute(`PRAGMA table_info(${quote(tableName)})`);
      const columns = columnsResult.rows.map((column) => column.name);
      const placeholders = columns.map(() => "?").join(", ");
      const select = `SELECT * FROM ${quote(tableName)} LIMIT ? OFFSET ?`;
      for (let offset = 0; offset < counts.get(tableName); offset += 10) {
        const rows = (await local.execute({ sql: select, args: [10, offset] })).rows;
        const statements = rows.map((row) => ({
          sql: `INSERT INTO ${quote(tableName)} (${columns.map(quote).join(", ")}) VALUES (${placeholders})`,
          args: columns.map((column) => row[column]),
        }));
        if (statements.length) await remote.batch(statements, "write");
        await pause();
      }
      console.log(`Transferred ${tableName}: ${counts.get(tableName)} rows.`);
    }

    for (const table of tables) {
      const result = await remote.execute(`SELECT COUNT(*) AS count FROM ${quote(table.name)}`);
      const remoteCount = Number(result.rows[0].count);
      if (remoteCount !== counts.get(table.name)) throw new Error(`Row count verification failed for ${table.name}: expected ${counts.get(table.name)}, got ${remoteCount}. Keep the local database untouched.`);
    }
    const remoteIntegrity = await remote.execute("PRAGMA integrity_check");
    if (remoteIntegrity.rows.length !== 1 || remoteIntegrity.rows[0].integrity_check !== "ok") {
      throw new Error("Remote integrity_check did not return ok. Keep the local database untouched.");
    }
    console.log("Migration and remote integrity verification completed. The local SQLite file was not modified.");
  } finally {
    await local.close();
    await remote.close();
  }
}

main().catch((error) => {
  console.error("Turso migration stopped:", error.message);
  process.exitCode = 1;
});
