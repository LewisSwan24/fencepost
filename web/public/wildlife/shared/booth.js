// The Fencepost booth storyboard on this screen.
//
// Entries arrive through /api/booth-feed, a relay on this deployment's own server that holds
// the screen's view-level token; the browser never sees it. Nothing here is cached. Every
// poll replaces the whole set, so an entry its author deleted leaves the screen on the next
// poll, and a poll that fails clears the set instead of keeping what may since have been
// deleted. Authors are never named on a public screen: the relay drops the handle, and
// nothing here would show it if it arrived.
import { esc } from "./ui.js";

export const BOOTH_POLL_MS = 15000;
export const BOOTH_FEED = "/api/booth-feed";

// Fencepost's own species values (proxy/app.py SPECIES). The label repeats what the
// neighbour recorded and never decides it: "other" is not identified further.
const SPECIES = {
  brushtail: "Brushtail possum",
  ringtail: "Ringtail possum",
  other: "Another animal",
  unknown: "Species not sure",
};
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const speciesLabel = (id) => SPECIES[id] || SPECIES.unknown;

export function toBoothStory(entry) {
  return {
    id: "booth:" + entry.id,
    booth: true,
    species: entry.species,
    storyText: entry.story || "",
    verifiedFact: entry.fun_fact || "",
    still:
      typeof entry.still === "string" && BASE64.test(entry.still)
        ? entry.still
        : null,
    createdAt: entry.created_at || "",
  };
}

// {configured: false} when this deployment has no booth (no relay, or a relay without its
// settings); anything else that is not a clean answer throws, and the caller clears the set.
export async function fetchBoothStories(fetchImpl = fetch) {
  const response = await fetchImpl(BOOTH_FEED, { cache: "no-store" });
  if (response.status === 404) return { configured: false, stories: [] };
  const body = await response.json().catch(() => null);
  if (response.status === 503 && body?.error === "booth_not_configured")
    return { configured: false, stories: [] };
  if (!response.ok || !Array.isArray(body?.entries))
    throw Error("The booth storyboard could not be loaded.");
  return { configured: true, stories: body.entries.map(toBoothStory) };
}

export function boothStoryHtml(s, position = "") {
  const label = speciesLabel(s.species);
  const photo = s.still
    ? `<img src="data:image/jpeg;base64,${s.still}" alt="${esc(label)}, photographed by a neighbour">`
    : `<p class="booth-no-photo">No photo with this sighting</p>`;
  return `<article class="hero booth-story"><div class="hero-photo">${photo}<span class="photo-note">Author-masked still from the neighbour's own video</span></div><div class="story-copy"><p class="status-label observation-label">From the Fencepost booth storyboard</p><h1>${esc(label)}</h1>${s.storyText ? `<p>${esc(s.storyText)}</p>` : ""}${s.verifiedFact ? `<aside class="fact"><span class="eyebrow">Fun fact from the neighbour</span><p>${esc(s.verifiedFact)}</p></aside>` : ""}<p class="review-label">Posted to the booth storyboard. Contributor names are not shown on this screen.</p>${position}<button data-action="narrate">Listen to story / pause narration</button><p id="audio-status" role="status"></p></div></article>`;
}

export function boothPanelHtml(url, qrHtml) {
  return `<section class="booth-panel" aria-label="Add your sighting"><div>${qrHtml}</div><div><p class="eyebrow">04 / Optional sharing</p><h2>Add your possum sighting</h2><p>Scan to join the booth storyboard on your phone. <strong>What you post there appears on this screen.</strong> You can delete it from your phone at any time and it leaves the screen within seconds.</p></div></section>`;
}
