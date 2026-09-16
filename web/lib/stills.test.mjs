// Frame positions and draw sizes.
//
//   node --test lib/stills.test.mjs
//
// extractStills() needs a video decoder and a canvas, so it is not tested here — node has
// neither. What is tested is the arithmetic it depends on, and that is where the failures
// actually are: the visible way for this feature to break is eight stills that are all the
// same black opening frame, or a portrait clip drawn as a squashed landscape one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTimes, drawSize, clockLabel, base64Of } from "./stills.js";

test("stills are spread across the clip, not taken from the start", () => {
  const times = pickTimes(16, 8);
  assert.equal(times.length, 8);
  // Nothing at 0: the first instant of a phone recording is a hand and a black frame.
  assert.ok(times[0] > 0);
  // Strictly increasing, so the scrubber moving right moves forward in the clip.
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] > times[i - 1]);
});

test("every position sits inside the clip", () => {
  for (const seconds of [0.4, 3, 16, 300]) {
    for (const t of pickTimes(seconds, 8)) {
      assert.ok(t >= 0 && t < seconds, `${t} is outside a ${seconds}s clip`);
    }
  }
});

test("the positions are evenly spaced", () => {
  const times = pickTimes(16, 4);
  assert.deepEqual(times, [2, 6, 10, 14]);
});

test("a duration the browser has not worked out yet gives nothing", () => {
  // Safari reports Infinity until the file is buffered, and seeking to Infinity never
  // returns. Returning nothing sends the caller to the placeholders, which is a screen;
  // handing Infinity onward is a spinner that never stops.
  for (const bad of [Infinity, NaN, 0, -4, null, undefined]) {
    assert.deepEqual(pickTimes(bad, 8), []);
  }
});

test("a count that is not a whole positive number gives nothing", () => {
  for (const bad of [0, -1, 2.5, NaN, null, undefined, "8"]) {
    assert.deepEqual(pickTimes(16, bad), []);
  }
});

test("a very short clip still produces the number of stills asked for", () => {
  // Two seconds of possum is a normal thing to film. The picker draws one cell per still,
  // so a short clip returning three of eight would leave gaps in the strip.
  const times = pickTimes(2, 8);
  assert.equal(times.length, 8);
  for (const t of times) assert.ok(Number.isFinite(t) && t >= 0 && t < 2);
});

test("a portrait clip keeps its shape", () => {
  // The normal case: somebody holding a phone up at a fence. Getting this wrong stretches
  // the possum sideways on the one screen where the picture is the subject.
  const size = drawSize(1080, 1920);
  assert.equal(size.width, 720);
  assert.equal(size.height, 1280);
});

test("a landscape clip keeps its shape too", () => {
  const size = drawSize(1920, 1080);
  assert.equal(size.width, 720);
  assert.equal(size.height, 405);
});

test("a clip narrower than the target is not blown up", () => {
  // Upscaling costs memory and buys a softer picture.
  assert.deepEqual(drawSize(320, 240), { width: 320, height: 240 });
});

test("dimensions the browser could not read give nothing", () => {
  // videoWidth is 0 until metadata loads, and on a file that is not really a video it stays
  // 0. A canvas of width 0 throws on toDataURL in some browsers and returns a blank data URL
  // in others — the second is worse, because it looks like it worked.
  for (const [w, h] of [[0, 1080], [1920, 0], [0, 0], [undefined, undefined]]) {
    assert.equal(drawSize(w, h), null);
  }
});

test("labels read as a position in the clip", () => {
  assert.equal(clockLabel(0), "0:00");
  assert.equal(clockLabel(3.9), "0:03");     // floor, so the label never claims a frame ahead
  assert.equal(clockLabel(62), "1:02");
  assert.equal(clockLabel(600), "10:00");
});

test("a label never comes out negative or as NaN", () => {
  for (const bad of [-5, NaN, null, undefined, "x"]) {
    assert.equal(clockLabel(bad), "0:00");
  }
});

test("the frame handed to the model is base64, not a data URL", () => {
  // proxy/roles.py adds the `data:image/jpeg;base64,` prefix itself. Sending it twice hands
  // the model a string that is not a picture, and it answers about nothing.
  assert.equal(base64Of("data:image/jpeg;base64,QUJD"), "QUJD");
  assert.equal(base64Of("data:image/png;base64,QUJD"), "QUJD");
});

test("anything that is not a data URL gives nothing to send", () => {
  for (const bad of ["", null, undefined, "https://example.com/x.jpg",
                     "data:image/jpeg;base64,"]) {
    assert.equal(base64Of(bad), null);
  }
});
