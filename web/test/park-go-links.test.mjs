// Links that move the visitor on, in the park web app.
//
//   node --import ./test/setup.mjs --test test/park-go-links.test.mjs
//
// These used to be plain underlined text with an arrow typed into the label, so the arrow
// was underlined along with the words and a screen reader read "right arrow" after each
// one. The arrow is now drawn by the stylesheet on a .go-link, and the label is words only.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { mount } = await import("../public/wildlife/shared/mobile.js");

let root, stop;
const settle = () => new Promise((r) => setTimeout(r, 30));
const go = async (hash) => {
  location.hash = hash;
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  await settle();
};

beforeEach(async () => {
  stop?.();
  localStorage.clear();
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  location.hash = "#stories";
  stop = await mount(root);
  await settle();
});

const arrows = [0x2190, 0x2192].map((c) => String.fromCodePoint(c));
// What a screen reader is given: the label, without anything marked as decoration.
const spoken = (a) => {
  const copy = a.cloneNode(true);
  copy.querySelectorAll("[aria-hidden]").forEach((n) => n.remove());
  return copy.textContent.trim();
};

test("the help link beside a story is a go-link with no arrow in its name", async () => {
  const story = root.querySelector('a[href^="#story/"]');
  assert.ok(story, "no story to open");
  await go(story.getAttribute("href"));
  const link = root.querySelector('.notice a[href="#help"]');
  assert.ok(link, "the safe-response notice has no way on to help");
  assert.ok(link.classList.contains("go-link"));
  assert.equal(link.textContent, "If it may be hurt");
});

test("no link that stands alone carries a typed arrow", async () => {
  const story = root.querySelector('a[href^="#story/"]').getAttribute("href");
  for (const hash of ["#", story, "#share", "#community", "#updates", "#species/brushtail", "#activity"]) {
    await go(hash);
    // Cards keep their own hidden label; the link covers the whole card and draws its arrow.
    const typed = [...root.querySelectorAll("a:not(.card-link):not(.link-button)")].filter((a) =>
      arrows.some((arrow) => spoken(a).includes(arrow)),
    );
    assert.deepEqual(
      typed.map((a) => a.textContent),
      [],
      `on ${hash}`,
    );
  }
});

test("a link back says where it goes back to, in words", async () => {
  const story = root.querySelector('a[href^="#story/"]').getAttribute("href");
  for (const [hash, place] of [
    [story, "Stories"],
    ["#species/brushtail", "Learn"],
    ["#updates", "Community"],
  ]) {
    await go(hash);
    const back = root.querySelector(".return-link");
    assert.ok(back, `no way back on ${hash}`);
    assert.equal(back.textContent, place);
    assert.equal(back.getAttribute("aria-label"), "Back to " + place);
  }
});

test("the quiz's way back keeps its arrow for the display, as decoration", async () => {
  await go("#activity");
  const back = root.querySelector(".quiz-return");
  assert.ok(back, "the quiz has no way back");
  assert.ok(back.querySelector('.back-arrow[aria-hidden="true"]'));
  assert.match(back.getAttribute("aria-label"), /^Back to /);
});

test("the link back from a form sentence stays a link in the sentence", async () => {
  await go("#share");
  const link = root.querySelector('.rescue-route a[href="#rescue"]');
  assert.ok(link.classList.contains("go-link"));
  assert.ok(link.closest("p"), "it is no longer part of the question it answers");
});
