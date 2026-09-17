// Why the camera did not open, and what to say about it.
//
// This lives in lib/ rather than beside the component for one reason: npm test runs
// lib/*.test.mjs and nothing else, so a table of copy keys looked up dynamically is only
// checkable from here. lib/copy.test.mjs finds COPY.<key> by regex, which cannot see
// COPY[NOTICES[reason].title] — a typo in the table below would render the string "undefined"
// on screen with the whole suite green. The test beside this file closes that hole.

/**
 * A getUserMedia rejection, reduced to one of four stories.
 *
 * These are four different things to do, not four spellings of "unavailable":
 *
 *   denied   you told the browser no. Script cannot ask again; the address bar can.
 *   missing  there is no camera here. Sending this person to a camera app is nonsense.
 *   busy     another app has the lens. The commonest failure on Android, and the only one
 *            anybody fixes in ten seconds.
 *   other    the browser refused and did not say why.
 *
 * OverconstrainedError is filed under `missing` on purpose. It means no device satisfied the
 * constraints, which from where the user is standing is the same sentence as having no
 * camera — and the only constraint asked for here is a preference, so in practice reaching it
 * means the device list came back empty.
 */
export function reasonFor(error) {
  switch (error && error.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":   // the old prefixed spelling, still thrown by some builds
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
      return "busy";
    default:
      return "other";
  }
}

/**
 * The screen each reason gets: two copy keys and which way out to offer.
 *
 * `exit` is the part worth reading twice. A device with no camera is not helped by a button
 * that opens its camera app, so that one case offers the library instead. Offering the wrong
 * way out is worse than offering none — it reads as the app not having understood the answer
 * it just got.
 */
export const NOTICES = {
  denied: { title: "cameraDeniedTitle", body: "cameraDeniedBody", exit: "camera" },
  missing: { title: "cameraMissingTitle", body: "cameraMissingBody", exit: "library" },
  busy: { title: "cameraBusyTitle", body: "cameraBusyBody", exit: "camera" },
  other: { title: "cameraBlockedTitle", body: "cameraBlockedBody", exit: "camera" },
};

/**
 * Whether a camera is worth offering at all.
 *
 * Not a permission check — it cannot be, because asking is the only way to find out whether
 * the answer is yes. This is the weaker question of whether the API exists, which is false on
 * http (getUserMedia is secure-context only, so an origin without TLS has no mediaDevices)
 * and on older browsers.
 */
export function cameraSupported() {
  return typeof navigator !== "undefined"
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function";
}
