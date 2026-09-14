// node --test lib/api.test.mjs
//
// What this pins down is **a visitor's identity**.
//
// Every visitor used to share one handle, which made `author_id` equal between them:
// visitor A could edit and delete what visitor B wrote. The owner layer stopped that;
// nothing stood between two visitors.
//
// And one thing that matters more: the default for `NEXT_PUBLIC_FENCEPOST_HANDLE` used to
// be `mel_k`, who owns the demo storyboard — so anyone who forgot to configure that
// variable turned every visitor into the owner.
//
// Each case imports a **fresh** module instance (a query string defeats the cache): the
// handle is cached in a module-level variable, and sharing one would have each case
// measuring the state the last one left behind.

import { test } from "node:test";
import assert from "node:assert/strict";

let seq = 0;

// Install the window and crypto stubs, then take a clean copy of api.js
async function freshApi({ store = {}, crypto, brokenStorage = false, joinToken } = {}) {
  // Read at module load, so it has to be set before the import rather than after.
  if (joinToken === undefined) delete process.env.NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN;
  else process.env.NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN = joinToken;
  globalThis.window = {
    localStorage: brokenStorage
      ? { getItem() { throw new Error("SecurityError"); },
          setItem() { throw new Error("SecurityError"); },
          removeItem() { throw new Error("SecurityError"); } }
      // removeItem belongs here for the same reason the other two do: leaving it off makes
      // every clear a silent no-op, and a test for "the dead session is dropped" then fails
      // against a product that drops it perfectly well in a browser.
      : { getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: (k) => { delete store[k]; } },
  };
  // Node's globalThis.crypto is a read-only getter; assigning does nothing, so defineProperty.
  if (crypto !== undefined) {
    Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true, writable: true });
  }
  seq += 1;
  return import(`./api.js?case=${seq}`);
}

test("with no fixed handle configured, the default is not mel_k", async () => {
  // A regression test. A default that falls back to the owner hands owner rights to every
  // visitor — and that kind of mistake raises nothing; it quietly gives the demo away.
  const api = await freshApi();
  assert.notEqual(api.HANDLE, "mel_k");
  assert.equal(api.HANDLE, "");
});

test("each browser gets its own handle, and remembers it", async () => {
  const store = {};
  const api = await freshApi({ store });
  const first = api.visitorHandle();
  assert.match(first, /^guest_[0-9a-f]{16}$/);
  assert.equal(store["fencepost.handle"], first);
  // Asking again in the same browser gives the same person, so your entries stay yours
  assert.equal(api.visitorHandle(), first);
});

test("two browsers get two people", async () => {
  // This is the whole point of the change: they are no longer the same user.
  // Each module takes its own handle before the next stub is installed: globalThis.window
  // is shared, and installing both first would have the first read the second's store.
  const first = (await freshApi({ store: {} })).visitorHandle();
  const second = (await freshApi({ store: {} })).visitorHandle();
  assert.notEqual(first, second);
});

test("the handle comes from a CSPRNG, not Math.random", async () => {
  // Under open sign-up, knowing a handle is the same as being able to sign in as that
  // person, so this value should not come out of a PRNG whose state can be recovered from
  // a handful of outputs (V8's Math.random is xorshift128+).
  const seen = [];
  const api = await freshApi({
    store: {},
    crypto: {
      getRandomValues(arr) {
        seen.push(arr.length);
        for (let i = 0; i < arr.length; i++) arr[i] = 0xab;
        return arr;
      },
    },
  });
  const h = api.visitorHandle();
  assert.deepEqual(seen, [8], "crypto.getRandomValues was not called");
  assert.equal(h, "guest_" + "ab".repeat(8));
});

test("the handle fits the length the server accepts", async () => {
  // Server side: empty, all whitespace, or over 40 characters all come back 400
  const api = await freshApi({ store: {} });
  const h = api.visitorHandle();
  assert.ok(h.trim().length > 0);
  assert.ok(h.length <= 40);
});

test("an unusable localStorage must not crash, or change who you are each time", async () => {
  // In private mode getItem and setItem throw. Within one browsing session you still have
  // to be the same identity, or every request is a new user who does not recognise what
  // they just posted.
  const api = await freshApi({ brokenStorage: true });
  const a = api.visitorHandle();
  const b = api.visitorHandle();
  assert.match(a, /^guest_/);
  assert.equal(a, b, "the identity changed inside one session");
});

test("a server that cannot be reached says so in words, not in the browser's", async () => {
  // fetch rejects before there is a response when the network is down, DNS fails, or the
  // browser refuses the origin. Whatever string that browser uses for it ("Failed to fetch",
  // "NetworkError when attempting to fetch resource.", "Load failed") used to go straight to
  // the screen, where it reads like a broken site and differs by browser.
  //
  // CORS arrives here too, which is the one that matters on a deployment split across two
  // projects: the browser says only that it failed, never which origin was refused.
  const api = await freshApi();
  const original = new TypeError("Failed to fetch");
  globalThis.fetch = () => Promise.reject(original);

  const err = await api.dashboard().then(() => null, (e) => e);
  assert.ok(err, "an unreachable server resolved instead of rejecting");
  assert.equal(err.code, "unreachable", "callers need to tell this apart from a refusal");
  assert.equal(err.status, 0);
  assert.match(err.message, /reach Fencepost/, "the browser string reached the screen");
  assert.doesNotMatch(err.message, /fetch/i);
  assert.equal(err.cause, original, "the original is kept for the console");
});


// ── The join code ──────────────────────────────────────────────────────────────
// A visitor with their own identity reaches no storyboard at all until a code lets them in,
// so this runs on every first page load and is the only thing standing between somebody and
// an empty site.

function stubFetch(responses = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace(/^https?:[/][/][^/]+/, "");
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    const answer = responses[path];
    if (answer instanceof Error) throw answer;
    if (answer && answer.status) {
      return { ok: false, status: answer.status, json: async () => answer.payload };
    }
    return { ok: true, status: 200, json: async () => answer ?? {} };
  };
  return calls;
}

const SESSION = { token: "tok", user_id: "u_guest", handle: "guest_0000000000000000" };
const HAPPY = {
  "/api/session": SESSION,
  "/api/share-links/redeem": { storyboard_id: "sb_demo", level: "reshare" },
  "/api/dashboard": { active: [], past: [] },
};
const redeems = (calls) => calls.filter((c) => c.path === "/api/share-links/redeem");

test("a new visitor redeems the join code, once", async () => {
  const store = {};
  const api = await freshApi({ store, joinToken: "jt-one" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 1, "the code was not redeemed");
  assert.equal(redeems(calls)[0].body.token, "jt-one");
  assert.equal(store["fencepost.joined"], "jt-one|u_guest",
    "what was redeemed, and by whom, was not remembered");
});

test("the same code is never redeemed twice", async () => {
  const store = { "fencepost.joined": "jt-one|u_guest" };
  const api = await freshApi({ store, joinToken: "jt-one" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 0, "it joined again on a code it had already used");
});

test("a replacement code is picked up by somebody who already joined", async () => {
  // The case this whole design exists for. A join code lasts at most 90 days and the level
  // it grants is a decision that can change, so replacing one has to reach the people
  // already here. Storing a flag instead of the code meant it never did: they skipped the
  // new code for good and stayed on whatever the old one gave them.
  const store = { "fencepost.joined": "jt-one|u_guest" };
  const api = await freshApi({ store, joinToken: "jt-two" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 1, "the replacement code was skipped");
  assert.equal(redeems(calls)[0].body.token, "jt-two");
  assert.equal(store["fencepost.joined"], "jt-two|u_guest");
});

test("somebody carrying the old flag picks up the code too", async () => {
  // What is actually in the browsers of everyone already using the deployment: the literal
  // string "1", written before the code was the thing remembered. They have to be upgraded
  // by visiting, not by being told to clear their storage.
  const store = { "fencepost.joined": "1" };
  const api = await freshApi({ store, joinToken: "jt-two" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 1, "a visitor from before the change never joins again");
  assert.equal(store["fencepost.joined"], "jt-two|u_guest");
});

test("a code that no longer works leaves the rest of the site standing", async () => {
  // Expired or turned off. The page carries on and simply shows no demo storyboard, and
  // nothing is remembered, so a code issued later is still picked up on the next visit.
  const store = {};
  const api = await freshApi({ store, joinToken: "jt-dead" });
  stubFetch({ ...HAPPY, "/api/share-links/redeem": { status: 403, payload: { error: { code: "link_revoked", message: "no" } } } });

  const view = await api.dashboard();
  assert.deepEqual(view, { active: [], past: [] }, "a dead join code took the dashboard down with it");
  assert.equal(store["fencepost.joined"], undefined, "a failed join was recorded as done");
});

test("with no code configured nothing is redeemed", async () => {
  const store = {};
  const api = await freshApi({ store });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 0);
});

test("a second identity in the same browser joins on its own account", async () => {
  // Registering makes a second person in a browser that already holds a guest. Keyed on the
  // code alone, the mark said "this browser has joined" and the new account skipped it — so
  // somebody would sign up and land on an empty dashboard, holding a grant to nothing.
  const store = { "fencepost.joined": "jt-one|u_guest" };
  const api = await freshApi({ store, joinToken: "jt-one" });
  const calls = stubFetch({ ...HAPPY,
    "/api/register": { token: "tok2", user_id: "u_ada", handle: "ada_l" } });

  const made = await api.registerAccount("ada_l", "correct horse battery staple");
  assert.equal(made.user_id, "u_ada");
  assert.equal(redeems(calls).length, 1, "the new account was left with access to nothing");
  assert.equal(store["fencepost.joined"], "jt-one|u_ada");
});

test("signing in is remembered across a reload, and signing out is too", async () => {
  const store = {};
  const api = await freshApi({ store, joinToken: "jt-one" });
  stubFetch({ ...HAPPY, "/api/login": { token: "tok2", user_id: "u_ada", handle: "ada_l" } });

  await api.signIn("ada_l", "correct horse battery staple");
  const kept = JSON.parse(store["fencepost.session"]);
  assert.equal(kept.user_id, "u_ada");
  assert.equal(kept.account, true, "the interface cannot tell an account from a guest");

  // A fresh module is a reload: the stored session has to be picked up without another
  // /api/session exchange, or a refresh would silently sign somebody out.
  const reloaded = await freshApi({ store, joinToken: "jt-one" });
  const calls = stubFetch(HAPPY);
  const back = await reloaded.whoAmI();
  assert.equal(back.handle, "ada_l");
  assert.equal(back.account, true);
  assert.equal(calls.filter((c) => c.path === "/api/session").length, 0,
    "a reload threw away the session and became a guest again");

  reloaded.signOut();
  assert.equal(store["fencepost.session"], undefined, "signing out left the token behind");
});

test("a token the server no longer accepts is dropped rather than kept for ever", async () => {
  // Rotating FENCEPOST_TOKEN_SECRET, or clearing the database, leaves a stored token that
  // answers 401 to everything. Kept, it fails every call and the site reads as broken
  // instead of as signed out.
  const store = { "fencepost.session": JSON.stringify({ user_id: "u_old", handle: "ada_l", token: "stale", account: true }) };
  const api = await freshApi({ store, joinToken: "jt-one" });
  stubFetch({ "/api/dashboard": { status: 401, payload: { error: { code: "unauthorized", message: "no" } } } });

  await api.dashboard().then(() => null, (e) => e);
  assert.equal(store["fencepost.session"], undefined, "the dead session was kept");
});
