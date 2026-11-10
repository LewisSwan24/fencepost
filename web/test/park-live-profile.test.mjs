// The name a signed-in user sees for themselves when the park runs against Supabase.
//
//   node --import ./test/setup.mjs --test test/park-live-profile.test.mjs
//
// Comments are printed under the name in public.profiles (wildlife-backend/006), never under
// the user_metadata a user writes for themselves. The header must show the same name, or
// someone who typed "Wildlife Moderator" at sign-up would see it there and believe that is
// what everyone else sees.
//
// api.js decides at load time whether it is connected, from config.js, so the config is
// filled in before api.js is imported.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { config } from "../public/wildlife/shared/config.js";

// storage.js dispatches change events on the jsdom window, which only takes its own Event.
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
config.supabaseUrl = "https://example.supabase.test";
config.supabaseAnonKey = "anon-key";
const api = await import("../public/wildlife/shared/api.js");

let profileRows;
let asked;
beforeEach(() => {
  asked = [];
  window.sessionStorage.clear();
  window.localStorage.clear();
  globalThis.fetch = async (url) => {
    const path = String(url).slice(config.supabaseUrl.length);
    asked.push(path);
    const body = path.startsWith("/auth/v1/token")
      ? { access_token: "t", user: { id: "user-1", email: "a@b.test", user_metadata: { display_name: "Wildlife Moderator" } } }
      : path.startsWith("/rest/v1/rpc/is_moderator")
        ? false
        : path.startsWith("/rest/v1/profiles")
          ? profileRows
          : null;
    return new Response(JSON.stringify(body), { status: 200 });
  };
});

test("the signed-in name comes from the profile, not from sign-up metadata", async () => {
  profileRows = [{ display_name: "Robin" }];
  const me = await api.login("a@b.test", "pw");
  assert.equal(me.displayName, "Robin");
  assert.ok(asked.some((p) => p.startsWith("/rest/v1/profiles?") && p.includes("id=eq.user-1")));
});

test("with no profile the user is shown as everyone else sees them", async () => {
  profileRows = [];
  const me = await api.login("a@b.test", "pw");
  assert.equal(me.displayName, "Community member");
});
