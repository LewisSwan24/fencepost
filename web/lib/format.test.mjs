// node --test lib/format.test.mjs
//
// relative() looks backwards and until() looks forwards. Confusing the two is not a
// cosmetic problem: the share screen used relative() for a code's expiry, so every code
// that had not expired read "Expires today", including one six weeks away. Seen locally
// on 2026-09-14.

import { test } from "node:test";
import assert from "node:assert/strict";
import { until, relative } from "./format.js";

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
