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
export const artwork = {
  brushtail: 0,
  "flying-fox": 1,
  "water-dragon": 2,
  magpie: 3,
  kangaroo: 4,
  "blue-tongue": 5,
  planting: 6,
  cleanup: 7,
  park: 8,
  volunteers: 9,
  pond: 10,
  garden: 11,
};
export const image = (path, alt, cls = "") => {
  const legacy = /^assets\/species-(.+)\.svg$/.exec(path || "");
  if (legacy) path = "illustration:" + legacy[1];
  if (path?.startsWith("illustration:")) {
    const key = path.split(":")[1],
      cell = artwork[key] ?? artwork.park,
      col = cell % 4,
      row = Math.floor(cell / 4);
    return `<figure class="illustrated ${esc(cls)}"><svg class="art" viewBox="${col * 362} ${row * 362} 362 362" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${esc(alt)} — original illustrative artwork"><title>${esc(alt)} — original illustrative artwork</title><image href="${asset("assets/neighbours-illustrations.webp")}" width="1448" height="1086" /></svg><figcaption>Original illustration · prototype content</figcaption></figure>`;
  }
  return `<img class="${esc(cls)}" src="${esc(path?.startsWith("assets/") ? asset(path) : path || asset("assets/neutral-fallback.svg"))}" alt="${esc(alt)}" loading="lazy">`;
};
export function setupImages(root = document) {
  root.querySelectorAll("img").forEach((img) =>
    img.addEventListener(
      "error",
      () => {
        img.src = asset("assets/neutral-fallback.svg");
        img.alt =
          "Illustration of a neighbourhood park; original image unavailable";
      },
      { once: true },
    ),
  );
  root.querySelectorAll("svg.art image").forEach((img) =>
    img.addEventListener(
      "error",
      () => {
        const svg = img.closest("svg");
        svg.setAttribute("viewBox", "0 0 1200 800");
        img.setAttribute("href", asset("assets/neutral-fallback.svg"));
        img.setAttribute("width", "1200");
        img.setAttribute("height", "800");
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
  `<p class="mode-note">${live ? "Connected prototype · wildlife posts require human review" : "Local demo only · fictional content · stored in this browser, not shared between devices. Do not enter real personal or rescue details."}</p>`;
