import { exercises } from "./data";

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const ACCOUNTS_KEY = "tf_demo_accounts_v1";
const SESSION_KEY = "tf_demo_session_v1";
const PBKDF2_ITERATIONS = 310_000;

export type DemoAccount = { id: string; name: string; email: string };
type StoredAccount = DemoAccount & { salt: string; verifier: string; iterations: number };

function accounts(): StoredAccount[] {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt.slice().buffer as ArrayBuffer, iterations }, key, 256));
}

export async function registerDemoAccount(name: string, email: string, password: string): Promise<DemoAccount> {
  if (!DEMO_MODE) throw new Error("El registre local només està disponible en mode demo.");
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (cleanName.length < 2) throw new Error("Escriu un nom d'almenys dos caràcters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new Error("Introdueix un correu electrònic vàlid.");
  if (password.length < 8 || password.length > 256) throw new Error("La contrasenya ha de tenir entre 8 i 256 caràcters.");
  const existing = accounts();
  if (existing.some(account => account.email === cleanEmail)) throw new Error("Ja existeix un compte demo amb aquest correu en aquest navegador.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await derive(password, salt, PBKDF2_ITERATIONS);
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

export function findDemoSession(): DemoAccount | null {
  const id = localStorage.getItem(SESSION_KEY);
  if (!id) return null;
  const account = accounts().find(item => item.id === id);
  return account ? { id: account.id, name: account.name, email: account.email } : null;
}
export function saveDemoSession(account: DemoAccount) { localStorage.setItem(SESSION_KEY, account.id); }
export function clearDemoSession() { localStorage.removeItem(SESSION_KEY); }
export function updateDemoAccountName(id: string, name: string) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts().map(account => account.id === id ? { ...account, name: name.trim() } : account)));
  const listingsKey = `tf_demo_listings_${id}`;
  try {
    const listings = JSON.parse(localStorage.getItem(listingsKey) || "[]");
    if (Array.isArray(listings)) localStorage.setItem(listingsKey, JSON.stringify(listings.map(item => item?.owner === id ? { ...item, seller: name.trim() } : item)));
  } catch { /* Keep malformed local listings untouched. */ }
}

function userKeys(id: string) {
  return ["routines", "sessions", "weights", "measures", "food", "profile", "calendar", "challenges", "completed_challenges", "routine_starts", "recipe_favorites", "shopping", "fav", "messages", "gym_favs"].map(key => `tf_${key}_${id}`)
    .concat([`tf_demo_listings_${id}`, `tf_demo_friends_${id}`, `tf_demo_seeded_${id}`]);
}

/** Seeds only newly created accounts and never replaces a user's existing values. */
export function initializeDemoAccount(account: DemoAccount) {
  if (!DEMO_MODE) return;
  const seedKey = `tf_demo_seeded_${account.id}`;
  if (localStorage.getItem(seedKey) === "1") return;
  const id = (name: string) => `demo-${account.id}-${name}`;
  const exercise = (index: number, kg: number) => ({ exercise: exercises[index % exercises.length].name, exerciseName: exercises[index % exercises.length].name, sets: 3, reps: 10, targetReps: 10, kg, targetWeight: kg, rest: 90, restSeconds: 90 });
  const routine = (name: string, indices: number[], kg: number) => ({ id: id(name), userId: account.id, name, description: "Pla de força i tècnica", days: ["Dl", "Dj"], trainingDays: ["Dl", "Dj"], createdAt: new Date().toISOString(), items: indices.map((n, i) => exercise(n, kg + i * 5)) });
  const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const sessions = [0, 2, 4, 7, 9, 12].map((days, i) => ({ id: id(`session-${i}`), workoutId: id(`workout-${i}`), exercise: exercises[i % exercises.length].name, date: past(days), duration: 45 + i, sets: [{ kg: 35 + i * 2, reps: 10, done: true }, { kg: 40 + i * 2, reps: 8, done: true }, { kg: 42 + i * 2, reps: 8, done: true }] }));
  const values: Record<string, unknown> = {
    [`tf_routines_${account.id}`]: [routine("Torso · força", [0, 2, 4], 35), routine("Cames · volum", [5, 7, 9], 45)],
    [`tf_sessions_${account.id}`]: sessions,
    [`tf_weights_${account.id}`]: [75.8, 75.2, 74.9, 74.4, 74.1].map((weight, i) => ({ id: id(`weight-${i}`), date: past((4 - i) * 7), weight })),
    [`tf_measures_${account.id}`]: [{ id: id("measure-1"), date: past(14), waist: "82", chest: "98", arm: "34", thigh: "56", calves: "37" }, { id: id("measure-2"), date: past(2), waist: "80", chest: "99", arm: "35", thigh: "57", calves: "37" }],
    [`tf_food_${account.id}`]: [{ id: id("food-1"), date: new Date().toISOString().slice(0, 10), name: "Civada i iogurt", grams: 100, cal: 145, protein: 8, carbs: 19, fat: 4 }, { id: id("food-2"), date: new Date().toISOString().slice(0, 10), name: "Pit de pollastre", grams: 180, cal: 165, protein: 31, carbs: 0, fat: 4 }],
    [`tf_profile_${account.id}`]: { age: "24", height: "178", weight: "74.1", experience: "Intermedi", goal: "Guanyar força", days: "4", gym: "Titan Gym" },
    [`tf_calendar_${account.id}`]: { [new Date().toISOString().slice(0, 10)]: "Torso", [new Date(Date.now() + 86400000).toISOString().slice(0, 10)]: "Cames" },
    [`tf_challenges_${account.id}`]: [{ id: "3-week" }, { id: "10-sessions" }], [`tf_completed_challenges_${account.id}`]: [], [`tf_routine_starts_${account.id}`]: 8,
    [`tf_recipe_favorites_${account.id}`]: [], [`tf_shopping_${account.id}`]: ["Civada", "Fruita", "Pit de pollastre"], [`tf_fav_${account.id}`]: [], [`tf_messages_${account.id}`]: [], [`tf_gym_favs_${account.id}`]: [],
    [`tf_demo_listings_${account.id}`]: [{ id: id("listing-1"), owner: account.id, seller: account.name, name: "Mancuernas ajustables", price: 65, category: "Equipament", state: "Usat", status: "Disponible", location: "Barcelona", description: "Parell en bon estat, ideal per entrenar a casa.", brand: "Titan", delivery: "Recollida" }, { id: id("listing-2"), owner: id("sample-seller"), seller: "Marta R.", name: "Cinturó de halterofília", price: 28, category: "Accessoris", state: "Nou", status: "Disponible", location: "Sant Boi", description: "Cinturó de suport lumbar, talla M." }],
    [`tf_demo_friends_${account.id}`]: [{ id: id("friend-1"), name: "Júlia Demo", status: "Amics", direction: "incoming" }, { id: id("friend-2"), name: "Marc Demo", status: "Pendent", direction: "incoming" }],
  };
  Object.entries(values).forEach(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value)); });
  localStorage.setItem(seedKey, "1");
}

/** Resets the current profile's demo data while preserving all local accounts. */
export function resetDemoAccountData(account: DemoAccount) {
  userKeys(account.id).forEach(key => localStorage.removeItem(key));
  initializeDemoAccount(account);
}

export function demoFriends(key: string) { try { return JSON.parse(localStorage.getItem(key) || "[]") as {id:string;name:string;status:"Amics"|"Pendent";direction:"incoming"|"outgoing"}[]; } catch { return []; } }
export function saveDemoFriends(key: string, items: unknown) { localStorage.setItem(key, JSON.stringify(items)); }
