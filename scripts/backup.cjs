const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync, backup } = require("node:sqlite");

async function main() {
  const root = path.resolve(__dirname, "..");
  const source = path.resolve(process.env.DB_PATH || path.join(root, "server-data", "titanfit.db"));
  if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`);
  const directory = path.resolve(process.env.BACKUP_DIR || path.join(root, "server-data", "backups"));
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(directory, `titanfit-${stamp}.db`);
  const db = new DatabaseSync(source);
  try {
    await backup(db, target);
    if (process.platform !== "win32") fs.chmodSync(target, 0o600);
  } finally {
    db.close();
  }
  console.log(`Database backup created: ${target}`);
}

main().catch((error) => {
  console.error("Database backup failed:", error);
  process.exitCode = 1;
});
