// Full-page screenshots of every park route, at desktop and phone width, over Chrome's
// DevTools protocol. Signed-in routes sign in with the park's own demo seed accounts
// (public/wildlife/shared/demo-accounts.js), from inside the page.
//
//   node scripts/shoot.mjs <out-dir> [base-url] [only-name,...]
//
// Local dev in fixtures mode only: the demo accounts exist only in the browser's storage.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [out, base = "http://localhost:3030", only] = process.argv.slice(2);
if (!out) throw Error("usage: node scripts/shoot.mjs <out-dir> [base-url] [names]");
mkdirSync(out, { recursive: true });

const ROUTES = [
  ["home", "/"],
  ["story", "/park#story/story-brushtail"],
  ["learn", "/park#learn"],
  ["species", "/park#species/brushtail"],
  ["activity", "/park#activity/brushtail"],
  ["help", "/park#help"],
  ["share", "/park#share"],
  ["share-errors", "/park#share", { submit: "#observation-form" }],
  ["rescue", "/park#rescue"],
  ["community", "/park#community"],
  ["updates", "/park#updates"],
  ["update", "/park#update/update-pond-demo"],
  ["opportunity", "/park#opportunity/habitat-demo"],
  ["register", "/park#register/habitat-demo"],
  ["receipts", "/park#receipts"],
  ["credits", "/park#credits"],
  ["login", "/park#login"],
  ["my-observations", "/park#my-observations", { as: "user" }],
  ["registrations", "/park#registrations", { as: "user" }],
  ["moderator", "/park#moderator", { as: "moderator" }],
  // The storyboard app (fixtures mode; the name gate is skipped there).
  ["l-sign-in", "/sign-in"],
  ["l-home", "/legacy"],
  ["l-board", "/b/sb_jacaranda"],
  ["l-board-roof", "/b/sb_roof"],
  ["l-add", "/b/sb_jacaranda/add"],
  ["l-species", "/b/sb_jacaranda/add/species"],
  ["l-write", "/b/sb_jacaranda/add/write"],
  ["l-share", "/b/sb_jacaranda/share"],
  ["l-forum", "/b/sb_jacaranda/forum"],
  ["l-review", "/b/sb_jacaranda/review"],
  ["l-close", "/b/sb_jacaranda/close"],
  ["l-you", "/you"],
  ["l-credits", "/credits"],
  ["l-no-access", "/no-access"],
  ["l-study", "/study"],
];
const SIZES = [["desktop", 1440, 900], ["phone", 390, 844]];

const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "shoot-"));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
    .then((list) => list.find((t) => t.type === "page")).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const waiting = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, (m) => (m.error ? reject(Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const run = async (expression) => (await send("Runtime.evaluate",
  { expression, awaitPromise: true, returnByValue: true })).result?.value;

await send("Page.enable");
await send("Runtime.enable");

async function signIn(role) {
  await send("Page.navigate", { url: base + "/park#stories" });
  await sleep(2500);
  await run(`(async () => {
    const api = await import("/wildlife/shared/api.js");
    const { demoAccounts } = await import("/wildlife/shared/demo-accounts.js");
    const who = demoAccounts.find((a) => a.role === ${JSON.stringify(role)});
    await api.login(who.email, who.password);
  })()`);
}

// What each page measures, in the page: sideways overflow, how many font sizes the text
// uses, text under 13px, text under WCAG contrast, and tap targets under 44px tall
// (inline links inside a sentence are exempt, as WCAG 2.5.8 exempts them).
const MEASURE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && +s.opacity > 0.05; };
  const rgb = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => [r, g, b].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bg = (e) => { for (let n = e; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor);
    if (c.length < 4 || c[3] > 0.5) return c; } return [255, 255, 255]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const app = document.querySelector(".fencepost-app") || document.body;
  const texts = [...app.querySelectorAll("*")].filter((e) => vis(e) &&
    [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1));
  const sizes = new Set(), tiny = [], low = [];
  for (const e of texts) {
    const s = getComputedStyle(e), fs = parseFloat(s.fontSize);
    sizes.add(fs);
    if (fs < 13) tiny.push(fs + "px " + e.textContent.trim().slice(0, 30));
    const big = fs >= 24 || (fs >= 18.66 && +s.fontWeight >= 700), r = ratio(rgb(s.color), bg(e));
    if (r < (big ? 3 : 4.5)) low.push(r.toFixed(2) + " " + e.textContent.trim().slice(0, 30));
  }
  const inSentence = (a) => a.tagName === "A" && /^(P|LI|SPAN|DD|SMALL)$/.test(a.parentElement.tagName) &&
    a.parentElement.textContent.trim().length > a.textContent.trim().length + 3;
  const small = [...app.querySelectorAll("a,button,input,select,textarea,summary")]
    .filter((e) => vis(e) && !inSentence(e) && e.type !== "checkbox" && e.getBoundingClientRect().height < 44)
    .map((e) => Math.round(e.getBoundingClientRect().height) + "px " + (e.textContent || e.name || "").trim().slice(0, 24));
  return { overflowX: document.documentElement.scrollWidth - innerWidth, sizes: [...sizes].sort((a, b) => a - b),
    under13: tiny.slice(0, 5), lowContrast: low.slice(0, 5), smallTargets: small.slice(0, 6) };
})()`;
const metrics = {};
let signedAs = null;
for (const [name, path, opt = {}] of ROUTES) {
  if (only && !only.split(",").includes(name)) continue;
  const as = opt.as || null;
  if (as !== signedAs) {
    await run("localStorage.clear(); sessionStorage.clear()").catch(() => {});
    if (as) await signIn(as);
    signedAs = as;
  }
  for (const [tag, w, h] of SIZES) {
    await send("Emulation.setDeviceMetricsOverride",
      { width: w, height: h, deviceScaleFactor: 1, mobile: tag === "phone" });
    await send("Page.navigate", { url: base + "/park#blank" });
    await sleep(150);
    await send("Page.navigate", { url: base + path });
    await sleep(2200);
    if (opt.submit) {
      await run(`document.querySelector(${JSON.stringify(opt.submit)})?.requestSubmit()`);
      await sleep(400);
      await run("window.scrollTo(0, 0)");
    }
    metrics[`${name}-${tag}`] = await run(MEASURE);
    const height = Math.min(await run("document.documentElement.scrollHeight"), 12000);
    // A viewport as tall as the page, so a fixed bar sits at the bottom of the picture
    // instead of wherever the first screen ended.
    await send("Emulation.setDeviceMetricsOverride",
      { width: w, height, deviceScaleFactor: 1, mobile: tag === "phone" });
    await sleep(250);
    const shot = await send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height, scale: 1 },
    });
    writeFileSync(join(out, `${name}-${tag}.png`), Buffer.from(shot.data, "base64"));
    console.log(`ok  ${name}-${tag}  ${w}x${height}`);
  }
}
writeFileSync(join(out, "metrics.json"), JSON.stringify(metrics, null, 1));
ws.close();
proc.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
