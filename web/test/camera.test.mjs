// The in-page camera: getUserMedia, a live preview, a shutter that photographs or samples.
//
//   node --import ./test/setup.mjs --test test/camera.test.mjs
//
// jsdom has no camera, no canvas and no media playback, so this suite brings its own:
// navigator.mediaDevices is a fake that hands out streams whose tracks record being stopped,
// HTMLVideoElement reports a 1280x720 frame, play() resolves, and a canvas answers with a
// numbered JPEG data URL. All of it goes on in beforeEach and comes off in afterEach, so no
// other suite ever sees it.
//
// What is pinned is what the component's own comments say must hold:
//
//   the lens is let go on every way out — the X, Escape, a shot, the component going away.
//   A track left running keeps the phone's camera light on while somebody is masking and
//   writing, which reads, correctly, as the app still watching them;
//
//   no microphone is asked for, because nothing keeps audio;
//
//   a frame leaves through a canvas as a re-encoded JPEG — the path that guarantees no EXIF
//   and no GPS — and filming keeps frames, never footage;
//
//   the shutter is held until the preview has a frame size, so a press cannot reach an
//   empty grab and dump somebody on the stock-photo picker;
//
//   each of the four refusals gets its own sentence and the right way out — a device with no
//   camera is offered the library, never the camera app;
//
//   flipping the lens mid-recording keeps what was already filmed, and a flip that fails
//   mid-recording hands those frames back rather than holding them behind an error screen.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Camera from "../components/Camera.js";
import { COPY } from "../lib/copy.js";

// ---- the fake camera -------------------------------------------------------------------

let requests;          // every constraints object getUserMedia was called with
let streams;           // every stream handed out, in order
let answers;           // queued answers: an Error to reject with, a promise to wait on
                       // first, or undefined to grant
let lenses;            // how many videoinput devices enumerateDevices reports
let frameNo;

function stream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const s = { track, getTracks: () => [track] };
  streams.push(s);
  return s;
}

function named(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}

const saved = {};

function patch(target, key, descriptor) {
  saved[key] = saved[key] || [];
  saved[key].push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

function restoreAll() {
  for (const list of Object.values(saved)) {
    for (const [target, key, was] of list.reverse()) {
      if (was) Object.defineProperty(target, key, was);
      else delete target[key];
    }
  }
  for (const key of Object.keys(saved)) delete saved[key];
}

beforeEach(() => {
  requests = [];
  streams = [];
  answers = [];
  lenses = 2;
  frameNo = 0;

  patch(navigator, "mediaDevices", {
    value: {
      getUserMedia: async (constraints) => {
        requests.push(constraints);
        let answer = answers.shift();
        if (answer && typeof answer.then === "function") answer = await answer;
        if (answer instanceof Error) throw answer;
        return stream();
      },
      enumerateDevices: async () =>
        Array.from({ length: lenses }, () => ({ kind: "videoinput" })),
    },
  });
  const video = HTMLVideoElement.prototype;
  const media = HTMLMediaElement.prototype;
  patch(video, "videoWidth", { get: () => 1280 });
  patch(video, "videoHeight", { get: () => 720 });
  patch(media, "play", { value: () => Promise.resolve(), writable: true });
  patch(media, "srcObject", { value: null, writable: true });
  const canvas = HTMLCanvasElement.prototype;
  patch(canvas, "getContext", { value: () => ({ drawImage() {} }), writable: true });
  patch(canvas, "toDataURL", {
    value: (type) => `data:${type};base64,frame${(frameNo += 1)}`,
    writable: true,
  });
});

afterEach(() => {
  cleanup();
  restoreAll();
});

// ---- helpers ---------------------------------------------------------------------------

async function open(props = {}) {
  const calls = { photo: [], clip: [], close: 0, fallback: 0, library: 0 };
  let view;
  await act(async () => {
    view = render(
      <Camera
        onPhoto={(s) => calls.photo.push(s)}
        onClip={(s) => calls.clip.push(s)}
        onClose={() => { calls.close += 1; }}
        onFallback={() => { calls.fallback += 1; }}
        onLibrary={() => { calls.library += 1; }}
        {...props}
      />
    );
  });
  return { calls, view, video: view.container.querySelector("video") };
}

// Granted, and the preview has reported its size: the shutter is live.
async function openReady() {
  const got = await open();
  await waitFor(() => assert.equal(screen.queryByText(COPY.cameraStarting), null));
  fireEvent.loadedMetadata(got.video);
  await waitFor(() => assert.equal(shutter().disabled, false));
  return got;
}

const shutter = () => screen.getByRole("button", {
  name: new RegExp(`^(${COPY.cameraTakePhoto}|${COPY.cameraStartVideo}|${COPY.cameraStopVideo})$`),
});
const flipButton = () => screen.queryByRole("button", { name: COPY.cameraFlip });

// ---- tests -----------------------------------------------------------------------------

test("it never asks for the microphone, and asks for the rear lens as a preference", async () => {
  // Nothing here keeps audio, so asking for that permission would be asking in order to throw
  // the answer away. `exact` would break every single-lens laptop the demo runs on.
  await open();
  await waitFor(() => assert.equal(requests.length, 1));
  assert.equal(requests[0].audio, false, "asked for a microphone nothing uses");
  assert.equal(requests[0].video.facingMode, "environment",
               "facingMode should be a plain preference, not { exact }");
});

test("the shutter is held until the preview has a frame to take", async () => {
  // Ready is not ready to shoot: a press before loadedmetadata reached an empty grab, closed
  // the camera and dropped somebody on the stock-photograph picker with no explanation.
  let grant;
  answers.push(new Promise((resolve) => { grant = resolve; }));
  const { video } = await open();
  assert.ok(screen.getByText(COPY.cameraStarting));
  assert.equal(shutter().disabled, true, "live while the camera was still opening");

  await act(async () => { grant(); });
  await waitFor(() => assert.equal(screen.queryByText(COPY.cameraStarting), null));
  assert.equal(shutter().disabled, true, "live before the preview had any dimensions");

  fireEvent.loadedMetadata(video);
  await waitFor(() => assert.equal(shutter().disabled, false));
});

test("a photograph leaves as a re-encoded JPEG, and the lens is let go", async () => {
  // The canvas is what guarantees the EXIF and GPS line; a shot that left the track running
  // would keep the camera light on through masking and writing.
  const user = userEvent.setup({ document });
  const { calls } = await openReady();

  await user.click(shutter());
  assert.equal(calls.photo.length, 1);
  const [still] = calls.photo[0];
  assert.match(still.src, /^data:image\/jpeg;base64,/, "the frame did not go through the canvas");
  assert.equal(streams[0].track.stopped, true, "the camera was still on after the shot");
});

test("the X lets go of the lens as well as closing", async () => {
  // Closing without stopping the track leaves the phone's camera indicator lit.
  const user = userEvent.setup({ document });
  const { calls } = await openReady();

  await user.click(screen.getByRole("button", { name: COPY.cameraClose }));
  assert.equal(calls.close, 1);
  assert.equal(streams[0].track.stopped, true);
});

test("Escape closes it and lets go of the lens, like every Sheet in the flow", async () => {
  // A fixed overlay rather than a Sheet, so the key handling is its own and can go missing
  // on its own.
  const { calls } = await openReady();

  fireEvent.keyDown(window, { key: "Escape" });
  assert.equal(calls.close, 1);
  assert.equal(streams[0].track.stopped, true);
});

test("the route changing underneath it still lets go of the lens", async () => {
  // Unmounting is the one way out nobody presses a button for, and the easiest to forget.
  const { view } = await openReady();
  view.unmount();
  assert.equal(streams[0].track.stopped, true, "the camera stayed on after the screen went");
});

test("filming keeps frames, not footage, and says so before it starts", async () => {
  // Fencepost has no object storage; filming samples the preview and keeps the stills. The
  // hint is the only place the person is told that before they press.
  const user = userEvent.setup({ document });
  const { calls } = await openReady();

  await user.click(screen.getByRole("button", { name: COPY.cameraModeVideo }));
  assert.ok(screen.getByText(COPY.cameraVideoHint));
  await user.click(shutter());

  // Mode switches mean nothing mid-recording, so they are gone rather than dead.
  assert.equal(screen.queryByRole("button", { name: COPY.cameraModePhoto }), null);
  assert.equal(shutter().getAttribute("aria-label"), COPY.cameraStopVideo);

  await user.click(shutter());
  assert.equal(calls.clip.length, 1);
  assert.ok(calls.clip[0].length >= 1, "a quick press and release produced nothing");
  for (const frame of calls.clip[0]) {
    assert.match(frame.src, /^data:image\/jpeg;base64,/, "something other than a still came back");
  }
  assert.equal(streams[0].track.stopped, true);
});

test("flipping the lens mid-recording keeps what was already filmed", async () => {
  // The stream effect runs again on a flip; if its cleanup were the full teardown, turning the
  // phone round halfway through would silently throw away everything filmed so far. And the
  // shutter must stay a stop button through the swap, or it changes meaning under a finger.
  const user = userEvent.setup({ document });
  const { calls } = await openReady();

  await user.click(screen.getByRole("button", { name: COPY.cameraModeVideo }));
  await user.click(shutter());
  const first = frameNo;
  assert.ok(first >= 1);

  await user.click(flipButton());
  await waitFor(() => assert.equal(requests.length, 2));
  assert.equal(requests[1].video.facingMode, "user");
  assert.equal(streams[0].track.stopped, true, "the old lens was not let go before the new one");
  await waitFor(() => assert.equal(streams.length, 2));
  assert.equal(shutter().getAttribute("aria-label"), COPY.cameraStopVideo);
  assert.equal(shutter().disabled, false, "a stop press was refused because a lens was opening");

  await user.click(shutter());
  assert.equal(calls.clip.length, 1);
  assert.ok(calls.clip[0].some((f) => f.src.endsWith(`frame${first}`)),
            "the frames from before the flip were lost");
});

test("a flip that fails mid-recording hands back what was filmed", async () => {
  // The alternative is an error screen holding a recording hostage over a lens that was
  // working a second ago.
  const user = userEvent.setup({ document });
  const { calls } = await openReady();

  await user.click(screen.getByRole("button", { name: COPY.cameraModeVideo }));
  await user.click(shutter());
  answers.push(named("NotReadableError"));
  await user.click(flipButton());

  await waitFor(() => assert.equal(calls.clip.length, 1));
  assert.ok(calls.clip[0].length >= 1);
  assert.equal(screen.queryByText(COPY.cameraBusyTitle), null,
               "the frames came back and an error screen went up anyway");
});

test("a device known to have one lens gets no flip button", async () => {
  // facingMode is a preference, so flipping a single-lens device hands the same lens back —
  // a button that appears to do nothing.
  lenses = 1;
  await openReady();
  await waitFor(() => assert.equal(flipButton(), null));
});

test("a refusal says it is a refusal, and offers the phone's camera app", async () => {
  // Denied is something the address bar can undo; the way out is the camera app.
  answers.push(named("NotAllowedError"));
  const { calls } = await open();
  const user = userEvent.setup({ document });

  await waitFor(() => screen.getByText(COPY.cameraDeniedTitle));
  assert.ok(screen.getByText(COPY.cameraDeniedBody));
  assert.equal(screen.queryByRole("button", { name: COPY.cameraUseLibrary }), null);
  assert.equal(shutter().disabled, true, "a shutter was offered with no camera behind it");

  await user.click(screen.getByRole("button", { name: COPY.cameraFallback }));
  assert.equal(calls.fallback, 1);
  assert.equal(calls.library, 0);
});

test("no camera at all is offered the library, never the camera app", async () => {
  // Sending somebody with no camera to their camera app reads as the app not having
  // understood the answer it just got.
  answers.push(named("NotFoundError"));
  const { calls } = await open();
  const user = userEvent.setup({ document });

  await waitFor(() => screen.getByText(COPY.cameraMissingTitle));
  assert.equal(screen.queryByRole("button", { name: COPY.cameraFallback }), null,
               "a device with no camera was sent to its camera app");
  await user.click(screen.getByRole("button", { name: COPY.cameraUseLibrary }));
  assert.equal(calls.library, 1);
  assert.equal(calls.fallback, 0);
});

test("another app holding the lens is told apart from being refused", async () => {
  // Four reasons are four different things to do; the busy one is fixed in ten seconds, but
  // only if it is not reported as the browser saying no.
  answers.push(named("NotReadableError"));
  await open();
  await waitFor(() => screen.getByText(COPY.cameraBusyTitle));
  assert.ok(screen.getByText(COPY.cameraBusyBody));
  assert.equal(screen.queryByText(COPY.cameraDeniedBody), null);
});
