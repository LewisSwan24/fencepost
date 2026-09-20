// Closing a storyboard: irreversible, and the one screen whose refusal path is a trap.
//
//   node --import ./test/setup.mjs --test test/close.test.mjs
//
// The closing note goes through the Screener, and a refusal comes back **200 with
// published:false**. So `catch` never sees it, and the obvious shape — await, then
// router.replace back to the storyboard — sends the author back to a board that is still
// open, with their line gone, having been told nothing. It reads exactly like success.
//
// The screen has to stay put, say what was wrong in the Screener's own words, say that the
// writing is still there, and leave it in the box. That is four separate things and all four
// are invisible from the outside if any one of them is dropped.
//
// The other rule here is that this screen is deliberately **stricter than the server**. The
// server would let an owner close an already-archived board again, which would quietly
// overwrite the previous closing line, so an archived board sends you back instead.
//
// Fixtures: sb_jacaranda is active and owned by "me"; sb_roof is archived and view-only.
// The fixture module is one mutable object for the whole process, so the test that actually
// closes something is last.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CloseStoryboard from "../app/b/[id]/close/page.js";
import { COPY, reasonSentence } from "../lib/copy.js";
import { BLOCKED_TRIGGER } from "../lib/fixtures.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

const note = () => screen.getByLabelText(COPY.closeNoteLabel);
const closeButton = () => screen.getByRole("button", { name: COPY.closeStoryboard });

// The screen loads the board before it decides anything, so every test waits for the
// decision rather than for the render.
const ready = () => waitFor(() => closeButton());

beforeEach(() => reset());
afterEach(() => cleanup());

test("an owner of an open storyboard is shown what closing costs", async () => {
  await renderScreen(CloseStoryboard, { id: "sb_jacaranda" });
  await ready();

  for (const point of COPY.closePoints) {
    assert.ok(screen.getByText(point), `a consequence went missing: ${point}`);
  }
  // Said in the same breath, because closing is for something having ended and not a
  // maintenance duty: 30 days quiet turns a storyboard read-only by itself.
  assert.ok(screen.getByText(COPY.closeNotRequired));
});

test("the note has a label a screen reader can use", async () => {
  await renderScreen(CloseStoryboard, { id: "sb_jacaranda" });
  await ready();
  assert.equal(note().tagName, "TEXTAREA");
});

test("somebody who cannot close it is sent back rather than shown the button", async () => {
  // sb_roof is view-only, so this is the ordinary refusal. There is no "you lack permission"
  // state on purpose: this is not a refusal, it is that there is nothing here for you.
  await renderScreen(CloseStoryboard, { id: "sb_roof", heading: false });

  await waitFor(() => assert.deepEqual(navigated, [["replace", "/b/sb_roof"]]));
  assert.equal(screen.queryByRole("button", { name: COPY.closeStoryboard }), null,
               "the button to do it was on screen on the way out");
});

test("the counter stays away until the limit is close", async () => {
  // A counter present from the first character is pressure to write less, and this line has
  // no obligation to exist at all.
  const user = userEvent.setup({ document });
  await renderScreen(CloseStoryboard, { id: "sb_jacaranda" });
  await ready();

  await user.type(note(), "Thanks everyone.");
  assert.equal(screen.queryByText("264"), null);

  await user.clear(note());
  await user.type(note(), "x".repeat(250));
  assert.ok(screen.getByText("30"), "no idea how much room was left at 250 of 280");
});

test("a refused note leaves the storyboard open, and says so where the author is", async () => {
  const user = userEvent.setup({ document });
  await renderScreen(CloseStoryboard, { id: "sb_jacaranda" });
  await ready();

  await user.type(note(), `It all started at ${BLOCKED_TRIGGER}.`);
  await user.click(closeButton());

  await waitFor(() => screen.getByText(reasonSentence(["pii"])));
  assert.ok(screen.getByText(COPY.blockedKept), "not told the writing survived");
  assert.equal(note().value, `It all started at ${BLOCKED_TRIGGER}.`,
               "the note was cleared out from under them");
  assert.deepEqual(navigated, [],
                   "sent back to a storyboard that is still open, which reads as success");
  assert.equal(closeButton().disabled, false, "left unable to try again");
});

test("editing after a refusal takes the refusal away", async () => {
  const user = userEvent.setup({ document });
  await renderScreen(CloseStoryboard, { id: "sb_jacaranda" });
  await ready();

  await user.type(note(), BLOCKED_TRIGGER);
  await user.click(closeButton());
  await waitFor(() => screen.getByText(reasonSentence(["pii"])));

  await user.type(note(), " — no, somewhere else");
  assert.equal(screen.queryByText(reasonSentence(["pii"])), null,
               "the old refusal is still sitting under a sentence it is not about");
  assert.equal(screen.queryByText(COPY.blockedKept), null);
});

// Last, and in one test rather than two, because the second half needs what the first half
// does: this archives sb_jacaranda in the fixture module, which is one mutable object shared
// by every test in this process.
test("closing it works once, and coming back to do it again sends you away", async () => {
  const user = userEvent.setup({ document });
  await renderScreen(CloseStoryboard, { id: "sb_jacaranda" });
  await ready();

  await user.type(note(), "Thanks everyone — she has moved on.");
  await user.click(closeButton());
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/b/sb_jacaranda"]]));

  // Now the stricter-than-the-server rule, which needs a board you own and have already
  // closed — and nothing in the fixtures is one until this test has made it. The server
  // would let an owner close it again and would overwrite the closing line just written,
  // with nothing on any screen to say the old one had gone.
  //
  // sb_roof cannot stand in for this: it is view-only as well as archived, so isOwner
  // answers false on the level and the archived half is never reached. Measured on
  // 2026-09-20 — with that test alone, deleting `&& !isArchived(got.status)` failed nothing.
  cleanup();
  reset();
  await renderScreen(CloseStoryboard, { id: "sb_jacaranda", heading: false });
  await waitFor(() => assert.deepEqual(navigated, [["replace", "/b/sb_jacaranda"]]));
  assert.equal(screen.queryByRole("button", { name: COPY.closeStoryboard }), null,
               "offered the chance to write over the closing line that is already there");
});
