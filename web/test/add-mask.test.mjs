// Step 4, the masking gate, and the consent sheet that follows it.
//
//   node --import ./test/setup.mjs --test test/add-mask.test.mjs
//
// This screen carries a safety line — **faces and number plates must be covered before a
// frame goes anywhere** — and the interesting thing about it is how the line has been got
// wrong here before, twice, in ways that left the screen looking correct:
//
//   it used to draw a FACE and a NUMBER PLATE marker from the fixture, in fixed positions,
//   over a canvas with no image under it, and the gate was "cover those two". Somebody could
//   satisfy it exactly and leave a real face in shot. So the gate now asks the person, and
//   "there is nothing here to cover" is a tick rather than the default;
//
//   and for a day it measured coverage, opened the gate, and sent the untouched still —
//   draft.boxes was read by nothing, so "Covered" was a word on a screen while the original
//   face went out.
//
// What is checkable without a canvas is the gate itself, and that is worth having on its
// own: closed on arrival, opened only by a box or by the tick, closed again when the last
// box goes, and never openable by both at once. The drawing is in lib/mask.js and
// lib/masking.test.mjs, and the drag was measured in a real browser (see the README).
//
// The consent sheet's two buttons are here for a different reason. They carry equal visual
// weight on purpose, so that leaving is not made quieter than agreeing, and the way that is
// held is that they share one class rather than having a style each. That is exactly the
// kind of thing a later edit undoes without noticing.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Mask from "../app/b/[id]/add/mask/page.js";
import { COPY } from "../lib/copy.js";
import { renderInFlow } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

const BOX = { x: 10, y: 10, w: 30, h: 25 };

const next = () => screen.getByRole("button", { name: "Next" });
const tick = () => screen.getByLabelText(COPY.maskNothing);

beforeEach(() => reset());
afterEach(() => cleanup());

test("the gate is closed on arrival, and says why", async () => {
  await renderInFlow(Mask);

  assert.equal(next().disabled, true);
  assert.ok(screen.getByText(COPY.maskBlockedNow), "stopped with nothing on screen to say why");
});

test("nothing to cover is a tick, not the default", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(Mask);

  assert.equal(tick().checked, false, "the frame was cleared to send without anybody saying so");
  await user.click(tick());
  assert.equal(next().disabled, false);
  assert.equal(screen.queryByText(COPY.maskBlockedNow), null);
});

test("a box opens the gate, and takes the tick away", async () => {
  // Ticking "there is nothing to cover" while a box is drawn is a contradiction, and the
  // screen refuses it rather than letting the two answers disagree.
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([BOX]) });

  assert.equal(next().disabled, false);
  assert.equal(tick().disabled, true);
});

test("removing the last box closes the gate again", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([BOX]) });

  await user.click(screen.getByRole("button", { name: "Remove mask" }));
  assert.equal(next().disabled, true, "the gate stayed open with nothing covered");
  assert.equal(tick().checked, false, "and it did not tick the box on their behalf");
});

test("each box has its own way off, and removing one leaves the others", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([BOX, { ...BOX, x: 60 }]) });

  const kills = screen.getAllByRole("button", { name: "Remove mask" });
  assert.equal(kills.length, 2);
  await user.click(kills[0]);
  assert.equal(screen.getAllByRole("button", { name: "Remove mask" }).length, 1);
  assert.equal(next().disabled, false);
});

test("the consent sheet is a dialog with a name a screen reader can read", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([BOX]) });

  await user.click(next());
  const sheet = screen.getByRole("dialog");
  assert.equal(sheet.getAttribute("aria-modal"), "true");
  // aria-labelledby is only a statement; this is the part that has to be true — that it
  // points at an element that exists and says something.
  assert.ok(within(sheet).getByRole("heading", { name: COPY.consentTitle }));
});

test("neither way out of the sheet is made quieter than the other", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([BOX]) });

  await user.click(next());
  const send = screen.getByRole("button", { name: COPY.consentSend });
  const skip = screen.getByRole("button", { name: COPY.consentSkip });
  assert.equal(send.className, skip.className,
               "one of the two has been given a style of its own");
});

test("declining to send the frame still carries on to the species step", async () => {
  // Skipping identification is not skipping the flow. The masking has been done either way,
  // and their sighting carries their own picture rather than a stock photograph.
  const user = userEvent.setup({ document });
  await renderInFlow(Mask, { id: "sb_jacaranda", seed: (d) => d.setBoxes([BOX]) });

  await user.click(next());
  await user.click(screen.getByRole("button", { name: COPY.consentSkip }));
  assert.deepEqual(navigated, [["push", "/b/sb_jacaranda/add/species"]]);
});

test("the sheet closes without going anywhere", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([BOX]) });

  await user.click(next());
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("dialog"), null);
  assert.deepEqual(navigated, [], "backing out of the sheet left the screen");
});
