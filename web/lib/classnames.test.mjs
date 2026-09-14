// Every CSS-module class name the interface refers to, checked against the stylesheet.
//
//   node --test lib/classnames.test.mjs
//
// This is the same class of fault copy.test.mjs was written for, in a second namespace.
// `ui` and `styles` are CSS-module objects, so `ui.btnn` is undefined, React renders
// className={undefined} as no class at all, and the result is a correctly working control
// with none of its styling: no error, no warning, nothing in the console. The one that
// already happened was COPY.votedYes, a key that had never existed — after voting, the
// buttons vanished and not a word appeared. A missing class is quieter still, because the
// element is right there, just unstyled.
//
// There are over 400 of these references and one stylesheet per screen, which is more than
// anybody re-checks by hand after a rename.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const UI_STYLESHEET = join(WEB, "components", "ui.module.css");

function sourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Deliberately generous: anything that looks like a class selector anywhere in the file
// counts as defined. Over-collecting risks missing a fault; under-collecting would report
// faults that are not there, and a test that cries wolf gets switched off.
function classNames(cssPath) {
  if (!existsSync(cssPath)) return null;
  return new Set([...readFileSync(cssPath, "utf8").matchAll(/\.([A-Za-z][\w-]*)/g)]
    .map((m) => m[1]));
}

const SOURCES = [...sourceFiles(join(WEB, "app")), ...sourceFiles(join(WEB, "components"))];

test("ui really is the stylesheet this test checks it against", () => {
  // The rest of the file assumes `ui` resolves to components/ui.module.css. If that export
  // is ever rewired, every ui.* assertion below would be checking the wrong stylesheet and
  // would keep passing, so the assumption is checked rather than trusted.
  const source = readFileSync(join(WEB, "components", "ui.js"), "utf8");
  assert.match(source, /import\s+styles\s+from\s+"\.\/ui\.module\.css"/);
  assert.match(source, /export\s*\{\s*styles\s+as\s+ui\s*\}/);
  assert.ok(existsSync(UI_STYLESHEET));
});

test("every class name the interface uses exists in a stylesheet", () => {
  const missing = [];
  let checked = 0;

  for (const file of SOURCES) {
    const text = readFileSync(file, "utf8");
    const local = text.match(/import\s+styles\s+from\s+"([^"]+\.module\.css)"/);
    const localNames = local ? classNames(resolve(dirname(file), local[1])) : null;
    const where = file.slice(WEB.length + 1).replaceAll("\\", "/");

    for (const line of text.split("\n")) {
      if (line.trimStart().startsWith("import")) continue;   // the import path is not a reference
      for (const [, object, name] of line.matchAll(/\b(ui|styles)\.([A-Za-z_$][\w$]*)/g)) {
        checked += 1;
        const pool = object === "ui" ? classNames(UI_STYLESHEET) : localNames;
        if (pool === null) {
          missing.push(`${where}: ${object}.${name} but the file imports no stylesheet`);
        } else if (!pool.has(name)) {
          missing.push(`${where}: ${object}.${name} is not in the stylesheet`);
        }
      }
    }
  }

  assert.ok(checked > 300, `only ${checked} references were checked; the scan has stopped working`);
  assert.deepEqual(missing, [], "\n" + missing.join("\n"));
});
