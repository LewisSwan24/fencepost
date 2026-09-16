// node --test lib/format.test.mjs
//
// relative() looks backwards and until() looks forwards. Confusing the two is not a
// cosmetic problem: the share screen used relative() for a code's expiry, so every code
// that had not expired read "Expires today", including one six weeks away. Seen locally
// on 2026-09-14.

import { test } from "node:test";
import assert from "node:assert/strict";
import { until, relative, initials } from "./format.js";

const NOW = new Date("2026-09-14T12:00:00+10:00");

test("looking forward: today, tomorrow, within the week, further out", () => {
  assert.equal(until("2026-09-14T23:00:00+10:00", NOW), "today");
  assert.equal(until("2026-09-15T09:00:00+10:00", NOW), "tomorrow");
  assert.equal(until("2026-09-19T09:00:00+10:00", NOW), "in 5 days");
  assert.equal(until("2026-10-30T09:00:00+10:00", NOW), "30 Oct");
});

test("something already past says so, rather than today", () => {
  assert.equal(until("2026-09-12T09:00:00+10:00", NOW), "expired");
});

test("no expiry is an empty string, not Invalid Date", () => {
  assert.equal(until(null, NOW), "");
  assert.equal(until(undefined, NOW), "");
});

test("relative() really does collapse a future time to today, so expiry cannot use it", () => {
  // This pins down why until() is needed. relative() is not broken; it only looks back.
  assert.equal(relative("2026-10-30T09:00:00+10:00", NOW), "today");
  assert.notEqual(until("2026-10-30T09:00:00+10:00", NOW), "today");
});

// The two letters on an avatar. Two derivations of these exist — this one, and the share
// screen taking the first two characters of the handle — and until visitors could choose a
// name they agreed. "lewis-9ffe" is where they stopped: split on the dash, this read "l9"
// while the share screen read "le" for the same person.
test("the random tail of a chosen name is not part of the name", () => {
  assert.equal(initials("lewis-9ffe"), "le");
  assert.equal(initials("sam-4f2a"), "sa");
  assert.equal(initials("lewis_from_14-4f2a"), "lf");
});

test("handles without a suffix are untouched", () => {
  assert.equal(initials("mel_k"), "mk");
  assert.equal(initials("sam_t"), "st");
  assert.equal(initials("visitor"), "vi");
  assert.equal(initials("guest_9d83a54f5a4ff8a1"), "g9");
});

test("a name in another script keeps its own letters", () => {
  assert.equal(initials("小明-4f2a"), "小明");
});

test("nothing to work with gives a placeholder rather than throwing", () => {
  for (const nothing of ["", null, undefined, "---"]) {
    assert.equal(initials(nothing), "?");
  }
});
