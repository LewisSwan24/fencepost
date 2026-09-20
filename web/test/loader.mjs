// The module hook that lets `node --test` load the screens themselves.
//
// Next's bundler is what normally makes these files importable, and it is not available to
// a plain Node process. Three things stand in the way, and this hook answers each:
//
//   JSX. The screens are .js files full of it, and package.json has no "type": "module", so
//   Node would read them as CommonJS and then fail on the first `<`. esbuild transforms them
//   and the hook returns format "module" explicitly, which settles both at once.
//
//   CSS modules. `import styles from "./x.module.css"` is a bundler feature. The stand-in
//   returns the key as the class name, so `styles.lede` is "lede" — which is also what makes
//   a class name assertable in a test. Nothing here checks the name is real; that is
//   classnames.test.mjs's job, against the actual stylesheet.
//
//   next/navigation and next/font/google. Resolved to local stubs. Doing it here rather than
//   with node:test's module mocking is deliberate: mock.module() is still behind
//   --experimental-test-module-mocks, and a stub the loader installs is the same stub for
//   every importer, including one imported three levels down inside a component.
//
// Scope is deliberately narrow: files under web/, outside node_modules. Everything else goes
// to the default loader untouched.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.dirname(HERE);

const STUBS = {
  "next/navigation": pathToFileURL(path.join(HERE, "stubs", "navigation.mjs")).href,
  "next/font/google": pathToFileURL(path.join(HERE, "stubs", "font.mjs")).href,
};

// A CSS-module object as the bundler would hand it over, except every key answers to its own
// name. `then` is excluded so the object is never mistaken for a promise, and symbols return
// undefined so `util.inspect` and friends do not get a string where they expect a method.
const CSS_MODULE = `
const handler = {
  get(_, key) {
    if (typeof key !== "string" || key === "then") return undefined;
    return key;
  },
  has: () => true,
};
export default new Proxy({}, handler);
`;

function ours(url) {
  if (!url.startsWith("file:")) return false;
  const file = fileURLToPath(url);
  return file.startsWith(WEB + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`);
}

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier];
  if (stub) return { url: stub, format: "module", shortCircuit: true };

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // The screens import each other the way the bundler lets them — `from "../../lib/api"`,
    // no extension — and Node's resolver requires one. Only relative specifiers are retried,
    // and only after the real resolver has already said no, so nothing here can shadow a
    // package that does exist.
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw err;
    for (const suffix of [".js", "/index.js"]) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch { /* try the next shape, then give up with the original error */ }
    }
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (!ours(url)) return nextLoad(url, context);

  const file = fileURLToPath(url);
  if (file.endsWith(".css")) {
    return { format: "module", source: CSS_MODULE, shortCircuit: true };
  }
  // .mjs as well as .js: a test that renders a screen is written in the same JSX the screen
  // is, or it reads as a different language from the thing it is describing.
  if (file.endsWith(".js") || file.endsWith(".mjs")) {
    const source = await readFile(file, "utf8");
    const { code } = await transform(source, {
      loader: "jsx",
      format: "esm",
      // The automatic runtime imports react/jsx-runtime itself, so a screen does not have to
      // import React to be rendered — and none of them do.
      jsx: "automatic",
      target: "node24",
      sourcefile: file,
      sourcemap: "inline",
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
