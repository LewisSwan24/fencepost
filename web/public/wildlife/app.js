import * as api from "./shared/api.js";
import { config } from "./shared/config.js";
import { species, isVerifiedOpportunity } from "./shared/data.js";
import {
  esc,
  asset,
  name,
  image,
  sourceLink,
  fencepostUrl,
  setupImages,
  modeNote,
} from "./shared/ui.js";
import { initControls } from "./shared/controls.js";
const main = document.querySelector("main");
const page = location.pathname.split("/").pop() || "index.html";
let narration;
let list = [],
  index = 0,
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches,
  timer,
  controls;
const intro = (n, title, description = "") =>
  `<section class="page-heading"><p class="eyebrow">${n}</p><h1>${title}</h1>${description ? `<p>${description}</p>` : ""}</section>`;
function storyHtml(s) {
  if (!s) return "<p>No approved stories are available yet.</p>";
  return `<article class="hero"><div class="hero-photo">${image(api.publicImage(s.mediaUrl), `Illustrative photograph or labelled placeholder: ${name(s.species)}`)}<span class="photo-note">${s.sample ? "Sample content · illustrative image" : "Reviewed public media"}</span></div><div class="story-copy"><p class="label">Neighbour Observation ${s.sample ? "· Sample" : ""}</p><h1>Possible ${esc(name(s.species))}</h1><p>${esc(s.storyText)}</p><dl class="story-meta"><div><dt>Public location</dt><dd>${esc(s.publicArea)}</dd></div><div><dt>Approximate time</dt><dd>${esc(s.approximateTime)}</dd></div></dl><aside class="fact"><span class="eyebrow">Wildlife reference information</span><p>${esc(s.verifiedFact)}</p>${sourceLink(s.factSource)}<p class="small">Source review pending unless confirmed by the responsible reviewer.</p></aside><p class="small">${s.species === "brushtail" && s.sample ? sourceLink("https://commons.wikimedia.org/wiki/File:Brushtail_Possum_IMG_5017.jpg", "Illustrative photo: Andrew Mercer · CC BY-SA 4.0") : ""}</p><p class="small">Approved for public display · Reviewed by ${esc(s.reviewedBy)}</p><div class="story-controls"><button data-action="previous">← Previous</button><span>${index + 1} / ${list.length}</span><button data-action="next">Next story →</button></div><div class="answers"><button data-action="pause">${paused ? "Resume rotation" : "Pause rotation"}</button><button data-action="narrate">Listen / pause narration</button></div><p id="audio-status" role="status"></p></div></article>`;
}
function drawStory() {
  const container = document.querySelector("#story");
  if (container) {
    container.innerHTML = storyHtml(list[index]);
    setupImages(container);
  }
}
function rotate() {
  clearInterval(timer);
  if (!paused)
    timer = setInterval(() => {
      if (!document.hidden && list.length) {
        index = (index + 1) % list.length;
        drawStory();
      }
    }, config.rotateMs);
}
function qr(url, label) {
  return `<a class="qr-link" href="${esc(url)}" target="_blank" rel="noreferrer" data-qr="${esc(url)}" aria-label="${esc(label)}"></a>`;
}
function drawQr() {
  document.querySelectorAll("[data-qr]").forEach((el) => {
    try {
      const code = window.qrcode(0, "M");
      code.addData(el.dataset.qr);
      code.make();
      el.innerHTML = code.createSvgTag({
        cellSize: 4,
        margin: 16,
        scalable: true,
      });
      el.querySelector("svg").setAttribute(
        "aria-label",
        el.getAttribute("aria-label"),
      );
    } catch {
      el.textContent = "Open Fencepost →";
    }
  });
}
async function load() {
  try {
    if (page === "index.html") {
      list = await api.stories();
      index = Math.min(index, Math.max(0, list.length - 1));
      const updates = await api.outcomes();
      main.innerHTML = `${modeNote(api.live)}<section class="intro"><p class="eyebrow">01 / Local Wildlife Story</p><span>Look. Learn. Leave space.</span></section><div id="story">${storyHtml(list[index])}</div><section class="home-zones"><a class="zone" href="help.html"><span class="eyebrow">02 / Is it hurt?</span><h2>What should I do?</h2><p>Keep your distance. Get practical guidance.</p></a><a class="zone" href="animals.html"><span class="eyebrow">03 / Meet the animal</span><h2>One small discovery</h2><p>Learn about six wild neighbours.</p></a><a class="zone" href="community.html"><span class="eyebrow">04 / Read, share or volunteer</span><h2>Continue in Fencepost</h2><p>No app download required.</p></a></section>${updates.length ? `<details class="outcome"><summary>Community Update ${updates[0].sample ? "· Sample" : ""}: ${esc(updates[0].title)}</summary>${updates[0].approvedImage ? image(api.publicImage(updates[0].approvedImage), "Reviewed community activity photograph") : ""}<p>${esc(updates[0].actionsCompleted)}</p><p>${esc(updates[0].communityMessage)}</p><p>No wildlife handling.</p></details>` : ""}`;
      rotate();
    } else if (page === "animals.html")
      main.innerHTML =
        intro(
          "03 / Meet the animal",
          "Who shares our neighbourhood?",
          "Choose an animal. Discover a safe way to live alongside it.",
        ) +
        `<section class="species-grid">${species.map((s) => `<a class="species-card" href="species.html?animal=${s.id}">${image(s.image, s.name)}<div><h2>${esc(s.name)}</h2><p>${esc(s.active)}</p><span>Meet the animal →</span></div></a>`).join("")}</section>`;
    else if (page === "species.html") {
      const s =
        species.find(
          (s) => s.id === new URLSearchParams(location.search).get("animal"),
        ) || species[0];
      main.innerHTML = `<a class="back" href="animals.html">← All animals</a><article class="species-detail">${image(s.image, s.name)}<div><p class="eyebrow">03 / Meet the animal</p><h1>${esc(s.name)}</h1><p><i>${esc(s.scientific)}</i></p><dl><dt>Active time</dt><dd>${esc(s.active)}</dd><dt>Habitat</dt><dd>${esc(s.habitat)}</dd><dt>Behaviour</dt><dd>${esc(s.behaviour)}</dd></dl><p class="guidance">${esc(s.advice)}</p><aside class="fact"><strong>Wildlife fact</strong><p>${esc(s.fact)}</p>${sourceLink(s.source)}<p class="small">${esc(s.sourceStatus)}</p></aside><details class="interaction"><summary>One optional family discovery</summary><p>An animal is nearby. What would you do?</p><div class="answers"><button data-action="safe">Watch quietly from a distance</button><button data-action="unsafe">Offer food</button></div><p id="learning-result" role="status"></p></details></div></article>`;
    } else if (page === "help.html") {
      const contacts = [...config.contacts, ...(await api.sources())].filter(
        (c) => c.verified && c.sourceUrl && c.reviewedAt,
      );
      main.innerHTML =
        intro(
          "02 / Is it hurt?",
          "Stay safe. Ask a wildlife rescuer.",
          "Keep children and pets away. Do not touch, feed or chase wildlife.",
        ) +
        `<section class="help-grid"><article class="action-card"><h2>Choose a situation</h2><div class="help-options">${["Animal appears healthy", "Animal may be injured", "Animal may be trapped", "Animal is on or near a road", "I am not sure"].map((x, i) => `<button data-action="guidance" data-index="${i}">${x}</button>`).join("")}</div></article><article><div id="guidance" role="status"><p>Choose a situation for short guidance.</p></div><h2>Professional contacts</h2>${contacts.length ? contacts.map((c) => `<p><strong>${esc(c.name)}</strong> · ${esc(c.phone)}</p>${sourceLink(c.sourceUrl, "Official source")}<p>Reviewed: ${esc(c.reviewedAt)}</p>`).join("") : "<p>Verified contact information is temporarily unavailable.</p>"}${sourceLink("https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife", "Queensland Government wildlife guidance")}<p class="small">Reference review pending. This prototype cannot dispatch rescue help.</p></article></section>`;
    } else if (page === "community.html") {
      const o = (await api.opportunities()).find(
          (o) => o.status !== "completed",
        ),
        url = fencepostUrl("stories");
      main.innerHTML =
        intro(
          "04 / Read, share or volunteer",
          "Care for the places we share.",
          "Participation is voluntary. Volunteers do not handle wildlife.",
        ) +
        `<section class="community-grid"><article><h2>Continue in Fencepost</h2><p>Read more, share a text or photo observation, join the discussion or view a sample community activity. No app download required.</p>${qr(url, "Scan to open Fencepost local park stories")}<a class="text-link" href="${esc(url)}" target="_blank" rel="noreferrer">Open park stories in Fencepost ↗</a><p class="small">All submissions and discussion await human review.</p></article>${o ? `<article class="action-card"><p class="label">${isVerifiedOpportunity(o) ? "Verified community opportunity" : "SAMPLE COMMUNITY ACTIVITY — PROTOTYPE ONLY"}</p><h2>${esc(o.title)}</h2><p>${esc(o.description)}</p><p>Date: ${o.dateConfirmed ? esc(o.date) : "To be confirmed"} · ${esc(o.duration)}</p><p>${esc(o.suitableFor)}</p><p>Wildlife handling: Not included</p>${qr(fencepostUrl("opportunity/" + o.id), "Scan for sample activity details and prototype registration")}<a href="${esc(fencepostUrl("opportunity/" + o.id))}" target="_blank" rel="noreferrer">Full details and register interest — prototype ↗</a><p class="small">Not a real booking. No confirmed organiser or event date.</p></article>` : "<p>No current community activity.</p>"}</section>`;
    }
    setupImages();
    drawQr();
    controls?.refresh();
  } catch {
    main.innerHTML =
      '<h1>We could not load the latest stories.</h1><p>Please try again. Private information has not been shown.</p><button data-action="retry">Try again</button>';
  }
}
main.addEventListener("click", (e) => {
  const external = e.target.closest('a[target="_blank"]');
  if (external) {
    e.preventDefault();
    paused = true;
    clearInterval(timer);
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<h2>Continue on your phone</h2><p>Scan for the source or Fencepost page. The display stays here.</p>${qr(external.href, "Scan to open the selected page")}<p class="small">${esc(external.href)}</p><button data-action="close-source">Back to the display</button>`;
    main.append(dialog);
    dialog.showModal();
    drawQr();
    controls?.refresh();
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  if (a === "close-source") {
    const dialog = el.closest("dialog");
    dialog.close();
    dialog.remove();
    controls?.refresh();
    return;
  }
  if (a === "next" || a === "previous") {
    window.speechSynthesis?.cancel();
    index = (index + (a === "next" ? 1 : -1) + list.length) % list.length;
    drawStory();
    rotate();
  }
  if (a === "pause") {
    paused = !paused;
    drawStory();
    rotate();
  }
  if (a === "retry") load();
  if (a === "safe" || a === "unsafe")
    document.querySelector("#learning-result").textContent =
      a === "safe"
        ? "Yes. Give it space, keep pets away and let it move on."
        : "Human food can harm wildlife. Watch from a distance instead.";
  if (a === "guidance") {
    const messages = [
      "If it is moving freely and shows no obvious distress, give it space and let it move on. If unsure, seek professional advice.",
      "Keep your distance. Contact an appropriate wildlife organisation directly. Do not handle the animal.",
      "Do not try to free or handle the animal. Stay back and seek professional advice.",
      "If driving, stop only when safe. Do not photograph or complete forms while driving. Keep clear of traffic.",
      "You do not need to decide alone. Stay back and ask an appropriate wildlife organisation for advice.",
    ];
    document.querySelector("#guidance").innerHTML =
      `<p class="notice">${messages[Number(el.dataset.index)]}</p>${sourceLink("https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife", "Official reference: Queensland Government")}<p class="small">Reference review pending. No exact wildlife location is available publicly.</p>`;
  }
  if (a === "narrate") {
    if (!("speechSynthesis" in window)) {
      document.querySelector("#audio-status").textContent =
        "Audio unavailable. Read the story above.";
      return;
    }
    if (speechSynthesis.speaking) {
      speechSynthesis.paused
        ? speechSynthesis.resume()
        : speechSynthesis.pause();
      return;
    }
    paused = true;
    clearInterval(timer);
    const s = list[index];
    const u = new SpeechSynthesisUtterance(
      `${s.storyText} Wildlife fact: ${s.verifiedFact}. Observe safely. Never approach, feed or handle wildlife.`,
    );
    narration = u;
    u.volume = controls.getVolume();
    u.onerror = () => {
      const target = document.querySelector("#audio-status");
      if (target)
        target.textContent = "Audio unavailable. Read the story above.";
    };
    speechSynthesis.speak(u);
  }
});
document.addEventListener("wn-volume", (event) => {
  if (window.speechSynthesis?.speaking && narration) {
    window.speechSynthesis.cancel();
    narration.volume = event.detail;
    window.speechSynthesis.speak(narration);
  }
});
document.addEventListener("wn-idle", () => {
  index = 0;
  paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
  drawStory();
  rotate();
});
window.addEventListener("storage", (e) => {
  if (e.key === "wn-demo-v2") load();
});
// Poll connected public projections, not private observations. Do not reset a user's selection mid-interaction.
if (api.live)
  setInterval(async () => {
    if (page !== "index.html") return;
    try {
      list = await api.stories();
      if (index >= list.length) index = 0;
      drawStory();
    } catch {
      const status = document.querySelector("#audio-status");
      if (status)
        status.textContent =
          "We could not load the latest stories. Please try again.";
    }
  }, 30000);
await load();
controls = initControls();
