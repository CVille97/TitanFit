export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const ACCOUNTS_KEY = "tf_demo_accounts_v1";
const SESSION_KEY = "tf_demo_session_v1";
const PBKDF2_ITERATIONS = 310_000;
const PROFILE_DEFAULTS = { age: "", height: "", weight: "", experience: "Principiant", goal: "Millorar la forma", days: "3", gym: "" };
const EMPTY_USER_DATA = (id: string): Record<string, unknown> => ({
  [`tf_routines_${id}`]: [], [`tf_sessions_${id}`]: [], [`tf_weights_${id}`]: [], [`tf_measures_${id}`]: [],
  [`tf_food_${id}`]: [], [`tf_profile_${id}`]: { ...PROFILE_DEFAULTS }, [`tf_calendar_${id}`]: {},
  [`tf_challenges_${id}`]: [], [`tf_completed_challenges_${id}`]: [], [`tf_routine_starts_${id}`]: 0,
  [`tf_recipe_favorites_${id}`]: [], [`tf_shopping_${id}`]: [], [`tf_fav_${id}`]: [], [`tf_messages_${id}`]: [],
  [`tf_gym_favs_${id}`]: [], [`tf_demo_listings_${id}`]: [], [`tf_demo_friends_${id}`]: [],
});

export type DemoAccount = { id: string; name: string; email: string };
type StoredAccount = DemoAccount & { salt: string; verifier: string; iterations: number };

function accounts(): StoredAccount[] {
  try { const value = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt.slice().buffer as ArrayBuffer, iterations }, key, 256));
}

export async function registerDemoAccount(name: string, email: string, password: string): Promise<DemoAccount> {
  if (!DEMO_MODE) throw new Error("El registre local només està disponible en mode demo.");
  const cleanName = name.trim(); const cleanEmail = email.trim().toLowerCase();
  if (cleanName.length < 2) throw new Error("Escriu un nom d'almenys dos caràcters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error("Introdueix un correu electrònic vàlid.");
  if (password.length < 8 || password.length > 256) throw new Error("La contrasenya ha de tenir entre 8 i 256 caràcters.");
  const existing = accounts();
  if (existing.some(account => account.email === cleanEmail)) throw new Error("Ja existeix un compte demo amb aquest correu en aquest navegador.");
  const salt = crypto.getRandomValues(new Uint8Array(16)); const verifier = await derive(password, salt, PBKDF2_ITERATIONS);
  const account: StoredAccount = { id: crypto.randomUUID(), name: cleanName, email: cleanEmail, salt: encode(salt), verifier: encode(verifier), iterations: PBKDF2_ITERATIONS };
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([...existing, account]));
  return { id: account.id, name: account.name, email: account.email };
}

export async function loginDemoAccount(email: string, password: string): Promise<DemoAccount> {
  const account = accounts().find(item => item.email === email.trim().toLowerCase());
  if (!account) throw new Error("No s'ha trobat cap compte demo amb aquest correu.");
  const candidate = encode(await derive(password, decode(account.salt), account.iterations));
  if (candidate !== account.verifier) throw new Error("La contrasenya no és correcta.");
  return { id: account.id, name: account.name, email: account.email };
}

export function saveDemoSession(account: DemoAccount) { localStorage.setItem(SESSION_KEY, account.id); }
export function clearDemoSession() { localStorage.removeItem(SESSION_KEY); }
export function updateDemoAccountName(id: string, name: string) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts().map(account => account.id === id ? { ...account, name: name.trim() } : account)));
  const listingsKey = `tf_demo_listings_${id}`;
  try { const listings = JSON.parse(localStorage.getItem(listingsKey) || "[]"); if (Array.isArray(listings)) localStorage.setItem(listingsKey, JSON.stringify(listings.map(item => item?.owner === id ? { ...item, seller: name.trim() } : item))); }
  catch { /* Keep malformed user listings untouched. */ }
}

function getJson(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
function setJson(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); }
const LEGACY_SAMPLE_SUFFIX = /^(?:(?:session|workout|weight|measure|food|listing|friend)-\d+|Torso · força|Cames · volum)$/i;
function isLegacySampleId(value: unknown, accountId: string) {
  if (typeof value !== "string") return false;
  const accountPrefix = `demo-${accountId}-`;
  if (value.startsWith(accountPrefix) && LEGACY_SAMPLE_SUFFIX.test(value.slice(accountPrefix.length))) return true;
  // Older fixed demo builds used the same fixture suffix without an account ID.
  return accountId === "demo-local" && value.startsWith("demo-") && LEGACY_SAMPLE_SUFFIX.test(value.slice("demo-".length));
}

/** Removes only the known IDs and exact initial values produced by the previous sample-data seeder. */
function removeLegacySamples(accountId: string) {
  const prefixes = ["routines", "sessions", "weights", "measures", "food", "demo_listings", "demo_friends"];
  for (const prefix of prefixes) {
    const key = prefix.startsWith("demo_") ? `tf_${prefix}_${accountId}` : `tf_${prefix}_${accountId}`;
    const value = getJson(key);
    if (!Array.isArray(value)) continue;
    const kept = value.filter(row => {
      if (!row || typeof row !== "object") return true;
      const record = row as { id?: unknown; workoutId?: unknown };
      return !isLegacySampleId(record.id, accountId) && !isLegacySampleId(record.workoutId, accountId);
    });
    if (kept.length !== value.length) setJson(key, kept);
  }

  const profileKey = `tf_profile_${accountId}`; const profile = getJson(profileKey);
  const legacyProfile = { age: "24", height: "178", weight: "74.1", experience: "Intermedi", goal: "Guanyar força", days: "4", gym: "Titan Gym" };
  if (profile && typeof profile === "object" && !Array.isArray(profile)) {
    const kept = { ...(profile as Record<string, unknown>) };
    for (const [field, seeded] of Object.entries(legacyProfile)) if (kept[field] === seeded) delete kept[field];
    setJson(profileKey, { ...PROFILE_DEFAULTS, ...kept });
  }

  const calendarKey = `tf_calendar_${accountId}`; const calendar = getJson(calendarKey);
  if (calendar && typeof calendar === "object" && !Array.isArray(calendar)) {
    const entries = Object.entries(calendar as Record<string, unknown>);
    const dated = entries.map(([date, value]) => ({ time: Date.parse(`${date}T00:00:00Z`), value }));
    const isOldSeed = entries.length === 2 && dated.every(entry => Number.isFinite(entry.time)) &&
      new Set(dated.map(entry => entry.value)).size === 2 && dated.some(entry => entry.value === "Torso") && dated.some(entry => entry.value === "Cames") && Math.abs(dated[0].time - dated[1].time) === 86400000;
    if (isOldSeed) setJson(calendarKey, {});
  }

  const challengesKey = `tf_challenges_${accountId}`; const challenges = getJson(challengesKey);
  if (Array.isArray(challenges)) {
    const kept = [...challenges];
    for (const seededId of ["3-week", "10-sessions"]) { const index = kept.findIndex(item => item?.id === seededId); if (index >= 0) kept.splice(index, 1); }
    setJson(challengesKey, kept);
  }
  const startsKey = `tf_routine_starts_${accountId}`; const starts = getJson(startsKey);
  if (starts === 8) setJson(startsKey, 0); else if (typeof starts === "number" && starts > 8) setJson(startsKey, starts - 8);
  const shoppingKey = `tf_shopping_${accountId}`; const shopping = getJson(shoppingKey);
  if (Array.isArray(shopping)) {
    const kept = [...shopping];
    for (const seededItem of ["Civada", "Fruita", "Pit de pollastre"]) { const index = kept.indexOf(seededItem); if (index >= 0) kept.splice(index, 1); }
    setJson(shoppingKey, kept);
  }
}

function migrateLegacyDemoData(accountId: string) {
  const marker = `tf_demo_clean_v3_${accountId}`;
  if (localStorage.getItem(marker) === "1") return;
  const hasOldSeedMarker = localStorage.getItem(`tf_demo_seeded_${accountId}`) === "1";
  const hasPreviousCleanupMarker = localStorage.getItem(`tf_demo_clean_v2_${accountId}`) === "1";
  const hasOldFixedDemoMarker = accountId === "demo-local" && localStorage.getItem("tf_demo_seeded") === "1";
  if (hasOldSeedMarker || hasPreviousCleanupMarker || hasOldFixedDemoMarker) removeLegacySamples(accountId);
  localStorage.setItem(marker, "1");
}

function cleanOldSharedMarketplace() {
  const marker = "tf_demo_clean_shared_market_v1";
  if (localStorage.getItem(marker) === "1") return;
  const key = "tf_demo_listings"; const listings = getJson(key);
  if (Array.isArray(listings)) {
    const clean = listings.filter(item => !(typeof item?.id === "string" && /^demo-listing-\d+$/i.test(item.id)));
    if (clean.length !== listings.length) setJson(key, clean);
  }
  localStorage.setItem(marker, "1");
}

/** New accounts get neutral, empty records; existing values are never overwritten. */
export function initializeDemoAccount(account: DemoAccount) {
  if (!DEMO_MODE) return;
  migrateLegacyDemoData(account.id);
  migrateLegacyDemoData("demo-local");
  cleanOldSharedMarketplace();
  for (const [key, value] of Object.entries(EMPTY_USER_DATA(account.id))) if (localStorage.getItem(key) === null) setJson(key, value);
  localStorage.setItem(`tf_demo_seeded_${account.id}`, "empty-v2");
}

/** Clears the selected account's personal data but keeps its credentials/session and all other accounts. */
export function resetDemoAccountData(account: DemoAccount) {
  for (const key of Object.keys(EMPTY_USER_DATA(account.id))) localStorage.removeItem(key);
  localStorage.removeItem(`tf_demo_seeded_${account.id}`);
  initializeDemoAccount(account);
}

export function demoFriends(key: string) { try { return JSON.parse(localStorage.getItem(key) || "[]") as {id:string;name:string;status:"Amics"|"Pendent";direction:"incoming"|"outgoing"}[]; } catch { return []; } }
export function saveDemoFriends(key: string, items: unknown) { localStorage.setItem(key, JSON.stringify(items)); }
