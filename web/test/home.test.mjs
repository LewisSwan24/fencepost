// 1 · My storyboards, and the second place a Screener refusal can read as success.
//
//   node --import ./test/setup.mjs --test test/home.test.mjs
//
// A refused title comes back 200 with published:false **and no storyboard_id**, so pushing
// straight on lands on /b/undefined with the title gone. Same shape as the closing note and
// the forum sheet; three screens, one trap.
//
// The rest of this screen is a list with two halves that must not mix. "Past" is not a
// status — it is readonly and archived together — and a board in the wrong half is either a
// closed storyboard offering to be written in or an open one that looks finished.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Home from "../app/LegacyHome.js";
import { COPY, reasonSentence } from "../lib/copy.js";
import { BLOCKED_TRIGGER } from "../lib/fixtures.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

// The two halves are headings-in-name-only (a kicker div), so a card is placed by reading
// the DOM order rather than by asking for a section that does not exist as a landmark.
function half(name) {
  const kicker = screen.getByText(name);
  const out = [];
  for (let node = kicker.nextElementSibling; node; node = node.nextElementSibling) {
    // The code box (#54) follows the last half; it is not a storyboard.
    if (node.textContent === "Active" || node.textContent === "Past" || node.tagName === "FORM") break;
    out.push(node);
  }
  return out;
}

const loaded = () => waitFor(() => screen.getByText("Active"));
const create = () => screen.getByRole("button", { name: "Create" });
const titleField = () => screen.getByLabelText("Title");

beforeEach(() => reset());
afterEach(() => cleanup());

test("an open storyboard and a closed one are kept in different halves", async () => {
  await renderScreen(Home);
  await loaded();

  assert.equal(half("Active").length, 1);
  assert.ok(within(half("Active")[0]).getByText("The one in the jacaranda"));
  assert.equal(half("Past").length, 1);
  assert.ok(within(half("Past")[0]).getByText("Roof thumper"));
});

test("a closed one says so on the card, and an open one does not", async () => {
  await renderScreen(Home);
  await loaded();

  assert.ok(within(half("Past")[0]).getByText("Read-only"));
  assert.equal(within(half("Active")[0]).queryByText("Read-only"), null);
});

test("a card counts its sightings in words that agree with the number", async () => {
  await renderScreen(Home);
  await loaded();

  assert.ok(within(half("Active")[0]).getByText("5 sightings"));
  assert.ok(within(half("Past")[0]).getByText("3 sightings"));
});

test("the cover photograph carries alt text rather than sitting there unnamed", async () => {
  // These are not the users' photographs and lib/frames.js holds the attribution with them;
  // an img with no alt in a list of storyboards is a row a screen reader reads as nothing.
  await renderScreen(Home);
  await loaded();

  const shot = within(half("Active")[0]).getByRole("img");
  assert.ok(shot.getAttribute("alt"), "the cover has no alt text");
});

test("the header says who is signed in, and gives them somewhere to go", async () => {
  // It used to be the handle as static text: a visitor could read the name this browser had
  // invented for them and had nowhere at all to go with it.
  await renderScreen(Home);
  await waitFor(() => screen.getByRole("link", { name: /You|mel/ }));

  const you = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "/you");
  assert.ok(you, "no way through to your own account page");
});

test("the mode is stated on the screen rather than guessed at", async () => {
  await renderScreen(Home);
  await loaded();
  assert.ok(screen.getByText(/fixtures — nothing leaves this browser/));
});

test("there is no making a storyboard without a title", async () => {
  const user = userEvent.setup({ document });
  await renderScreen(Home);
  await loaded();

  await user.click(screen.getByRole("button", { name: "New storyboard" }));
  assert.equal(create().disabled, true);
  await user.type(titleField(), "   ");
  assert.equal(create().disabled, true, "three spaces was accepted as a title");
  await user.type(titleField(), "Fence at number 12");
  assert.equal(create().disabled, false);
});

test("a refused title keeps the sheet, the title and the reason", async () => {
  const user = userEvent.setup({ document });
  await renderScreen(Home);
  await loaded();

  await user.click(screen.getByRole("button", { name: "New storyboard" }));
  await user.type(titleField(), `The one at ${BLOCKED_TRIGGER}`);
  await user.click(create());

  await waitFor(() => screen.getByText(reasonSentence(["pii"])));
  assert.ok(screen.getByText(COPY.blockedKept), "not told the writing survived");
  assert.equal(titleField().value, `The one at ${BLOCKED_TRIGGER}`);
  assert.deepEqual(navigated, [], "pushed on to /b/undefined with the title gone");
  assert.equal(create().disabled, false, "left unable to try again");
});

test("editing the title takes the refusal away", async () => {
  const user = userEvent.setup({ document });
  await renderScreen(Home);
  await loaded();

  await user.click(screen.getByRole("button", { name: "New storyboard" }));
  await user.type(titleField(), BLOCKED_TRIGGER);
  await user.click(create());
  await waitFor(() => screen.getByText(reasonSentence(["pii"])));

  await user.type(titleField(), " — no");
  assert.equal(screen.queryByText(reasonSentence(["pii"])), null);
  assert.equal(screen.queryByText(COPY.blockedKept), null);
});

test("a title the Screener allows opens the storyboard it just made", async () => {
  const user = userEvent.setup({ document });
  await renderScreen(Home);
  await loaded();

  await user.click(screen.getByRole("button", { name: "New storyboard" }));
  await user.type(titleField(), "Fence at number 12");
  await user.click(create());

  await waitFor(() => assert.equal(navigated.length, 1));
  const [[how, where]] = navigated;
  assert.equal(how, "push");
  assert.match(where, /^\/b\/sb_\w+$/, `went to ${where} rather than to the new storyboard`);
});
