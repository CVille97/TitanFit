const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { AsyncLocalStorage } = require("node:async_hooks");
const { createClient } = require("@libsql/client");

function createDatabase({ dbPath, databaseUrl, authToken }) {
  const local = !databaseUrl;
  const resolvedPath = path.resolve(dbPath);
  if (local) fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const client = createClient(local
    ? { url: pathToFileURL(resolvedPath).href, concurrency: 1 }
    : { url: databaseUrl, authToken, concurrency: 5 });
  const transactionContext = new AsyncLocalStorage();

  async function execute(sql, args = []) {
    const connection = transactionContext.getStore() || client;
    return connection.execute({ sql, args });
  }

  const db = {
    client,
    local,
    path: local ? resolvedPath : databaseUrl,
    prepare(sql) {
      return {
        async get(...args) {
          const result = await execute(sql, args);
          return result.rows[0] || null;
        },
        async all(...args) {
          const result = await execute(sql, args);
          return result.rows;
        },
        async run(...args) {
          const result = await execute(sql, args);
          return { changes: Number(result.rowsAffected || 0), lastInsertRowid: result.lastInsertRowid };
        },
      };
    },
    async exec(sql) {
      const statements = String(sql).split(";").map((statement) => statement.trim()).filter(Boolean);
      for (const statement of statements) await execute(statement);
    },
    async transaction(action) {
      const tx = await client.transaction("write");
      try {
        const result = await transactionContext.run(tx, action);
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    },
    async close() { await client.close(); },
  };

  return db;
}

module.exports = { createDatabase };
