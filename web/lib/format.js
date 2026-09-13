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
