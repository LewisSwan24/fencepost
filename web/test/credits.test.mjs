// /credits — image attribution, and the one server component.
//
//   node --import ./test/setup.mjs --test test/credits.test.mjs
//
// A server component with no hooks, no data fetching and no async body is a plain function
// returning JSX, so the harness renders it like any client screen. Nothing here depends on
// it running on a server.
//
// Two stated reasons for the page. CC BY-SA 4.0 requires attribution and requires saying
// whether a work was changed — a licence condition, not a courtesy — and the change list is
// built from the frame data so it cannot drift from what was really done. And the first
// paragraph says these photographs are not the users': next to other people's stories, not
// saying so implies "this is the one they filmed".
//
// The prose states counts ("All ten", "Nine were taken in daylight", "one was cropped"), so
// one test holds lib/frames.js to them; that part is plain data.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, cleanup, within } from "@testing-library/react";

import Credits from "../app/credits/page.js";
import { FRAMES } from "../lib/frames.js";

afterEach(() => cleanup());

const CC = "https://creativecommons.org/licenses/by-sa/4.0/";
const items = () => screen.getAllByRole("listitem");
const changes = (item) => item.querySelector(".meta").lastChild.textContent;

test("it says first that these photographs are not the users' sightings", () => {
  // The important part of the page: without it a stand-in reads as the filmer's own still.
  render(<Credits />);
  const lede = document.querySelector(".lede");
  assert.match(lede.textContent, /are not the sightings they sit\s+beside/);
  assert.equal(lede.querySelector("strong").textContent, "not");
});

test("the prose counts are true of the frames", () => {
  // "All ten", "Nine ... darkened", "one was cropped": the page asserts these in words, so
  // the data has to keep them true.
  assert.equal(FRAMES.length, 10);
  assert.equal(FRAMES.filter((f) => !f.night).length, 9);
  assert.equal(FRAMES.filter((f) => f.cropped).length, 1);
});

test("every photograph is attributed, with its source and its licence", () => {
  // CC BY-SA attribution: author, where it came from, and the licence linked.
  render(<Credits />);
  const list = items();
  assert.equal(list.length, FRAMES.length);
  FRAMES.forEach((frame, i) => {
    const item = list[i];
    assert.ok(within(item).getByText(frame.author), `no author for ${frame.slug}`);
    assert.equal(within(item).getByRole("link", { name: "Wikimedia Commons" })
                   .getAttribute("href"), frame.source);
    const licence = within(item).getByRole("link", { name: frame.licence });
    assert.equal(licence.getAttribute("href"), frame.licenceUrl);
  });
});

test("the licence itself is linked from the page's own paragraph", () => {
  render(<Credits />);
  const links = screen.getAllByRole("link", { name: "CC BY-SA 4.0" });
  assert.ok(links.some((a) => a.getAttribute("href") === CC && !a.closest("li")));
});

test("every change made is listed against the photograph it was made to", () => {
  // The part the licence asks for. All ten were resized and stripped; daylight ones were
  // darkened, the night shot was not, and only the cropped one says cropped. The night one
  // once read "used as taken", which was never true.
  render(<Credits />);
  items().forEach((item, i) => {
    const frame = FRAMES[i];
    const said = changes(item);
    assert.match(said, /^resized, metadata removed/, `${frame.slug}: ${said}`);
    assert.equal(said.includes("darkened"), !frame.night, `${frame.slug}: ${said}`);
    assert.equal(said.includes("cropped"), !!frame.cropped, `${frame.slug}: ${said}`);
    assert.ok(!said.includes("used as taken"));
  });
});
