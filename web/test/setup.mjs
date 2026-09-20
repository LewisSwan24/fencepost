// One --import for the whole thing: register the module hook, then put a document in place.
//
//   node --import ./test/setup.mjs --test "test/*.test.mjs"
//
// Order is the only subtle part. The hook has to be registered before any screen is imported,
// and the DOM has to exist before react-dom/client is, because React reads globals at module
// scope. Both happen here, before the test file itself is loaded.
//
// The globals are copied off a jsdom window rather than assigned one at a time. Node 24
// already defines some of these — navigator is read-only, and assigning to it throws — so
// every one goes on with defineProperty, and anything Node owns and jsdom does not need to
// replace is left alone.

import { register } from "node:module";
import { JSDOM } from "jsdom";

register("./loader.mjs", import.meta.url);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:3000/",
  pretendToBeVisual: true,      // requestAnimationFrame, which React 19 uses
});

const { window } = dom;

// Node's own globals that jsdom must take over for a React tree to work, whether or not Node
// has its own version. The rest are copied only where Node has nothing.
const TAKE_OVER = new Set(["navigator", "location", "history", "fetch"]);

function put(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

put("window", window);
put("document", window.document);
put("self", window);

for (const key of Object.getOwnPropertyNames(window)) {
  if (key.startsWith("_") || key === "window" || key === "document" || key === "self") continue;
  if (key in globalThis && !TAKE_OVER.has(key)) continue;
  const value = window[key];
  // Unbound DOM methods lose their receiver once they are globals; getComputedStyle and
  // scrollTo are the ones React and user-event actually reach for.
  put(key, typeof value === "function" && !/^[A-Z]/.test(key) ? value.bind(window) : value);
}

// React 19 refuses to flush updates outside act() without this, and says so on every render.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
