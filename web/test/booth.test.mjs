import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toBoothStory,
  fetchBoothStories,
  boothStoryHtml,
  boothPanelHtml,
  speciesLabel,
} from "../public/wildlife/shared/booth.js";

const entry = {
  id: "e1",
  species: "ringtail",
  fun_fact: "Ringtails build dreys.",
  story: "Seen on the fence at dusk.",
  still: "QUJD",
  created_at: "2026-10-29T08:00:00+00:00",
};
const reply = (status, body) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });

test("booth ids cannot collide with the park's own stories", () => {
  const story = toBoothStory(entry);
  assert.equal(story.id, "booth:e1");
  assert.equal(story.booth, true);
  assert.equal(story.storyText, entry.story);
  assert.equal(story.verifiedFact, entry.fun_fact);
});

test("species is the neighbour's own record, never decided here", () => {
  assert.equal(speciesLabel("brushtail"), "Brushtail possum");
  assert.equal(speciesLabel("ringtail"), "Ringtail possum");
  assert.equal(speciesLabel("other"), "Another animal");
  assert.equal(speciesLabel("unknown"), "Species not sure");
  assert.equal(speciesLabel(undefined), "Species not sure");
});

test("what a neighbour typed is shown as text, never as markup", () => {
  const html = boothStoryHtml(
    toBoothStory({
      ...entry,
      story: '<img src=x onerror="alert(1)">',
      fun_fact: "<script>alert(2)</script>",
    }),
  );
  assert.doesNotMatch(html, /<img src=x|<script>/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test("only a base64 still becomes an image", () => {
  assert.match(boothStoryHtml(toBoothStory(entry)), /data:image\/jpeg;base64,QUJD/);
  const broken = toBoothStory({ ...entry, still: '"><script>' });
  assert.equal(broken.still, null);
  assert.match(boothStoryHtml(broken), /No photo with this sighting/);
});

test("the QR panel tells people their post appears on the screen", () => {
  const html = boothPanelHtml("https://x.test/s/abc", "<a data-qr></a>");
  assert.match(html, /appears on this screen/);
  assert.match(html, /<a data-qr><\/a>/);
});

test("no relay, or a relay without settings, means no booth", async () => {
  assert.deepEqual(await fetchBoothStories(async () => reply(404, "missing")), {
    configured: false,
    stories: [],
  });
  assert.deepEqual(
    await fetchBoothStories(async () =>
      reply(503, { error: "booth_not_configured" }),
    ),
    { configured: false, stories: [] },
  );
});

test("a failing feed throws so the page clears what it was showing", async () => {
  await assert.rejects(
    fetchBoothStories(async () => reply(502, { error: "booth_unavailable" })),
  );
  await assert.rejects(fetchBoothStories(async () => reply(200, "not json")));
  await assert.rejects(
    fetchBoothStories(async () => {
      throw Error("offline");
    }),
  );
});

test("a good feed maps every entry and asks without a cache", async () => {
  let init;
  const result = await fetchBoothStories(async (url, i) => {
    init = i;
    assert.equal(url, "/api/booth-feed");
    return reply(200, { entries: [entry] });
  });
  assert.equal(init.cache, "no-store");
  assert.equal(result.configured, true);
  assert.deepEqual(result.stories.map((s) => s.id), ["booth:e1"]);
});
