// node --test lib/paging.test.mjs
//
// lib/paging.js exists because two screens lost entries the day the timeline was paged: the
// landing after posting showed page one, which on a long storyboard does not hold the new
// sighting, and every edit or delete collapsed a list somebody had expanded back to page one.
// A stand-in server here pages exactly the way /api/timeline does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendPage, fillTo, MAX_EXTRA_PAGES } from "./paging.js";

function server(total, size = 20) {
  const all = Array.from({ length: total }, (_, i) => ({ id: "e" + (i + 1) }));
  const asked = [];
  const page = async (after) => {
    asked.push(after ?? null);
    const start = after ? all.findIndex((e) => e.id === after) + 1 : 0;
    const entries = all.slice(start, start + size);
    return { entries, next: start + size < all.length ? entries.at(-1).id : null };
  };
  return { all, page, asked };
}

test("the landing after posting keeps going until the new sighting is in the list", async () => {
  const s = server(25);
  const view = await fillTo(await s.page(), s.page, { containing: "e25" });
  assert.ok(view.entries.some((e) => e.id === "e25"), "the new sighting is not on the page");
  assert.equal(view.entries.length, 25);
});

test("a reload keeps at least as many entries as were showing", async () => {
  const s = server(60);
  const view = await fillTo(await s.page(), s.page, { atLeast: 40 });
  assert.equal(view.entries.length, 40, "an edit collapsed the expanded list");
  assert.equal(view.next, "e40");
});

test("nothing more is fetched when the first page already has it", async () => {
  const s = server(60);
  await fillTo(await s.page(), s.page, { atLeast: 5, containing: "e3" });
  assert.equal(s.asked.length, 1);
});

test("an entry that is not there ends at the end of the list, not in a loop", async () => {
  const s = server(25);
  const view = await fillTo(await s.page(), s.page, { containing: "never-posted" });
  assert.equal(view.entries.length, 25);
  assert.equal(view.next, null);
});

test("and the walk is bounded however long the list is", async () => {
  const s = server(5000);
  await fillTo(await s.page(), s.page, { containing: "never-posted" });
  assert.equal(s.asked.length, 1 + MAX_EXTRA_PAGES);
});

test("a page appended onto a list it overlaps adds nothing twice", () => {
  // A delete shifts every later entry up one place, so a page fetched for the old list can
  // begin with an entry the new list already holds. Twice on screen is also a React key clash.
  const view = { entries: [{ id: "e1" }, { id: "e2" }, { id: "e3" }], next: "e3" };
  const joined = appendPage(view, { entries: [{ id: "e3" }, { id: "e4" }], next: null });
  assert.deepEqual(joined.entries.map((e) => e.id), ["e1", "e2", "e3", "e4"]);
  assert.equal(joined.next, null);
});

// A forum thread pages the same way behind the same 4.5 MB cap, but its list lives under
// `posts`, not `entries`. Passing key: "posts" is what the thread screen relies on; without
// the generalization these would walk an undefined array and page for ever.
function threadServer(total, size = 30) {
  const all = Array.from({ length: total }, (_, i) => ({ id: "p" + (i + 1) }));
  const page = async (after) => {
    const start = after ? all.findIndex((p) => p.id === after) + 1 : 0;
    const posts = all.slice(start, start + size);
    return { posts, next: start + size < all.length ? posts.at(-1).id : null };
  };
  return { all, page };
}

test("posts pages until the reply just posted is on screen", async () => {
  const s = threadServer(35);
  const view = await fillTo(await s.page(), s.page, { containing: "p35", key: "posts" });
  assert.ok(view.posts.some((p) => p.id === "p35"), "the new reply is not on the page");
  assert.equal(view.posts.length, 35);
  assert.equal(view.next, null);
});

test("a reload keeps at least as many posts as were showing", async () => {
  const s = threadServer(100);
  const view = await fillTo(await s.page(), s.page, { atLeast: 60, key: "posts" });
  assert.equal(view.posts.length, 60, "a take-down collapsed the expanded thread");
});

test("a posts page appended onto a list it overlaps adds nothing twice", () => {
  const view = { posts: [{ id: "p1" }, { id: "p2" }], next: "p2" };
  const joined = appendPage(view, { posts: [{ id: "p2" }, { id: "p3" }], next: null }, "posts");
  assert.deepEqual(joined.posts.map((p) => p.id), ["p1", "p2", "p3"]);
});
