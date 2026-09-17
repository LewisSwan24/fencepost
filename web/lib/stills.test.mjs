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
import { pickTimes, drawSize, clockLabel, base64Of, stillsFrom, thin } from "./stills.js";

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

// What a photograph is routed by.
//
// stillsFrom picks its path off file.type and nothing else, which is the whole reason a
// phone photograph reaches the masking screen at all. A rename on that property — reading
// file.mimeType, say — would send every photograph down the video decoder, which answers
// with an empty list, and the flow would silently fall back to a stock picture of somebody
// else's possum. That failure is invisible on a laptop and only shows up at a fence in the
// dark, so it is worth a test even though the decoding itself needs a browser.
test("a photograph is routed by its type, not by its name", async () => {
  let asked = 0;
  const file = { name: "possum.jpg", get type() { asked += 1; return "image/jpeg"; } };
  const out = await stillsFrom(file);
  assert.equal(asked > 0, true, "the dispatcher must read file.type");
  // node has no document, so both paths answer empty here — what is asserted is the read
  // and that neither path throws.
  assert.ok(Array.isArray(out));
});

test("nothing chosen is an empty list, not a crash", async () => {
  assert.deepEqual(await stillsFrom(null), []);
  assert.deepEqual(await stillsFrom(undefined), []);
});

test("a file with no type at all falls to the clip path rather than throwing", async () => {
  assert.ok(Array.isArray(await stillsFrom({ name: "clip" })));
});

// A clip the page recorded itself.
//
// MediaRecorder writes its container header before it knows how long the recording will
// run, so a WebM out of it commonly reports duration Infinity. usableDuration reads that as
// unknown and pickTimes then returns nothing — which is not a degraded result, it is zero
// stills out of a clip the person just filmed. The camera holds a stopwatch for exactly
// this, and these tests pin the order: the file first, the stopwatch only as a fallback.
test("a clip with no duration in its header falls back to the measured length", () => {
  const times = pickTimes(Infinity, 8, 4);
  assert.equal(times.length, 8);
  assert.ok(times[0] > 0 && times[7] < 4);
});

test("a duration the file does know is preferred over the measured one", () => {
  // 16s in the file, a wrong 4s from the caller. The file wins.
  const times = pickTimes(16, 8, 4);
  assert.ok(times[7] > 4);
});

test("neither a duration nor a measurement is still an empty list, not a crash", () => {
  assert.deepEqual(pickTimes(Infinity, 8, 0), []);
  assert.deepEqual(pickTimes(0, 8), []);
  assert.deepEqual(pickTimes(NaN, 8, NaN), []);
});

// Thinning the camera's samples down to a filmstrip.
//
// The in-page camera samples the preview every half second while somebody films, so a
// twenty-second recording arrives as forty frames and the picker wants eight. Two things
// have to hold: never the very first frame (a hand and a black screen) and never two of the
// same one, because the filmstrip keys its cells on each still's t and duplicates collide.
const sample = (n) => Array.from({ length: n }, (_, i) => ({ t: i * 0.5, label: "x" }));

test("a long run of samples comes back as the count asked for", () => {
  assert.equal(thin(sample(40), 8).length, 8);
  assert.equal(thin(sample(9), 8).length, 8);
});

test("thinning never opens on the first frame", () => {
  // The first half-second of a recording is a hand moving away from the shutter.
  assert.ok(thin(sample(40), 8)[0].t > 0);
});

test("thinned samples stay in order and stay distinct", () => {
  const out = thin(sample(40), 8);
  for (let i = 1; i < out.length; i += 1) assert.ok(out[i].t > out[i - 1].t);
  assert.equal(new Set(out.map((s) => s.t)).size, out.length);
});

test("a short recording is kept whole rather than padded", () => {
  const three = sample(3);
  assert.deepEqual(thin(three, 8), three);
  assert.equal(thin(three, 8).length, 3);
});

test("nothing to thin, or a nonsense count, is an empty list", () => {
  assert.deepEqual(thin([], 8), []);
  assert.deepEqual(thin(null, 8), []);
  assert.deepEqual(thin(sample(40), 0), []);
  assert.deepEqual(thin(sample(40), 1.5), []);
});
