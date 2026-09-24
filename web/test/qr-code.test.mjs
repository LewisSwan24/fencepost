// QrCode: the real, scannable square for one issued share link.
//
//   node --import ./test/setup.mjs --test test/qr-code.test.mjs
//
// A QR here is permissioned access, never a public link: the square encodes the token the
// owner has just issued, which resolves to exactly the level they chose for as long as they
// chose. So the thing that matters most is that it draws *the value it was given* and
// nothing else — a square that reads correctly to the wrong place is the failure nobody sees.
// lib/qr.js decides the URL (and is tested beside itself); this component is trusted to draw
// that URL's modules faithfully, so these tests compare its path, module for module, with
// matrix() of the same value.
//
// The rest is from the header comment: nothing at all when there is nothing to encode (the
// share screen falls back to the placeholder rather than coming down), a four-module quiet
// zone inside the viewBox, dark modules on a light ground, and a label a screen reader can
// announce.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, render, cleanup, screen } from "@testing-library/react";

import QrCode from "../components/QrCode.js";
import { matrix, shareUrl } from "../lib/qr.js";

afterEach(() => cleanup());

const URL_A = shareUrl("http://localhost:3000", "tok_view_abc123");
const URL_B = shareUrl("http://localhost:3000", "tok_view_abc124");

async function draw(props) {
  let view;
  await act(async () => { view = render(<QrCode {...props} />); });
  return view.container;
}

// The dark modules the path draws, as "x,y" in matrix coordinates (quiet zone removed).
function drawn(container) {
  const d = container.querySelector("path").getAttribute("d");
  const cells = new Set();
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    cells.add(`${Number(m[1]) - 4},${Number(m[2]) - 4}`);
  }
  return cells;
}

function expected(value) {
  const cells = new Set();
  matrix(value).forEach((row, y) => row.forEach((dark, x) => { if (dark) cells.add(`${x},${y}`); }));
  return cells;
}

test("the square draws exactly the modules of the link it was given", async () => {
  // A code that scans to somewhere other than the issued link is a permission leak that
  // looks like a working QR; the drawing has to be the value, module for module.
  const box = await draw({ value: URL_A });
  assert.deepEqual(drawn(box), expected(URL_A));
});

test("a different token draws a different square", async () => {
  // Two links a character apart are two grants; the picture must not be cached or fixed.
  const a = drawn(await draw({ value: URL_A }));
  cleanup();
  const b = drawn(await draw({ value: URL_B }));
  assert.notDeepEqual(a, b);
  assert.deepEqual(b, expected(URL_B));
});

test("with nothing issued there is no square at all", async () => {
  // Nothing to encode means nothing drawn; the share screen shows the placeholder instead,
  // rather than a square pointing somewhere invented or taking the screen down.
  for (const value of [undefined, null, ""]) {
    const box = await draw({ value });
    assert.equal(box.querySelector("svg"), null, `drew something for ${JSON.stringify(value)}`);
    cleanup();
  }
});

test("four clear modules on every side, as part of the drawing", async () => {
  // Without the quiet zone many decoders will not lock on; it is in the viewBox so it scales.
  const box = await draw({ value: URL_A });
  const n = matrix(URL_A).length;
  assert.equal(box.querySelector("svg").getAttribute("viewBox"), `0 0 ${n + 8} ${n + 8}`);
  const d = box.querySelector("path").getAttribute("d");
  for (const m of d.matchAll(/M(\d+) (\d+)/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    assert.ok(x >= 4 && y >= 4 && x < n + 4 && y < n + 4, `a module sat in the quiet zone at ${x},${y}`);
  }
});

test("dark modules on a light ground, quiet zone included", async () => {
  // Every screen around this one is dark, and a code inverted against its surroundings is
  // one most phones will not read.
  const box = await draw({ value: URL_A });
  const ground = box.querySelector("rect");
  const n = matrix(URL_A).length;
  assert.equal(ground.getAttribute("width"), String(n + 8));
  assert.equal(ground.getAttribute("fill").toLowerCase(), "#f4ebdc");
  assert.equal(box.querySelector("path").getAttribute("fill").toLowerCase(), "#0f0d0b");
});

test("a screen reader is told what it is", async () => {
  // It is a picture of a link; it gets an image role and a name, default or given.
  await draw({ value: URL_A });
  assert.ok(screen.getByRole("img", { name: "QR code for this share link" }));
  cleanup();
  await draw({ value: URL_A, label: "Code for view access" });
  assert.ok(screen.getByRole("img", { name: "Code for view access" }));
});
