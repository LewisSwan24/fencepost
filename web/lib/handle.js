// What somebody types, turned into the name that follows them around.
//
// Until now a visitor who did not want an account was guest_9d83a54f5a4ff8a1, and that name
// appeared beside everything they wrote and in the list of who has access to a storyboard —
// the screen this product is about. A street keeping a storyboard together should not read
// like a server log.
//
// The suffix is the part that cannot be dropped. The server maps a handle to a user
// (proxy/app.py create_session), so if two visitors both typed "Sam" they would be handed
// the same identity, and then either could edit and delete the other's sightings. That is
// not hypothetical: it is the bug that giving every visitor an identity of their own was
// meant to fix. Four hex characters is not much, but it only has to separate the handful of
// people who type the same name on the same evening.
//
// lib/api.js keeps its own longer random name for the anonymous case, and the two are
// deliberately different lengths: there, sixteen characters *are* the whole name and have to
// be unique on their own; here the name carries the meaning and the suffix only has to tell
// two Sams apart.

// Eight, not four. Four was enough to tell two Sams apart and nothing like enough to stop
// somebody guessing which Sam you are: /api/session trades any handle for that user's token,
// with no password and — docs/operations.md is explicit — no rate limit. So sixteen bits
// meant a named visitor could be walked in 65,536 probes, and the one whose dashboard is not
// empty is the real person, along with their grants and their private timelines. An
// adversarial review measured it on 2026-09-16 and hit the victim at probe 244.
//
// Before names, a visitor was guest_ plus sixteen hex characters, and the documented position
// — that open sign-up widens what you can write, not what you can see — rested on handles
// being unguessable. Letting people choose a name is what broke that, so the suffix carries
// the weight instead: thirty-two bits puts the same walk in the billions.
//
// It is a bar, not a proof. The real answer is that a name alone should not buy a token,
// which is a server change and its own decision.
export const SUFFIX = 8;

// 24 + "-" + 8 = 33. proxy/app.py refuses a handle over 40 characters, and being refused at
// the door is a blank dashboard for somebody whose only mistake was a long name.
const MAX_NAME = 24;

function randomSuffix() {
  const bytes = new Uint8Array(SUFFIX / 2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Older embedded webviews. Math.random is weak, but this is not a secret — it is a
    // disambiguator, and the cost of a repeat is two people sharing a name.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The readable half: lowercased, with runs of anything else collapsed to one underscore.
 *
 * `\p{L}\p{N}` rather than `a-z0-9` is load-bearing. Stripping to ASCII would quietly hand
 * anybody who writes their name in Chinese, Cyrillic or te reo the random guest name
 * instead — the same judgement the screener is forbidden from making about a language it
 * reads less well, arriving through a different door. The server counts characters, not
 * bytes, and does not care which script they are in.
 */
function slug(name) {
  const cleaned = String(name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  // Clamping can land mid-separator, so trim again afterwards rather than leaving
  // "bartholomew_archibald_" to meet the suffix as "bartholomew_archibald_-4f2a".
  return cleaned.slice(0, MAX_NAME).replace(/_+$/, "");
}

/**
 * A handle, or null when the name had nothing usable in it.
 *
 * Null rather than a handle made of underscores: the caller then falls back to the random
 * guest name it already had, which is a worse name but a working one. Nobody is stopped at
 * this screen for typing something this function could not read.
 */
export function toHandle(name, suffix = randomSuffix()) {
  const base = slug(name);
  return base ? base + "-" + suffix : null;
}
