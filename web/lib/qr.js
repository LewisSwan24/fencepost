// Turning an issued share code into a scannable square.
//
// The placeholder this replaces carried its own reason: "a scannable code is actually
// dangerous in a prototype, because the link it resolves to is live". That was right about
// a code drawn before anything has been issued — there is nothing to encode, so a square on
// screen would have to point somewhere invented or somewhere real, and both are wrong.
//
// It stops being true once a code exists. A square that encodes the token the owner has
// just issued resolves to exactly the level they chose, for exactly as long as they chose.
// That is not a hazard, it is the product. So the share screen keeps the placeholder until
// there is a code and draws the real thing afterwards — which is also the first moment the
// line underneath it, that a real code is generated when you share, is true.

import qrcode from "qrcode-generator";

// M corrects about 15% of the square. A phone camera held at a fence after dark is not a
// clean read, and the level below it, L, corrects 7% and is the one that fails in poor
// light. The levels above cost modules the token does not need.
const CORRECTION = "M";

// 0 asks the library for the smallest version the data fits in. A fixed version would
// either waste modules on a short token or refuse a longer one.
const AUTO_VERSION = 0;

/**
 * The URL a scan should land on.
 *
 * Kept apart from the drawing so that the part deciding where people end up can be tested
 * without a DOM, which is where the risk actually is: a square nobody can read is a visible
 * failure, and a square that reads correctly to the wrong place is not.
 */
export function shareUrl(origin, token) {
  if (!origin || !token) return null;
  return origin.replace(/\/+$/, "") + "/s/" + token;
}

/**
 * A square matrix of booleans, true where a module is dark.
 *
 * Returns null for an empty or unencodable value rather than throwing. The only caller is a
 * render path, and a screen that cannot draw a code should fall back to the placeholder,
 * not take the share screen down with it.
 */
export function matrix(value) {
  if (!value) return null;
  try {
    const code = qrcode(AUTO_VERSION, CORRECTION);
    code.addData(value);
    code.make();
    const size = code.getModuleCount();
    const rows = [];
    for (let y = 0; y < size; y += 1) {
      const row = [];
      for (let x = 0; x < size; x += 1) row.push(code.isDark(y, x));
      rows.push(row);
    }
    return rows;
  } catch {
    return null;
  }
}
