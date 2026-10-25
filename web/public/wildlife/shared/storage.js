// One local persistence service for the exhibition. Never put passwords here.
export const storageKeys = {
  data: "wn-demo-v2",
  session: "wn-demo-session",
  legacyRegistrations: "wn-registrations",
  legacyReceipts: "wn-receipts",
};
export function readLocal(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    throw Error(
      "Browser storage is unavailable. Enable storage to use this demonstration.",
    );
  }
}
export function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw Error(
      "Browser storage is unavailable or full. Your changes were not saved.",
    );
  }
}
export function removeLocal(key) {
  localStorage.removeItem(key);
}
export function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem("wn-auth"));
  } catch {
    return null;
  }
}
export function writeSession(value) {
  if (value) sessionStorage.setItem("wn-auth", JSON.stringify(value));
  else sessionStorage.removeItem("wn-auth");
}
export function notify(name = "wn-data") {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(name));
}
export function readDemo(initial, migrate) {
  const stored = readLocal(storageKeys.data);
  if (!stored) return initial();
  const changed = migrate(stored);
  if (changed) writeLocal(storageKeys.data, stored);
  return stored;
}
export function saveDemo(state) {
  writeLocal(storageKeys.data, state);
  notify();
}
