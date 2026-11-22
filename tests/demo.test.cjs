const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const root = path.resolve(__dirname, "..");
const chromePath = [process.env.CHROME_PATH, "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(fs.existsSync);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, name, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await wait(100); } throw new Error(`Timeout waiting for ${name}`); }
async function port() { const server = net.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }

async function main() {
  assert.ok(chromePath, "Chrome/Chromium unavailable for demo browser check");
  assert.ok(fs.existsSync(path.join(root, "dist", "index.html")), "Build demo with VITE_DEMO_MODE=true first");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "titanfit-demo-"));
  const portNumber = await port(); const apiRequests = []; const consoleErrors = [];
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
  const staticServer = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname.startsWith("/api")) apiRequests.push(pathname);
    let file = path.join(root, "dist", pathname.replace(/^\/TitanFit\/?/, ""));
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "dist", "index.html");
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream"); fs.createReadStream(file).pipe(res);
  });
  staticServer.listen(portNumber, "127.0.0.1");
  let chrome; let socket;
  try {
    const profile = path.join(temp, "chrome");
    chrome = spawn(chromePath, ["--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    const activeFile = path.join(profile, "DevToolsActivePort"); await waitFor(() => fs.existsSync(activeFile), "Chrome DevTools port");
    const debugPort = Number(fs.readFileSync(activeFile, "utf8").split(/\r?\n/)[0]);
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); const page = targets.find(target => target.type === "page");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    let nextId = 0; const pending = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text);
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") consoleErrors.push(message.params.entry.text);
      if (message.id && pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    const evaluate = async expression => { const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
    const click = async text => assert.equal(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)}||x.textContent.includes(${JSON.stringify(text)}));if(!b)return false;b.click();return true})()`), true, `button not found: ${text}`);
    const setValue = async (selector, value) => assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`), true, `field not found: ${selector}`);
    const submit = () => evaluate("document.querySelector('.auth-card').requestSubmit()");
    const logout = () => evaluate("document.querySelector('.topbar .icon-btn').click()");

    await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable"); await send("Page.enable");
    await send("Page.navigate", { url: `http://127.0.0.1:${portNumber}/TitanFit/` });
    await waitFor(() => evaluate("Boolean(document.querySelector('.auth-card'))"), "initial demo authentication screen");
    assert.match(await evaluate("document.body.innerText"), /DEMO · Les dades es guarden només en aquest navegador/);
    for (const width of [360, 390, 430]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
      assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth+2"), false, `authentication screen overflows at ${width}px`);
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate("window.confirm=()=>true");
    await evaluate("localStorage.setItem('tf_demo_seeded','1');localStorage.setItem('tf_routines_demo-local',JSON.stringify([{id:'demo-Torso · força',name:'fixture'},{id:'personal-legacy-routine',name:'Personal anterior'}]));localStorage.setItem('tf_demo_listings',JSON.stringify([{id:'demo-listing-1',name:'anunci fictici'},{id:'personal-legacy-ad',name:'Anunci propi'}]))");

    // Register first account, ensure duplicate email is rejected, then login again after logout.
    await click("Crear compte"); await setValue('input[name="name"]', "Alex Demo"); await setValue('input[name="email"]', "alex@example.test"); await setValue('input[name="password"]', "demo-password-100"); await submit();
    await waitFor(() => evaluate("Boolean(document.querySelector('.hero h1'))"), "first account registration");
    let accounts = await evaluate("JSON.parse(localStorage.getItem('tf_demo_accounts_v1'))");
    assert.equal(accounts.length, 1); assert.equal(accounts[0].password, undefined); assert.ok(accounts[0].salt && accounts[0].verifier && accounts[0].iterations >= 100000);
    assert.equal(JSON.stringify(accounts).includes("demo-password-100"), false, "clear password is never persisted");
    const firstId = accounts[0].id;
    const firstSalt = accounts[0].salt; const firstVerifier = accounts[0].verifier;
    assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('tf_routines_demo-local'))"), [{ id: "personal-legacy-routine", name: "Personal anterior" }], "legacy sample removed while personal legacy data is preserved");
    assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('tf_demo_listings'))"), [{ id: "personal-legacy-ad", name: "Anunci propi" }], "only known old sample marketplace item removed");
    const emptyState = await evaluate(`(()=>{const id=${JSON.stringify(firstId)};const value=k=>JSON.parse(localStorage.getItem('tf_'+k+'_'+id));return {routines:value('routines'),sessions:value('sessions'),weights:value('weights'),measures:value('measures'),food:value('food'),profile:value('profile'),calendar:value('calendar'),challenges:value('challenges'),completed:value('completed_challenges'),routineStarts:value('routine_starts'),shopping:value('shopping'),messages:value('messages'),friends:JSON.parse(localStorage.getItem('tf_demo_friends_'+id)),listings:JSON.parse(localStorage.getItem('tf_demo_listings_'+id))}})()`);
    assert.deepEqual(emptyState.routines, []); assert.deepEqual(emptyState.sessions, []); assert.deepEqual(emptyState.weights, []); assert.deepEqual(emptyState.measures, []); assert.deepEqual(emptyState.food, []);
    assert.deepEqual(emptyState.calendar, {}); assert.deepEqual(emptyState.challenges, []); assert.deepEqual(emptyState.completed, []); assert.equal(emptyState.routineStarts, 0);
    assert.deepEqual(emptyState.shopping, []); assert.deepEqual(emptyState.messages, []); assert.deepEqual(emptyState.friends, []); assert.deepEqual(emptyState.listings, []);
    assert.equal(emptyState.profile.age, ""); assert.equal(emptyState.profile.height, ""); assert.equal(emptyState.profile.weight, "");
    assert.match(await evaluate("document.body.innerText"), /0 entrenaments/);
    await click("Mercat"); assert.match(await evaluate("document.body.innerText"), /No hi ha anuncis/);
    await click("Entrenar"); await click("Biblioteca d'exercicis"); assert.ok(await evaluate("document.querySelectorAll('.exercise-card').length") > 0, "static exercise library remains available");
    await click("Les meves rutines");
    await logout(); await waitFor(() => evaluate("Boolean(document.querySelector('.auth-card'))"), "logout returns to login");
    await click("Crear compte"); await setValue('input[name="name"]', "Duplicate"); await setValue('input[name="email"]', "ALEX@example.test"); await setValue('input[name="password"]', "demo-password-101"); await submit();
    await waitFor(() => evaluate("document.querySelector('.toast')?.textContent.includes('Ja existeix')"), "duplicate email rejection");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('tf_demo_accounts_v1')).length"), 1);
    await click("Tornar a l'inici de sessió"); await setValue('input[name="email"]', "alex@example.test"); await setValue('input[name="password"]', "demo-password-100"); await submit();
    await waitFor(() => evaluate("Boolean(document.querySelector('.hero h1'))"), "login to existing account");

    // Exercise the main local write flows and visit every section.
    for (const section of ["Entrenar", "Progr\u00e9s", "Nutrici\u00f3", "Mercat", "Gimnasos", "Calendari", "Comunitat", "Perfil", "Inici"]) { await click(section); await wait(100); }
    await click("Entrenar"); await click("Crear una rutina"); await setValue(".routine-builder-page input", "Rutina primera compte"); await click("+ Afegir exercicis");
    await click("Press de banca amb barra"); await click("Afegir 1 exercicis a la rutina"); await click("Guardar rutina");
    await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('tf_routines_${firstId}')||'[]').some(r=>r.name==='Rutina primera compte')`), "account one routine save");
    await click("Començar");
    await setValue(".set-row input[type=number]", "60"); await click("Completar"); await click("Finalitzar entrenament");
    await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('tf_sessions_${firstId}')||'[]').length>0`), "workout saved locally");
    await click("Progr\u00e9s"); await setValue(".progress-form input[type=number]", "73.8"); await click("Guardar pes");
    await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('tf_weights_${firstId}')||'[]').some(w=>w.weight===73.8)`), "account one weight save");
    await click("Nutrici\u00f3"); await setValue('form input[name="name"]', "Iogurt primera compte"); await setValue('form input[name="cal"]', "90"); await setValue('form input[name="protein"]', "12"); await evaluate("document.querySelector('.nutrition-layout form').requestSubmit()");
    await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('tf_food_${firstId}')||'[]').some(f=>f.name==='Iogurt primera compte')`), "account one food save");
    await click("Mercat"); await click("+ Publicar producte");
    await setValue('.publish-form input[name="name"]', "Producte primera compte"); await setValue('.publish-form input[name="price"]', "42");
    await setValue('.publish-form input[name="location"]', "Barcelona"); await setValue('.publish-form textarea[name="description"]', "Material de prova en bon estat."); await evaluate("document.querySelector('.publish-form').requestSubmit()");
    await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('tf_demo_listings_${firstId}')||'[]').some(item=>item.name==='Producte primera compte')`), "marketplace ad saved locally");
    await click("Gimnasos"); assert.ok(await evaluate("document.querySelectorAll('.gym-card').length") > 0, "static gyms remain available");
    await evaluate(`(()=>{const id=${JSON.stringify(firstId)};const key=n=>'tf_'+n+'_'+id;const append=(k,v)=>localStorage.setItem(k,JSON.stringify([...JSON.parse(localStorage.getItem(k)||'[]'),v]));append(key('routines'),{id:'demo-Torso · força',name:'fake'});append(key('sessions'),{id:'demo-session-0',exercise:'fake',sets:[]});append(key('weights'),{id:'demo-weight-0',weight:74.1});append(key('measures'),{id:'demo-measure-0',waist:'82'});append(key('measures'),{id:'personal-measure-keep',waist:'90'});append(key('food'),{id:'demo-food-0',name:'fake'});append('tf_demo_listings_'+id,{id:'demo-listing-1',owner:id,name:'fake'});append('tf_demo_friends_'+id,{id:'demo-friend-1',name:'fake'});append('tf_demo_friends_'+id,{id:'personal-friend-keep',name:'Person'});localStorage.setItem(key('profile'),JSON.stringify({age:'24',height:'178',weight:'74.1',experience:'Intermedi',goal:'Guanyar força',days:'4',gym:'Titan Gym',personalNote:'keep'}));const d=new Date();const d2=new Date(d.getTime()+86400000);const date=x=>x.toISOString().slice(0,10);localStorage.setItem(key('calendar'),JSON.stringify({[date(d)]:'Torso',[date(d2)]:'Cames'}));localStorage.setItem(key('challenges'),JSON.stringify([{id:'3-week'},{id:'10-sessions'},{id:'personal-challenge'}]));localStorage.setItem(key('routine_starts'),'9');localStorage.setItem(key('shopping'),JSON.stringify(['Civada','Fruita','Pit de pollastre']));localStorage.setItem('tf_demo_seeded_'+id,'1');localStorage.removeItem('tf_demo_clean_v2_'+id)})()`);
    await click("Perfil");
    await evaluate("(()=>{const e=[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Nom visible')).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Alex Editat');e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('form.profile-card').requestSubmit()})()");
    await waitFor(() => evaluate("JSON.parse(localStorage.getItem('tf_demo_accounts_v1')).find(a=>a.id===localStorage.getItem('tf_demo_session_v1')).name==='Alex Editat'"), "updated display name persisted");
    await send("Page.reload"); await waitFor(() => evaluate("Boolean(document.querySelector('.hero h1'))"), "session after reload");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_routines_${firstId}')||'[]').some(r=>r.name==='Rutina primera compte')`), true, "routine survives reload");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_routines_${firstId}')||'[]').some(r=>r.id==='demo-Torso · força')`), false, "legacy fictitious routine removed");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_sessions_${firstId}')||'[]').some(s=>s.id==='demo-session-0')`), false, "legacy workout removed");
    assert.ok(await evaluate(`JSON.parse(localStorage.getItem('tf_sessions_${firstId}')||'[]').length`), "workout survives reload");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_weights_${firstId}')||'[]').some(w=>w.weight===73.8)`), true, "weight survives reload");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_weights_${firstId}')||'[]').some(w=>w.id==='demo-weight-0')`), false, "legacy weight removed");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_food_${firstId}')||'[]').some(f=>f.name==='Iogurt primera compte')`), true, "food survives reload");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_food_${firstId}')||'[]').some(f=>f.id==='demo-food-0')`), false, "legacy food removed");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_demo_listings_${firstId}')||'[]').some(item=>item.name==='Producte primera compte')`), true, "marketplace ad survives reload");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_demo_listings_${firstId}')||'[]').some(item=>item.id==='demo-listing-1')`), false, "legacy fake listing removed");
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('tf_demo_friends_${firstId}'))`), [{ id: "personal-friend-keep", name: "Person" }], "legacy fake friend removed and personal friend preserved");
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('tf_measures_${firstId}'))`), [{ id: "personal-measure-keep", waist: "90" }], "legacy measure removed and personal measure preserved");
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('tf_calendar_${firstId}'))`), {}, "legacy sample calendar removed");
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('tf_challenges_${firstId}'))`), [{ id: "personal-challenge" }], "legacy challenges removed while custom challenge preserved");
    assert.equal(await evaluate(`localStorage.getItem('tf_routine_starts_${firstId}')`), "1", "routine starts retain only user increment");
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('tf_shopping_${firstId}'))`), [], "legacy shopping sample removed");
    const cleanedProfile = await evaluate(`JSON.parse(localStorage.getItem('tf_profile_${firstId}'))`);
    assert.equal(cleanedProfile.age, ""); assert.equal(cleanedProfile.height, ""); assert.equal(cleanedProfile.weight, ""); assert.equal(cleanedProfile.personalNote, "keep");

    await logout(); await waitFor(() => evaluate("Boolean(document.querySelector('.auth-card'))"), "logout before second account");
    await click("Crear compte"); await setValue('input[name="name"]', "Bea Demo"); await setValue('input[name="email"]', "bea@example.test"); await setValue('input[name="password"]', "demo-password-200"); await submit();
    await waitFor(() => evaluate("Boolean(document.querySelector('.hero h1'))"), "second account registration");
    accounts = await evaluate("JSON.parse(localStorage.getItem('tf_demo_accounts_v1'))"); const secondId = accounts.find(account => account.email === "bea@example.test").id;
    assert.notEqual(firstId, secondId); assert.notEqual(firstId, "demo-local");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_routines_${secondId}')||'[]').some(r=>r.name==='Rutina primera compte')`), false, "second account does not see first account routine");
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('tf_demo_listings_${secondId}')||'null')`), [], "second account marketplace starts empty");
    await click("Nutrici\u00f3"); await setValue('form input[name="name"]', "Menjar segona compte"); await setValue('form input[name="cal"]', "80"); await setValue('form input[name="protein"]', "10"); await evaluate("document.querySelector('.nutrition-layout form').requestSubmit()");
    await waitFor(() => evaluate(`JSON.parse(localStorage.getItem('tf_food_${secondId}')||'[]').some(food=>food.name==='Menjar segona compte')`), "second account data saved");
    await send("Page.reload"); await waitFor(() => evaluate("document.querySelector('.hero h1')?.textContent.includes('Bea Demo')"), "second account session survives reload");
    await logout(); await waitFor(() => evaluate("Boolean(document.querySelector('.auth-card'))"), "login screen for first account");
    await setValue('input[name="email"]', "alex@example.test"); await setValue('input[name="password"]', "demo-password-100"); await submit();
    await waitFor(() => evaluate("document.querySelector('.hero h1')?.textContent.includes('Alex Editat')"), "login to first account after second account");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_routines_${firstId}')||'[]').some(r=>r.name==='Rutina primera compte')`), true);
    assert.equal(await evaluate(`localStorage.getItem('tf_demo_session_v1')`), firstId);

    // Reset only this account and ensure both account records and the other profile remain.
    await evaluate("localStorage.setItem('unrelated_browser_data','keep-me')");
    await evaluate("window.confirm=()=>true;document.querySelector('.notice button').click()"); await wait(80);
    await send("Page.reload"); await waitFor(() => evaluate("Boolean(document.querySelector('.hero h1'))"), "after current-account reset");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('tf_demo_accounts_v1')).length"), 2, "reset preserves all accounts");
    accounts = await evaluate("JSON.parse(localStorage.getItem('tf_demo_accounts_v1'))");
    assert.equal(accounts.find(account => account.id === firstId).salt, firstSalt, "reset preserves account salt");
    assert.equal(accounts.find(account => account.id === firstId).verifier, firstVerifier, "reset preserves password verifier");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_routines_${firstId}')||'[]').some(r=>r.name==='Rutina primera compte')`), false, "reset clears current account changes");
    const resetState = await evaluate(`(()=>{const id=${JSON.stringify(firstId)};const value=k=>JSON.parse(localStorage.getItem('tf_'+k+'_'+id));return {sessions:value('sessions'),weights:value('weights'),measures:value('measures'),food:value('food'),calendar:value('calendar'),challenges:value('challenges'),completed:value('completed_challenges'),routineStarts:value('routine_starts'),shopping:value('shopping'),messages:value('messages'),friends:JSON.parse(localStorage.getItem('tf_demo_friends_'+id)),listings:JSON.parse(localStorage.getItem('tf_demo_listings_'+id)),profile:value('profile')}})()`);
    assert.deepEqual(resetState.sessions, []); assert.deepEqual(resetState.weights, []); assert.deepEqual(resetState.measures, []); assert.deepEqual(resetState.food, []);
    assert.deepEqual(resetState.calendar, {}); assert.deepEqual(resetState.challenges, []); assert.deepEqual(resetState.completed, []); assert.equal(resetState.routineStarts, 0);
    assert.deepEqual(resetState.shopping, []); assert.deepEqual(resetState.messages, []); assert.deepEqual(resetState.friends, []); assert.deepEqual(resetState.listings, []);
    assert.equal(resetState.profile.age, ""); assert.equal(resetState.profile.height, ""); assert.equal(resetState.profile.weight, "");
    assert.equal(await evaluate("localStorage.getItem('tf_demo_session_v1')"), firstId, "reset keeps the current session active");
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('tf_food_${secondId}')||'[]').some(food=>food.name==='Menjar segona compte')`), true, "reset preserves the other account data");
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('tf_demo_listings_${firstId}')||'null')`), [], "reset leaves current account marketplace empty");
    assert.equal(await evaluate("localStorage.getItem('unrelated_browser_data')"), "keep-me", "reset preserves unrelated browser storage");

    assert.deepEqual(apiRequests, [], "demo must not make any /api requests");
    const dimensions = [360, 390, 430, 768, 1024, 1440];
    for (const width of dimensions) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      for (const section of ["Inici", "Entrenar", "Progr\u00e9s", "Nutrici\u00f3", "Mercat", "Gimnasos", "Calendari", "Comunitat", "Perfil"]) {
        await click(section); await wait(60);
        assert.equal(await evaluate("document.documentElement.scrollWidth>window.innerWidth+2"), false, `horizontal overflow in ${section} at ${width}px`);
      }
    }
    assert.deepEqual(consoleErrors, [], `browser console errors: ${consoleErrors.join(" | ")}`);
    console.log(`Demo browser integration passed: empty new account, legacy sample cleanup, registration/login/logout, PBKDF2 verifier, duplicate email rejection, two-account isolation, routine/workout/weight/food/ad persistence, reset scope, static exercise library and gyms, all sections, zero /api requests, no console errors, 57 responsive layouts.`);
  } finally {
    if (socket) socket.close();
    if (chrome && chrome.exitCode === null) { chrome.kill(); await Promise.race([once(chrome, "exit"), wait(2500)]); }
    await new Promise(resolve => staticServer.close(resolve));
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* A transient Chrome profile lock may remain on Windows. */ }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
