// Frame positions, draw sizes, and which path a file is sent down.
//
//   node --import ./test/setup.mjs --test lib/stills.test.mjs
//
// The decoding itself needs a browser and is not tested here. What is tested is the
// arithmetic around it, which is where the failures actually are — the visible way for this
// feature to break is eight stills that are all the same black opening frame, or a portrait
// clip drawn as a squashed landscape one — and the dispatch in stillsFrom, which needs a
// document to reach at all. Hence the harness in the command above.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTimes, drawSize, clockLabel, base64Of, stillsFrom, thin } from "./stills.js";

// A file the way the picker hands one over, and a way to see whether its type was read.
// `type` is an own getter shadowing Blob's, so the object is still a real Blob and
// URL.createObjectURL accepts it.
function pickedFile(name, type) {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type });
  let asked = 0;
  Object.defineProperty(file, "type", { get() { asked += 1; return type; },
                                        configurable: true });
  return { file, asks: () => asked };
}

// A document that cannot decode, which is the one we have.
//
// Measured on 2026-09-20: jsdom loads no media, so an <img> handed a blob URL fires neither
// load nor error, and a <video> neither loadedmetadata nor error. A real Blob on its own
// therefore leaves the photograph path hanging for good and the clip path hanging until
// BUDGET_MS, twelve seconds. Both elements are stood in for instead — the same move redact()
// made when it took its drawing surface as a parameter — and each stand-in reports the
// failure a real browser reports for a blob it cannot decode, so the promise settles at once
// and the answer is the empty list that is the contract either way.
//
// What that makes observable is the routing: the photograph path is the one that makes an
// image, the clip path the one that makes a video. Before this, neither branch was entered —
// both returned [] on `typeof document === "undefined"` and the assertion was that nothing
// threw.
async function withStandInMedia(run) {
  const made = [];
  const RealImage = globalThis.Image;
  const realCreate = document.createElement.bind(document);

  const standIn = (kind) => {
    const el = {
      set src(value) {
        made.push({ kind, url: value });
        queueMicrotask(() => el.onerror?.());
      },
      removeAttribute() {},
      load() {},
    };
    return el;
  };

  globalThis.Image = function Image() { return standIn("img"); };
  document.createElement = (tag, ...rest) =>
    (tag === "video" ? standIn("video") : realCreate(tag, ...rest));

  try {
    return { made, out: await run() };
  } finally {
    globalThis.Image = RealImage;
    document.createElement = realCreate;
  }
}

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
test("a photograph goes to the photograph path", async () => {
  const jpeg = pickedFile("possum.jpg", "image/jpeg");
  const { made, out } = await withStandInMedia(() => stillsFrom(jpeg.file));

  assert.equal(jpeg.asks() > 0, true, "the dispatcher must read file.type");
  assert.deepEqual(made.map((m) => m.kind), ["img"], "sent down the video decoder");
  assert.match(made[0].url, /^blob:/, "the element was handed something other than the file");
  assert.deepEqual(out, [], "a document that cannot decode still has to answer empty");
});

test("and it is the type that decides, not the name", async () => {
  // The half the old test was named for and did not check. A clip saved as possum.jpg is
  // not a photograph, and a phone photograph whose name says nothing is.
  const lying = pickedFile("possum.jpg", "video/mp4");
  const quiet = pickedFile("IMG_0031", "image/heic");

  assert.deepEqual((await withStandInMedia(() => stillsFrom(lying.file))).made
                     .map((m) => m.kind), ["video"]);
  assert.deepEqual((await withStandInMedia(() => stillsFrom(quiet.file))).made
                     .map((m) => m.kind), ["img"]);
});

test("nothing chosen is an empty list, not a crash", async () => {
  assert.deepEqual(await stillsFrom(null), []);
  assert.deepEqual(await stillsFrom(undefined), []);
});

test("a file with no type at all falls to the clip path rather than throwing", async () => {
  const { made, out } = await withStandInMedia(() => stillsFrom(pickedFile("clip", "").file));

  assert.deepEqual(made.map((m) => m.kind), ["video"]);
  assert.deepEqual(out, []);
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

// A clip too short to have eight distinct moments in it.
//
// pickTimes clamps every position to just before the end, so on a clip under about 0.27s the
// last few land on the same instant and under 0.05s all eight are 0. The frame picker keys
// its filmstrip on t, so identical stamps are duplicate React keys — a warning, and cells
// that can reconcile onto the wrong image. Fewer real positions is the honest answer to a
// short clip; eight copies of one is not.
test("a very short clip yields fewer positions rather than repeated ones", () => {
  for (const seconds of [0.25, 0.2, 0.1, 0.04, 0.01]) {
    const times = pickTimes(seconds, 8);
    assert.equal(new Set(times).size, times.length, `duplicate stamps at ${seconds}s`);
    for (let i = 1; i < times.length; i += 1) assert.ok(times[i] > times[i - 1]);
  }
});

test("a clip with room for all eight still gets all eight", () => {
  // The dedupe must not quietly cost positions on an ordinary clip.
  assert.equal(pickTimes(16, 8).length, 8);
  assert.equal(pickTimes(4, 8).length, 8);
  assert.equal(pickTimes(1, 8).length, 8);
});
