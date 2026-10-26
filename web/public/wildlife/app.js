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
import { mountActivity } from "./shared/activities.js";
import { outcomeCard, outcomeDetail } from "./shared/presentation.js";
const main = document.querySelector("main");
const page = location.pathname.split("/").pop() || "index.html";
const query = new URLSearchParams(location.search);
let list = [],
  index = 0,
  timer,
  controls,
  narration,
  lastInteraction = Date.now(),
  pendingStories = null;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const intro = (label, title, text = "") =>
  `<section class="page-heading"><p class="eyebrow">${label}</p><h1>${title}</h1>${text ? `<p>${text}</p>` : ""}</section>`;
const returnLinks = (
  href = "index.html",
  label = "← Return to previous screen",
) =>
  `<nav class="return-options" aria-label="Return options"><a href="${esc(href)}">${label}</a><a href="index.html">⌂ Return to home</a></nav>`;
const selectedSpecies = () =>
  species.find((s) => s.id === query.get("animal")) || species[0];
function stopAudio() {
  window.speechSynthesis?.cancel();
}
function scheduleStory() {
  clearTimeout(timer);
  if (page !== "index.html" || reduceMotion.matches) return;
  timer = setTimeout(() => {
    if (
      document.hidden ||
      document.querySelector("dialog[open]") ||
      window.speechSynthesis?.speaking
    ) {
      scheduleStory();
      return;
    }
    if (Date.now() - lastInteraction < config.rotateMs) {
      scheduleStory();
      return;
    }
    if (pendingStories) {
      const current = list[index]?.id;
      list = pendingStories;
      pendingStories = null;
      index = Math.max(
        0,
        list.findIndex((s) => s.id === current),
      );
    }
    if (list.length) {
      index = (index + 1) % list.length;
      drawStory();
    }
    scheduleStory();
  }, config.rotateMs);
}
function activity() {
  lastInteraction = Date.now();
  scheduleStory();
}
["pointerdown", "pointermove", "keydown", "touchstart", "scroll"].forEach(
  (event) => window.addEventListener(event, activity, { passive: true }),
);
reduceMotion.addEventListener("change", scheduleStory);
function storyHtml(s, full = false) {
  if (!s) return "<p>No approved stories are available yet.</p>";
  const sp = species.find((x) => x.id === s.species);
  return `<article class="hero ${full ? "full-story" : ""}"><div class="hero-photo">${image(api.publicImage(s.mediaUrl) || sp?.image || "illustration:park", `Possible ${name(s.species)}`)}<span class="photo-note">${s.sample ? "Sample observation · illustrative image" : "Human-reviewed public media"}</span></div><div class="story-copy"><p class="status-label observation-label">Neighbour Observation ${s.sample ? "· Sample" : ""}</p><h1>Possible ${esc(name(s.species))}</h1><p>${esc(s.storyText)}</p><dl class="story-meta"><div><dt>Public location</dt><dd>${esc(s.publicArea)}</dd></div><div><dt>Approximate time</dt><dd>${esc(s.approximateTime)}</dd></div></dl><aside class="fact"><span class="eyebrow">Wildlife information · source linked</span><p>${esc(s.verifiedFact)}</p>${sourceLink(s.factSource)}<p class="small">Official source review pending unless confirmed by the responsible reviewer.</p></aside><p class="review-label">Approved for Public Display · Reviewed by ${esc(s.reviewedBy)}</p>${s.species === "brushtail" && s.sample ? `<p class="small">${sourceLink("https://commons.wikimedia.org/wiki/File:Brushtail_Possum_IMG_5017.jpg", "Illustrative photo: Andrew Mercer · CC BY-SA 4.0")}</p>` : ""}${full ? '<h2>Safe Response</h2><p>Observe quietly from a distance. Never approach, feed or handle wildlife.</p><p class="small">Broad area only. Contributor identity and private rescue details are not public.</p>' : `<p class="story-position">Story ${index + 1} of ${list.length}</p><div class="story-controls"><button data-action="previous">Previous story</button><button data-action="next">Next story</button><a class="link-button" href="story.html?id=${encodeURIComponent(s.id)}">Read full story →</a></div>`}<button data-action="narrate">Listen to story / pause narration</button><p id="audio-status" role="status"></p></div></article>`;
}
function drawStory() {
  const target = document.querySelector("#story");
  if (target) {
    target.innerHTML = storyHtml(list[index]);
    setupImages(target);
    controls?.refresh();
  }
}
function qr(url, label, interactive = true) {
  return interactive
    ? `<a class="qr-link" href="${esc(url)}" target="_blank" rel="noreferrer" data-qr="${esc(url)}" aria-label="${esc(label)}"></a>`
    : `<div class="qr-link" data-qr="${esc(url)}" aria-label="${esc(label)}"></div>`;
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
      el.textContent = "Open on your phone →";
    }
  });
}
async function load() {
  try {
    if (page === "index.html") {
      list = await api.stories();
      index = Math.min(index, Math.max(0, list.length - 1));
      main.innerHTML = `${modeNote(api.live)}<section class="intro"><p class="eyebrow">01 / Local Wildlife Story</p><span>Look. Learn. Leave space.</span></section><div id="story">${storyHtml(list[index])}</div><section class="home-zones"><a class="zone" href="help.html"><span class="eyebrow">02 / Is it hurt?</span><h2>What should I do?</h2><p>Read practical guidance without a phone.</p></a><a class="zone" href="animals.html"><span class="eyebrow">03 / Meet the animal</span><h2>Discover together</h2><p>Six animals. One small activity each.</p></a><a class="zone" href="community.html"><span class="eyebrow">04 / Read, share or volunteer</span><h2>Care for shared places</h2><p>Optional tasks and sample Community Updates.</p></a></section>`;
      scheduleStory();
    } else if (page === "story.html") {
      const all = await api.stories(),
        story = all.find((s) => s.id === query.get("id"));
      list = story ? [story] : [];
      index = 0;
      main.innerHTML =
        returnLinks() +
        `<p class="eyebrow">Read full story / Take your time</p>${story ? storyHtml(story, true) : "<h1>Story unavailable</h1><p>This observation is still being reviewed or has been removed.</p>"}`;
    } else if (page === "animals.html")
      main.innerHTML =
        returnLinks() +
        intro(
          "03 / Meet the animal",
          "Who shares our neighbourhood?",
          "Choose an animal. Learn one fact and try a short activity.",
        ) +
        `<section class="species-grid">${species.map((s) => `<a class="species-card" href="species.html?animal=${s.id}">${image(s.image, s.name)}<div><h2>${esc(s.name)}</h2><p>${esc(s.active)}</p><span>Meet the animal →</span></div></a>`).join("")}</section>`;
    else if (page === "species.html") {
      const s = selectedSpecies();
      main.innerHTML =
        returnLinks("animals.html") +
        `<article class="species-detail">${image(s.image, s.name)}<div><p class="eyebrow">03 / Meet the animal</p><h1>${esc(s.name)}</h1><p><i>${esc(s.scientific)}</i></p><dl><dt>Active time</dt><dd>${esc(s.active)}</dd><dt>Habitat</dt><dd>${esc(s.habitat)}</dd><dt>Behaviour</dt><dd>${esc(s.behaviour)}</dd></dl><p class="guidance">${esc(s.advice)}</p><aside class="fact"><strong>Wildlife fact · source linked</strong><p>${esc(s.fact)}</p>${sourceLink(s.source)}<p class="small">${esc(s.sourceStatus)}</p></aside><a class="link-button activity-start" href="activity.html?animal=${s.id}">Start a mini quiz together →</a></div></article>`;
    } else if (page === "activity.html") {
      const s = selectedSpecies();
      main.innerHTML =
        '<h1 class="quiz-page-heading">Meet the Animal quiz</h1><div id="activity-root"></div>';
      mountActivity(document.querySelector("#activity-root"), s.id, {
        animalUrl: `species.html?animal=${s.id}`,
        animalsUrl: "animals.html",
      });
    } else if (page === "help.html") {
      const contacts = [...config.contacts, ...(await api.sources())].filter(
        (c) => c.verified && c.sourceUrl && c.reviewedAt,
      );
      main.innerHTML =
        returnLinks() +
        intro(
          "02 / Is it hurt?",
          "Stay safe. Ask a wildlife rescuer.",
          "Keep children and pets away. Do not touch, feed or chase wildlife.",
        ) +
        `<section class="help-grid"><article class="action-card"><h2>Choose a situation</h2><div class="help-options">${["Animal appears healthy", "Animal may be injured", "Animal may be trapped", "Animal is on or near a road", "I am not sure"].map((text, i) => `<button data-action="guidance" data-index="${i}">${text}</button>`).join("")}</div></article><article><div id="guidance" role="status"><p>Choose a situation for short guidance.</p></div><h2>Professional contacts</h2>${contacts.length ? contacts.map((c) => `<p><strong>${esc(c.name)}</strong> · ${esc(c.phone)}</p>${sourceLink(c.sourceUrl, "Official source")}<p>Reviewed: ${esc(c.reviewedAt)}</p>`).join("") : "<p>Verified contact information is temporarily unavailable.</p>"}${sourceLink("https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife", "Queensland Government wildlife guidance")}<p class="small">Official reference review pending. This prototype cannot dispatch rescue help.</p></article></section>`;
    } else if (page === "community.html") {
      const o = (await api.opportunities()).find(
          (o) => o.status !== "completed",
        ),
        updates = await api.outcomes(),
        url = fencepostUrl("stories");
      main.innerHTML =
        returnLinks() +
        intro(
          "04 / Read, share or volunteer",
          "Care for the places we share.",
          "Participation is voluntary. Volunteers do not handle wildlife.",
        ) +
        `<section class="community-grid"><article>${image("illustration:park", "A general neighbourhood park")}<h2>Continue in Fencepost</h2><p>Read, share a text or photo observation, join the discussion or view optional activities. No app download required.</p>${qr(url, "Scan to open Fencepost local park stories")}<a class="text-link" href="${esc(url)}" target="_blank" rel="noreferrer">Open Fencepost park stories ↗</a></article>${o ? `<article class="action-card">${image(o.image || "illustration:volunteers", "Illustrated habitat care activity")}<p class="status-label opportunity-label">${isVerifiedOpportunity(o) ? "Verified Opportunity" : "SAMPLE COMMUNITY ACTIVITY — PROTOTYPE ONLY"}</p><h2>${esc(o.title)}</h2><p>${esc(o.description)}</p><p>${o.dateConfirmed ? esc(o.date) : "Date: To be confirmed"} · ${esc(o.duration)}</p><p>Wildlife handling: Not included</p>${qr(fencepostUrl("opportunity/" + o.id), "Scan for sample activity details and registration")}<a href="${esc(fencepostUrl("opportunity/" + o.id))}" target="_blank" rel="noreferrer">View sample activity on your phone →</a><p class="small">Registration is for demonstration only and is not sent to a real organiser.</p></article>` : "<p>No current community activity.</p>"}</section><section class="updates-section"><div class="section-heading"><h2>Community Updates</h2><a href="updates.html">View all updates →</a></div><p>Fictional exhibition records. These activities are not presented as real events.</p><div class="update-grid">${updates
          .slice(0, 2)
          .map((o) =>
            outcomeCard(o, "update.html?id=" + encodeURIComponent(o.id)),
          )
          .join("")}</div></section>`;
    } else if (page === "updates.html") {
      const updates = await api.outcomes();
      main.innerHTML =
        returnLinks("community.html") +
        intro(
          "04 / Community Updates",
          "Small actions. Shared care.",
          "These exhibition samples show how an activity could become a Community Update.",
        ) +
        `<div class="update-grid">${updates.map((o) => outcomeCard(o, "update.html?id=" + encodeURIComponent(o.id))).join("") || "<p>No published updates yet.</p>"}</div>`;
    } else if (page === "update.html") {
      const update = (await api.outcomes()).find(
        (o) => o.id === query.get("id"),
      );
      main.innerHTML =
        returnLinks("updates.html") +
        (update
          ? outcomeDetail(
              update,
              update.opportunityId
                ? fencepostUrl("opportunity/" + update.opportunityId)
                : null,
            )
          : "<h1>Update unavailable</h1>");
    }
    setupImages();
    drawQr();
    controls?.refresh();
  } catch {
    main.innerHTML =
      returnLinks() +
      '<h1>We could not load the latest stories.</h1><p>Please try again. Private information has not been shown.</p><button data-action="retry">Try again</button>';
  }
}
function closeSource(dialog) {
  dialog.close();
  dialog.remove();
  controls?.refresh();
  scheduleStory();
}
main.addEventListener("click", (e) => {
  const external = e.target.closest('a[target="_blank"]');
  if (external) {
    e.preventDefault();
    clearTimeout(timer);
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<h2>Continue on your phone</h2><p>Scan for the selected page. The display stays here.</p>${qr(external.href, "Scan to open the selected page", false)}<p class="small">${esc(external.href)}</p><button data-action="close-source">← Return to previous screen</button><a href="index.html">⌂ Return to home</a>`;
    dialog.addEventListener("cancel", (e) => e.preventDefault());
    main.append(dialog);
    dialog.showModal();
    drawQr();
    controls?.refresh();
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  if (action === "close-source") {
    closeSource(el.closest("dialog"));
    return;
  }
  if (action === "previous" || action === "next") {
    stopAudio();
    index = (index + (action === "next" ? 1 : -1) + list.length) % list.length;
    drawStory();
    scheduleStory();
  }
  if (action === "retry") load();
  if (action === "guidance") {
    const messages = [
      "If it is moving freely and shows no obvious distress, give it space and let it move on. If unsure, seek professional advice.",
      "Keep your distance. Contact an appropriate wildlife organisation directly. Do not handle the animal.",
      "Do not try to free or handle wildlife. Stay back and seek professional advice.",
      "If driving, stop only when safe. Do not photograph or complete forms while driving. Keep clear of traffic.",
      "You do not need to decide alone. Stay back and ask an appropriate wildlife organisation for advice.",
    ];
    document.querySelector("#guidance").innerHTML =
      `<p class="notice"><strong>Safe Response</strong><br>${messages[Number(el.dataset.index)]}</p>${sourceLink("https://www.qld.gov.au/environment/plants-animals/animals/care-injured-wildlife", "Official reference: Queensland Government")}<p class="small">Source review pending. No exact wildlife location is available publicly.</p>`;
  }
  if (action === "narrate") {
    const status = document.querySelector("#audio-status");
    if (!("speechSynthesis" in window)) {
      status.textContent = "Audio unavailable. Read the story above.";
      return;
    }
    if (speechSynthesis.speaking) {
      speechSynthesis.paused
        ? speechSynthesis.resume()
        : speechSynthesis.pause();
      return;
    }
    const story = list[index];
    if (!story) return;
    clearTimeout(timer);
    narration = new SpeechSynthesisUtterance(
      `${story.storyText} Wildlife fact: ${story.verifiedFact}. Observe safely. Never approach, feed or handle wildlife.`,
    );
    narration.volume = controls.getVolume();
    narration.onend = () => {
      lastInteraction = Date.now();
      scheduleStory();
    };
    narration.onerror = () => {
      if (status.isConnected)
        status.textContent = "Audio unavailable. Read the story above.";
      scheduleStory();
    };
    speechSynthesis.speak(narration);
  }
});
document.addEventListener("wn-volume", (e) => {
  if (window.speechSynthesis?.speaking && narration) {
    speechSynthesis.cancel();
    narration.volume = e.detail;
    speechSynthesis.speak(narration);
  }
});
document.addEventListener("wn-idle", () => {
  index = 0;
  drawStory();
  lastInteraction = Date.now();
  scheduleStory();
});
async function refreshFeed() {
  if (page !== "index.html") return;
  try {
    pendingStories = await api.stories();
    if (
      Date.now() - lastInteraction >= config.rotateMs &&
      !document.querySelector("dialog[open]")
    ) {
      const current = list[index]?.id;
      list = pendingStories;
      pendingStories = null;
      index = Math.max(
        0,
        list.findIndex((s) => s.id === current),
      );
      drawStory();
    }
  } catch {
    const status = document.querySelector("#audio-status");
    if (status)
      status.textContent =
        "We could not load the latest stories. Please try again.";
  }
}
window.addEventListener("storage", (e) => {
  if (e.key === "wn-demo-v2") refreshFeed();
});
if (api.live) setInterval(refreshFeed, 30000);
await load();
controls = initControls();
