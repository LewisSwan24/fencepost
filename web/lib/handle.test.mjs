// Turning what somebody types into the name that follows them around.
//
//   node --test lib/handle.test.mjs
//
// Two failures matter here and neither is the obvious one. A handle that looks wrong is
// visible and gets fixed. A handle that **collides** is invisible: the server maps a handle
// to a user, so two visitors who both type "Sam" become the same person, and then one of
// them can edit and delete the other's sightings. That bug has been fixed once already, by
// giving every visitor an identity of their own; this screen is what could quietly undo it.
// Hence the suffix, and hence most of what is tested below.
//
// The other is quieter still: a name this function throws away. Somebody who types their
// name in Chinese and is handed guest_9d83a54f5a4ff8a1 instead has been told something
// about who this product is for.

import { test } from "node:test";
import assert from "node:assert/strict";
import { toHandle, SUFFIX } from "./handle.js";

const FIXED = "4f2a";                    // passed in, so the tests are not random

test("a plain name becomes a readable handle", () => {
  assert.equal(toHandle("Sam", FIXED), "sam-4f2a");
});

test("spaces and punctuation become single underscores", () => {
  assert.equal(toHandle("Sam from #14", FIXED), "sam_from_14-4f2a");
  assert.equal(toHandle("mel   k", FIXED), "mel_k-4f2a");
  assert.equal(toHandle("O'Brien-Smith", FIXED), "o_brien_smith-4f2a");
});

test("separators at either end are not left dangling", () => {
  assert.equal(toHandle("  Sam!  ", FIXED), "sam-4f2a");
  assert.equal(toHandle("...Sam...", FIXED), "sam-4f2a");
});

test("a name not written in Latin letters survives", () => {
  // The project already refuses to treat a language it reads less well as grounds for
  // rejection — non-English submissions can be flagged but never auto-rejected. Throwing
  // the name away and handing back guest_xxxx is that same decision wearing a hat. The
  // server allows 40 characters and does not care which script they are in.
  assert.equal(toHandle("小明", FIXED), "小明-4f2a");
  assert.equal(toHandle("Ngā Tama", FIXED), "ngā_tama-4f2a");
  assert.equal(toHandle("Зоя", FIXED), "зоя-4f2a");
});

test("two people who type the same name do not become the same person", () => {
  // The whole reason the suffix exists. Without it the server hands the second Sam the
  // first Sam's identity, and author_id stops telling the truth.
  const a = toHandle("Sam");
  const b = toHandle("Sam");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("sam-") && b.startsWith("sam-"));
});

test("the suffix is short, lowercase and always there", () => {
  for (const name of ["Sam", "小明", "a"]) {
    assert.match(toHandle(name), /-[0-9a-f]{4}$/);
  }
  assert.equal(SUFFIX, 4);
});

test("a long name is clamped so the server still accepts the handle", () => {
  // proxy/app.py create_session refuses anything over 40 characters, and being refused at
  // the door is a blank dashboard. Clamp here, where the person typing can see it, rather
  // than find out there.
  const made = toHandle("Bartholomew Archibald Fitzgerald the Third of Paddington", FIXED);
  assert.ok(made.length <= 40, `${made.length} characters is over the server's limit`);
  assert.ok(made.startsWith("bartholomew"), made);
  assert.ok(made.endsWith("-" + FIXED));
  assert.doesNotMatch(made, /_-/, "clamping left a separator hanging before the suffix");
});

test("a name with nothing usable in it gives nothing", () => {
  // null rather than a handle made of underscores: the caller falls back to the random
  // guest_ name it already had, which is a worse name but a working one.
  for (const nothing of ["", "   ", "!!!", "...", "😀😀", null, undefined]) {
    assert.equal(toHandle(nothing, FIXED), null);
  }
});

test("a name is never turned into somebody else's", () => {
  // The seeded neighbours hold passwords, so /api/session refuses their handles outright
  // and typing "mel_k" cannot take that account over. The suffix means it is not even
  // asked: what reaches the server is mel_k-4f2a, a different person.
  assert.equal(toHandle("mel_k", FIXED), "mel_k-4f2a");
  assert.notEqual(toHandle("mel_k", FIXED), "mel_k");
});
