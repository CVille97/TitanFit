type AccountIdentity = { id: string };
type WriteResponse = { ok: boolean };

let activeUserId: string | null = null;
const pendingWrites = new Map<string, Promise<unknown>>();

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `Error del servidor (${response.status}).`);
  return body as T;
}

function isOwnedDataKey(key: string, userId: string): boolean {
  return key.startsWith("tf_") && key.endsWith(`_${userId}`) &&
    !key.startsWith("tf_migration_backup_") && key !== "tf_token";
}

function parseLocalListings(userId: string): unknown[] {
  try {
    const value = JSON.parse(localStorage.getItem("tf_listings") || "[]");
    return Array.isArray(value) ? value.filter((item) => item && item.owner === userId) : [];
  } catch {
    return [];
  }
}

export async function activateCloudAccount(account: AccountIdentity): Promise<void> {
  activeUserId = null;
  const localEntries: Record<string, unknown> = {};
  const localListingsToImport = parseLocalListings(account.id);
  const listingsBackupKey = `tf_migration_backup_${account.id}_tf_listings`;
  const localListingsRaw = localStorage.getItem("tf_listings");
  if (localListingsRaw !== null && localStorage.getItem(listingsBackupKey) === null) {
    localStorage.setItem(listingsBackupKey, localListingsRaw);
  }
  const localKeys = Object.keys(localStorage).filter((key) => isOwnedDataKey(key, account.id));
  for (const key of localKeys) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    const backupKey = `tf_migration_backup_${account.id}_${key}`;
    if (localStorage.getItem(backupKey) === null) localStorage.setItem(backupKey, raw);
    try {
      localEntries[key] = JSON.parse(raw);
    } catch {
      // Keep malformed local content in the backup; it cannot be imported as JSON.
    }
  }

  await requestJson("/api/data/import", {
    method: "POST",
    body: JSON.stringify({ entries: localEntries, listings: localListingsToImport }),
  });
  const [cloudData, cloudListings] = await Promise.all([
    requestJson<{ data: Record<string, unknown> }>("/api/data"),
    requestJson<{ listings: unknown[] }>("/api/listings"),
  ]);
  const missingKeys = Object.keys(localEntries).filter((key) => !Object.prototype.hasOwnProperty.call(cloudData.data, key));
  if (missingKeys.length) throw new Error("No s'han pogut verificar totes les dades locals migrades.");
  const listingIds = new Set(cloudListings.listings.map((item) => item && typeof item === "object" && "id" in item ? String(item.id) : ""));
  if (localListingsToImport.some((item) => item && typeof item === "object" && "id" in item && !listingIds.has(String(item.id)))) {
    throw new Error("No s'han pogut verificar tots els anuncis locals migrats.");
  }
  for (const [key, value] of Object.entries(cloudData.data)) {
    if (!isOwnedDataKey(key, account.id)) continue;
    localStorage.setItem(key, JSON.stringify(value));
  }
  localStorage.setItem("tf_listings", JSON.stringify(cloudListings.listings));
  localStorage.removeItem("tf_token");
  activeUserId = account.id;
}

export function deactivateCloudAccount(): void {
  activeUserId = null;
  localStorage.removeItem("tf_token");
}

function scheduleWrite(key: string, value: unknown): void {
  if (!activeUserId) return;
  let url: string;
  let body: string;
  if (key === "tf_listings") {
    url = "/api/listings";
    body = JSON.stringify({ items: value });
  } else {
    if (!isOwnedDataKey(key, activeUserId)) return;
    url = `/api/data/${encodeURIComponent(key)}`;
    body = JSON.stringify({ value });
  }
  const previous = pendingWrites.get(key) || Promise.resolve();
  const write = previous.catch(() => undefined).then(() =>
    requestJson<WriteResponse>(url, { method: "PUT", body }),
  );
  pendingWrites.set(key, write);
  void write.then(
    () => {
      if (pendingWrites.get(key) === write) pendingWrites.delete(key);
    },
    (error: unknown) => {
      if (pendingWrites.get(key) === write) pendingWrites.delete(key);
      window.dispatchEvent(new CustomEvent("titanfit:sync-error", {
        detail: error instanceof Error ? error.message : "No s'ha pogut sincronitzar amb el servidor.",
      }));
    },
  );
}

export function write<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return false;
  }
  if (key === "tf_listings" || (activeUserId && isOwnedDataKey(key, activeUserId))) {
    scheduleWrite(key, value);
  }
  return true;
}

export async function confirmCloudWrite(key: string): Promise<void> {
  if (!activeUserId) throw new Error("No hi ha una sessió remota activa.");
  const pending = pendingWrites.get(key);
  if (pending) await pending;
}

export async function confirmPendingCloudWrites(): Promise<void> {
  await Promise.all([...pendingWrites.values()]);
}

export function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T ?? fallback;
  } catch {
    return fallback;
  }
}
