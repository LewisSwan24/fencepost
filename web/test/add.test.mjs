// Step 2 of posting, capture: where the clip at the centre of the product comes from.
//
//   node --import ./test/setup.mjs --test test/add.test.mjs
//
// Both buttons on this screen once called next() and did nothing else, so the one thing in
// the product that was never real was the footage. What the screen now promises, and what is
// pinned here:
//
//   Record opens the camera in the page when the browser has getUserMedia, and otherwise
//   falls back to a file input that asks for **photographs only** with capture="environment"
//   — the only accept list Android turns into its camera. The library input takes clips.
//
//   Where a choice leads: a photograph (one still, no timestamp) skips the frame picker and
//   goes to masking; a clip goes to the frame picker; and a clip the browser will not decode
//   also goes to the frame picker, to its placeholders, rather than to an error. "A phone with
//   an opinion about H.265 costs a picture, not a flow."
//
//   The skip button is the one way off the screen for somebody with no clip on the device.
//   It once crashed the page (next() called with no list), so it is pinned twice over.
//
//   The camera is mounted only while it is open, so closing it lets go of the lens.
//
//   And the footnote: Fencepost runs no cameras, the CLAUDE.md decision to use residents'
//   phones rather than street cameras, said on the screen where footage comes from.
//
// jsdom has no getUserMedia, no image decoding and no canvas, so each test that needs one
// installs a stand-in on the global and takes it away again in afterEach. The decoder itself
// (lib/stills.js) is not what is under test; the stand-ins only decide what it hands back.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Capture from "../app/b/[id]/add/page.js";
import { useDraft } from "../app/b/[id]/add/DraftContext.js";
import { COPY } from "../lib/copy.js";
import { renderInFlow } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

// The screen plus a readout of the draft, so a test can see what the screen left in it for
// the next step without reaching into React.
function Probe() {
  const draft = useDraft();
  return <output data-testid="stills">{draft.stills.length}</output>;
}
function CaptureWithProbe(props) {
  return (<><Capture {...props} /><Probe /></>);
}
const stillsInDraft = () => Number(screen.getByTestId("stills").textContent);

const recordButton = () => screen.getByRole("button", { name: "Record" });
const libraryButton = () => screen.getByRole("button", { name: "Choose from library" });
const skipButton = () => screen.getByRole("button", { name: COPY.captureSkip });
const recorderInput = () => document.querySelector('input[type="file"][capture]');
const libraryInput = () => document.querySelector('input[type="file"]:not([capture])');

// ---- stand-ins for what jsdom lacks, all undone after every test --------------------------

const restores = [];
function swap(target, key, value) {
  const had = Object.prototype.hasOwnProperty.call(target, key);
  const before = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
  restores.push(() => {
    if (had) Object.defineProperty(target, key, before);
    else delete target[key];
  });
}

// Which file inputs were opened. A picker cannot open in jsdom, so a click is the evidence.
function spyOnInputClicks() {
  const clicked = [];
  swap(window.HTMLInputElement.prototype, "click", function click() { clicked.push(this); });
  return clicked;
}

// A camera that answers, or refuses with a named DOMException-shaped error.
function giveCamera({ refuse } = {}) {
  const track = { stopped: 0, stop() { this.stopped += 1; }, kind: "video" };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  swap(navigator, "mediaDevices", {
    getUserMedia: () => (refuse
      ? Promise.reject(Object.assign(new Error(refuse), { name: refuse }))
      : Promise.resolve(stream)),
    enumerateDevices: () => Promise.resolve([{ kind: "videoinput" }, { kind: "videoinput" }]),
  });
  swap(window.HTMLMediaElement.prototype, "play", () => Promise.resolve());
  return track;
}

// An image decoder. `outcome` is "load" (a decodable photograph), "error" (a file the browser
// will not decode) or "hold" (still decoding — resolved later by calling the returned
// function), and the canvas stand-in lets the photograph path draw.
function giveDecoder(outcome) {
  let pending = null;
  class FakeImage {
    constructor() { this.naturalWidth = 1280; this.naturalHeight = 960; }
    set src(_) {
      const fire = () => (outcome === "error" ? this.onerror?.() : this.onload?.());
      if (outcome === "hold") pending = fire;
      else setTimeout(fire, 0);
    }
  }
  swap(globalThis, "Image", FakeImage);
  swap(URL, "createObjectURL", () => "blob:fake");
  swap(URL, "revokeObjectURL", () => {});
  swap(window.HTMLCanvasElement.prototype, "getContext", () => ({ drawImage() {} }));
  swap(window.HTMLCanvasElement.prototype, "toDataURL", () => "data:image/jpeg;base64,AAAA");
  return () => pending?.();
}

const photo = () => new File(["x"], "possum.jpg", { type: "image/jpeg" });

beforeEach(() => reset());
afterEach(() => {
  cleanup();
  while (restores.length) restores.pop()();
});

// ---- the screen as it stands ---------------------------------------------------------------

test("the screen says Fencepost runs no cameras of its own", async () => {
  // CLAUDE.md: filming is on residents' phones, never community cameras pointed at a street,
  // because surveillance dressed up as helpful is the line the brief draws. This is where
  // footage comes from, so this is where it is said.
  await renderInFlow(Capture);
  assert.ok(screen.getByText(COPY.noCameras));
});

test("back leaves the flow for the storyboard it started from", async () => {
  const user = userEvent.setup({ document });
  await renderInFlow(Capture, { id: "sb_jacaranda" });

  await user.click(screen.getByRole("button", { name: /back/i }));
  assert.deepEqual(navigated, [["push", "/b/sb_jacaranda"]]);
});

// ---- the way off with no clip -------------------------------------------------------------

test("skipping with no clip carries on to the placeholder frames, and does not crash", async () => {
  // The skip button once called next() with nothing and `stills.length` threw — the only way
  // off this screen for somebody without a clip crashed the page. It goes to the frame picker.
  const user = userEvent.setup({ document });
  await renderInFlow(Capture, { id: "sb_jacaranda" });

  await user.click(skipButton());
  assert.deepEqual(navigated, [["push", "/b/sb_jacaranda/add/frame"]]);
});

test("skipping drops a clip chosen earlier, so the placeholders are what follow", async () => {
  // Coming back and choosing "no clip" must not carry the previous clip's frames forward:
  // the frame screen decides live-or-placeholder from the draft, and the skip empties it.
  const user = userEvent.setup({ document });
  await renderInFlow(CaptureWithProbe, {
    seed: (d) => d.setStills([{ t: 0, label: "0:00", src: "data:a" },
                              { t: 1, label: "0:01", src: "data:b" }]),
  });
  assert.equal(stillsInDraft(), 2);

  await user.click(skipButton());
  assert.equal(stillsInDraft(), 0);
});

// ---- Record without a camera API ----------------------------------------------------------

test("Record with no getUserMedia falls back to the capture input, not the library", async () => {
  // The fallback is not dead code: it is what http, an old browser, or a refused site gets.
  // Record must reach the input that opens the camera, never the library picker.
  const user = userEvent.setup({ document });
  const clicked = spyOnInputClicks();
  await renderInFlow(Capture);

  await user.click(recordButton());
  assert.deepEqual(clicked, [recorderInput()]);
  assert.equal(screen.queryByRole("dialog", { name: "Camera" }), null);
});

test("the camera fallback asks for photographs only; the library takes clips too", async () => {
  // Chromium honours capture only when accept resolves to a single media supertype; with
  // "image/*,video/*" it drops capture and opens a photo picker with no camera tile. So the
  // capture input is image/* alone, and clips come through the library input.
  await renderInFlow(Capture);

  assert.equal(recorderInput().getAttribute("accept"), "image/*");
  assert.equal(recorderInput().getAttribute("capture"), "environment");
  assert.equal(libraryInput().getAttribute("accept"), "image/*,video/*");
  assert.equal(libraryInput().hasAttribute("capture"), false);
});

test("Choose from library opens the library input", async () => {
  const user = userEvent.setup({ document });
  const clicked = spyOnInputClicks();
  await renderInFlow(Capture);

  await user.click(libraryButton());
  assert.deepEqual(clicked, [libraryInput()]);
});

// ---- Record with a camera ------------------------------------------------------------------

test("Record opens the camera in the page when the browser has one to give", async () => {
  // The handoff to the phone's camera app stopped being the main path; with getUserMedia the
  // viewfinder opens here and no file picker is involved.
  const user = userEvent.setup({ document });
  giveCamera();
  const clicked = spyOnInputClicks();
  await renderInFlow(Capture);

  await user.click(recordButton());
  assert.ok(await screen.findByRole("dialog", { name: "Camera" }));
  assert.deepEqual(clicked, [], "a file picker opened alongside the camera");
});

test("closing the camera unmounts it and lets go of the lens", async () => {
  // Mounted only while open: kept mounted and hidden, it would hold the phone's camera and its
  // indicator light for the rest of the flow.
  const user = userEvent.setup({ document });
  const track = giveCamera();
  await renderInFlow(Capture);

  await user.click(recordButton());
  await screen.findByRole("dialog", { name: "Camera" });
  // Wait for the stream to have arrived, so there is a lens to let go of.
  await waitFor(() => assert.equal(screen.queryByText(COPY.cameraStarting), null));

  await user.click(screen.getByRole("button", { name: COPY.cameraClose }));
  assert.equal(screen.queryByRole("dialog", { name: "Camera" }), null);
  assert.ok(track.stopped > 0, "the camera closed on screen but the lens stayed open");
  assert.deepEqual(navigated, [], "closing the camera left the screen");
});

test("a refused camera hands over to the phone's camera app through the capture input", async () => {
  // A site the browser has been told to refuse still gets a way to take a picture: the
  // notice's button closes the viewfinder and opens the capture input.
  const user = userEvent.setup({ document });
  giveCamera({ refuse: "NotAllowedError" });
  const clicked = spyOnInputClicks();
  await renderInFlow(Capture);

  await user.click(recordButton());
  await user.click(await screen.findByRole("button", { name: COPY.cameraFallback }));
  assert.equal(screen.queryByRole("dialog", { name: "Camera" }), null);
  assert.deepEqual(clicked, [recorderInput()]);
});

// ---- what a chosen file leads to ----------------------------------------------------------

test("a photograph skips the frame picker and goes straight to masking", async () => {
  // A photograph has no frame to pick, so the screen with one cell and an immovable scrubber
  // is skipped. The single still is what the masking screen is handed.
  const user = userEvent.setup({ document, applyAccept: false });
  giveDecoder("load");
  await renderInFlow(CaptureWithProbe, { id: "sb_jacaranda" });

  await user.upload(recorderInput(), photo());
  await waitFor(() => assert.deepEqual(navigated, [["push", "/b/sb_jacaranda/add/mask"]]));
  assert.equal(stillsInDraft(), 1);
});

test("a file the browser will not decode lands on the frame picker, not on an error", async () => {
  // stillsFrom resolves to [] rather than throwing, and an empty list means placeholders:
  // an unreadable clip costs a picture, not the flow.
  const user = userEvent.setup({ document, applyAccept: false });
  giveDecoder("error");
  await renderInFlow(CaptureWithProbe, { id: "sb_jacaranda" });

  await user.upload(libraryInput(), photo());
  await waitFor(() => assert.deepEqual(navigated, [["push", "/b/sb_jacaranda/add/frame"]]));
  assert.equal(stillsInDraft(), 0);
  assert.equal(screen.queryByRole("alert"), null);
});

test("while a file is being read, it says so and nothing else can be started", async () => {
  // Reading takes seconds on a phone. The status line says what is happening, and every way
  // off the screen is held shut so a second choice cannot race the first.
  const user = userEvent.setup({ document, applyAccept: false });
  const finish = giveDecoder("hold");
  await renderInFlow(Capture);

  await user.upload(libraryInput(), photo());
  assert.equal(screen.getByRole("status").textContent, COPY.captureReading);
  for (const button of [recordButton(), libraryButton(), skipButton()]) {
    assert.equal(button.disabled, true, `${button.textContent} stayed live while reading`);
  }
  assert.deepEqual(navigated, []);

  finish();
  await waitFor(() => assert.equal(navigated.length, 1));
  assert.equal(screen.queryByText(COPY.captureReading), null);
});

test("the input is emptied after a choice, so the same file can be chosen again", async () => {
  // Cleared straight away so picking the same file twice still fires change, and a cancelled
  // second attempt does not reuse the first clip.
  const user = userEvent.setup({ document, applyAccept: false });
  giveDecoder("error");
  await renderInFlow(Capture);

  await user.upload(libraryInput(), photo());
  assert.equal(libraryInput().value, "");
});
