// Step 3 of posting, picking the frame.
//
//   node --import ./test/setup.mjs --test test/add-frame.test.mjs
//
// This screen shows one of two things — the person's own clip, or placeholder stock
// photographs when there is no clip or the browser would not decode it — and its header says
// both paths stay and **the line underneath says which one you are looking at**. A screen
// that shows stock photographs while implying they are your footage, or the reverse, is the
// small lie this flow has had enough of. So most of what is pinned here is that line, plus:
//
//   a real still is shown as it came out of the camera; only the daytime placeholders are
//   graded towards night, because they stand in for a night clip;
//
//   a photograph (one still, no timestamp) has nothing to scrub, so the scrubber is not
//   offered and no timestamp is stamped on it;
//
//   the placeholder mapping is proportional across all the stock images. The old
//   floor(index / 2) reached only the first four — all ringtails — which would quietly have
//   made the picker ringtail-only with nothing on screen to notice;
//
//   an index left pointing past the end of a shorter clip is clamped rather than rendered as
//   undefined;
//
//   the scrubber is a slider a keyboard can reach and move, and landing on the frame already
//   chosen, by key or by tap, does not clear the masks drawn on it.
//
// jsdom lays nothing out, so the scrubber test gives the track a measured box of its own.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import PickFrame from "../app/b/[id]/add/frame/page.js";
import { useDraft } from "../app/b/[id]/add/DraftContext.js";
import { COPY } from "../lib/copy.js";
import { CLIP } from "../lib/fixtures.js";
import { FRAMES } from "../lib/frames.js";
import { renderInFlow } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

// A clip as lib/stills.js hands it over: timestamped, with its own shape.
const clip = (n) => Array.from({ length: n }, (_, i) => ({
  t: i, label: `0:0${i}`, w: 360, h: 640, src: `data:image/jpeg;base64,STILL${i}`,
}));
// A photograph: one still, no label, because it has no timeline.
const photograph = [{ t: 0, label: null, w: 1280, h: 960, src: "data:image/jpeg;base64,PHOTO" }];

const picture = () => document.querySelector("img");
const scrubber = () => document.querySelector(".track").parentElement;
const cells = () => [...document.querySelectorAll(".cell")];

beforeEach(() => reset());
afterEach(() => cleanup());

// ---- which path you are looking at --------------------------------------------------------

test("with no clip, the line says these are placeholder stills", async () => {
  // Stock photographs must never pass for the person's own footage.
  await renderInFlow(PickFrame);

  assert.ok(screen.getByText(COPY.frameNote));
  assert.equal(screen.queryByText(COPY.frameNoteLive), null);
  const stock = FRAMES.map((f) => f.file);
  assert.ok(stock.includes(picture().getAttribute("src")), "no clip, yet not a placeholder");
});

test("with a clip, the picture is their own frame and the line says so", async () => {
  // And says the video itself is not uploaded, which is true: the stills live in the draft.
  await renderInFlow(PickFrame, { seed: (d) => d.setStills(clip(4)) });

  assert.ok(screen.getByText(COPY.frameNoteLive));
  assert.equal(screen.queryByText(COPY.frameNote), null);
  assert.match(picture().getAttribute("src"), /^data:image\/jpeg;base64,STILL/);
  assert.equal(picture().getAttribute("alt"), "A frame from your clip");
});

test("their own footage is shown as it came out; only daytime placeholders are graded", async () => {
  // Grading stands a daylight stock photograph in for a night clip. Applied to a real still
  // it would alter the person's own picture before they decide what in it needs covering.
  await renderInFlow(PickFrame, { seed: (d) => d.setStills(clip(4)) });
  assert.equal(picture().classList.contains("graded"), false);
  cleanup();

  // CLIP.default_index lands on a daytime placeholder, which is graded.
  await renderInFlow(PickFrame);
  const frame = FRAMES.find((f) => f.file === picture().getAttribute("src"));
  assert.equal(frame.night, false, "the default placeholder is no longer a daytime one");
  assert.equal(picture().classList.contains("graded"), true);
});

// ---- a photograph -------------------------------------------------------------------------

test("a photograph gets its own line, no scrubber and no timestamp", async () => {
  // A scrubber that cannot move would be furniture, and "0:00" on a photograph is a timeline
  // it does not have.
  await renderInFlow(PickFrame, { seed: (d) => d.setStills(photograph) });

  assert.ok(screen.getByText(COPY.framePhoto));
  assert.equal(picture().getAttribute("alt"), "Your photograph");
  assert.equal(scrubber().style.display, "none");
  assert.equal(document.querySelector(".stampChip"), null);
});

test("a clip keeps its scrubber and stamps the chosen frame's time", async () => {
  await renderInFlow(PickFrame, { seed: (d) => d.setStills(clip(4)) });

  assert.notEqual(scrubber().style.display, "none");
  assert.ok(document.querySelector(".stampChip"));
});

// ---- the placeholders ----------------------------------------------------------------------

test("the placeholder strip reaches both species, not only the first few images", async () => {
  // floor(index / 2) over ten images reached frames 0 to 3 — all ringtails — and made the
  // picker ringtail-only without anything on screen to show it. The mapping is proportional.
  await renderInFlow(PickFrame);

  const strip = cells().map((c) => c.style.backgroundImage).join(" ");
  assert.equal(cells().length, CLIP.frames.length);
  assert.match(strip, /ringtail/);
  assert.match(strip, /brushtail/, "the placeholders never reach a brushtail");
  assert.ok(strip.includes(FRAMES[0].file));
});

// ---- a stale index -------------------------------------------------------------------------

test("an index past the end of a shorter clip is clamped, not rendered as undefined", async () => {
  // Arriving by the back button with the list already changed underneath can leave the
  // index pointing past the end; the screen shows the last frame rather than breaking.
  await renderInFlow(PickFrame, {
    seed: (d) => { d.setStills(clip(2)); d.setFrameIndex(7); },
  });

  assert.equal(picture().getAttribute("src"), "data:image/jpeg;base64,STILL1");
  assert.equal(document.querySelector(".stampChip").textContent, "0:01");
});

// ---- scrubbing and leaving -----------------------------------------------------------------

test("scrubbing to the far end picks the last frame", async () => {
  await renderInFlow(PickFrame, { seed: (d) => { d.setStills(clip(4)); d.setFrameIndex(0); } });
  const track = document.querySelector(".track");
  track.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 40,
                                         right: 300, bottom: 40, x: 0, y: 0 });

  fireEvent.pointerDown(scrubber(), { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(scrubber(), { pointerId: 1 });
  assert.equal(picture().getAttribute("src"), "data:image/jpeg;base64,STILL3");
  assert.equal(document.querySelector(".stampChip").textContent, "0:03");
});

// ---- from a keyboard -----------------------------------------------------------------------
//
// The scrubber was a div with pointer handlers and nothing else: Tab never reached it and a
// screen reader never announced it, so anybody without a pointer posted whichever frame the
// screen opened on. Found walking the flow in a real browser on 2026-10-04 (#43).

test("the scrubber is a slider that says which frame is chosen", async () => {
  await renderInFlow(PickFrame, { seed: (d) => { d.setStills(clip(4)); d.setFrameIndex(1); } });

  const slider = screen.getByRole("slider", { name: COPY.frameScrubber });
  assert.equal(slider.tabIndex, 0);
  assert.equal(slider.getAttribute("aria-valuemin"), "0");
  assert.equal(slider.getAttribute("aria-valuemax"), "3");
  assert.equal(slider.getAttribute("aria-valuenow"), "1");
  // The time the stamp chip shows, not a bare index nobody can map to the clip.
  assert.equal(slider.getAttribute("aria-valuetext"), "0:01");
});

test("arrow keys step one frame, Home and End go to the ends", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(PickFrame, { seed: (d) => { d.setStills(clip(4)); d.setFrameIndex(1); } });
  const slider = screen.getByRole("slider", { name: COPY.frameScrubber });
  const shown = () => [picture().getAttribute("src").slice(-6), slider.getAttribute("aria-valuenow")];

  for (let i = 0; i < 10 && document.activeElement !== slider; i++) await user.tab();
  assert.equal(document.activeElement, slider, "Tab does not reach the scrubber");

  await user.keyboard("{ArrowRight}");
  assert.deepEqual(shown(), ["STILL2", "2"]);
  await user.keyboard("{ArrowLeft}{ArrowLeft}");
  assert.deepEqual(shown(), ["STILL0", "0"]);
  await user.keyboard("{ArrowLeft}");
  assert.deepEqual(shown(), ["STILL0", "0"], "stepped past the first frame");
  await user.keyboard("{End}");
  assert.deepEqual(shown(), ["STILL3", "3"]);
  await user.keyboard("{ArrowRight}");
  assert.deepEqual(shown(), ["STILL3", "3"], "stepped past the last frame");
  await user.keyboard("{Home}");
  assert.deepEqual(shown(), ["STILL0", "0"]);
  // Up and Down are the other axis of the same control, as the ARIA slider pattern has them.
  await user.keyboard("{ArrowUp}");
  assert.deepEqual(shown(), ["STILL1", "1"]);
  await user.keyboard("{ArrowDown}");
  assert.deepEqual(shown(), ["STILL0", "0"]);
});

test("over the placeholders the slider runs the fixture clip's length and times", async () => {
  await renderInFlow(PickFrame, { seed: (d) => d.setFrameIndex(2) });

  const slider = screen.getByRole("slider", { name: COPY.frameScrubber });
  assert.equal(slider.getAttribute("aria-valuemax"), String(CLIP.frames.length - 1));
  assert.equal(slider.getAttribute("aria-valuetext"), CLIP.frames[2].label);
});

test("a key that cannot move the frame leaves the masks alone", async () => {
  // Choosing a frame clears the boxes drawn on the old one, which is right when the frame
  // changes and wrong when it does not. Coming back from masking and pressing Left on the
  // first frame, or End on the last, would otherwise wipe the covering-up for the same frame.
  const user = userEvent.setup({ document });
  const Probe = () => <output data-boxes={useDraft().boxes.length} />;
  const WithProbe = (props) => <><PickFrame {...props} /><Probe /></>;
  await renderInFlow(WithProbe, {
    seed: (d) => { d.setStills(clip(4)); d.setFrameIndex(0); d.setBoxes([{ x: 1, y: 1, w: 9, h: 9 }]); },
  });
  const boxes = () => document.querySelector("output").dataset.boxes;
  screen.getByRole("slider", { name: COPY.frameScrubber }).focus();

  await user.keyboard("{ArrowLeft}{Home}{ArrowDown}");
  assert.equal(boxes(), "1", "a key at the first frame wiped the masks");
  await user.keyboard("{End}{ArrowRight}");
  assert.equal(boxes(), "0", "moving to another frame kept masks drawn on the old one");
});

test("a tap on the frame already chosen leaves the masks alone too", async () => {
  // The pointer half of the same rule. It had the same flaw before the keyboard existed.
  const Probe = () => <output data-boxes={useDraft().boxes.length} />;
  const WithProbe = (props) => <><PickFrame {...props} /><Probe /></>;
  await renderInFlow(WithProbe, {
    seed: (d) => { d.setStills(clip(4)); d.setFrameIndex(3); d.setBoxes([{ x: 1, y: 1, w: 9, h: 9 }]); },
  });
  document.querySelector(".track").getBoundingClientRect = () => (
    { left: 0, width: 300, top: 0, height: 40, right: 300, bottom: 40, x: 0, y: 0 });
  const boxes = () => document.querySelector("output").dataset.boxes;

  fireEvent.pointerDown(scrubber(), { clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(scrubber(), { pointerId: 1 });
  assert.equal(boxes(), "1", "a tap on the chosen frame wiped its masks");
  fireEvent.pointerDown(scrubber(), { clientX: 0, pointerId: 1 });
  fireEvent.pointerUp(scrubber(), { pointerId: 1 });
  assert.equal(boxes(), "0");
});

test("a photograph's hidden scrubber is out of the tab order", async () => {
  // display: none already keeps it out of reach; the explicit -1 keeps it out if that styling
  // ever changes to something that only looks hidden.
  await renderInFlow(PickFrame, { seed: (d) => d.setStills(photograph) });

  assert.equal(scrubber().tabIndex, -1);
});

test("Next goes on to masking; back returns to capture", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(PickFrame, { id: "sb_jacaranda" });

  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: /back/i }));
  assert.deepEqual(navigated, [
    ["push", "/b/sb_jacaranda/add/mask"],
    ["push", "/b/sb_jacaranda/add"],
  ]);
});
