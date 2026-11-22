const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const root = path.resolve(__dirname, "..");
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(fs.existsSync);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, name, timeout = 12000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await wait(100); } throw new Error(`Timeout waiting for ${name}`); }
async function port() { const s = net.createServer(); s.listen(0, "127.0.0.1"); await once(s, "listening"); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
async function main() {
  assert.ok(chromePath, "Chrome/Chromium unavailable for demo browser check");
  assert.ok(fs.existsSync(path.join(root, "dist", "index.html")), "Build demo with VITE_DEMO_MODE=true first");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "titanfit-demo-")); const p = await port(); const apiRequests = []; const consoleErrors = [];
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const staticServer = http.createServer((req, res) => { const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); if (pathname.startsWith("/api")) apiRequests.push(pathname); let file = path.join(root, "dist", pathname.replace(/^\/TitanFit\/?/, "")); if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "dist", "index.html"); res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res); });
  staticServer.listen(p, "127.0.0.1");
  let chrome; let socket;
  try {
    const profile = path.join(temp, "chrome"); chrome = spawn(chromePath, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    const active = path.join(profile, "DevToolsActivePort"); await waitFor(() => fs.existsSync(active), "Chrome DevTools port"); const debugPort = Number(fs.readFileSync(active, "utf8").split(/\r?\n/)[0]); const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); const page = pages.find(t => t.type === "page");
    socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let nextId = 0; const pending = new Map(); socket.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") consoleErrors.push(m.params.exceptionDetails.text); if (m.method === "Log.entryAdded" && m.params.entry.level === "error") consoleErrors.push(m.params.entry.text); if (m.id && pending.has(m.id)) { const d = pending.get(m.id); pending.delete(m.id); m.error ? d.reject(new Error(m.error.message)) : d.resolve(m.result); } });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const click = async text => { assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}||x.textContent.includes(${JSON.stringify(text)}));if(!b)return false;b.click();return true})()`), true, `button not found: ${text}`); };
    const setValue = async (selector, value) => assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true, `field not found: ${selector}`);
    await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Page.enable"); await send("Page.navigate", { url: `http://127.0.0.1:${p}/TitanFit/` });
    await waitFor(() => evaluate("Boolean(document.querySelector('.hero h1'))"), "demo dashboard direct access");
    assert.match(await evaluate("document.body.innerText"), /DEMO · Les dades es guarden només en aquest navegador/);
    assert.equal(await evaluate("Boolean(document.querySelector('.auth-card'))"), false, "demo must bypass authentication");
    for (const section of ["Entrenar", "Progrés", "Nutrició", "Mercat", "Gimnasos", "Calendari", "Comunitat", "Perfil", "Inici"]) { await click(section); await wait(120); }
    await click("Entrenar"); await click("Crear una rutina"); await setValue(".routine-builder-page input", "Rutina demo e2e"); await click("+ Afegir exercicis");
    await click("Press de banca amb barra"); await click("Afegir 1 exercicis a la rutina"); await click("Guardar rutina");
    await waitFor(() => evaluate("JSON.parse(localStorage.getItem('tf_routines_demo-local')||'[]').some(r=>r.name==='Rutina demo e2e')"), "routine saved in localStorage");
    await click("Progrés"); await setValue(".progress-form input[type=number]", "73.8"); await click("Guardar pes");
    await waitFor(() => evaluate("JSON.parse(localStorage.getItem('tf_weights_demo-local')||'[]').some(w=>w.weight===73.8)"), "weight saved locally");
    await click("Nutrició"); await setValue('form input[name="name"]', "Iogurt demo"); await setValue('form input[name="cal"]', "90"); await setValue('form input[name="protein"]', "12"); await evaluate("document.querySelector('.nutrition-layout form').requestSubmit()");
    await waitFor(() => evaluate("JSON.parse(localStorage.getItem('tf_food_demo-local')||'[]').some(f=>f.name==='Iogurt demo')"), "food saved locally");
    await click("Perfil"); await evaluate("(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Nom visible')).querySelector('input');const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,'Alex Demo Editat');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('form.profile-card').requestSubmit()})()");
    await waitFor(() => evaluate("localStorage.getItem('tf_demo_account')?.includes('Alex Demo Editat')"), "profile saved locally");
    assert.equal(await evaluate("localStorage.getItem('tf_unrelated_sentinel')"), null);
    await send("Page.reload"); await waitFor(() => evaluate("Boolean(document.querySelector('.hero h1'))"), "reload demo");
    await click("Perfil"); await waitFor(() => evaluate("document.querySelector('.profile-card input')?.value==='Alex Demo Editat'"), "saved profile after reload");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('tf_routines_demo-local')||'[]').some(r=>r.name==='Rutina demo e2e')"), true, "routine survives reload");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('tf_weights_demo-local')||'[]').some(w=>w.weight===73.8)"), true, "weight survives reload");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('tf_food_demo-local')||'[]').some(f=>f.name==='Iogurt demo')"), true, "food survives reload");
    assert.deepEqual(apiRequests, [], "static demo must not request /api"); assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
    const dimensions = [360, 390, 430, 768, 1024, 1440];
    for (const width of dimensions) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const section of ["Inici", "Entrenar", "Progrés", "Nutrició", "Mercat", "Gimnasos", "Calendari", "Comunitat", "Perfil"]) {
        await click(section); await wait(80);
        const overflow = await evaluate("document.documentElement.scrollWidth>window.innerWidth+2");
        assert.equal(overflow, false, `horizontal overflow in ${section} at ${width}px`);
      }
    }
    console.log(`TITANFIT demo browser check passed: direct entry, all 9 sections at ${dimensions.join(", ")} px (54 layouts), profile persistence/reload, zero /api requests, no console errors or horizontal overflow.`);
  } finally { if (socket) socket.close(); if (chrome && chrome.exitCode === null) { chrome.kill(); await Promise.race([once(chrome, "exit"), wait(2500)]); } await new Promise(resolve => staticServer.close(resolve)); try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* Windows may retain a transient Chrome profile lock until process teardown. */ } }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
