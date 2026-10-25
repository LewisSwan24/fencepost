import { species } from "./data.js";
import { config } from "./config.js";
export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const asset = (path) => new URL("../" + path, import.meta.url).href;
export const name = (id) =>
  species.find((s) => s.id === id)?.name || "Not sure";
export const opts = (items, current) =>
  items
    .map((x) => {
      const value = typeof x === "string" ? x : x.id,
        label = typeof x === "string" ? x : x.name;
      return `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
    })
    .join("");
export const button = (text, action, extra = "") =>
  `<button type="button" data-action="${action}" ${extra}>${text}</button>`;
export const image = (path, alt, cls = "") =>
  `<img class="${cls}" src="${esc(path?.startsWith("assets/") ? asset(path) : path || asset("assets/placeholder.svg"))}" alt="${esc(alt)}" loading="lazy">`;
export function setupImages(root = document) {
  root.querySelectorAll("img").forEach((img) =>
    img.addEventListener(
      "error",
      () => {
        img.src = asset("assets/placeholder.svg");
        img.alt = "Wildlife photograph unavailable — read the description";
      },
      { once: true },
    ),
  );
}
export function fencepostUrl(hash = "stories") {
  const base = config.fencepostBaseUrl
    ? new URL(config.fencepostBaseUrl)
    : new URL("../fencepost/index.html", import.meta.url);
  base.searchParams.set("park", config.park);
  base.hash = hash;
  return base.href;
}
export const sourceLink = (url, label = "Information source") =>
  /^https:\/\//.test(url || "")
    ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${label} ↗</a>`
    : "";
export const modeNote = (live) =>
  `<p class="mode-note">${live ? "Connected prototype · human review before publication" : "Local demo only · fictional content · stored in this browser, not shared between devices. Do not enter real personal or rescue details."}</p>`;
