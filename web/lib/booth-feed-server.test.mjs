import { test } from "node:test";
import assert from "node:assert/strict";
import { handleBoothFeed, BOOTH_LIMIT } from "./booth-feed-server.js";

const env = {
  FENCEPOST_BOOTH_TOKEN: "screen-token",
  FENCEPOST_BOOTH_STORYBOARD: "sb_booth",
  FENCEPOST_API: "https://api.test/",
};
const row = (n) => ({
  id: "e" + n,
  author_id: "u_secret_" + n,
  handle: "neighbour_" + n,
  species: "brushtail",
  fun_fact: "fact " + n,
  story: "story " + n,
  video_id: "v" + n,
  still: null,
  created_at: "2026-10-29T00:00:" + String(n).padStart(2, "0") + "+00:00",
});
const page = (entries, next = null) =>
  new Response(JSON.stringify({ storyboard_id: "sb_booth", entries, next }));

test("without its settings the relay says so and asks nobody", async () => {
  const response = await handleBoothFeed({
    env: { FENCEPOST_API: "https://api.test" },
    fetchImpl: () => {
      throw Error("should not call");
    },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "booth_not_configured" });
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
});

test("asks as the screen, for the booth storyboard, and is never cached", async () => {
  const calls = [];
  const response = await handleBoothFeed({
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return page([row(1)]);
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.test/api/timeline?storyboard_id=sb_booth",
  );
  assert.equal(calls[0].init.headers.authorization, "Bearer screen-token");
  assert.equal(calls[0].init.cache, "no-store");
  assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
});

test("authors are not named on the public screen", async () => {
  const response = await handleBoothFeed({
    env,
    fetchImpl: async () => page([row(1)]),
  });
  const text = await response.clone().text();
  assert.doesNotMatch(text, /u_secret_1|neighbour_1|author_id|handle|video_id/);
  const { entries } = await response.json();
  assert.deepEqual(Object.keys(entries[0]).sort(), [
    "created_at",
    "fun_fact",
    "id",
    "species",
    "still",
    "story",
  ]);
  assert.doesNotMatch(text, /screen-token/);
});

test("follows the cursor to the end and leads with the newest", async () => {
  const first = Array.from({ length: 20 }, (_, i) => row(i + 1));
  const second = [row(21), row(22)];
  const seen = [];
  const response = await handleBoothFeed({
    env,
    fetchImpl: async (url) => {
      seen.push(new URL(url).searchParams.get("after"));
      return seen.length === 1 ? page(first, "e20") : page(second);
    },
  });
  assert.deepEqual(seen, [null, "e20"]);
  const { entries } = await response.json();
  assert.equal(entries.length, BOOTH_LIMIT);
  assert.equal(entries[0].id, "e22");
  assert.equal(entries.at(-1).id, "e" + (22 - BOOTH_LIMIT + 1));
});

test("an upstream failure is a 502 with nothing from upstream in it", async () => {
  for (const fetchImpl of [
    async () =>
      new Response(JSON.stringify({ error: "no_access", detail: "upstream secret" }), {
        status: 403,
      }),
    async () => {
      throw Error("network down: upstream secret");
    },
    async () => new Response("not json"),
  ]) {
    const response = await handleBoothFeed({ env, fetchImpl });
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.equal(text, JSON.stringify({ error: "booth_unavailable" }));
  }
});

test("a timeline that never ends is an error, not the oldest page passed off as latest", async () => {
  const response = await handleBoothFeed({
    env,
    fetchImpl: async () => page([row(1)], "e1"),
  });
  assert.equal(response.status, 502);
});
