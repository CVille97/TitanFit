const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { createDatabase: createLibsqlDatabase } = require("./database.cjs");

const ROOT = __dirname;
const DEFAULT_DB_PATH = path.join(ROOT, "server-data", "titanfit.db");
const COOKIE_NAME = "tf_session";
const SESSION_DAYS = 14;

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function createDatabase(dbPath, legacyUsersFile, options = {}) {
  if (options.databaseUrl && !options.authToken) throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is configured.");
  if (!options.databaseUrl && options.authToken) throw new Error("TURSO_DATABASE_URL is required when TURSO_AUTH_TOKEN is configured.");
  const resolvedDbPath = path.resolve(dbPath);
  if (isWithin(path.join(ROOT, "dist"), resolvedDbPath)) {
    throw new Error("DB_PATH must not point inside the public build directory.");
  }
  const db = createLibsqlDatabase({
    dbPath: resolvedDbPath,
    databaseUrl: options.databaseUrl,
    authToken: options.authToken,
  });
  if (db.local) {
    await db.exec("PRAGMA foreign_keys = ON");
    await db.exec("PRAGMA busy_timeout = 5000");
    await db.exec("PRAGMA synchronous = NORMAL");
    await db.exec("PRAGMA journal_mode = WAL");
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      preferences TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(preferences)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data_key TEXT NOT NULL,
      value TEXT NOT NULL CHECK(json_valid(value)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, data_key)
    );
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      training_days TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(training_days)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS routines_owner_idx ON routines(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS routine_exercises (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      routine_id TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      position INTEGER NOT NULL,
      details TEXT NOT NULL CHECK(json_valid(details)),
      PRIMARY KEY(user_id, routine_id, id),
      FOREIGN KEY(user_id, routine_id) REFERENCES routines(user_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS training_sessions (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      duration_minutes INTEGER,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS training_sessions_owner_date_idx ON training_sessions(user_id, completed_at);
    CREATE TABLE IF NOT EXISTS performed_exercises (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      exercise_name TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY(user_id, id),
      FOREIGN KEY(user_id, session_id) REFERENCES training_sessions(user_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS workout_sets (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      performed_exercise_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      weight_kg REAL NOT NULL CHECK(weight_kg >= 0),
      repetitions INTEGER NOT NULL CHECK(repetitions > 0),
      completed INTEGER NOT NULL DEFAULT 1 CHECK(completed IN (0, 1)),
      PRIMARY KEY(user_id, id),
      FOREIGN KEY(user_id, performed_exercise_id) REFERENCES performed_exercises(user_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS body_weights (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recorded_at TEXT NOT NULL,
      weight_kg REAL NOT NULL CHECK(weight_kg BETWEEN 20 AND 400),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS body_weights_owner_date_idx ON body_weights(user_id, recorded_at);
    CREATE TABLE IF NOT EXISTS body_measurements (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recorded_at TEXT NOT NULL,
      waist_cm REAL,
      chest_cm REAL,
      arm_cm REAL,
      thigh_cm REAL,
      calves_cm REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS body_measurements_owner_date_idx ON body_measurements(user_id, recorded_at);
    CREATE TABLE IF NOT EXISTS app_config (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      config_key TEXT NOT NULL,
      value TEXT NOT NULL CHECK(json_valid(value)),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, config_key)
    );
    CREATE TABLE IF NOT EXISTS marketplace_listings (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL CHECK(json_valid(payload)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS marketplace_updated_idx ON marketplace_listings(updated_at);
    CREATE TABLE IF NOT EXISTS marketplace_favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, listing_id)
    );
    CREATE TABLE IF NOT EXISTS listing_images (
      listing_id TEXT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      image_data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(listing_id, position)
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
      buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(listing_id, buyer_user_id)
    );
    CREATE TABLE IF NOT EXISTS friendships (
      requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(requester_user_id, addressee_user_id),
      CHECK(requester_user_id <> addressee_user_id)
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      goal REAL NOT NULL CHECK(goal > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenge_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0),
      completed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, challenge_id)
    );
    CREATE TABLE IF NOT EXISTS nutrition_entries (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      consumed_at TEXT NOT NULL,
      payload TEXT NOT NULL CHECK(json_valid(payload)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, id)
    );
    CREATE INDEX IF NOT EXISTS nutrition_owner_date_idx ON nutrition_entries(user_id, consumed_at);
    CREATE TABLE IF NOT EXISTS recipe_favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipe_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(user_id, recipe_id)
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      listing_id TEXT REFERENCES marketplace_listings(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT NOT NULL,
      PRIMARY KEY(conversation_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages(conversation_id, created_at);
  `);

  if (db.local && process.platform !== "win32") fs.chmodSync(resolvedDbPath, 0o600);
  const legacyImportDone = await db.prepare("SELECT value FROM app_meta WHERE key = 'legacy_users_imported'").get();
  if (db.local && !legacyImportDone && legacyUsersFile && fs.existsSync(legacyUsersFile)) {
    const legacyUsers = JSON.parse(fs.readFileSync(legacyUsersFile, "utf8"));
    if (!Array.isArray(legacyUsers)) throw new Error("The legacy users file must contain an array.");
    const insert = db.prepare(`
      INSERT OR IGNORE INTO users (id, name, email, password_hash, preferences, created_at, updated_at)
      VALUES (?, ?, ?, ?, '{}', ?, ?)
    `);
    try {
      await db.transaction(async () => {
      for (const user of legacyUsers) {
        if (!user || typeof user.id !== "string" || typeof user.email !== "string" || typeof user.passwordHash !== "string") continue;
        const createdAt = typeof user.createdAt === "string" ? user.createdAt : new Date().toISOString();
        await insert.run(user.id, String(user.name || "").trim().slice(0, 80) || "Usuari", user.email.trim().toLowerCase(), user.passwordHash, createdAt, createdAt);
      }
      await db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('legacy_users_imported', '1', ?)").run(new Date().toISOString());
      });
    } catch (error) {
      throw error;
    }
  }

  return db;
}

function transaction(db, action) { return db.transaction(action); }

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts[0] === "scrypt" && parts.length === 3) {
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(password, parts[1], expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  }
  const [salt, expectedHex] = String(stored).split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  if (expected.length !== 32) return false;
  const actual = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
  return crypto.timingSafeEqual(actual, expected);
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function parseCookie(header, cookieName) {
  for (const piece of String(header || "").split(";")) {
    const separator = piece.indexOf("=");
    if (separator < 0 || piece.slice(0, separator).trim() !== cookieName) continue;
    try {
      return decodeURIComponent(piece.slice(separator + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

async function createApp(options = {}) {
  const dbPath = options.dbPath || process.env.DB_PATH || DEFAULT_DB_PATH;
  const legacyUsersFile = Object.prototype.hasOwnProperty.call(options, "legacyUsersFile")
    ? options.legacyUsersFile
    : path.join(ROOT, "server-data", "users.json");
  const db = await createDatabase(dbPath, legacyUsersFile, {
    databaseUrl: options.databaseUrl || process.env.TURSO_DATABASE_URL,
    authToken: options.authToken || process.env.TURSO_AUTH_TOKEN,
  });
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(express.json({ limit: "10mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    next();
  });

  // Bound expensive authentication work. Keep separate buckets per address and
  // normalized account identifier so a single account cannot be brute-forced
  // by rotating requests through a shared network.
  const authAttempts = new Map();
  const authWindowMs = 15 * 60 * 1000;
  const authLimit = (limit, keyForRequest) => (req, res, next) => {
    const now = Date.now();
    for (const [key, bucket] of authAttempts) if (bucket.expiresAt <= now) authAttempts.delete(key);
    const key = keyForRequest(req);
    const bucket = authAttempts.get(key);
    if (bucket && bucket.count >= limit) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000))));
      return res.status(429).json({ error: "Massa intents. Torna-ho a provar d'aquí a uns minuts." });
    }
    if (bucket) bucket.count += 1;
    else authAttempts.set(key, { count: 1, expiresAt: now + authWindowMs });
    next();
  };
  const authAddress = (req) => req.ip || req.socket.remoteAddress || "unknown";
  const authIdentity = (req) => String(req.body?.email || "").trim().toLowerCase().slice(0, 254) || "missing-email";
  const limitAuthAddress = authLimit(60, (req) => `address:${authAddress(req)}`);
  const limitAuthIdentity = authLimit(10, (req) => `identity:${authAddress(req)}:${authIdentity(req)}`);
  const clearAuthIdentity = (req) => authAttempts.delete(`identity:${authAddress(req)}:${authIdentity(req)}`);

  const secureCookie = process.env.NODE_ENV === "production";
  const cookieValue = (token, maxAge) => `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookie ? "; Secure" : ""}`;
  const setSession = async (res, userId) => {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + SESSION_DAYS * 86400000;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .run(tokenHash, userId, expiresAt, new Date().toISOString());
    res.setHeader("Set-Cookie", cookieValue(token, SESSION_DAYS * 86400));
  };
  const sessionUser = async (req) => {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    if (!token) return null;
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const row = await db.prepare(`
      SELECT users.id, users.name, users.email
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash, Date.now());
    return row || null;
  };
  const requireUser = async (req, res, next) => {
    const user = await sessionUser(req);
    if (!user) return res.status(401).json({ error: "La sessió no és vàlida. Torna a iniciar-la." });
    req.user = user;
    next();
  };
  const validOwnedKey = (key, userId) => /^tf_[a-zA-Z0-9_-]{1,140}$/.test(key) && key.endsWith(`_${userId}`);
  const validatePayload = (value) => {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 5 * 1024 * 1024) {
      const error = new Error("El registre supera la mida permesa.");
      error.status = 413;
      throw error;
    }
    return serialized;
  };

  async function syncRoutines(userId, value) {
    if (!Array.isArray(value)) return;
    await db.prepare("DELETE FROM routines WHERE user_id = ?").run(userId);
    const routineInsert = db.prepare(`
      INSERT INTO routines (id, user_id, name, description, training_days, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const exerciseInsert = db.prepare(`
      INSERT INTO routine_exercises (id, user_id, routine_id, exercise_name, position, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const routine of value) {
      if (!routine || typeof routine.id !== "string" || typeof routine.name !== "string") continue;
      const createdAt = typeof routine.createdAt === "string" ? routine.createdAt : now;
      const days = routine.trainingDays || routine.days || [];
      await routineInsert.run(routine.id, userId, routine.name.slice(0, 160), String(routine.description || "").slice(0, 2000), JSON.stringify(Array.isArray(days) ? days : []), createdAt, now);
      const exercises = Array.isArray(routine.items) ? routine.items : Array.isArray(routine.exercises) ? routine.exercises : [];
      for (const [index, exercise] of exercises.entries()) {
        if (!exercise || typeof exercise.exercise !== "string") continue;
        await exerciseInsert.run(`${routine.id}:${index}`, userId, routine.id, exercise.exercise.slice(0, 160), index, validatePayload(exercise));
      }
    }
  }

  async function syncSessions(userId, value) {
    if (!Array.isArray(value)) return;
    await db.prepare("DELETE FROM training_sessions WHERE user_id = ?").run(userId);
    const sessionInsert = db.prepare(`
      INSERT INTO training_sessions (id, user_id, started_at, completed_at, duration_minutes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const exerciseInsert = db.prepare(`
      INSERT INTO performed_exercises (id, user_id, session_id, exercise_name, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    const setInsert = db.prepare(`
      INSERT INTO workout_sets (id, user_id, performed_exercise_id, position, weight_kg, repetitions, completed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const groups = new Map();
    for (const entry of value) {
      if (!entry || typeof entry.id !== "string" || typeof entry.exercise !== "string") continue;
      const workoutId = typeof entry.workoutId === "string" && entry.workoutId ? entry.workoutId : entry.id;
      if (!groups.has(workoutId)) groups.set(workoutId, []);
      groups.get(workoutId).push(entry);
    }
    for (const [workoutId, entries] of groups) {
      const date = typeof entries[0].date === "string" ? entries[0].date : now;
      const duration = Number.isFinite(entries[0].duration) ? Math.max(0, Math.round(entries[0].duration)) : null;
      await sessionInsert.run(workoutId, userId, date, date, duration, now);
      for (const [index, entry] of entries.entries()) {
        const performedId = `${entry.id}:exercise`;
        await exerciseInsert.run(performedId, userId, workoutId, entry.exercise.slice(0, 160), index);
        const sets = Array.isArray(entry.sets) ? entry.sets : [];
        for (const [setIndex, set] of sets.entries()) {
          const weight = Number(set && set.kg);
          const repetitions = Number(set && set.reps);
          if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(repetitions) || repetitions < 1) continue;
          await setInsert.run(`${entry.id}:set:${setIndex}`, userId, performedId, setIndex, weight, repetitions, set.done === false ? 0 : 1);
        }
      }
    }
  }

  async function syncWeights(userId, value) {
    if (!Array.isArray(value)) return;
    await db.prepare("DELETE FROM body_weights WHERE user_id = ?").run(userId);
    const insert = db.prepare(`
      INSERT INTO body_weights (id, user_id, recorded_at, weight_kg, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const entry of value) {
      const weight = Number(entry && entry.weight);
      if (!entry || typeof entry.id !== "string" || !Number.isFinite(weight) || weight < 20 || weight > 400) continue;
      const recordedAt = typeof entry.date === "string" ? entry.date : now;
      await insert.run(entry.id, userId, recordedAt, weight, now, now);
    }
  }

  async function syncMeasurements(userId, value) {
    if (!Array.isArray(value)) return;
    await db.prepare("DELETE FROM body_measurements WHERE user_id = ?").run(userId);
    const insert = db.prepare(`
      INSERT INTO body_measurements (id, user_id, recorded_at, waist_cm, chest_cm, arm_cm, thigh_cm, calves_cm, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const entry of value) {
      if (!entry || typeof entry.id !== "string") continue;
      const values = ["waist", "chest", "arm", "thigh", "calves"].map((key) => {
        const number = Number(entry[key]);
        return Number.isFinite(number) && number > 0 && number <= 300 ? number : null;
      });
      if (values.every((number) => number === null)) continue;
      await insert.run(entry.id, userId, typeof entry.date === "string" ? entry.date : now, ...values, now, now);
    }
  }

  async function syncConfig(userId, key, value) {
    if (!key.startsWith("tf_profile_") && !key.startsWith("tf_calendar_") && !key.startsWith("tf_shopping_")) return;
    if (!key.endsWith(`_${userId}`)) return;
    const configKey = key.slice(3, -(userId.length + 1));
    const now = new Date().toISOString();
    await db.prepare(`
      INSERT INTO app_config (user_id, config_key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, config_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(userId, configKey, JSON.stringify(value), now);
  }

  async function syncFavorites(userId, key, value) {
    if (!Array.isArray(value)) return;
    const now = new Date().toISOString();
    if (key === `tf_fav_${userId}`) {
      await db.prepare("DELETE FROM marketplace_favorites WHERE user_id = ?").run(userId);
      const insert = db.prepare("INSERT OR IGNORE INTO marketplace_favorites (user_id, listing_id, created_at) VALUES (?, ?, ?)");
      const exists = db.prepare("SELECT 1 FROM marketplace_listings WHERE id = ?");
      for (const listingId of value) {
        if (typeof listingId === "string" && await exists.get(listingId)) await insert.run(userId, listingId, now);
      }
    }
    if (key === `tf_recipe_favorites_${userId}`) {
      await db.prepare("DELETE FROM recipe_favorites WHERE user_id = ?").run(userId);
      const insert = db.prepare("INSERT OR IGNORE INTO recipe_favorites (user_id, recipe_id, created_at) VALUES (?, ?, ?)");
      for (const recipeId of value) {
        if (typeof recipeId === "string" && recipeId.length <= 160) await insert.run(userId, recipeId, now);
      }
    }
  }

  async function syncNutrition(userId, value) {
    if (!Array.isArray(value)) return;
    await db.prepare("DELETE FROM nutrition_entries WHERE user_id = ?").run(userId);
    const insert = db.prepare(`
      INSERT INTO nutrition_entries (id, user_id, consumed_at, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const [index, entry] of value.entries()) {
      if (!entry || typeof entry.name !== "string") continue;
      const payload = JSON.stringify(entry);
      const id = crypto.createHash("sha256").update(`${index}:${payload}`).digest("hex");
      await insert.run(id, userId, typeof entry.date === "string" ? entry.date : now, payload, now, now);
    }
  }

  async function saveUserData(userId, key, value, serialized, insertOnly = false) {
    if (insertOnly) {
      const result = await db.prepare(`
        INSERT OR IGNORE INTO user_data (user_id, data_key, value, updated_at) VALUES (?, ?, ?, ?)
      `).run(userId, key, serialized, new Date().toISOString());
      if (!result.changes) return false;
    } else {
      await db.prepare(`
        INSERT INTO user_data (user_id, data_key, value, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, data_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(userId, key, serialized, new Date().toISOString());
    }
    if (key === `tf_routines_${userId}`) await syncRoutines(userId, value);
    if (key === `tf_sessions_${userId}`) await syncSessions(userId, value);
    if (key === `tf_weights_${userId}`) await syncWeights(userId, value);
    if (key === `tf_measures_${userId}`) await syncMeasurements(userId, value);
    if (key === `tf_food_${userId}`) await syncNutrition(userId, value);
    await syncFavorites(userId, key, value);
    await syncConfig(userId, key, value);
    return true;
  }

  async function saveListings(user, items, { importOnly = false } = {}) {
    if (!Array.isArray(items) || items.length > 500) {
      const error = new Error("La llista d'anuncis no és vàlida.");
      error.status = 400;
      throw error;
    }
    const normalized = items.filter((item) => item && typeof item.id === "string" && item.owner === user.id);
    await transaction(db, async () => {
      if (!importOnly) {
        const ids = new Set(normalized.map((item) => item.id));
        const owned = await db.prepare("SELECT id FROM marketplace_listings WHERE owner_user_id = ?").all(user.id);
        const remove = db.prepare("DELETE FROM marketplace_listings WHERE id = ? AND owner_user_id = ?");
        for (const row of owned) if (!ids.has(row.id)) await remove.run(row.id, user.id);
      }
      const findOwner = db.prepare("SELECT owner_user_id FROM marketplace_listings WHERE id = ?");
      const upsert = db.prepare(importOnly ? `
        INSERT OR IGNORE INTO marketplace_listings (id, owner_user_id, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      ` : `
        INSERT INTO marketplace_listings (id, owner_user_id, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        WHERE marketplace_listings.owner_user_id = excluded.owner_user_id
      `);
      const imageDelete = db.prepare("DELETE FROM listing_images WHERE listing_id = ?");
      const imageInsert = db.prepare("INSERT INTO listing_images (listing_id, position, image_data, created_at) VALUES (?, 0, ?, ?)");
      const now = new Date().toISOString();
      for (const item of normalized) {
        const existing = await findOwner.get(item.id);
        if (existing && existing.owner_user_id !== user.id) continue;
        const name = String(item.name || "").trim().slice(0, 160);
        const price = Number(item.price);
        if (!name || !Number.isFinite(price) || price < 0 || price > 1000000) continue;
        const photo = typeof item.photo === "string" && item.photo.length <= 3 * 1024 * 1024 ? item.photo : "";
        const payload = {
          ...item,
          name,
          price,
          seller: user.name,
          owner: user.id,
          photo,
          status: ["Disponible", "Reservat", "Venut"].includes(item.status) ? item.status : "Disponible",
        };
        const createdAt = typeof item.createdAt === "string" ? item.createdAt : now;
        const result = await upsert.run(item.id, user.id, JSON.stringify(payload), createdAt, now);
        if (!result.changes) continue;
        await imageDelete.run(item.id);
        if (photo) await imageInsert.run(item.id, photo, now);
      }
    });
  }

  app.get("/api/health", async (_req, res, next) => {
    try {
      await db.prepare("SELECT 1 AS ready").get();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/register", limitAuthAddress, limitAuthIdentity, async (req, res, next) => {
    try {
      const name = String(req.body.name || "").trim();
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      if (!name || name.length > 80) return res.status(400).json({ error: "El nom no és vàlid." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "El correu no és vàlid." });
      if (password.length < 8 || password.length > 256) return res.status(400).json({ error: "La contrasenya ha de tenir entre 8 i 256 caràcters." });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        await db.prepare("INSERT INTO users (id, name, email, password_hash, preferences, created_at, updated_at) VALUES (?, ?, ?, ?, '{}', ?, ?)")
          .run(id, name, email, passwordHash(password), now, now);
      } catch (error) {
        if (String(error.message).includes("UNIQUE constraint failed: users.email")) {
          return res.status(409).json({ error: "Ja existeix un compte amb aquest correu." });
        }
        throw error;
      }
      clearAuthIdentity(req);
      await setSession(res, id);
      res.status(201).json({ user: { id, name, email } });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", limitAuthAddress, limitAuthIdentity, async (req, res, next) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 1 || password.length > 256) {
        return res.status(401).json({ error: "Correu o contrasenya incorrectes." });
      }
      const user = await db.prepare("SELECT id, name, email, password_hash FROM users WHERE email = ? COLLATE NOCASE").get(email);
      if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: "Correu o contrasenya incorrectes." });
      }
      if (user.password_hash.includes(":")) {
        await db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
          .run(passwordHash(password), new Date().toISOString(), user.id);
      }
      clearAuthIdentity(req);
      await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
      await setSession(res, user.id);
      res.json({ user: safeUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/logout", async (req, res) => {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(crypto.createHash("sha256").update(token).digest("hex"));
    res.setHeader("Set-Cookie", cookieValue("", 0));
    res.json({ ok: true });
  });

  app.get("/api/me", requireUser, (req, res) => res.json({ user: safeUser(req.user) }));

  app.get("/api/users", requireUser, async (req, res) => {
    const query = String(req.query.q || "").trim().replace(/[%_]/g, "").slice(0, 80);
    if (query.length < 2) return res.json({ users: [] });
    const pattern = `%${query}%`;
    const users = await db.prepare(`
      SELECT id, name FROM users
      WHERE id <> ? AND (name LIKE ? COLLATE NOCASE OR email LIKE ? COLLATE NOCASE)
      ORDER BY name COLLATE NOCASE LIMIT 20
    `).all(req.user.id, pattern, pattern);
    res.json({ users });
  });

  app.get("/api/friends", requireUser, async (req, res) => {
    const rows = await db.prepare(`
      SELECT users.id, users.name, friendships.status,
        CASE WHEN friendships.requester_user_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
      FROM friendships
      JOIN users ON users.id = CASE
        WHEN friendships.requester_user_id = ? THEN friendships.addressee_user_id
        ELSE friendships.requester_user_id END
      WHERE friendships.requester_user_id = ? OR friendships.addressee_user_id = ?
      ORDER BY friendships.updated_at DESC
    `).all(req.user.id, req.user.id, req.user.id, req.user.id);
    res.json({ friends: rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status === "accepted" ? "Amics" : "Pendent",
      direction: row.direction,
    })) });
  });

  app.post("/api/friends/:userId", requireUser, async (req, res, next) => {
    try {
      const targetId = String(req.params.userId);
      if (targetId === req.user.id || !await db.prepare("SELECT 1 FROM users WHERE id = ?").get(targetId)) {
        return res.status(404).json({ error: "No s'ha trobat aquest compte." });
      }
      await transaction(db, async () => {
        const existing = await db.prepare(`
          SELECT requester_user_id, addressee_user_id, status FROM friendships
          WHERE (requester_user_id = ? AND addressee_user_id = ?)
             OR (requester_user_id = ? AND addressee_user_id = ?)
        `).get(req.user.id, targetId, targetId, req.user.id);
        const now = new Date().toISOString();
        if (existing?.status === "accepted") return;
        if (existing?.status === "pending") {
          if (existing.requester_user_id === targetId) {
            await db.prepare("UPDATE friendships SET status = 'accepted', updated_at = ? WHERE requester_user_id = ? AND addressee_user_id = ?")
              .run(now, targetId, req.user.id);
          }
          return;
        }
        await db.prepare("INSERT INTO friendships (requester_user_id, addressee_user_id, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)")
          .run(req.user.id, targetId, now, now);
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/friends/:userId", requireUser, async (req, res) => {
    const targetId = String(req.params.userId);
    await db.prepare(`
      DELETE FROM friendships WHERE
        (requester_user_id = ? AND addressee_user_id = ?)
        OR (requester_user_id = ? AND addressee_user_id = ?)
    `).run(req.user.id, targetId, targetId, req.user.id);
    res.json({ ok: true });
  });

  app.patch("/api/profile", requireUser, async (req, res, next) => {
    try {
      const name = String(req.body.name || "").trim();
      if (!name || name.length > 80) return res.status(400).json({ error: "El nom no és vàlid." });
      await db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(name, new Date().toISOString(), req.user.id);
      res.json({ user: safeUser(await db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(req.user.id)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reset-request", limitAuthAddress, limitAuthIdentity, (_req, res) => {
    res.json({ ok: true, message: "La recuperació per correu encara no està configurada. Contacta amb l'administració del servei." });
  });

  app.get("/api/data", requireUser, async (req, res) => {
    const rows = await db.prepare("SELECT data_key, value FROM user_data WHERE user_id = ?").all(req.user.id);
    const data = Object.fromEntries(rows.map((row) => [row.data_key, JSON.parse(row.value)]));
    res.json({ data });
  });

  app.post("/api/data/import", requireUser, async (req, res, next) => {
    try {
      const entries = req.body.entries && typeof req.body.entries === "object" && !Array.isArray(req.body.entries) ? req.body.entries : {};
      if (Object.keys(entries).length > 120) return res.status(400).json({ error: "Massa registres per importar." });
      const migrated = [];
      await transaction(db, async () => {
        for (const [key, value] of Object.entries(entries)) {
          if (!validOwnedKey(key, req.user.id)) continue;
          const serialized = validatePayload(value);
          if (await saveUserData(req.user.id, key, value, serialized, true)) migrated.push(key);
        }
      });
      const listings = Array.isArray(req.body.listings) ? req.body.listings : [];
      if (listings.length) {
        await saveListings(req.user, listings, { importOnly: true });
        for (const row of await db.prepare("SELECT data_key, value FROM user_data WHERE user_id = ?").all(req.user.id)) {
          await syncFavorites(req.user.id, row.data_key, JSON.parse(row.value));
        }
      }
      res.json({ imported: migrated.length, skipped: Object.keys(entries).length - migrated.length });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/data/:key", requireUser, async (req, res, next) => {
    try {
      const key = String(req.params.key);
      if (!validOwnedKey(key, req.user.id)) return res.status(403).json({ error: "No tens permís per modificar aquest registre." });
      const serialized = validatePayload(req.body.value);
      await transaction(db, async () => saveUserData(req.user.id, key, req.body.value, serialized));
      res.json({ ok: true, key, updatedAt: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/data/:key", requireUser, async (req, res, next) => {
    try {
      const key = String(req.params.key);
      if (!validOwnedKey(key, req.user.id)) return res.status(403).json({ error: "No tens permís per eliminar aquest registre." });
      await transaction(db, async () => {
        await db.prepare("DELETE FROM user_data WHERE user_id = ? AND data_key = ?").run(req.user.id, key);
        if (key === `tf_routines_${req.user.id}`) await db.prepare("DELETE FROM routines WHERE user_id = ?").run(req.user.id);
        if (key === `tf_sessions_${req.user.id}`) await db.prepare("DELETE FROM training_sessions WHERE user_id = ?").run(req.user.id);
        if (key === `tf_weights_${req.user.id}`) await db.prepare("DELETE FROM body_weights WHERE user_id = ?").run(req.user.id);
        if (key === `tf_measures_${req.user.id}`) await db.prepare("DELETE FROM body_measurements WHERE user_id = ?").run(req.user.id);
        if (key === `tf_food_${req.user.id}`) await db.prepare("DELETE FROM nutrition_entries WHERE user_id = ?").run(req.user.id);
        if (key === `tf_fav_${req.user.id}`) await db.prepare("DELETE FROM marketplace_favorites WHERE user_id = ?").run(req.user.id);
        if (key === `tf_recipe_favorites_${req.user.id}`) await db.prepare("DELETE FROM recipe_favorites WHERE user_id = ?").run(req.user.id);
        if (key.startsWith("tf_profile_") || key.startsWith("tf_calendar_") || key.startsWith("tf_shopping_")) {
          await db.prepare("DELETE FROM app_config WHERE user_id = ? AND config_key = ?")
            .run(req.user.id, key.slice(3, -(req.user.id.length + 1)));
        }
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/listings", requireUser, async (_req, res) => {
    const rows = await db.prepare("SELECT payload FROM marketplace_listings ORDER BY updated_at DESC LIMIT 500").all();
    res.json({ listings: rows.map((row) => JSON.parse(row.payload)) });
  });

  app.put("/api/listings", requireUser, async (req, res, next) => {
    try {
      await saveListings(req.user, req.body.items);
      const rows = await db.prepare("SELECT payload FROM marketplace_listings ORDER BY updated_at DESC LIMIT 500").all();
      res.json({ ok: true, listings: rows.map((row) => JSON.parse(row.payload)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/delete-account", requireUser, async (req, res) => {
    await db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
    res.setHeader("Set-Cookie", cookieValue("", 0));
    res.json({ ok: true });
  });

  if (options.staticFiles !== false) {
    const dist = path.join(ROOT, "dist");
    app.use(express.static(dist));
    app.use((req, res, next) => {
      if (!req.path.startsWith("/api/") && req.method === "GET" && fs.existsSync(path.join(dist, "index.html"))) {
        return res.sendFile(path.join(dist, "index.html"));
      }
      next();
    });
  }

  app.use((error, _req, res, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("TITANFIT API error:", error);
    res.status(status).json({ error: status >= 500 ? "S'ha produït un error al servidor." : error.message });
  });

  app.locals.db = db;
  app.locals.dbPath = db.path;
  return app;
}

if (require.main === module) {
  (async () => {
    const app = await createApp();
    const port = Number(process.env.PORT || 4174);
    const host = process.env.HOST || "0.0.0.0";
    const server = app.listen(port, host, () => {
      console.log(`TITANFIT server listening on ${host}:${port}`);
    });
    const shutdown = () => {
      server.close(async () => {
        await app.locals.db.close();
        process.exit(0);
      });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })().catch((error) => {
    console.error("TITANFIT startup failed:", error);
    process.exitCode = 1;
  });
}

module.exports = { createApp };
