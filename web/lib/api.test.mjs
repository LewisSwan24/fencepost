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
async function freshApi({ store = {}, crypto, brokenStorage = false, joinToken,
                          silentlyDroppingStorage = false, fetch } = {}) {
  // Read at module load, so it has to be set before the import rather than after.
  if (joinToken === undefined) delete process.env.NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN;
  else process.env.NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN = joinToken;

  // Three storages, because they fail in three different ways and only the first one is the
  // one people picture. Throwing is the loud kind. Accepting a write and keeping nothing is
  // the quiet kind, and it is the one that used to slip through: setItem returns, nothing
  // raises, and the value is simply not there on the next read.
  const throwing = { getItem() { throw new Error("SecurityError"); },
                     setItem() { throw new Error("SecurityError"); },
                     removeItem() { throw new Error("SecurityError"); } };
  const dropping = { getItem: (k) => (k in store ? store[k] : null),
                     setItem: () => {},
                     removeItem: (k) => { delete store[k]; } };
  // removeItem belongs in the working one for the same reason the other two do: leaving it
  // off makes every clear a silent no-op, and a test for "the dead session is dropped" then
  // fails against a product that drops it perfectly well in a browser.
  const working = { getItem: (k) => (k in store ? store[k] : null),
                    setItem: (k, v) => { store[k] = String(v); },
                    removeItem: (k) => { delete store[k]; } };

  globalThis.window = {
    localStorage: brokenStorage ? throwing : silentlyDroppingStorage ? dropping : working,
  };
  if (fetch) globalThis.fetch = fetch;
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

test("a browser that cannot keep a handle is given none", async () => {
  // This used to invent one for the page load, reasoning that being the same person for a
  // while beat changing on every request. Measured on the deployment, that reasoning was
  // worth less than it cost: the fallback lasted one page load rather than a session, and
  // every one of those people was a permanent row in users and another in access_grants,
  // because arriving redeems the join code. Anything that does not keep storage — crawlers
  // and link-preview fetchers rather than people — minted one per view, and they collected
  // on the share screen, which is the screen listing who has access to a storyboard.
  const api = await freshApi({ brokenStorage: true });
  assert.equal(api.visitorHandle(), null);
  assert.equal(api.visitorHandle(), null, "asking twice started inventing one");
});

test("a write that is silently dropped counts as no storage", async () => {
  // setItem does not always throw when it fails. A full quota and some embedded webviews
  // take the call and keep nothing, so the check has to be reading the value back rather
  // than trusting that no exception means success.
  const api = await freshApi({ silentlyDroppingStorage: true });
  assert.equal(api.visitorHandle(), null);
});

test("no handle means nothing is asked of the server", async () => {
  // The point of all of the above. This path used to ask /api/session for a token and get
  // one, which wrote a person into the database who could never come back as themselves.
  const calls = [];
  const api = await freshApi({
    brokenStorage: true,
    fetch: async (url) => { calls.push(String(url)); throw new Error("must not be called"); },
  });
  await assert.rejects(
    () => api.dashboard(),
    (e) => e.message.includes("remember who you are"),
    "the visitor was not told why, or was told in the browser's words"
  );
  assert.deepEqual(calls, [], "a request went out for a browser that cannot hold a session");
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

// What this browser has redeemed, read the way the product reads it. Asserting on the raw
// string instead pinned the encoding rather than the intent, and these cases are about
// which codes were taken and by whom — not about whether that is stored as one string or a
// list. The old single-string shape is still accepted here because it is still accepted
// there: browsers already carrying one must not redeem again.
function marks(store) {
  const raw = store["fencepost.joined"];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

test("a new visitor redeems the join code, once", async () => {
  const store = {};
  const api = await freshApi({ store, joinToken: "jt-one" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 1, "the code was not redeemed");
  assert.equal(redeems(calls)[0].body.token, "jt-one");
  assert.deepEqual(marks(store), ["jt-one|u_guest"],
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
  assert.deepEqual(marks(store), ["jt-one|u_guest", "jt-two|u_guest"],
    "the replacement was not recorded alongside the code it replaces");
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
  assert.deepEqual(marks(store), ["1", "jt-two|u_guest"],
    "the old flag was dropped or the new code was not recorded");
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

test("two codes are both redeemed, each once", async () => {
  // A code reaches one storyboard, so one code reaches one. The archived storyboard — the
  // one demonstrating that a board closes and turns read-only — was invisible to everybody
  // who arrived after it was seeded, because no code pointed at it.
  const store = {};
  const api = await freshApi({ store, joinToken: "jt-active, jt-archived" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.deepEqual(redeems(calls).map((c) => c.body.token), ["jt-active", "jt-archived"]);
  assert.deepEqual(marks(store), ["jt-active|u_guest", "jt-archived|u_guest"]);
});

test("adding a second code does not redeem the first one again", async () => {
  // What happens to everybody already here when the setting gains a code: the one they have
  // is left alone, and only the new one is taken. Redeeming the old one again would count
  // another use against it and, on a code with a limit, could use it up.
  const store = { "fencepost.joined": JSON.stringify(["jt-active|u_guest"]) };
  const api = await freshApi({ store, joinToken: "jt-active,jt-archived" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.deepEqual(redeems(calls).map((c) => c.body.token), ["jt-archived"]);
});

test("one code that fails does not stop the other", async () => {
  // Two codes expire on their own timetables. If the first is turned off, the second still
  // has to be taken, or turning off one code quietly costs access to the other board.
  const store = {};
  const api = await freshApi({ store, joinToken: "jt-dead,jt-live" });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ path, body });
    if (path === "/api/share-links/redeem" && body.token === "jt-dead") {
      return { ok: false, status: 403,
               json: async () => ({ error: { code: "link_revoked", message: "no" } }) };
    }
    return { ok: true, status: 200, json: async () => HAPPY[path] ?? {} };
  };

  await api.dashboard();
  assert.deepEqual(redeems(calls).map((c) => c.body.token), ["jt-dead", "jt-live"]);
  assert.deepEqual(marks(store), ["jt-live|u_guest"], "a failed code was recorded as done");
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
  assert.deepEqual(marks(store), ["jt-one|u_guest", "jt-one|u_ada"],
    "the new account's mark replaced the guest's instead of joining it");
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

const SIGNED_IN = () => ({
  "fencepost.session": JSON.stringify(
    { user_id: "u_ada", handle: "ada_l", token: "tok", account: true }),
  "fencepost.joined": "jt-one|u_ada",
});

test("a code replaced while somebody is signed in still reaches them", async () => {
  // Registering and signing in both redeem, so a new account is fine. Somebody already
  // signed in comes back through the restored-session path instead, and that path used to
  // return before joinDemo was ever reached: they would keep whatever the code granted on
  // the day they registered, for good, while every guest around them was upgraded.
  const store = SIGNED_IN();
  const api = await freshApi({ store, joinToken: "jt-two" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 1, "a signed-in account never heard about the new code");
  assert.equal(redeems(calls)[0].body.token, "jt-two");
  assert.deepEqual(marks(store), ["jt-one|u_ada", "jt-two|u_ada"],
    "the replacement was not recorded alongside the code it replaces");
});

test("a restored session with nothing to redeem asks for nothing", async () => {
  // The other half: this runs on every page load for everybody signed in, so it has to be
  // free when the code has not moved. One request, the one that was asked for.
  const store = SIGNED_IN();
  const api = await freshApi({ store, joinToken: "jt-one" });
  const calls = stubFetch(HAPPY);

  await api.dashboard();
  assert.equal(redeems(calls).length, 0, "it redeemed a code it had already redeemed");
  assert.equal(calls.filter((c) => c.path === "/api/session").length, 0,
    "the stored session was thrown away and exchanged again");
  assert.deepEqual(calls.map((c) => c.path), ["/api/dashboard"]);
});
