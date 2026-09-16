// Boxes, and where they land in the pixels.
//
//   node --test lib/mask.test.mjs
//
// CLAUDE.md: faces and number plates must be covered. Everything else about that promise is
// copy on a screen; this is the part that decides — and where "this" is has moved. It used
// to be coverage arithmetic against two rectangles from the fixture, which is a gate that
// can be passed exactly while a real face stays in shot, so that went with the screen that
// asked for it (2026-09-16). What decides now is whether a drag counted as a box, and the
// rectangle redact() paints over the frame before it is sent.
//
// Coordinates are percentages of the frame, which is how boxes are drawn and stored.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isDeliberate, boxPixels, SMALLEST_BOX } from "./mask.js";

test("a twitchy tap is not a box", () => {
  // Without this a stray touch while scrolling could tick a target off having drawn
  // nothing anybody can see.
  assert.equal(isDeliberate({ x: 30, y: 30, w: 0, h: 0 }), false);
  assert.equal(isDeliberate({ x: 30, y: 30, w: SMALLEST_BOX - 0.1, h: 20 }), false, "thin sliver");
  assert.equal(isDeliberate({ x: 30, y: 30, w: 20, h: SMALLEST_BOX - 0.1 }), false, "flat sliver");
  assert.equal(isDeliberate({ x: 30, y: 30, w: SMALLEST_BOX, h: SMALLEST_BOX }), true);
  assert.equal(isDeliberate(null), false);
  assert.equal(isDeliberate(undefined), false);
});


// Turning a drawn box into the rectangle that actually gets painted over the frame.
//
// Until 2026-09-16 nothing did this: the boxes were measured, the gate opened, and the
// untouched still was what got sent. The screen said "Covered" and meant nothing by it.
// These tests are about the one direction the arithmetic is allowed to be wrong in.
test("a box becomes the same fraction of the pixels", () => {
  assert.deepEqual(boxPixels({ x: 50, y: 50, w: 50, h: 50 }, 720, 1280),
                   { x: 360, y: 640, w: 360, h: 640 });
});

test("rounding always covers more, never less", () => {
  // A face is not covered by a rectangle one pixel short of it. Origins floor, extents
  // ceil, so every box grows outward rather than settling to the nearest pixel.
  const px = boxPixels({ x: 10.4, y: 10.4, w: 20.3, h: 20.3 }, 1000, 1000);
  assert.ok(px.x <= 104, `left edge moved inward to ${px.x}`);
  assert.ok(px.y <= 104, `top edge moved inward to ${px.y}`);
  assert.ok(px.x + px.w >= 307, `right edge stopped short at ${px.x + px.w}`);
  assert.ok(px.y + px.h >= 307, `bottom edge stopped short at ${px.y + px.h}`);
});

test("a box hanging off the edge is held inside the frame", () => {
  const px = boxPixels({ x: 80, y: 80, w: 50, h: 50 }, 720, 1280);
  assert.equal(px.x + px.w, 720);
  assert.equal(px.y + px.h, 1280);
});

test("a box covering everything covers exactly everything", () => {
  assert.deepEqual(boxPixels({ x: 0, y: 0, w: 100, h: 100 }, 720, 1280),
                   { x: 0, y: 0, w: 720, h: 1280 });
});

test("something that is not a box paints nothing", () => {
  // null rather than a zero-sized rectangle, so the caller can tell the difference between
  // "nothing to paint" and "paint this empty thing".
  for (const bad of [null, undefined, {}, { x: 1, y: 1, w: 0, h: 10 },
                     { x: 1, y: 1, w: 10, h: 0 }, { x: "a", y: 1, w: 10, h: 10 }]) {
    assert.equal(boxPixels(bad, 720, 1280), null);
  }
  assert.equal(boxPixels({ x: 1, y: 1, w: 10, h: 10 }, 0, 1280), null);
});
