// The text colours against the backgrounds they sit on.
//
//   node --import ./test/setup.mjs --test test/contrast.test.mjs
//
// Every text token is pinned at 4.5:1 or better on the page and on a card, which is what
// WCAG 1.4.3 asks of text under 18.66px bold or 24px. The tokens are read straight out of
// globals.css rather than copied here, so the test measures the colours the site ships.
//
// --text-faint is the reason this exists. It was #7d7365: 3.84 on the page and 3.54 on a
// card, and every place it was used was small text (10.5 to 12px) or an input placeholder.
// An audit of all eighteen routes in a real browser found it on 2026-10-04 (#44).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const tokens = Object.fromEntries(
  [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

function resolve(name) {
  let value = tokens[name];
  for (let hops = 0; value && value.startsWith("var("); hops++) {
    assert.ok(hops < 10, `${name} never resolves to a colour`);
    value = tokens[value.slice(4, -1).trim()];
  }
  assert.match(value || "", /^#[0-9a-f]{6}$/i, `${name} is not a six-digit hex colour`);
  return value;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT = ["--text", "--text-body", "--text-muted", "--text-dim", "--text-faint"];
const BACKGROUNDS = ["--bg", "--surface"];

test("the contrast arithmetic agrees with the WCAG reference points", () => {
  // Black on white is the top of the scale; a colour on itself is the bottom.
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#777777", "#777777"), 1);
  // #767676 on white is the well-known lightest grey that passes 4.5.
  assert.ok(contrast("#767676", "#ffffff") >= 4.5);
  assert.ok(contrast("#777777", "#ffffff") < 4.5);
});

for (const text of TEXT) {
  for (const bg of BACKGROUNDS) {
    test(`${text} on ${bg} is at least 4.5:1`, () => {
      const ratio = contrast(resolve(text), resolve(bg));
      assert.ok(ratio >= 4.5, `${text} ${resolve(text)} on ${bg} ${resolve(bg)} is ${ratio.toFixed(2)}:1`);
    });
  }
}

test("the text tokens still step down in order, so faint stays the quietest", () => {
  // Fixing contrast by making every grey the same grey would pass the tests above and lose
  // the hierarchy the screens are written against.
  const page = resolve("--bg");
  const ratios = TEXT.map((t) => contrast(resolve(t), page));
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(ratios[i] < ratios[i - 1], `${TEXT[i]} is not quieter than ${TEXT[i - 1]}`);
  }
});
