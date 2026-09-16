// The share code, and the two ways it can be wrong.
//
//   node --test lib/qr.test.mjs
//
// One of those ways announces itself: a square that will not scan is a visible failure and
// somebody notices within a second. The other does not. A square that scans perfectly and
// resolves to a token that was never issued looks like it is working, right up until it
// hands somebody access to something they were not offered.
//
// So most of what is below is about the address rather than the drawing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { shareUrl, matrix } from "./qr.js";

const ORIGIN = "https://fencepost-app.vercel.app";
const TOKEN = "Zk3xQ8vN2mPqR7sT";              // invented for the test, never issued

test("the code points at the token that was issued", () => {
  assert.equal(shareUrl(ORIGIN, TOKEN), `${ORIGIN}/s/${TOKEN}`);
});

test("a trailing slash on the origin does not become a double slash", () => {
  // window.location.origin does not carry one, but a configured base might, and //s/ is a
  // different path that answers 404.
  for (const origin of [ORIGIN, ORIGIN + "/", ORIGIN + "///"]) {
    assert.equal(shareUrl(origin, TOKEN), `${ORIGIN}/s/${TOKEN}`);
  }
});

test("no token means no address, rather than an address to nowhere", () => {
  // The share screen renders before anything is issued. Returning a URL here would put a
  // scannable square on screen pointing at /s/undefined.
  assert.equal(shareUrl(ORIGIN, null), null);
  assert.equal(shareUrl(ORIGIN, ""), null);
  assert.equal(shareUrl(null, TOKEN), null);
  assert.equal(shareUrl("", TOKEN), null);
});

test("two different codes never draw the same square", () => {
  // Guards against a fixed or cached matrix surviving a re-issue, so the owner turns one
  // code off, issues another, and the screen still shows the old one.
  const a = JSON.stringify(matrix(shareUrl(ORIGIN, TOKEN)));
  const b = JSON.stringify(matrix(shareUrl(ORIGIN, "differentTokenHere")));
  assert.notEqual(a, b);
});

test("the same code draws the same square every time", () => {
  const first = JSON.stringify(matrix(shareUrl(ORIGIN, TOKEN)));
  const again = JSON.stringify(matrix(shareUrl(ORIGIN, TOKEN)));
  assert.equal(first, again);
});

test("nothing to encode draws nothing, and does not throw", () => {
  // matrix() sits on a render path. Throwing here would take the share screen down with it,
  // including the permission controls, which work perfectly well without a picture.
  for (const value of [null, undefined, ""]) {
    assert.equal(matrix(value), null);
  }
});

test("what comes back is a square", () => {
  const rows = matrix(shareUrl(ORIGIN, TOKEN));
  assert.ok(Array.isArray(rows) && rows.length > 0);
  for (const row of rows) assert.equal(row.length, rows.length);
});

test("it is a QR code, not a pattern that resembles one", () => {
  // The three finder patterns are what a camera locks onto, and they are exactly the part a
  // decorative stand-in gets approximately right. Checked precisely: a 7x7 ring of dark
  // modules, a light ring inside it, and a solid 3x3 core.
  const rows = matrix(shareUrl(ORIGIN, TOKEN));
  const n = rows.length;

  for (const [top, left] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        const ring = y === 0 || y === 6 || x === 0 || x === 6;
        const core = y >= 2 && y <= 4 && x >= 2 && x <= 4;
        assert.equal(rows[top + y][left + x], ring || core,
          `finder at ${top},${left} is wrong at row ${y}, column ${x}`);
      }
    }
  }

  // The fourth corner carries no finder. That absence is how a decoder works out which way
  // up the square is, so a "QR code" with four matching corners does not scan at all.
  assert.ok(!(rows[n - 1][n - 1] && rows[n - 2][n - 2] && rows[n - 3][n - 3]),
    "there is a finder pattern in the fourth corner");
});

test("a longer token grows the square instead of losing characters", () => {
  // The version is chosen automatically. Fixed, a longer token would either throw or be
  // truncated, and a code missing its last characters still scans perfectly — to a token
  // that does not exist.
  const short = matrix(shareUrl(ORIGIN, "abc"));
  const long = matrix(shareUrl(ORIGIN, "a".repeat(120)));
  assert.ok(long.length > short.length,
    `expected a bigger square for a longer token, got ${long.length} and ${short.length}`);
});
