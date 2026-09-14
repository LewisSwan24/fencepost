// The masking gate, which is where a safety line is actually enforced in code.
//
//   node --test lib/mask.test.mjs
//
// CLAUDE.md: faces and number plates must be covered. Everything else about that promise
// is copy on a screen; this is the part that decides. It used to sit inside the mask
// screen, where the suite could not reach it, and the screen's own header called it a hard
// requirement that the gate "really measures coverage rather than letting a single tap
// through" — a hard requirement nothing checked.
//
// Coordinates are percentages of the frame, which is how boxes are drawn and stored.

import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, covered, isDeliberate, COVERED_ENOUGH, SMALLEST_BOX } from "./mask.js";
import { CLIP } from "./fixtures.js";

const TARGET = { x: 20, y: 20, w: 10, h: 10 };

test("a box laid over the target covers it", () => {
  assert.equal(coverage(TARGET, [{ x: 18, y: 18, w: 14, h: 14 }]), 1);
  assert.equal(covered(TARGET, [{ x: 18, y: 18, w: 14, h: 14 }]), true);
});

test("a box swallowing the whole frame is still only 1, never more", () => {
  // The ratio is intersection over target area, so a huge box cannot score above 1 and
  // cannot be used to make up for a second target being uncovered.
  assert.equal(coverage(TARGET, [{ x: 0, y: 0, w: 100, h: 100 }]), 1);
});

test("a box somewhere else covers nothing", () => {
  assert.equal(coverage(TARGET, [{ x: 60, y: 60, w: 20, h: 20 }]), 0);
  assert.equal(covered(TARGET, [{ x: 60, y: 60, w: 20, h: 20 }]), false);
});

test("a box that only lines up on one axis covers nothing", () => {
  // This is what the two Math.max(0, ...) clamps are for. Without them a box diagonally
  // away from the target multiplies two negative overlaps into a positive area, and a
  // face nowhere near the box reads as covered.
  assert.equal(coverage(TARGET, [{ x: 20, y: 60, w: 10, h: 10 }]), 0, "same columns, different rows");
  assert.equal(coverage(TARGET, [{ x: 60, y: 20, w: 10, h: 10 }]), 0, "same rows, different columns");
  assert.equal(coverage(TARGET, [{ x: 60, y: 60, w: 10, h: 10 }]), 0, "away on both axes");
});

test("nothing drawn covers nothing", () => {
  assert.equal(coverage(TARGET, []), 0);
  assert.equal(covered(TARGET, []), false);
});

test("the threshold is the threshold, not a shade over it", () => {
  // Exactly COVERED_ENOUGH has to pass. The comparison is >=, and a > here would mean a
  // box that is precisely good enough is refused, with nothing on screen to explain why.
  const full = { x: 0, y: 0, w: 100, h: 100 };
  const exactly = { x: 0, y: 0, w: 100, h: COVERED_ENOUGH * 100 };
  assert.equal(coverage(full, [exactly]), COVERED_ENOUGH);
  assert.equal(covered(full, [exactly]), true);
  assert.equal(covered(full, [{ x: 0, y: 0, w: 100, h: COVERED_ENOUGH * 100 - 1 }]), false);
});

test("two boxes that between them cover a target do not count", () => {
  // Deliberate, and the direction to be wrong in: it asks for more than it needs rather
  // than less. Each half is well short on its own, and the gate stays shut.
  const left = { x: 20, y: 20, w: 5, h: 10 };
  const right = { x: 25, y: 20, w: 5, h: 10 };
  assert.equal(coverage(TARGET, [left, right]), 0.5, "the best single box, not the union");
  assert.equal(covered(TARGET, [left, right]), false);
});

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

test("both targets on the real clip can be covered, and neither covers the other", () => {
  // The fixture the screen actually uses. A box over one target must not tick off the
  // other, or a person could send a frame with a number plate in plain sight.
  const [face, plate] = CLIP.mask_targets;
  const overFace = { x: face.x - 1, y: face.y - 1, w: face.w + 2, h: face.h + 2 };

  assert.equal(covered(face, [overFace]), true);
  assert.equal(covered(plate, [overFace]), false, "covering the face ticked off the plate");
});
