// Time display. In the prototype these two functions lived in fixtures, because there was
// nowhere else to put them; in the real implementation they have nothing to do with data,
// so they get a file of their own.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function relative(iso, now = new Date()) {
  if (!iso) return "";
  const then = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(then)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return days + " days ago";
  return then.getDate() + " " + MONTHS[then.getMonth()];
}

// The forward-looking half. `relative()` only ever counts backwards: any future time falls
// into the days <= 0 branch and comes back as "today". The share screen used it for a
// code expiry, so a code expiring on 30 October read "Expires today" — enough to make
// somebody revoke a perfectly good code and issue another. Found running fixtures locally
// on 2026-09-14, not reasoned about.
export function until(iso, now = new Date()) {
  if (!iso) return "";
  const then = new Date(iso);
  const days = Math.round((dayStart(then) - dayStart(now)) / 86400000);
  if (days < 0) return "expired";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return "in " + days + " days";
  return then.getDate() + " " + MONTHS[then.getMonth()];
}

export function stamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return d.getDate() + " " + MONTHS[d.getMonth()] + " · " + h + ":" + m + ampm;
}

// "2 Sep", for the collective line under a storyboard's count. Date only: the hour a
// street started keeping a storyboard is not the point, the fact that it has been going
// since early September is.
export function monthDay(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.getDate() + " " + MONTHS[d.getMonth()];
}

export function countLabel(n, one, many) {
  return n === 1 ? "1 " + one : n + " " + many;
}

// The two letters on an avatar. A handle looks like `mel_k`, so take the first letter of
// each part; with only one part, take the first two characters. The home page used to have
// "mk / mel_k" hard-coded in the markup, so signing in with a different handle left the
// header still saying you were mel_k.
export function initials(handle) {
  // The random tail on a chosen name is not part of the name. Without this, "lewis-9ffe" is
  // two parts and the avatar reads "l9" — while the share screen, which takes the first two
  // characters of the handle instead, reads "le" for the same person on the same evening.
  // Both derivations predate the suffix; a handle with one is what made them disagree.
  const named = String(handle || "").replace(/-[0-9a-f]{4}$/, "");
  const parts = named.split(/[_.\-\s]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLowerCase();
  return (parts[0][0] + parts[1][0]).toLowerCase();
}
