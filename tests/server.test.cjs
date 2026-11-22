const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { once } = require("node:events");
const { test } = require("node:test");
const { createApp } = require("../server.cjs");

async function startServer(dbPath, legacyUsersFile = null) {
  const app = await createApp({ dbPath, legacyUsersFile, staticFiles: false });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  let closed = false;
  return {
    app,
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await app.locals.db.close();
    },
  };
}

async function jsonRequest(server, pathname, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${server.origin}${pathname}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  const setCookie = response.headers.get("set-cookie");
  return {
    response,
    result,
    setCookie,
    cookie: setCookie?.split(";")[0] || cookie,
  };
}

async function register(server, email) {
  const { response, result, cookie, setCookie } = await jsonRequest(server, "/api/register", {
    method: "POST",
    body: { name: "Test User", email, password: "correct-horse-42" },
  });
  assert.equal(response.status, 201);
  assert.ok(cookie.startsWith("tf_session="));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  return { user: result.user, cookie };
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "titanfit-test-"));
  const servers = [];
  t.after(async () => {
    for (const server of servers) await server.close();
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    } catch (error) {
      if (error.code !== "EBUSY") throw error;
      t.diagnostic("Windows kept a temporary libSQL test database locked after client.close; the isolated temp directory was left for OS cleanup.");
    }
  });
  return { directory, servers };
}

test("async libSQL adapter executes local SQLite transactions and rolls back failures", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const server = await startServer(path.join(directory, "titanfit.db"));
  servers.push(server);
  const db = server.app.locals.db;
  assert.equal(db.local, true);
  await assert.rejects(db.transaction(async () => {
    await db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)")
      .run("rollback-check", "must-not-persist", new Date().toISOString());
    throw new Error("force transaction rollback");
  }), /force transaction rollback/);
  assert.equal(await db.prepare("SELECT value FROM app_meta WHERE key = ?").get("rollback-check"), null);
  const health = await jsonRequest(server, "/api/health");
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.result, { ok: true });
});

test("Turso migration tool dry-runs, transfers a test fixture, and refuses a second overwrite", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const sourcePath = path.join(directory, "source.db");
  const remotePath = path.join(directory, "remote.db");
  const server = await startServer(sourcePath);
  servers.push(server);
  const account = await register(server, "migration-fixture@example.test");
  const localHash = (await server.app.locals.db.prepare("SELECT password_hash FROM users WHERE id = ?").get(account.user.id)).password_hash;
  await server.close();

  const env = {
    ...process.env,
    DB_PATH: sourcePath,
    TURSO_DATABASE_URL: pathToFileURL(remotePath).href,
    TURSO_AUTH_TOKEN: "fixture-only-not-a-real-token",
  };
  const script = path.join(__dirname, "..", "scripts", "migrate-to-turso.cjs");
  const dryRun = spawnSync(process.execPath, [script], { cwd: path.dirname(script), env, encoding: "utf8" });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Dry run only/);

  const migration = spawnSync(process.execPath, [script, "--apply", "--confirm-empty-remote"], { cwd: path.dirname(script), env, encoding: "utf8" });
  assert.equal(migration.status, 0, migration.stderr);
  assert.match(migration.stdout, /Migration and remote integrity verification completed/);

  const { createClient } = require("@libsql/client");
  const remote = createClient({ url: pathToFileURL(remotePath).href, concurrency: 1 });
  try {
    const migratedHash = await remote.execute({ sql: "SELECT password_hash FROM users WHERE id = ?", args: [account.user.id] });
    assert.equal(migratedHash.rows[0].password_hash, localHash);
  } finally {
    await remote.close();
  }

  const secondApply = spawnSync(process.execPath, [script, "--apply", "--confirm-empty-remote"], { cwd: path.dirname(script), env, encoding: "utf8" });
  assert.notEqual(secondApply.status, 0);
  assert.match(secondApply.stderr, /is not empty/);
});

test("registered account and fitness data survive a backend restart", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const dbPath = path.join(directory, "titanfit.db");
  const firstServer = await startServer(dbPath);
  servers.push(firstServer);
  const account = await register(firstServer, "persistent@example.test");
  const key = `tf_routines_${account.user.id}`;
  const routines = [{
    id: "routine-1",
    name: "Força",
    description: "Rutina persistent",
    days: ["Dilluns"],
    items: [{ exercise: "Press banca", sets: 3, reps: 8, kg: 60, rest: 90 }],
    createdAt: new Date().toISOString(),
  }];
  const firstImport = await jsonRequest(firstServer, "/api/data/import", {
    cookie: account.cookie,
    method: "POST",
    body: { entries: { [key]: routines } },
  });
  assert.equal(firstImport.response.status, 200);
  assert.equal(firstImport.result.imported, 1);
  const repeatedImport = await jsonRequest(firstServer, "/api/data/import", {
    cookie: account.cookie,
    method: "POST",
    body: { entries: { [key]: [] } },
  });
  assert.equal(repeatedImport.result.imported, 0);

  const sessions = [
    { id: "exercise-a", workoutId: "workout-1", exercise: "Press banca", date: new Date().toISOString(), duration: 35, sets: [{ kg: 60, reps: 8, done: true }] },
    { id: "exercise-b", workoutId: "workout-1", exercise: "Rem amb barra", date: new Date().toISOString(), duration: 35, sets: [{ kg: 50, reps: 10, done: true }, { kg: 55, reps: 8, done: true }] },
  ];
  const weights = [{ id: "weight-1", date: new Date().toISOString(), weight: 70 }];
  const measures = [{ id: "measure-1", date: new Date().toISOString(), waist: "82", chest: "98" }];
  const food = [{ id: "food-1", date: "2026-05-09", name: "Civada", grams: 100, cal: 380, protein: 13, carbs: 68, fat: 7 }];
  const profile = { age: "28", height: "180", weight: "70", experience: "Intermedi" };
  const friends = [{ id: "demo-marc", name: "Marc · DEMO", status: "Pendent" }];
  const challenges = [{ id: "10-sessions" }];
  for (const [dataKey, value] of [
    [`tf_sessions_${account.user.id}`, sessions],
    [`tf_weights_${account.user.id}`, weights],
    [`tf_measures_${account.user.id}`, measures],
    [`tf_food_${account.user.id}`, food],
    [`tf_profile_${account.user.id}`, profile],
    [`tf_friends_${account.user.id}`, friends],
    [`tf_challenges_${account.user.id}`, challenges],
  ]) {
    const saved = await jsonRequest(firstServer, `/api/data/${encodeURIComponent(dataKey)}`, {
      cookie: account.cookie,
      method: "PUT",
      body: { value },
    });
    assert.equal(saved.response.status, 200);
  }
  assert.equal((await firstServer.app.locals.db.prepare("SELECT COUNT(*) AS count FROM training_sessions WHERE user_id = ?").get(account.user.id)).count, 1);
  assert.equal((await firstServer.app.locals.db.prepare("SELECT COUNT(*) AS count FROM performed_exercises WHERE user_id = ?").get(account.user.id)).count, 2);
  assert.equal((await firstServer.app.locals.db.prepare("SELECT COUNT(*) AS count FROM workout_sets WHERE user_id = ?").get(account.user.id)).count, 3);
  assert.equal((await firstServer.app.locals.db.prepare("SELECT weight_kg FROM body_weights WHERE user_id = ?").get(account.user.id)).weight_kg, 70);
  assert.equal((await firstServer.app.locals.db.prepare("SELECT waist_cm FROM body_measurements WHERE user_id = ?").get(account.user.id)).waist_cm, 82);
  assert.equal((await firstServer.app.locals.db.prepare("SELECT consumed_at FROM nutrition_entries WHERE user_id = ?").get(account.user.id)).consumed_at, "2026-05-09");
  assert.equal((await firstServer.app.locals.db.prepare("SELECT value FROM app_config WHERE user_id = ? AND config_key = 'profile'").get(account.user.id)).value, JSON.stringify(profile));
  assert.equal((await firstServer.app.locals.db.prepare("SELECT COUNT(*) AS count FROM routines WHERE user_id = ?").get(account.user.id)).count, 1);

  const secondDevice = await jsonRequest(firstServer, "/api/login", {
    method: "POST",
    body: { email: "persistent@example.test", password: "correct-horse-42" },
  });
  assert.equal(secondDevice.response.status, 200);
  const secondDeviceData = await jsonRequest(firstServer, "/api/data", { cookie: secondDevice.cookie });
  assert.deepEqual(secondDeviceData.result.data[key], routines);
  assert.deepEqual(secondDeviceData.result.data[`tf_weights_${account.user.id}`], weights);
  assert.deepEqual(secondDeviceData.result.data[`tf_measures_${account.user.id}`], measures);
  assert.deepEqual(secondDeviceData.result.data[`tf_food_${account.user.id}`], food);
  assert.deepEqual(secondDeviceData.result.data[`tf_profile_${account.user.id}`], profile);
  assert.deepEqual(secondDeviceData.result.data[`tf_friends_${account.user.id}`], friends);
  assert.deepEqual(secondDeviceData.result.data[`tf_challenges_${account.user.id}`], challenges);
  await firstServer.close();

  const restartedServer = await startServer(dbPath);
  servers.push(restartedServer);
  const session = await jsonRequest(restartedServer, "/api/me", { cookie: account.cookie });
  assert.equal(session.response.status, 200);
  assert.equal(session.result.user.id, account.user.id);
  const data = await jsonRequest(restartedServer, "/api/data", { cookie: account.cookie });
  assert.deepEqual(data.result.data[key], routines);
  assert.deepEqual(data.result.data[`tf_food_${account.user.id}`], food);
});

test("private data is isolated while published listings are shared and owner-protected", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const server = await startServer(path.join(directory, "titanfit.db"));
  servers.push(server);
  const first = await register(server, "first@example.test");
  const second = await register(server, "second@example.test");
  const privateKey = `tf_weights_${first.user.id}`;
  const privateData = [{ id: "weight-1", weight: 70, date: new Date().toISOString() }];
  const write = await jsonRequest(server, `/api/data/${encodeURIComponent(privateKey)}`, {
    cookie: first.cookie,
    method: "PUT",
    body: { value: privateData },
  });
  assert.equal(write.response.status, 200);

  const deniedWrite = await jsonRequest(server, `/api/data/${encodeURIComponent(privateKey)}`, {
    cookie: second.cookie,
    method: "PUT",
    body: { value: [] },
  });
  assert.equal(deniedWrite.response.status, 403);
  const secondData = await jsonRequest(server, "/api/data", { cookie: second.cookie });
  assert.deepEqual(secondData.result.data, {});

  const listing = {
    id: "product-1",
    owner: first.user.id,
    name: "Barra",
    price: 25,
    category: "Equipament",
    state: "Usat",
    location: "Sant Boi",
    description: "En bon estat",
    status: "Disponible",
  };
  const published = await jsonRequest(server, "/api/listings", {
    cookie: first.cookie,
    method: "PUT",
    body: { items: [listing] },
  });
  assert.equal(published.response.status, 200);
  const staleImport = await jsonRequest(server, "/api/data/import", {
    cookie: first.cookie,
    method: "POST",
    body: { entries: {}, listings: [{ ...listing, name: "Versió local antiga" }] },
  });
  assert.equal(staleImport.response.status, 200);
  const visible = await jsonRequest(server, "/api/listings", { cookie: second.cookie });
  assert.equal(visible.result.listings.length, 1);
  assert.equal(visible.result.listings[0].owner, first.user.id);
  assert.equal(visible.result.listings[0].name, "Barra");

  const takeover = await jsonRequest(server, "/api/listings", {
    cookie: second.cookie,
    method: "PUT",
    body: { items: [{ ...listing, owner: second.user.id, name: "Alterat" }] },
  });
  assert.equal(takeover.response.status, 200);
  const unchanged = await jsonRequest(server, "/api/listings", { cookie: first.cookie });
  assert.equal(unchanged.result.listings[0].name, "Barra");

  const edited = await jsonRequest(server, "/api/listings", {
    cookie: first.cookie,
    method: "PUT",
    body: { items: [{ ...listing, name: "Barra editada", photo: "data:image/png;base64,AA==" }] },
  });
  assert.equal(edited.response.status, 200);
  assert.equal(edited.result.listings[0].name, "Barra editada");
  assert.equal((await server.app.locals.db.prepare("SELECT image_data FROM listing_images WHERE listing_id = ?").get(listing.id)).image_data, "data:image/png;base64,AA==");
  const deleted = await jsonRequest(server, "/api/listings", {
    cookie: first.cookie,
    method: "PUT",
    body: { items: [] },
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.result.listings.length, 0);
});

test("legacy password hashes are migrated and upgraded after login", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const dbPath = path.join(directory, "titanfit.db");
  const legacyFile = path.join(directory, "users.json");
  const salt = "a".repeat(32);
  const password = "legacy-password";
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  fs.writeFileSync(legacyFile, JSON.stringify([{
    id: "legacy-user",
    name: "Legacy User",
    email: "legacy@example.test",
    passwordHash: `${salt}:${derived}`,
    createdAt: new Date().toISOString(),
  }]));
  const server = await startServer(dbPath, legacyFile);
  servers.push(server);
  const login = await jsonRequest(server, "/api/login", {
    method: "POST",
    body: { email: "legacy@example.test", password },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.result.user.id, "legacy-user");
  const hash = (await server.app.locals.db.prepare("SELECT password_hash FROM users WHERE id = ?").get("legacy-user")).password_hash;
  assert.ok(hash.startsWith("scrypt$"));
  const deleted = await jsonRequest(server, "/api/delete-account", { cookie: login.cookie, method: "POST" });
  assert.equal(deleted.response.status, 200);
  await server.close();

  const restarted = await startServer(dbPath, legacyFile);
  servers.push(restarted);
  const deletedAccountLogin = await jsonRequest(restarted, "/api/login", {
    method: "POST",
    body: { email: "legacy@example.test", password },
  });
  assert.equal(deletedAccountLogin.response.status, 401);
});

test("logout revokes the persistent session", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const server = await startServer(path.join(directory, "titanfit.db"));
  servers.push(server);
  const account = await register(server, "logout@example.test");
  const logout = await jsonRequest(server, "/api/logout", { cookie: account.cookie, method: "POST" });
  assert.equal(logout.response.status, 200);
  const session = await jsonRequest(server, "/api/me", { cookie: account.cookie });
  assert.equal(session.response.status, 401);
});

test("friend requests are stored in SQLite and support accept and remove", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const server = await startServer(path.join(directory, "titanfit.db"));
  servers.push(server);
  const first = await register(server, "friend-one@example.test");
  const second = await register(server, "friend-two@example.test");
  const search = await jsonRequest(server, "/api/users?q=friend-two", { cookie: first.cookie });
  assert.equal(search.response.status, 200);
  assert.deepEqual(search.result.users, [{ id: second.user.id, name: second.user.name }]);
  const request = await jsonRequest(server, `/api/friends/${second.user.id}`, { cookie: first.cookie, method: "POST" });
  assert.equal(request.response.status, 200);
  assert.equal((await server.app.locals.db.prepare("SELECT status FROM friendships WHERE requester_user_id = ? AND addressee_user_id = ?").get(first.user.id, second.user.id)).status, "pending");
  const incoming = await jsonRequest(server, "/api/friends", { cookie: second.cookie });
  assert.deepEqual(incoming.result.friends, [{ id: first.user.id, name: first.user.name, status: "Pendent", direction: "incoming" }]);
  const accepted = await jsonRequest(server, `/api/friends/${first.user.id}`, { cookie: second.cookie, method: "POST" });
  assert.equal(accepted.response.status, 200);
  const outgoing = await jsonRequest(server, "/api/friends", { cookie: first.cookie });
  assert.deepEqual(outgoing.result.friends, [{ id: second.user.id, name: second.user.name, status: "Amics", direction: "outgoing" }]);
  const removed = await jsonRequest(server, `/api/friends/${second.user.id}`, { cookie: first.cookie, method: "DELETE" });
  assert.equal(removed.response.status, 200);
  assert.equal((await server.app.locals.db.prepare("SELECT COUNT(*) AS count FROM friendships").get()).count, 0);
});

test("authentication limits repeated attempts and rejects oversized login passwords", async (t) => {
  const { directory, servers } = temporaryDirectory(t);
  const server = await startServer(path.join(directory, "titanfit.db"));
  servers.push(server);
  const account = await register(server, "limited@example.test");
  await jsonRequest(server, "/api/logout", { cookie: account.cookie, method: "POST" });

  const oversized = await jsonRequest(server, "/api/login", {
    method: "POST",
    body: { email: "limited@example.test", password: "x".repeat(257) },
  });
  assert.equal(oversized.response.status, 401);
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const failed = await jsonRequest(server, "/api/login", {
      method: "POST",
      body: { email: "limited@example.test", password: "incorrect-password" },
    });
    assert.equal(failed.response.status, 401);
  }
  const limited = await jsonRequest(server, "/api/login", {
    method: "POST",
    body: { email: "limited@example.test", password: "correct-horse-42" },
  });
  assert.equal(limited.response.status, 429);
  assert.ok(Number(limited.response.headers.get("retry-after")) > 0);
  const health = await jsonRequest(server, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.result.ok, true);
});
