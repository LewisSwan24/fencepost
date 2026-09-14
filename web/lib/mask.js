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
