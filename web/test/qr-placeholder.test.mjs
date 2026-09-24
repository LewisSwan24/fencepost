// QrPlaceholder: what the share screen shows before a code has been issued.
//
//   node --import ./test/setup.mjs --test test/qr-placeholder.test.mjs
//
// The header comment is the whole brief. It is a picture, not a code: a scannable square
// drawn before anything has been issued would have to point somewhere invented or somewhere
// real, and a QR here is permissioned access, never a public link — so a placeholder that
// happened to scan would be the one thing on the share screen that could hand out access
// nobody chose. And it is drawn from a fixed seed, so every render is identical and
// screenshots are stable.
//
// What swaps it for the real code (share/page.js: `live ? <QrCode> : <QrPlaceholder>`) is
// share.test.mjs's subject; this suite is about the placeholder itself.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, render, cleanup, screen } from "@testing-library/react";

import QrPlaceholder from "../components/QrPlaceholder.js";

afterEach(() => cleanup());

async function draw(props = {}) {
  let view;
  await act(async () => { view = render(<QrPlaceholder {...props} />); });
  return view.container.firstChild;
}

// The grid as booleans, read back off the rendered cells.
function grid(root) {
  return Array.from(root.children).map((row) =>
    Array.from(row.children).map((cell) => cell.style.background !== "transparent"));
}

test("it is hidden from screen readers rather than announced as a code", async () => {
  // It is decoration standing in for something not yet issued; announcing "QR code" would
  // claim there is a link here when there is none.
  const root = await draw();
  assert.equal(root.getAttribute("aria-hidden"), "true");
  assert.equal(screen.queryByRole("img"), null);
});

test("it is not a size any QR version comes in, so nothing can scan it", async () => {
  // A scannable square before issue would resolve to a live link nobody chose. QR versions
  // are 21, 25, 29 … modules square; a 17-module grid is none of them.
  const rows = grid(await draw());
  const n = rows.length;
  assert.ok(rows.every((row) => row.length === n), "the grid is not square");
  assert.ok(n < 21 || (n - 21) % 4 !== 0, `a ${n}-module grid is a real QR size`);
});

test("it carries no link, text or encoded payload", async () => {
  // Nothing on it resolves anywhere: no anchor, no URL, no words.
  const root = await draw();
  assert.equal(root.querySelector("a, svg, img"), null);
  assert.equal(root.textContent, "");
});

test("every render is identical, so screenshots are stable", async () => {
  // Fixed seed: two renders, the same picture, cell for cell.
  const first = grid(await draw());
  cleanup();
  const second = grid(await draw());
  assert.deepEqual(first, second);
});

test("it still looks like a QR code, finder corners and all", async () => {
  // It stands in for the real thing on the share screen, so the three finder squares are
  // drawn: a dark ring, a light ring, a dark centre, in three corners.
  const rows = grid(await draw());
  const n = rows.length;
  const finder = (ox, oy) => {
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const ring = Math.max(Math.abs(x - 2), Math.abs(y - 2));
        assert.equal(rows[oy + y][ox + x], ring !== 1, `finder at ${ox},${oy} wrong at ${x},${y}`);
      }
    }
  };
  finder(0, 0);
  finder(n - 5, 0);
  finder(0, n - 5);
});

test("the cell size is the caller's", async () => {
  // The share screen sizes it; a fixed cell would not.
  const root = await draw({ cell: 5 });
  const cell = root.firstChild.firstChild;
  assert.equal(cell.style.width, "5px");
  assert.equal(cell.style.height, "5px");
});
