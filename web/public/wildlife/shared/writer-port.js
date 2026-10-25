// Tidying logic ported from LewisSwan24/fencepost main, web/lib/fixtures.js, tidy().
// The writing-only adapter deliberately excludes the old fun_facts candidates.
export function tidy(story) {
  let t = String(story || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!t) return null;
  t = t.replace(/\bi\b/g, "I").replace(/\s+([,.!?])/g, "$1");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += ".";
  return t;
}

// Exhibition alternatives wrap the original tidier; they introduce no observed detail.
export function writingVariant(original, tidied, variant = 0) {
  if (variant % 3 === 1) {
    if (/^saw\b/i.test(tidied)) return tidied.replace(/^saw\b/i, "I noticed");
    if (/^I saw\b/i.test(tidied))
      return tidied.replace(/^I saw\b/i, "I noticed");
  }
  if (variant % 3 === 2) return "Observation: " + tidied;
  return tidied;
}
