// /no-access — a code that does not work.
//
//   node --import ./test/setup.mjs --test test/no-access.test.mjs
//
// The page's header: this screen can leak nothing. No title, no participants, nothing about
// what is inside, and no distinction between expired and revoked, or a dead link becomes a
// probe — try another token, and a difference in wording tells you that storyboard exists.
//
// It fetches nothing and takes nothing, which is what makes the two cases identical by
// construction. The tests hold it to that: the same page whatever it is handed, in the
// wording ux-copy settled on, with nothing from the dataset in it.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";

import NoAccess, { metadata } from "../app/no-access/page.js";
import { COPY } from "../lib/copy.js";

afterEach(() => cleanup());

test("it says the link does not work, and what to do about it", () => {
  // The only two things the screen is allowed to say, both from copy.js.
  render(<NoAccess />);
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, COPY.noAccessTitle);
  assert.ok(screen.getByText(COPY.noAccessBody));
});

test("expired and revoked cannot be told apart", () => {
  // Neither word, nor anything else that sorts dead links into kinds.
  render(<NoAccess />);
  assert.doesNotMatch(document.body.textContent, /expired|revoked|turned off|no longer|used up/i);
});

test("the page is the same whatever the route hands it", () => {
  // Nothing a caller passes — a reason, a storyboard, a search string — can change the
  // wording, which is how "the two look identical" stays true.
  const plain = render(<NoAccess />).container.innerHTML;
  cleanup();
  const handed = render(
    <NoAccess reason="revoked" storyboard="sb_jacaranda"
              searchParams={{ reason: "expired", title: "The one in the jacaranda" }} />
  ).container.innerHTML;
  assert.equal(handed, plain);
});

test("nothing about any storyboard is on the page, not even in the tab title", () => {
  // The browser tab counts as the page: a title naming the storyboard would leak as surely
  // as the body.
  render(<NoAccess />);
  const text = document.body.textContent;
  for (const leak of ["jacaranda", "Roof thumper", "mel_k", "dan_h", "Can view", "Can add"]) {
    assert.ok(!text.includes(leak), `leaked: ${leak}`);
  }
  assert.equal(metadata.title, "Fencepost");
});
