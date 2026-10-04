// Guards over the source, for two things the screens got right once and nothing else holds.
//
//   node --import ./test/setup.mjs --test test/a11y-guards.test.mjs
//
// Pointer-only controls. The frame scrubber (#43) and the mask canvas (#46) both answered to
// a pointer and nothing else, and a browser audit for missing handlers walked straight past
// the second because a drag on a plain <div> looks like nothing at all from the DOM. So this
// reads the JSX instead: any element that is not a native control and listens for a pointer
// must listen for keys too, or be named below with the control that does its job.
//
// Reduced motion. globals.css turns every animation and transition down to nothing under
// prefers-reduced-motion, which is what covers the fades and the spinner in the modules. One
// rule in one file, and deleting it would change nothing a test sees.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (/\.js$/.test(entry.name)) out.push(path);
  }
  return out;
}

// Every opening tag in a file, as its name and its text. Attribute values are JSX expressions
// full of `=>` and `>`, so a tag ends at the first `>` outside braces and quotes, not the
// first `>`. Comments inside braces are skipped whole: the mask canvas has one that says
// "the still's own shape", and that apostrophe read as a quote swallowed half the tag.
function openingTags(src) {
  const tags = [];
  const start = /<([a-z][a-zA-Z0-9]*)\b/g;
  let m;
  while ((m = start.exec(src))) {
    let depth = 0;
    let quote = null;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (depth > 0 && c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
      if (depth > 0 && c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 1; continue; }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push({ name: m[1], text: src.slice(m.index, i + 1) });
  }
  return tags;
}

// Controls the browser already makes reachable and operable from a keyboard.
const NATIVE = new Set(["button", "input", "select", "textarea", "a", "label", "summary", "option"]);
const POINTER = /\bon(Click|DoubleClick|PointerDown|PointerUp|MouseDown|MouseUp|TouchStart|TouchEnd)=/;

// Pointer-only on purpose, each with the control that does the same job from a keyboard.
// The test also checks that control is still in the file, so the excuse cannot outlive it.
const ALTERNATIVES = {
  // Drawing a mask is a drag; the keyboard way is Add a mask, then the arrows on the mask.
  [join("app", "b", "[id]", "add", "mask", "page.js")]: { tag: "div", proof: "COPY.maskAdd" },
};

test("nothing that listens for a pointer is out of reach of a keyboard", () => {
  const found = [];
  for (const file of [...sources(join(WEB, "app")), ...sources(join(WEB, "components"))]) {
    const src = readFileSync(file, "utf8");
    const rel = relative(WEB, file);
    for (const { name, text } of openingTags(src)) {
      if (NATIVE.has(name) || !POINTER.test(text)) continue;
      // The panel inside a sheet only stops a click from reaching the scrim.
      if (/onClick=\{\(e\) => e\.stopPropagation\(\)\}/.test(text) && !/onPointer/.test(text)) continue;
      if (/\bonKeyDown=/.test(text)) continue;
      const excused = ALTERNATIVES[rel];
      if (excused && excused.tag === name && src.includes(excused.proof)) continue;
      found.push(`${rel.split(sep).join("/")}: <${name}> ${text.slice(0, 80).replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(found, []);
});

test("the guard can see a pointer-only element when there is one", () => {
  // Without this, a tokenizer that found no tags at all would pass the test above forever.
  const tags = openingTags(`<div className={s.x} onPointerDown={(e) => go(e > 1)}>hi</div>`);
  assert.equal(tags.length, 1);
  assert.ok(POINTER.test(tags[0].text));
  assert.ok(!/onKeyDown=/.test(tags[0].text));
  assert.match(tags[0].text, /go\(e > 1\)\}>$/, "a > inside braces ended the tag early");

  const commented = openingTags(`<div style={{
      // the still's own shape
      width: 1 }} onPointerDown={down}>`);
  assert.match(commented[0].text, /onPointerDown=\{down\}>$/, "an apostrophe in a comment read as a quote");
});

test("reduced motion turns every animation and transition down", () => {
  const css = readFileSync(join(WEB, "app", "globals.css"), "utf8");
  const block = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, "the reduced-motion rule is gone from globals.css");
  assert.match(block[1], /\*,\s*\*::before,\s*\*::after/, "it no longer applies to everything");
  assert.match(block[1], /animation-duration:\s*0\.01ms\s*!important/);
  assert.match(block[1], /animation-iteration-count:\s*1\s*!important/,
               "the spinner and the record dot would keep going round");
  assert.match(block[1], /transition-duration:\s*0\.01ms\s*!important/);
});

test("nothing scrolls smoothly from script, where the reduced-motion rule cannot reach", () => {
  // CSS durations do not touch scrollIntoView({behavior: "smooth"}) or scrollTo with it.
  const found = [...sources(join(WEB, "app")), ...sources(join(WEB, "components")), ...sources(join(WEB, "lib"))]
    .filter((f) => !/\.test\./.test(f))
    .filter((f) => /behavior:\s*["']smooth["']/.test(readFileSync(f, "utf8")));
  assert.deepEqual(found, []);
});
