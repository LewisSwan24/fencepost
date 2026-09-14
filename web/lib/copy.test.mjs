// Pins down the sentence an author reads when they are stopped.
//
//   node --test lib/copy.test.mjs
//
// Why this deserves a file of its own: these sentences are copied word for word from
// ux-copy.md §1, and §1 is not in the repository (CLAUDE.md: docs/ stays out), so nothing
// automatic can notice that the copy went wrong. This file is the trace left by doing that
// comparison by hand — on 2026-09-14 it turned up three mismatches: two codes the Screener
// never sends were configured (safety, scope), five it really does send were missing, and
// the fallback sentence had been written here instead of taken from the document. What
// somebody stopped by the Screener reads is among the most important copy in this product.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { COPY, REASON_COPY, REASON_FALLBACK, reasonSentence } from "./copy.js";

const WEB = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

test("every COPY key the interface refers to actually exists", () => {
  // Learned the hard way: the second-look screen referred to COPY.votedYes and
  // COPY.votedNo, and copy.js had never had either key. React renders undefined as
  // nothing — so after voting the buttons vanished and not a word appeared, with no error.
  // No other test could catch it, because the logic was right and only a key was missing.
  const missing = [];
  for (const file of [...sourceFiles(join(WEB, "app")), ...sourceFiles(join(WEB, "components"))]) {
    const text = readFileSync(file, "utf8");
    for (const [, key] of text.matchAll(/\bCOPY\.([A-Za-z_$][\w$]*)/g)) {
      if (!(key in COPY)) missing.push(`${file.slice(WEB.length + 1)} → COPY.${key}`);
    }
  }
  assert.deepEqual(missing, [], "a copy key that does not exist is referenced; that spot renders blank");
});

test("every style class the interface refers to actually exists", () => {
  // The same fault as above, only quieter: a missing key on a CSS Module is undefined,
  // React reads className={undefined} as no class at all, and that block silently loses
  // its styling — no error, no trace. On 2026-09-14, writing the frame screen, I reached
  // for ui.note, and `ui` is a re-export of components/ui.module.css, which has no note
  // class in it.
  const missing = [];
  for (const file of [...sourceFiles(join(WEB, "app")), ...sourceFiles(join(WEB, "components"))]) {
    const text = readFileSync(file, "utf8");
    // which .module.css this file binds to which name
    const bound = {};
    for (const [, name, rel] of text.matchAll(/import\s+(\w+)\s+from\s+"([^"]+\.module\.css)"/g)) {
      bound[name] = join(dirname(file), rel);
    }
    if (/\bui\b[^\n]*from\s+"[^"]*\/ui"/.test(text)) {
      bound.ui = join(WEB, "components", "ui.module.css");
    }
    for (const [holder, cssPath] of Object.entries(bound)) {
      let css;
      try { css = readFileSync(cssPath, "utf8"); } catch { continue; }
      const classes = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
      const refs = new RegExp(`\\b${holder}\\.([A-Za-z_$][\\w$]*)`, "g");
      for (const [, key] of text.matchAll(refs)) {
        if (!classes.has(key)) missing.push(`${file.slice(WEB.length + 1)} → ${holder}.${key}`);
      }
    }
  }
  assert.deepEqual(missing, [], "a style class that does not exist is referenced; that block loses its styling");
});

test("nothing in COPY is empty", () => {
  for (const [key, value] of Object.entries(COPY)) {
    assert.ok(value !== undefined && value !== null && value !== "", `COPY.${key} is empty`);
  }
});

// The closed set from prompts.md §4.2. The model only ever picks from here.
const EMITTED = [
  "nonsense", "abuse", "spam", "pii", "harm_advocacy", "dangerous_reassurance",
  "fact_conflict", "unverifiable_number", "handling_advice", "legal_claim", "injection",
];

test("every key with copy is a code the Screener really emits", () => {
  for (const key of Object.keys(REASON_COPY)) {
    assert.ok(EMITTED.includes(key),
      `${key} in REASON_COPY is not in the prompts.md §4.2 set, so it can never match`);
  }
});

test("all six codes listed in ux-copy §1 have a sentence", () => {
  for (const key of ["nonsense", "pii", "abuse", "spam", "harm_advocacy", "dangerous_reassurance"]) {
    assert.ok(REASON_COPY[key], `${key} has no copy and falls through to the fallback`);
  }
});

test("takes the first matching sentence for the codes, rather than joining them", () => {
  const two = reasonSentence(["harm_advocacy", "pii"]);
  assert.equal(two, REASON_COPY.harm_advocacy);
  assert.ok(!two.includes("address or name"), "two sentences were stacked together");
});

test("when an earlier code has no copy, keep looking", () => {
  // fact_conflict has no author-facing sentence, deliberately; the pii after it does.
  assert.equal(reasonSentence(["fact_conflict", "pii"]), REASON_COPY.pii);
});

test("nothing matching at all goes to the fallback", () => {
  assert.equal(reasonSentence(["fact_conflict"]), REASON_FALLBACK);
  assert.equal(reasonSentence(["injection"]), REASON_FALLBACK);
});

test("empty codes, missing codes, or codes that are not an array still say something", () => {
  assert.equal(reasonSentence([]), REASON_FALLBACK);
  assert.equal(reasonSentence(undefined), REASON_FALLBACK);
  assert.equal(reasonSentence(null), REASON_FALLBACK);
});

test("the fallback says the writing is still there", () => {
  // Not a question of tone. Somebody has just been stopped mid-sentence, and their first
  // thought is whether they have lost what they wrote.
  assert.ok(/nothing has been lost/i.test(REASON_FALLBACK));
});

test("no sentence blames the person who wrote it", () => {
  // The Screener does not judge writing quality or worth (CLAUDE.md decision table), and
  // the copy should not either.
  const forbidden = /\b(violat|illegal|banned|invalid|wrong|failed|rejected)\b/i;
  for (const [key, line] of Object.entries({ ...REASON_COPY, fallback: REASON_FALLBACK })) {
    assert.ok(!forbidden.test(line), `${key} reads like a judgement of the person: ${line}`);
  }
});

test("the sentence somebody is stopped with is written in exactly one place", () => {
  // fixtures.js used to carry its own REASON_COPY with a second copy of the pii sentence,
  // next to the trigger that produces that code. Nothing imported it, so the interface was
  // never wrong; what it was was a trap. Someone changing what an author reads would find
  // two definitions, and the one sitting beside the trigger is the one they would reach
  // for. The sentence would then be changed everywhere except where it is read.
  //
  // This is the copy §1 calls the most important in the product, and the test above cannot
  // see a mistake like that: every key would still exist and every key would still be used.
  const scan = [...sourceFiles(join(WEB, "app")), ...sourceFiles(join(WEB, "components")),
                ...sourceFiles(join(WEB, "lib"))]
    .filter((file) => !file.endsWith("copy.js"));

  const duplicated = [];
  for (const file of scan) {
    const text = readFileSync(file, "utf8");
    const where = file.slice(WEB.length + 1).replaceAll("\\", "/");
    if (/export\s+(const|let|function)\s+REASON_/.test(text)) {
      duplicated.push(`${where} exports its own REASON_ copy`);
    }
    for (const [code, sentence] of Object.entries(REASON_COPY)) {
      if (text.includes(sentence)) duplicated.push(`${where} repeats the ${code} sentence`);
    }
    if (text.includes(REASON_FALLBACK)) duplicated.push(`${where} repeats the fallback sentence`);
  }
  // String.fromCharCode(10) rather than an escape: this file has been written through
  // enough layers of quoting to have had the backslash eaten twice.
  const NL = String.fromCharCode(10);
  assert.deepEqual(duplicated, [], NL + duplicated.join(NL));
});
