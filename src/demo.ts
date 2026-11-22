import { exercises } from "./data";

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
export const DEMO_ACCOUNT = { id: "demo-local", name: "Alex Demo", email: "demo@titanfit.local" };
const seededKeys = ["tf_routines_demo-local", "tf_sessions_demo-local", "tf_weights_demo-local", "tf_measures_demo-local", "tf_food_demo-local", "tf_profile_demo-local", "tf_calendar_demo-local", "tf_challenges_demo-local", "tf_completed_challenges_demo-local", "tf_routine_starts_demo-local", "tf_recipe_favorites_demo-local", "tf_shopping_demo-local", "tf_fav_demo-local", "tf_messages_demo-local", "tf_gym_favs_demo-local", "tf_demo_listings", "tf_demo_friends_demo-local", "tf_demo_account", "tf_demo_seeded"];
const id = (name: string) => `demo-${name}`;
export function initializeDemo(reset = false) {
  if (!DEMO_MODE) return;
  if (reset) seededKeys.forEach(key => localStorage.removeItem(key));
  if (localStorage.getItem("tf_demo_seeded") === "1") return;
  const exercise = (index: number, kg: number) => ({ exercise: exercises[index % exercises.length].name, exerciseName: exercises[index % exercises.length].name, sets: 3, reps: 10, targetReps: 10, kg, targetWeight: kg, rest: 90, restSeconds: 90 });
  const routine = (name: string, indices: number[], kg: number) => ({ id: id(name), userId: DEMO_ACCOUNT.id, name, description: "Pla de força i tècnica", days: ["Dl", "Dj"], trainingDays: ["Dl", "Dj"], createdAt: new Date().toISOString(), items: indices.map((n, i) => exercise(n, kg + i * 5)) });
  const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const sessions = [0, 2, 4, 7, 9, 12].map((days, i) => ({ id: id(`session-${i}`), workoutId: id(`workout-${i}`), exercise: exercises[i % exercises.length].name, date: past(days), duration: 45 + i, sets: [{ kg: 35 + i * 2, reps: 10, done: true }, { kg: 40 + i * 2, reps: 8, done: true }, { kg: 42 + i * 2, reps: 8, done: true }] }));
  const values: Record<string, unknown> = {
    "tf_routines_demo-local": [routine("Torso · força", [0, 2, 4], 35), routine("Cames · volum", [5, 7, 9], 45)],
    "tf_sessions_demo-local": sessions,
    "tf_weights_demo-local": [75.8, 75.2, 74.9, 74.4, 74.1].map((weight, i) => ({ id: id(`weight-${i}`), date: past((4 - i) * 7), weight })),
    "tf_measures_demo-local": [{ id: id("measure-1"), date: past(14), waist: "82", chest: "98", arm: "34", thigh: "56", calves: "37" }, { id: id("measure-2"), date: past(2), waist: "80", chest: "99", arm: "35", thigh: "57", calves: "37" }],
    "tf_food_demo-local": [{ id: id("food-1"), date: new Date().toISOString().slice(0, 10), name: "Civada i iogurt", grams: 100, cal: 145, protein: 8, carbs: 19, fat: 4 }, { id: id("food-2"), date: new Date().toISOString().slice(0, 10), name: "Pit de pollastre", grams: 180, cal: 165, protein: 31, carbs: 0, fat: 4 }],
    "tf_profile_demo-local": { age: "24", height: "178", weight: "74.1", experience: "Intermedi", goal: "Guanyar força", days: "4", gym: "Titan Gym" },
    "tf_calendar_demo-local": { [new Date().toISOString().slice(0, 10)]: "Torso", [new Date(Date.now() + 86400000).toISOString().slice(0, 10)]: "Cames" }, "tf_challenges_demo-local": [{ id: "3-week" }, { id: "10-sessions" }], "tf_completed_challenges_demo-local": [], "tf_routine_starts_demo-local": 8,
    "tf_recipe_favorites_demo-local": [], "tf_shopping_demo-local": ["Civada", "Fruita", "Pit de pollastre"], "tf_fav_demo-local": [], "tf_messages_demo-local": [], "tf_gym_favs_demo-local": [],
    "tf_demo_listings": [{ id: id("listing-1"), owner: DEMO_ACCOUNT.id, seller: DEMO_ACCOUNT.name, name: "Mancuernas ajustables", price: 65, category: "Equipament", state: "Usat", status: "Disponible", location: "Barcelona", description: "Parell en bon estat, ideal per entrenar a casa.", brand: "Titan", delivery: "Recollida" }, { id: id("listing-2"), owner: "demo-other", seller: "Marta R.", name: "Cinturó de halterofília", price: 28, category: "Accessoris", state: "Nou", status: "Disponible", location: "Sant Boi", description: "Cinturó de suport lumbar, talla M." }],
    "tf_demo_friends_demo-local": [{ id: "friend-1", name: "Júlia Demo", status: "Amics", direction: "incoming" }, { id: "friend-2", name: "Marc Demo", status: "Pendent", direction: "incoming" }],
  };
  Object.entries(values).forEach(([key, value]) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value)); });
  localStorage.setItem("tf_demo_seeded", "1");
}

export function demoFriends(key: string) { try { return JSON.parse(localStorage.getItem(key) || "[]") as {id:string;name:string;status:"Amics"|"Pendent";direction:"incoming"|"outgoing"}[]; } catch { return []; } }
export function saveDemoFriends(key: string, items: unknown) { localStorage.setItem(key, JSON.stringify(items)); }
