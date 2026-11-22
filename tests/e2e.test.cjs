const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");

const ROOT = path.resolve(__dirname, "..");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function registerApiUser(origin, name, email) {
  const response = await fetch(`${origin}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password: "e2e-secure-password-44" }),
  });
  assert.equal(response.status, 201, "secondary test account registration failed");
  return { user: (await response.json()).user, cookie: response.headers.get("set-cookie").split(";")[0] };
}

async function waitFor(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([once(child, "exit"), wait(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

class DevTools {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const deferred = this.pending.get(message.id);
      if (!deferred) return;
      this.pending.delete(message.id);
      if (message.error) deferred.reject(new Error(message.error.message));
      else deferred.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }
    return result.result.value;
  }

  async clickButton(text, exact = false) {
    const result = await this.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find(button => ${exact
        ? `button.textContent.trim() === ${JSON.stringify(text)}`
        : `button.textContent.includes(${JSON.stringify(text)})`});
      if (!target) return false;
      target.click();
      return true;
    })()`);
    assert.equal(result, true, `Button not found: ${text}`);
  }

  async setValue(selector, value) {
    const result = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      setter.call(element, ${JSON.stringify(String(value))});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(result, true, `Form field not found: ${selector}`);
  }

  async waitForText(selector, text, label = text) {
    try {
      await waitFor(async () => (await this.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent.includes(${JSON.stringify(text)}) || false`)), label);
    } catch (error) {
      const snapshot = await this.evaluate("document.body.innerText.slice(0, 1200)").catch(() => "<page unavailable>");
      console.error(`Browser state while waiting for ${label}:\n${snapshot}`);
      throw error;
    }
  }
}

async function main() {
  const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
  assert.ok(chromePath, "Chrome/Chromium not found. Set CHROME_PATH to run the browser integration test.");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "titanfit-e2e-"));
  const dbPath = path.join(temp, "render-safe-test.db");
  const port = await freePort();
  let server;
  let chrome;
  let socket;
  try {
    server = spawn(process.execPath, ["server.cjs"], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), HOST: "0.0.0.0", DB_PATH: dbPath, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let serverLog = "";
    server.stdout.on("data", (chunk) => { serverLog += chunk.toString(); });
    server.stderr.on("data", (chunk) => { serverLog += chunk.toString(); });
    await waitFor(() => serverLog.includes(`0.0.0.0:${port}`), "Express to listen", 15000);

    const profile = path.join(temp, "chrome-profile");
    chrome = spawn(chromePath, [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
      `--user-data-dir=${profile}`, "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore"] });
    const activePortFile = path.join(profile, "DevToolsActivePort");
    await waitFor(() => fs.existsSync(activePortFile), "Chrome DevTools endpoint", 15000);
    const debugPort = Number(fs.readFileSync(activePortFile, "utf8").split(/\r?\n/)[0]);
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    assert.ok(page, "Chrome page target was not created");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const browser = new DevTools(socket);
    await browser.send("Page.enable");
    await browser.send("Runtime.enable");
    await browser.send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
    await waitFor(async () => await browser.evaluate("Boolean(document.querySelector('.auth-card'))"), "authentication form");

    await browser.clickButton("Crear compte");
    await browser.setValue('input[name="name"]', "Auditoria TITANFIT");
    const email = `e2e-${Date.now()}@example.test`;
    await browser.setValue('input[name="email"]', email);
    await browser.setValue('input[name="password"]', "e2e-secure-password-44");
    await browser.evaluate("document.querySelector('form.auth-card').requestSubmit()");
    await browser.waitForText(".hero h1", "Auditoria TITANFIT", "account registration and dashboard");
    const identityDb = new DatabaseSync(dbPath, { readOnly: true });
    const mainUserId = identityDb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
    identityDb.close();
    const incomingFriend = await registerApiUser(`http://127.0.0.1:${port}`, "E2E Friend", `friend-${Date.now()}@example.test`);
    const outgoingFriend = await registerApiUser(`http://127.0.0.1:${port}`, "E2E Search", `search-${Date.now()}@example.test`);
    const incomingRequest = await fetch(`http://127.0.0.1:${port}/api/friends/${mainUserId}`, {
      method: "POST", headers: { Cookie: incomingFriend.cookie },
    });
    assert.equal(incomingRequest.status, 200);

    await browser.clickButton("Entrenar");
    await browser.clickButton("Crear una rutina");
    await browser.setValue(".routine-builder-page input", "Rutina e2e inicial");
    await browser.clickButton("+ Afegir exercicis");
    for (const exercise of ["Press de banca amb barra", "Press inclinat amb barra", "Obertures amb manuelles"]) {
      await browser.clickButton(exercise, false);
    }
    await browser.clickButton("Afegir 3 exercicis a la rutina");
    await browser.clickButton("Guardar rutina");
    await browser.waitForText(".saved-routine-card h3", "Rutina e2e inicial", "routine create and save");
    await browser.evaluate("location.reload()");
    await browser.waitForText(".hero h1", "Auditoria TITANFIT", "session restoration after reload");
    await browser.clickButton("Entrenar");
    await browser.waitForText(".saved-routine-card h3", "Rutina e2e inicial", "routine recovery after reload");
    await browser.clickButton("Editar");
    await browser.setValue(".routine-builder-page input", "Rutina e2e editada");
    await browser.clickButton("Guardar rutina");
    await browser.waitForText(".saved-routine-card h3", "Rutina e2e editada", "routine edit");
    await browser.clickButton("Començar");
    for (let exerciseIndex = 0; exerciseIndex < 3; exerciseIndex += 1) {
      await browser.setValue(".set-row input[type=number]", "60");
      await browser.setValue(".set-row label:nth-of-type(2) input", "8");
      await browser.clickButton("Completar");
      if (exerciseIndex < 2) await browser.clickButton("Següent exercici");
    }
    await browser.clickButton("Finalitzar entrenament");
    await browser.waitForText(".workout-summary h1", "Bon treball", "workout completion");
    await browser.clickButton("Tornar a Entrenar");

    await browser.clickButton("Progrés");
    await browser.setValue('.progress-form input[type="number"]', "72.4");
    await browser.evaluate("document.querySelector('.progress-form form').requestSubmit()");
    await browser.waitForText(".history-list", "72.4 kg", "body weight save");
    await browser.setValue('input[name="waist"]', "82");
    await browser.evaluate("document.querySelectorAll('.progress-form form')[1].requestSubmit()");
    await browser.waitForText(".history-list", "Cintura 82 cm", "body measurements save");

    await browser.clickButton("Nutrició");
    await browser.setValue('input[name="name"]', "Civada e2e");
    await browser.setValue('input[name="grams"]', "100");
    await browser.setValue('input[name="cal"]', "380");
    await browser.setValue('input[name="protein"]', "13");
    await browser.setValue('input[name="carbs"]', "68");
    await browser.setValue('input[name="fat"]', "7");
    await browser.evaluate("document.querySelector('.nutrition-layout form').requestSubmit()");
    await browser.waitForText(".nutrition-layout .panel:last-child", "Civada e2e", "nutrition form");
    const today = await browser.evaluate("document.querySelector('.nutrition-date input').value");
    const yesterday = await browser.evaluate("(()=>{const d=new Date();d.setDate(d.getDate()-1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})()");
    await browser.setValue(".nutrition-date input", yesterday);
    await browser.waitForText(".nutrition-layout .panel:last-child", "El teu diari", "nutrition date filter");
    assert.equal(await browser.evaluate("document.querySelector('.nutrition-stats article strong').textContent"), "0 kcal");
    await browser.setValue(".nutrition-date input", today);
    await browser.waitForText(".nutrition-layout .panel:last-child", "Civada e2e", "nutrition date recovery");

    await browser.clickButton("Entrenar");
    await browser.clickButton("Smart Workout");
    await browser.setValue(".smart-grid label:nth-child(5) select", "Grups musculars concretos");
    await browser.clickButton("Pit");
    await browser.clickButton("Generar la meva rutina");
    await browser.waitForText(".week-preview", "Pit", "custom Smart Workout generation");
    await waitFor(async () => await browser.evaluate("document.querySelectorAll('.week-exercise').length > 0"), "Smart Workout exercises for selected muscles");
    await browser.clickButton("Guardar rutina");
    await browser.waitForText(".toast", "Setmana desada al servidor", "Smart Workout persistence");

    await browser.clickButton("Mercat");
    await browser.clickButton("+ Publicar producte");
    await browser.setValue('.publish-form input[name="name"]', "Barra e2e");
    await browser.setValue('.publish-form input[name="price"]', "25");
    await browser.setValue('.publish-form input[name="location"]', "Sant Boi");
    await browser.setValue('.publish-form textarea[name="description"]', "Anunci d'integracio");
    await browser.evaluate("document.querySelector('.publish-form').requestSubmit()");
    await browser.waitForText(".listing-card h3", "Barra e2e", "marketplace publish");
    await browser.clickButton("Editar");
    await browser.setValue('.publish-form input[name="name"]', "Barra e2e editada");
    await browser.evaluate(`(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = Object.assign((input, init) => String(input).includes('/api/listings')
        ? Promise.reject(new TypeError('simulated offline'))
        : originalFetch(input, init), { __original: originalFetch });
    })()`);
    await browser.evaluate("document.querySelector('.publish-form').requestSubmit()");
    await browser.waitForText(".toast", "No s'ha pogut sincronitzar l'anunci", "marketplace sync failure");
    assert.equal(await browser.evaluate("Boolean(document.querySelector('.publish-form'))"), true, "marketplace form closed despite failed server save");
    await browser.evaluate(`window.fetch = window.fetch.__original || window.fetch`);
    await browser.evaluate("document.querySelector('.publish-form').requestSubmit()");
    await browser.waitForText(".listing-card h3", "Barra e2e editada", "marketplace edit after retry");
    await browser.clickButton("Reservar");
    await browser.waitForText(".listing-card", "Reservat", "marketplace status change");
    await browser.clickButton("Gimnasos");
    await browser.clickButton("Veure gimnàs");
    await waitFor(async () => await browser.evaluate("Boolean(document.querySelector('.gym-detail h1'))"), "gym detail view");
    assert.match(await browser.evaluate("document.querySelector('.gym-detail h1').textContent"), /Basic-Fit/);
    await browser.clickButton("Tornar al catàleg");
    await browser.clickButton("☆ Preferit");
    await browser.clickButton("Comunitat");
    await browser.waitForText(".friend-columns", "E2E Friend", "incoming friend request");
    await browser.clickButton("Acceptar");
    await waitFor(async () => await browser.evaluate("[...document.querySelectorAll('.friend-columns .friend-row')].some(row=>row.textContent.includes('E2E Friend')&&row.textContent.includes('Amics'))"), "friend request acceptance");
    await browser.setValue(".friend-search input", "E2E Search");
    await waitFor(async () => await browser.evaluate("[...document.querySelectorAll('.friend-row strong')].some(node=>node.textContent==='E2E Search')"), "friend search results");
    await browser.clickButton("Afegir");
    await browser.waitForText(".friend-columns", "Enviat", "outgoing friend request");
    await browser.clickButton("Reptes");
    await browser.clickButton("Activar repte");

    await browser.clickButton("Inici");
    await browser.waitForText(".level-ring span", "Rookie", "TITAN LEVEL from saved workout exercises");
    if (process.env.TF_CAPTURE_VISUALS) await browser.evaluate("new Promise(resolve => setTimeout(resolve, 3200))");
    const visualAudit = [];
    const sections = ["Inici", "Entrenar", "Progrés", "Nutrició", "Gimnasos", "Comunitat", "Mercat", "Perfil"];
    for (const section of sections) {
      await browser.clickButton(section);
      await browser.evaluate("new Promise(resolve => setTimeout(resolve, 120))");
      for (const width of [360, 390, 430, 768, 1024, 1440]) {
        await browser.send("Emulation.setDeviceMetricsOverride", {
          width, height: width < 600 ? 900 : 1000, deviceScaleFactor: 1, mobile: width <= 900,
        });
        const layout = await browser.evaluate(`(() => {
          const viewport = document.documentElement.clientWidth;
          const whiteButtons = [...document.querySelectorAll('button')].filter(button => {
            const style = getComputedStyle(button);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const color = style.backgroundColor.match(/[\\d.]+/g)?.map(Number) || [];
            return color.length >= 3 && color[0] > 235 && color[1] > 235 && color[2] > 235 && color[3] !== 0;
          }).map(button => button.textContent.trim().slice(0, 40));
          return {
            viewport, documentWidth: document.documentElement.scrollWidth,
            sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
            mobileNav: getComputedStyle(document.querySelector('.mobile-nav')).display,
            whiteButtons,
            overflowNodes: [...document.querySelectorAll('body *')].map(node => ({
              node, rect: node.getBoundingClientRect(),
            })).filter(({ node, rect }) => rect.width > 0 && rect.right > viewport + 1)
              .slice(0, 8).map(({ node, rect }) => node.tagName + "." + String(node.className).slice(0, 40) + " right=" + Math.round(rect.right) + " text=" + node.textContent.trim().slice(0, 35)),
          };
        })()`);
        assert.ok(layout.documentWidth <= layout.viewport, `${section} horizontal overflow at ${width}px: ${JSON.stringify(layout)}`);
        assert.deepEqual(layout.whiteButtons, [], `${section} has unexpected white buttons at ${width}px`);
        if (width <= 900) {
          assert.equal(layout.sidebar, "none", `${section} sidebar visible at ${width}px`);
          assert.equal(layout.mobileNav, "grid", `${section} mobile navigation missing at ${width}px`);
        }
        visualAudit.push(`${section}:${width}`);
        if (process.env.TF_CAPTURE_VISUALS && [390, 1440].includes(width)) {
          const screenshot = await browser.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          fs.writeFileSync(path.join(temp, `${section}-${width}.png`), Buffer.from(screenshot.data, "base64"));
        }
      }
    }

    await browser.evaluate("document.querySelector('button[title=\"Tancar sessió\"]').click()");
    await browser.waitForText(".auth-card h1", "Torna al teu progrés", "logout");
    await browser.setValue('input[name="email"]', email);
    await browser.setValue('input[name="password"]', "e2e-secure-password-44");
    await browser.evaluate("document.querySelector('form.auth-card').requestSubmit()");
    await waitFor(async () => await browser.evaluate("Boolean(document.querySelector('.app-shell'))"), "authenticated app after re-login");
    await browser.clickButton("Inici");
    await browser.waitForText(".hero h1", "Auditoria TITANFIT", "login");
    await browser.evaluate("location.reload()");
    await browser.waitForText(".hero h1", "Auditoria TITANFIT", "login session survives reload");
    await browser.clickButton("Entrenar");
    await browser.waitForText(".saved-routine-card h3", "Rutina e2e editada", "routine is visible after a new login");
    await browser.clickButton("Progrés");
    await browser.waitForText(".history-list", "72.4 kg", "body weight is visible after a new login");

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      assert.ok(user, "registered account missing from SQLite");
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM routines WHERE user_id = ?").get(user.id).count, 4);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM training_sessions WHERE user_id = ?").get(user.id).count, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM workout_sets WHERE user_id = ? AND weight_kg = 60 AND repetitions = 8").get(user.id).count, 3);
      assert.equal(db.prepare("SELECT weight_kg FROM body_weights WHERE user_id = ?").get(user.id).weight_kg, 72.4);
      assert.equal(db.prepare("SELECT waist_cm FROM body_measurements WHERE user_id = ?").get(user.id).waist_cm, 82);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM nutrition_entries WHERE user_id = ?").get(user.id).count, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM marketplace_listings WHERE owner_user_id = ?").get(user.id).count, 1);
      const keys = new Set(db.prepare("SELECT data_key FROM user_data WHERE user_id = ?").all(user.id).map((row) => row.data_key));
      for (const prefix of ["tf_routines_", "tf_sessions_", "tf_weights_", "tf_measures_", "tf_food_", "tf_gym_favs_", "tf_challenges_"]) {
        assert.ok([...keys].some((key) => key.startsWith(prefix)), `Missing persisted user-data key ${prefix}`);
      }
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM friendships WHERE requester_user_id = ? OR addressee_user_id = ?").get(user.id, user.id).count, 2);
    } finally {
      db.close();
    }
    console.log(`TITANFIT browser integration passed: auth, routine CRUD/reload, workout sets, progress, nutrition, Smart Workout, marketplace, gyms, social, TITAN LEVEL; responsive overflow and light-button audit passed for ${visualAudit.length} section/viewport combinations.`);
    if (process.env.TF_CAPTURE_VISUALS) console.log(`Visual screenshots: ${temp}`);
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    await stopProcess(chrome);
    await stopProcess(server);
    if (!process.env.TF_CAPTURE_VISUALS) fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
