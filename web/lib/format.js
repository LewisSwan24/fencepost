// 时间显示。原型里这两个函数写在 fixtures 里，那是因为它没有别的地方放；
// 真实现里它们和数据无关，所以单独一个文件。
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

// 往后看的那一面。`relative()` 只会往回算：任何未来时间都落进 days <= 0 那个分支，
// 一律回 "today"。分享页拿它显示码的有效期，于是一张 10 月 30 日才过期的码
// 写着「Expires today」——足以让人把一张好好的码作废重发。
// 2026-09-14 在本机跑 fixtures 看出来的，不是想出来的。
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

export function countLabel(n, one, many) {
  return n === 1 ? "1 " + one : n + " " + many;
}

// 头像上那两个字母。handle 是 `mel_k` 这种，取每段的首字母；只有一段就取前两个字符。
// 首页原先把「mk / mel_k」写死在标记里，于是换个 handle 登录，页头还在说你是 mel_k。
export function initials(handle) {
  const parts = String(handle || "").split(/[_.\-\s]+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toLowerCase();
  return (parts[0][0] + parts[1][0]).toLowerCase();
}
