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
import { screen, cleanup, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Mask from "../app/b/[id]/add/mask/page.js";
import { useDraft } from "../app/b/[id]/add/DraftContext.js";
import { COPY } from "../lib/copy.js";
import { SMALLEST_BOX } from "../lib/mask.js";
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

// ---- masking from a keyboard (#46) ---------------------------------------------------------
//
// Drawing was pointer-only. The tick gave a keyboard user a way through when there was
// nothing to cover, and no way at all to cover something that was there — which left them a
// choice between not posting and ticking a line that was not true.

const Probe = () => <output data-boxes={JSON.stringify(useDraft().boxes)} />;
const WithProbe = (props) => <><Mask {...props} /><Probe /></>;
const stored = () => JSON.parse(document.querySelector("output").dataset.boxes);
const masks = () => screen.queryAllByRole("group", { name: /^Mask \d/ });
const add = () => screen.getByRole("button", { name: COPY.maskAdd });

test("Add a mask puts one in the middle of the frame, and focus on it", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(WithProbe);

  await user.click(add());
  assert.deepEqual(stored(), [{ x: 35, y: 35, w: 30, h: 30 }]);
  assert.equal(masks().length, 1);
  assert.equal(document.activeElement, masks()[0], "focus stayed on the button");
  assert.equal(next().disabled, false, "a mask placed by keyboard did not open the gate");

  // A second one sits off the first, or it would look as though nothing happened.
  await user.click(add());
  assert.deepEqual(stored()[1], { x: 39, y: 39, w: 30, h: 30 });
  assert.equal(document.activeElement, masks()[1]);
});

test("a dragged mask is named in whole percentages", async () => {
  // A drag stores whatever fraction the pointer landed on; nobody needs to hear 12.6%.
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([{ x: 12.6, y: 3.2, w: 20.49, h: 7.5 }]) });
  assert.equal(masks()[0].getAttribute("aria-label"),
               "Mask 1: 13% from the left, 3% from the top, 20% wide, 8% tall");
});

test("each mask says where it is, and how to move it", async () => {
  await renderInFlow(Mask, { seed: (d) => d.setBoxes([BOX, { ...BOX, x: 60 }]) });

  const [first, second] = masks();
  assert.equal(first.getAttribute("aria-label"),
               "Mask 1: 10% from the left, 10% from the top, 30% wide, 25% tall");
  assert.match(second.getAttribute("aria-label"), /^Mask 2: 60% from the left/);
  assert.equal(first.tabIndex, 0);
  const help = document.getElementById(first.getAttribute("aria-describedby"));
  assert.equal(help.textContent, COPY.maskKeys);
});

test("arrow keys move the focused mask, Shift and the arrows resize it", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(WithProbe, { seed: (d) => d.setBoxes([BOX]) });
  masks()[0].focus();

  await user.keyboard("{ArrowRight}{ArrowDown}");
  assert.deepEqual(stored(), [{ x: 12, y: 12, w: 30, h: 25 }]);
  await user.keyboard("{ArrowLeft}{ArrowUp}{ArrowUp}");
  assert.deepEqual(stored(), [{ x: 10, y: 8, w: 30, h: 25 }]);
  await user.keyboard("{Shift>}{ArrowRight}{ArrowDown}{/Shift}");
  assert.deepEqual(stored(), [{ x: 10, y: 8, w: 32, h: 27 }]);
  await user.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowUp}{/Shift}");
  assert.deepEqual(stored(), [{ x: 10, y: 8, w: 28, h: 25 }]);
  // And what it says follows it.
  assert.match(masks()[0].getAttribute("aria-label"), /^Mask 1: 10% from the left, 8% from the top, 28% wide/);
});

test("a mask cannot leave the frame or shrink below a deliberate box", async () => {
  // The same floor a drag has (SMALLEST_BOX): anything smaller is a twitch, not a mask.
  const user = userEvent.setup({ document });
  await renderInFlow(WithProbe, { seed: (d) => d.setBoxes([BOX]) });
  masks()[0].focus();

  await user.keyboard("{ArrowLeft>10/}{ArrowUp>10/}");
  assert.deepEqual(stored(), [{ x: 0, y: 0, w: 30, h: 25 }]);
  await user.keyboard("{Shift>}{ArrowLeft>20/}{ArrowUp>20/}{/Shift}");
  assert.deepEqual(stored(), [{ x: 0, y: 0, w: SMALLEST_BOX, h: SMALLEST_BOX }]);
  await user.keyboard("{ArrowRight>60/}{ArrowDown>60/}");
  assert.deepEqual(stored(), [{ x: 100 - SMALLEST_BOX, y: 100 - SMALLEST_BOX, w: SMALLEST_BOX, h: SMALLEST_BOX }]);
  await user.keyboard("{Shift>}{ArrowRight>5/}{ArrowDown>5/}{/Shift}");
  assert.deepEqual(stored(), [{ x: 100 - SMALLEST_BOX, y: 100 - SMALLEST_BOX, w: SMALLEST_BOX, h: SMALLEST_BOX }],
                   "grew past the edge of the frame");
});

test("Delete removes the focused mask, and focus goes on to something that is there", async () => {
  // Focus left on a removed element falls to body, out of reach of anything on this screen.
  const user = userEvent.setup({ document });
  await renderInFlow(WithProbe, { seed: (d) => d.setBoxes([BOX, { ...BOX, x: 60 }]) });
  masks()[0].focus();

  await user.keyboard("{Delete}");
  assert.deepEqual(stored(), [{ ...BOX, x: 60 }]);
  assert.equal(document.activeElement, masks()[0], "focus did not go to the mask that is left");
  await user.keyboard("{Backspace}");
  assert.deepEqual(stored(), []);
  assert.equal(document.activeElement, add(), "with none left, focus did not go back to Add a mask");
  assert.equal(next().disabled, true);
});

test("the box being dragged is not a mask yet, so it takes no focus and has no name", async () => {
  // It is not in draft.boxes until release, so a key pressed on it would act on nothing.
  await renderInFlow(Mask);
  const canvas = screen.getByText(COPY.maskHint).parentElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });

  fireEvent.pointerDown(canvas, { clientX: 20, clientY: 20 });
  fireEvent.pointerMove(canvas, { clientX: 120, clientY: 120 });
  assert.equal(screen.getAllByRole("button", { name: "Remove mask" }).length, 1, "the drag drew nothing");
  assert.equal(masks().length, 0);
  assert.equal(canvas.querySelector("[tabindex]"), null);

  fireEvent.pointerUp(canvas);
  assert.equal(masks().length, 1, "and once released it is one");
});

test("the remove button hands focus on the same way", async () => {
  // It is the other way to remove a mask from a keyboard, and it dropped focus on body too.
  const user = userEvent.setup({ document });
  await renderInFlow(WithProbe, { seed: (d) => d.setBoxes([BOX, { ...BOX, x: 60 }, { ...BOX, y: 60 }]) });

  screen.getAllByRole("button", { name: "Remove mask" })[2].focus();
  await user.keyboard("{Enter}");
  assert.equal(stored().length, 2);
  assert.equal(document.activeElement, masks()[1], "removing the last in the list did not go to the one before");
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
