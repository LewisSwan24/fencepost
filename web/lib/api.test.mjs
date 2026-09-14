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
async function freshApi({ store = {}, crypto, brokenStorage = false } = {}) {
  globalThis.window = {
    localStorage: brokenStorage
      ? { getItem() { throw new Error("SecurityError"); },
          setItem() { throw new Error("SecurityError"); } }
      : { getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); } },
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
