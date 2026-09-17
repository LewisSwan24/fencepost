// The masking itself, which had no test at all until 2026-09-17.
//
//   node --test lib/masking.test.mjs
//
// redact(), maskedFrame() and grabStill() are the only safety-critical code in this front
// end: they are what burns the black rectangle over a neighbour's face before a frame leaves
// the device. They need a canvas, and this suite is `node --test` with no DOM, so for weeks
// they were checked by hand in a browser and nowhere else.
//
// That is exactly how the worst bug of the day shipped green. redact() read an empty box list
// as a failure, so the ordinary sighting — a possum on a fence with no face and no number
// plate in shot — drew no box, ticked "nothing here identifies a person or a house", and
// silently lost the author's own photograph. All 154 tests passed while it did.
//
// The drawing surface is a parameter now, so a stand-in can record what was drawn. What
// follows asserts behaviour — how many rectangles were painted, and where — rather than
// whether a function returned something truthy.

import { test } from "node:test";
import assert from "node:assert/strict";
import { maskedFrame, redact, grabStill } from "./stills.js";

const SRC = "data:image/jpeg;base64,SRC";
const OUTPUT = "data:image/jpeg;base64,FAKE";

function recorder({ width = 720, height = 1280, noContext = false, brokenImage = false } = {}) {
  const ops = [];
  return {
    ops,
    rects: () => ops.filter((o) => o.op === "fillRect").map((o) => o.args),
    count: (op) => ops.filter((o) => o.op === op).length,
    exported: () => ops.find((o) => o.op === "toDataURL"),
    canvas: () => ({
      width: 0,
      height: 0,
      getContext() {
        if (noContext) return null;
        return {
          set fillStyle(value) { ops.push({ op: "fillStyle", value }); },
          drawImage(...args) { ops.push({ op: "drawImage", args: args.slice(1) }); },
          fillRect(...args) { ops.push({ op: "fillRect", args }); },
        };
      },
      toDataURL(type, quality) {
        ops.push({ op: "toDataURL", args: [type, quality], size: [this.width, this.height] });
        return OUTPUT;
      },
    }),
    image: () => {
      const img = { naturalWidth: width, naturalHeight: height };
      Object.defineProperty(img, "src", {
        set() {
          // A real Image fires these asynchronously, so this one does too. Resolving
          // synchronously would hide an ordering fault that a browser would find.
          queueMicrotask(() => (brokenImage ? img.onerror?.() : img.onload?.()));
        },
      });
      return img;
    },
  };
}

// 20% across and 11% down of a 720x1280 frame — the shape a face takes in these tests.
const FACE = { x: 69, y: 10, w: 20, h: 11 };

test("a drawn box is painted, at the pixels it was drawn over", async () => {
  const surface = recorder();
  const out = await redact(SRC, [FACE], 0, surface);
  assert.equal(out, OUTPUT);
  assert.equal(surface.count("drawImage"), 1, "the frame itself goes down first");
  const [rect] = surface.rects();
  // boxPixels rounds outward, so a box never shrinks away from what was covered on screen.
  assert.equal(rect[0], Math.floor(0.69 * 720));
  assert.equal(rect[1], Math.floor(0.10 * 1280));
  assert.ok(rect[2] >= Math.floor(0.20 * 720));
  assert.ok(rect[3] >= Math.floor(0.11 * 1280));
});

test("the paint is opaque black, and goes on after the frame rather than under it", async () => {
  const surface = recorder();
  await redact(SRC, [FACE], 0, surface);
  assert.deepEqual(surface.ops.map((o) => o.op).slice(0, 3),
                   ["drawImage", "fillStyle", "fillRect"],
                   "painting before the frame would be painting underneath it");
  assert.equal(surface.ops.find((o) => o.op === "fillStyle").value, "#000");
});

test("every box drawn is a box painted", async () => {
  const surface = recorder();
  await redact(SRC, [FACE, { x: 5, y: 60, w: 30, h: 10 }, { x: 40, y: 80, w: 15, h: 8 }],
               0, surface);
  assert.equal(surface.rects().length, 3);
});

test("redact refuses an empty list, because it cannot tell nothing-to-do from nothing-done", async () => {
  const surface = recorder();
  assert.equal(await redact(SRC, [], 0, surface), null);
  assert.equal(surface.ops.length, 0, "nothing should have been drawn");
});

test("maskedFrame keeps the picture when there was nothing to cover", async () => {
  // The 2026-09-17 bug, in one assertion.
  const surface = recorder();
  assert.equal(await maskedFrame(SRC, [], 480, surface), OUTPUT,
               "the author's own frame has to survive");
  assert.equal(surface.count("drawImage"), 1);
  assert.equal(surface.rects().length, 0, "nothing to cover, so nothing is painted");
});

test("maskedFrame still burns the boxes in when there are some", async () => {
  const surface = recorder();
  await maskedFrame(SRC, [FACE], 0, surface);
  assert.equal(surface.rects().length, 1);
});

test("the copy kept on the entry is drawn small; the one sent to the model is not", async () => {
  const card = recorder();
  await maskedFrame(SRC, [FACE], 480, card);
  assert.deepEqual(card.exported().size, [480, 853]);

  const full = recorder();
  await maskedFrame(SRC, [FACE], 0, full);
  assert.deepEqual(full.exported().size, [720, 1280]);
});

test("boxes that all fall outside the frame give nothing, not the original", async () => {
  // The arithmetic coming back empty is the same bug in a different hat: a frame that should
  // have been masked and was not must never be the thing that gets sent.
  const surface = recorder();
  assert.equal(await redact(SRC, [{ x: 150, y: 150, w: 10, h: 10 }], 0, surface), null);
  assert.equal(surface.count("toDataURL"), 0);
});

test("an image that will not decode gives nothing, from either entry point", async () => {
  assert.equal(await redact(SRC, [FACE], 0, recorder({ brokenImage: true })), null);
  assert.equal(await maskedFrame(SRC, [], 0, recorder({ brokenImage: true })), null);
});

test("a canvas with no 2d context gives nothing rather than an unmasked frame", async () => {
  assert.equal(await redact(SRC, [FACE], 0, recorder({ noContext: true })), null);
  assert.equal(await maskedFrame(SRC, [], 0, recorder({ noContext: true })), null);
});

test("no drawing surface at all is null rather than a crash", async () => {
  // Which is what node itself is: no document, no Image.
  assert.equal(await redact(SRC, [FACE], 0, null), null);
  assert.equal(await maskedFrame(SRC, [], 0, null), null);
  assert.equal(grabStill({ videoWidth: 720, videoHeight: 1280 }, null), null);
});

test("a photograph off the live preview carries its own size and no timestamp", async () => {
  const surface = recorder();
  const still = grabStill({ videoWidth: 1280, videoHeight: 720 }, surface);
  assert.equal(still.w, 720);
  assert.equal(still.h, 405);
  assert.equal(still.t, 0);
  assert.equal(still.label, null, "a photograph has no timeline to stamp");
  assert.equal(still.src, OUTPUT);
  assert.equal(surface.count("drawImage"), 1);
});

test("a preview that has not reported a size yet yields nothing", async () => {
  // The press that reached grabStill before loadedmetadata fired, which closed the camera and
  // dropped somebody on the stock-photograph picker with no explanation.
  assert.equal(grabStill({ videoWidth: 0, videoHeight: 0 }, recorder()), null);
  assert.equal(grabStill(null, recorder()), null);
});
