// Shot: one night frame, with or without a picture in it.
//
//   node --import ./test/setup.mjs --test test/shot.test.mjs
//
// A small component whose header comment makes five promises, each of which a later edit can
// drop without anything looking wrong on the page it was made on:
//
//   the box is the same size with a picture and without one, so a layout does not jump when
//   the image arrives;
//
//   a picture with no alt is decorative (alt=""), so a screen reader skips it rather than
//   reading out a filename;
//
//   the dark wash goes under children and only under children — it keeps overlaid text
//   readable, and laid over nothing it only darkens every photograph;
//
//   with an aspect ratio the *width* is bounded, never the height, so a portrait still is
//   shown whole rather than cropped — the missing part being the top of the frame, the part
//   most likely to need masking;
//
//   radius "none" does not round the picture inside an already rounded card.
//
// What the EXIF/GPS line needs of this file is not checkable here: the comment is explicit
// that stripping happens before a file reaches web/public/frames/, and a browser will not do
// it. That lives in lib/stills (canvas re-encode) and in how the material was prepared.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

import Shot from "../components/Shot.js";

afterEach(() => cleanup());

async function draw(props, children) {
  let view;
  await act(async () => {
    view = render(<Shot {...props}>{children}</Shot>);
  });
  return view.container.firstChild;
}

test("the frame keeps its height before and after a picture arrives", async () => {
  // The layout must not jump when the image turns up.
  const empty = await draw({ height: 206 });
  const before = empty.style.height;
  cleanup();
  const full = await draw({ height: 206, src: "/frames/a.jpg" });
  assert.equal(before, "206px");
  assert.equal(full.style.height, before, "the box changed size when the picture came in");
});

test("with no picture there is only the dark, not a broken image", async () => {
  // Without a src it shows the night rather than an <img> pointing at nothing.
  const box = await draw({});
  assert.equal(box.querySelector("img"), null);
});

test("a picture with no alt is decorative, not a filename read aloud", async () => {
  // alt="" makes a screen reader skip it; an absent alt would read out the path.
  const box = await draw({ src: "/frames/possum-fence.jpg" });
  const img = box.querySelector("img");
  assert.ok(img);
  assert.equal(img.getAttribute("alt"), "");
});

test("a picture with an alt keeps it", async () => {
  // Where the caller has something to say about the frame, it is said.
  const box = await draw({ src: "/frames/a.jpg", alt: "A brushtail on the fence" });
  assert.equal(box.querySelector("img").getAttribute("alt"), "A brushtail on the fence");
});

test("the wash goes under text on the frame, and is absent over a bare picture", async () => {
  // It exists to keep overlaid text readable; laid down with no children it only darkens
  // every photograph for nothing.
  const bare = await draw({ src: "/frames/a.jpg" });
  assert.equal(bare.querySelector(".scrim"), null, "a bare photograph was darkened");
  cleanup();

  const captioned = await draw({ src: "/frames/a.jpg" }, <span>0:03</span>);
  const scrim = captioned.querySelector(".scrim");
  assert.ok(scrim, "text sat straight on the picture with nothing to keep it readable");
  assert.equal(scrim.getAttribute("aria-hidden"), "true");
  assert.ok(captioned.textContent.includes("0:03"));
});

test("with an aspect ratio the width is bounded and the height follows the picture", async () => {
  // A portrait still in a fixed-height box showed 35% of itself, top cut off — the part most
  // likely to need masking. Bounding height instead would distort it.
  //
  // Read off server markup rather than the jsdom node: jsdom's style parser drops both
  // aspect-ratio and a calc() mixing vh with a number, so the DOM would show neither.
  const html = renderToStaticMarkup(
    <Shot src="/frames/tall.jpg" aspect={0.5625} maxHeight="42vh" />
  );
  const style = html.match(/style="([^"]*)"/)[1];
  assert.match(style, /height:auto/, "a fixed height crops a portrait frame");
  assert.match(style, /max-width:calc\(42vh \* 0\.5625\)/, "nothing bounds the width");
  assert.match(style, /aspect-ratio:0\.5625/, "the picture's own shape was not carried");
});

test("radius none does not nest a second curve inside a rounded card", async () => {
  // The list card is already rounded with overflow:hidden.
  const flat = await draw({ radius: "none" });
  assert.ok(flat.classList.contains("none"));
  assert.ok(!flat.classList.contains("md"));
  // The fallback to md for an unknown radius cannot be tested here: the CSS-module stand-in
  // answers every key with its own name, so styles["huge"] is never undefined.
});
