import { demoAccounts } from "./demo-accounts.js";
import {
  readLocal,
  writeLocal,
  removeLocal,
  storageKeys,
  notify,
} from "./storage.js";
const safe = (account) => ({
  id: account.id,
  displayName: account.displayName,
  email: account.email,
  role: account.role,
});
export function currentUser() {
  let stored;
  try {
    stored = readLocal(storageKeys.session);
  } catch {
    return null;
  }
  if (!stored) return null;
  const account = demoAccounts.find((a) => a.id === stored.id);
  if (
    !account ||
    stored.role !== account.role ||
    stored.email !== account.email ||
    stored.displayName !== account.displayName
  )
    return null;
  return safe(account);
}
export function signIn(email, password) {
  const account = demoAccounts.find(
    (a) =>
      a.email === String(email).trim().toLowerCase() && a.password === password,
  );
  if (!account)
    throw Error(
      "The email or password is incorrect. Try the demonstration accounts below.",
    );
  const user = safe(account);
  writeLocal(storageKeys.session, user);
  notify("wn-auth-change");
  return user;
}
export function signOut() {
  removeLocal(storageKeys.session);
  notify("wn-auth-change");
}
export function requireUser() {
  const user = currentUser();
  if (!user) throw Error("Sign in to continue.");
  return user;
}
export function requireRole(role) {
  const user = requireUser();
  if (user.role !== role) throw Error("Moderator access is required.");
  return user;
}
