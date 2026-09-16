// The masking gate: whether a face or a number plate is covered enough to send the frame.
//
// This lived inside the mask screen, which meant the one place a CLAUDE.md safety line is
// enforced in code had no test and could not have one — the screen is a client component
// and the suite runs without a DOM. The numbers and the comparison are unchanged; they
// have only moved somewhere they can be checked.

// Carried over from the screen unchanged. Not 1: a box drawn with a thumb never lands
// exactly on a target, and a gate that demanded perfection would be answered by scribbling
// over the whole frame, which hides the sighting along with the face.
export const COVERED_ENOUGH = 0.78;

// A twitchy tap is not a box. Below this, a stray touch could tick a target off without
// anybody meaning to draw anything.
export const SMALLEST_BOX = 5;

export function isDeliberate(box) {
  return Boolean(box) && box.w >= SMALLEST_BOX && box.h >= SMALLEST_BOX;
}

// How much of `target` the best single box covers, from 0 to 1. Everything is in percent
// of the frame, which is how the boxes are drawn and stored.
//
// Best single box, not the union of all of them: two boxes that between them cover a
// target do not count as covering it. That is the direction to be wrong in, since it asks
// for more than it needs to rather than less, and it is what the screen has always done.
export function coverage(target, boxes) {
  let best = 0;
  for (const b of boxes) {
    const ix = Math.max(0, Math.min(b.x + b.w, target.x + target.w) - Math.max(b.x, target.x));
    const iy = Math.max(0, Math.min(b.y + b.h, target.y + target.h) - Math.max(b.y, target.y));
    best = Math.max(best, (ix * iy) / (target.w * target.h));
  }
  return best;
}

export function covered(target, boxes) {
  return coverage(target, boxes) >= COVERED_ENOUGH;
}

// The rectangle to actually paint, in pixels of the frame.
//
// Until 2026-09-16 nothing converted these: the boxes were measured, the gate opened, and
// the untouched still was what got sent. The screen said "Covered" and meant nothing by it.
//
// Rounding goes outward, never to the nearest. A face is not covered by a rectangle one
// pixel short of it, and the cost of being generous is a few pixels of tree.
export function boxPixels(box, width, height) {
  if (!box || !width || !height) return null;
  const sides = [box.x, box.y, box.w, box.h];
  if (sides.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  if (box.w <= 0 || box.h <= 0) return null;

  const left = Math.max(0, Math.floor((box.x / 100) * width));
  const top = Math.max(0, Math.floor((box.y / 100) * height));
  const right = Math.min(width, Math.ceil(((box.x + box.w) / 100) * width));
  const bottom = Math.min(height, Math.ceil(((box.y + box.h) / 100) * height));
  // A box dragged entirely off the frame has nothing left inside it. Null rather than a
  // zero-sized rectangle, so the caller can tell "nothing to paint" from "paint nothing".
  if (right <= left || bottom <= top) return null;

  return { x: left, y: top, w: right - left, h: bottom - top };
}
