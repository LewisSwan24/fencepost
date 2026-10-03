// Boxes: what counts as one, and where it lands in the pixels.
//
// This file used to answer a different question — how much of an invented FACE or NUMBER
// PLATE rectangle a box covered — because the masking screen's gate was "cover these two".
// Those rectangles came from the fixture and bore no relation to anybody's own footage, so
// the gate could be satisfied exactly while a real face stayed in shot. The screen now shows
// the frame and asks the person what needs covering, and the coverage arithmetic went with
// the question it answered (2026-09-16).
//
// What is left is the part that decides the outcome: whether a drag was deliberate, and the
// rectangle redact() paints. The CLAUDE.md safety line is enforced there now.

// A twitchy tap is not a box. Below this, a stray touch could tick a target off without
// anybody meaning to draw anything.
export const SMALLEST_BOX = 5;

export function isDeliberate(box) {
  return Boolean(box) && box.w >= SMALLEST_BOX && box.h >= SMALLEST_BOX;
}

// Masking from a keyboard (#46). Drawing was a drag and nothing else, so somebody without a
// pointer could say "nothing to cover" and could not cover anything — the one answer the
// gate exists to get out of them was the one they could not give.
//
// A placed mask starts in the middle at a size that is plainly a mask, and the keys move it
// in steps of KEY_STEP percent. It keeps to the same rules as a drag: inside the frame, and
// never smaller than SMALLEST_BOX.
export const PLACED_BOX = { x: 35, y: 35, w: 30, h: 30 };
export const KEY_STEP = 2;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Arrows move; with resize, Right and Down grow it, Left and Up shrink it, from the top-left
// corner so the mask stays where it was put. Any other key answers null.
export function nudge(box, key, resize = false) {
  const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
  if (!d) return null;
  const [dx, dy] = d.map((n) => n * KEY_STEP);
  if (resize) {
    return { ...box,
             w: clamp(box.w + dx, SMALLEST_BOX, 100 - box.x),
             h: clamp(box.h + dy, SMALLEST_BOX, 100 - box.y) };
  }
  return { ...box, x: clamp(box.x + dx, 0, 100 - box.w), y: clamp(box.y + dy, 0, 100 - box.h) };
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
