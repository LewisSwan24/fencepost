// Stills out of the clip the person actually filmed.
//
// Until now the first screen was two buttons that both went to the next screen, and the
// frame picker offered photographs of somebody else's possum. This is the part that makes
// the clip real: chosen on the phone, decoded in the page, never sent anywhere.
//
// The clip itself never leaves the browser: there is no object storage behind this product,
// so a sighting has no watchable video and the eight stills live in memory for the length of
// the posting flow and go when the tab does.
//
// One of them does not. The frame the author picked and then masked is saved with the entry
// (data-model.md §1 entries.still), because a storyboard showing a stock photograph of
// somebody else's possum beside somebody's own account of their own evening is the concept
// failing quietly. What is kept is the redacted copy, at card size, and it dies with the
// entry — a different thing from retaining the raw frames this file produces.
//
// Drawing through a canvas settles the other safety line for free: a re-encoded bitmap
// carries no EXIF and no GPS, because none of that survives the pixels.

import { boxPixels } from "./mask.js";

// Wide enough to read on a phone, small enough that eight of them in memory are not a
// problem. The picker shows them about 200px tall.
const TARGET_WIDTH = 720;

// Some browsers report duration as Infinity until the whole file is buffered, and a seek to
// Infinity never completes. Anything that is not a finite positive number is unknown.
function usableDuration(duration) {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * The timestamps to grab, in seconds.
 *
 * Spread across the clip rather than taken from the start: the first instant of a phone
 * recording is very often black or a blur of the hand, and the last is the hand coming back.
 * Taking the midpoint of each slice avoids both ends without having to know anything about
 * how long the clip is.
 */
export function pickTimes(duration, count, fallbackSeconds = 0) {
  // What the file says, and only if that is unusable, what the caller measured. This order
  // round rather than the other: a file that knows its own length is more trustworthy than
  // a stopwatch, and the stopwatch exists for the one case where the file does not know.
  const length = usableDuration(duration) || usableDuration(fallbackSeconds);
  if (!length || !Number.isInteger(count) || count < 1) return [];
  const times = [];
  for (let i = 0; i < count; i += 1) {
    const at = ((i + 0.5) / count) * length;
    // Seeking to exactly the last frame lands past the end on some decoders and never fires
    // `seeked`, which would hang the extraction on the final still.
    const clamped = Math.min(at, Math.max(0, length - 0.05));
    // That clamp is what makes duplicates possible. On a clip under about 0.27s the last
    // positions all land on the same instant, and under 0.05s every one of them is 0 — eight
    // stills stamped with an identical t, which the frame picker uses as its React key. Fewer
    // real positions is the honest answer to a very short clip; eight copies of one is not.
    if (times.length && clamped <= times[times.length - 1]) continue;
    times.push(clamped);
  }
  return times;
}

/**
 * How big to draw, keeping the clip's own shape.
 *
 * Portrait is the normal case here — somebody holding a phone up at a fence — so this cannot
 * assume landscape, and it must never scale a small clip up into a soft one.
 */
export function drawSize(width, height, target = TARGET_WIDTH) {
  if (!width || !height) return null;
  const scale = Math.min(1, target / width);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * "0:03" — a position in the clip, not a time of day.
 *
 * lib/format.js is the home for time display, but everything in it formats a calendar
 * instant: relative(), until(), stamp(), monthDay(). This formats an offset into a piece of
 * media, which is a different thing that happens to look similar, so it lives beside the
 * code that produces the offsets.
 */
export function clockLabel(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
}

// Enough for a phone clip on a phone. Past this, give back whatever was decoded so far
// rather than leaving somebody looking at a spinner at a fence in the dark.
const BUDGET_MS = 12000;
const JPEG_QUALITY = 0.72;

// A seek that resolves when the frame is actually there.
//
// Setting currentTime is asynchronous — drawing immediately afterwards paints the *previous*
// frame, which is how you end up with eight identical stills. The seeked event is the only
// signal that the decoder has caught up.
function seek(video, time) {
  return new Promise((resolve, reject) => {
    // Already there: no seeked event is coming, and waiting for one hangs the rest of the
    // run. Short clips make this real — eight positions in two seconds collide at the end.
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve();
      return;
    }
    const done = () => { off(); resolve(); };
    const failed = () => { off(); reject(new Error("seek failed")); };
    const off = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", failed);
    };
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", failed, { once: true });
    video.currentTime = time;
  });
}

/**
 * Stills out of a clip the person just picked or filmed.
 *
 * Resolves to `[{ t, label, src }]`, or to an empty array on anything going wrong — a codec
 * the browser will not decode, a still image handed to a video input, a seek that never
 * completes. **Empty is a valid answer**, and the caller falls back to the placeholder
 * photographs. Tonight is never allowed to be worse than last night because a phone had an
 * opinion about H.265.
 */
export function extractStills(file, count = 8, knownSeconds = 0) {
  return new Promise((resolve) => {
    if (!file || typeof document === "undefined" || typeof URL === "undefined") {
      resolve([]);
      return;
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const out = [];
    let settled = false;

    function finish(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Let go of the decoder and the blob. Without the revoke the whole clip stays in
      // memory for the life of the tab, which on a phone is the difference between a slow
      // screen and a reload.
      try {
        video.removeAttribute("src");
        video.load();
      } catch { /* the element is already gone; nothing to release */ }
      URL.revokeObjectURL(url);
      resolve(value);
    }

    const timer = setTimeout(() => finish(out.slice()), BUDGET_MS);

    // muted + playsInline are what let a video element decode on iOS without being played.
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => finish([]);

    video.onloadedmetadata = async () => {
      try {
        // A clip this page recorded itself is the case video.duration cannot answer. A
        // MediaRecorder writes its container header before it knows how long the recording
        // will be, so a WebM out of it very often reports Infinity — and usableDuration
        // reads Infinity as unknown, which gives no times and therefore no stills at all.
        // The camera timed the recording while it was happening, so it can simply say.
        const times = pickTimes(video.duration, count, knownSeconds);
        const size = drawSize(video.videoWidth, video.videoHeight);
        if (!times.length || !size) {
          finish([]);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          finish([]);
          return;
        }
        for (const t of times) {
          if (settled) return;
          await seek(video, t);
          ctx.drawImage(video, 0, 0, size.width, size.height);
          // w and h travel with the still because the masking screen has to display it at
          // exactly its own shape. Boxes are stored as percentages of what was on screen and
          // redact() applies them as percentages of the image, so if the screen letterboxes
          // or crops a portrait clip into a fixed-height box, the black rectangle lands
          // somewhere other than where the person drew it — which is the one thing that
          // screen cannot get wrong.
          out.push({ t, label: clockLabel(t), w: size.width, h: size.height,
                     src: canvas.toDataURL("image/jpeg", JPEG_QUALITY) });
        }
        finish(out.slice());
      } catch {
        // Partway is still worth having: four real stills beat eight of somebody else's
        // possum. Only a run that produced nothing falls back.
        finish(out.slice());
      }
    };

    video.src = url;
  });
}

/**
 * Where the drawing happens.
 *
 * The three functions below are the only safety-critical code in this front end — they are
 * what puts the black rectangle over a neighbour's face before a frame leaves the device —
 * and until now not one of them had a test, because they need a canvas and the suite is
 * `node --test` with no DOM. That gap is how the worst bug of 2026-09-17 shipped green: an
 * empty box list read as a failure, so ticking "nothing here identifies a person" silently
 * threw the author's own photograph away, and all 154 tests passed.
 *
 * Rather than take on a native canvas dependency, the surface is a parameter. In the browser
 * it defaults to the real thing; in a test it is a stand-in that records what was drawn, so
 * the assertions can be about behaviour — how many rectangles, and where — instead of about
 * whether a function returned truthy.
 *
 * Null when there is no document, which is what the old `typeof document === "undefined"`
 * guards were doing in each function separately.
 */
function domSurface() {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  return {
    canvas: () => document.createElement("canvas"),
    image: () => new Image(),
  };
}


/**
 * The base64 out of a data URL, or null.
 *
 * proxy/roles.py builds `data:image/jpeg;base64,{image_b64}` itself, so sending the whole
 * data URL would produce `data:image/jpeg;base64,data:image/jpeg;base64,…` and the model
 * would be handed something that is not a picture.
 */
/**
 * A photograph, as the single still it is.
 *
 * "Record" means filming or photographing what is in front of you, and a possum on a fence
 * at midnight is at least as often photographed as filmed. It also matters for a duller
 * reason: Android Chrome picks its camera intent from `accept`, and a video-only one asks
 * for ACTION_VIDEO_CAPTURE, which plenty of stock camera apps do not handle — they open and
 * bounce straight back out. Reported from a phone on 2026-09-17.
 *
 * label is null rather than "0:00". There is no timeline in a photograph, and stamping a
 * timestamp on one would be the same small lie this flow has had enough of.
 */
function stillFromImage(file) {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      resolve([]);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
    img.onerror = () => done([]);
    img.onload = () => {
      try {
        const size = drawSize(img.naturalWidth, img.naturalHeight);
        if (!size) {
          done([]);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          done([]);
          return;
        }
        // Through a canvas, like every other frame here, which is also what strips the EXIF
        // and the GPS a phone photograph carries — the CLAUDE.md line, met by construction
        // rather than by a step somebody has to remember.
        ctx.drawImage(img, 0, 0, size.width, size.height);
        done([{ t: 0, label: null, w: size.width, h: size.height,
                src: canvas.toDataURL("image/jpeg", JPEG_QUALITY) }]);
      } catch {
        done([]);
      }
    };
    img.src = url;
  });
}

/**
 * A long list of stills, thinned down to `count` of them, spread across the list.
 *
 * The in-page camera samples the preview while somebody is filming, so it ends up with far
 * more frames than the picker wants. Which ones to drop is the same question pickTimes
 * answers for a file — take the midpoint of each slice — and the answer is the same for the
 * same reason: the first frame of a recording is a hand and the last one is the hand coming
 * back, and a midpoint never lands on either.
 *
 * Shorter than `count` comes back whole. Indices are kept distinct, because the frame picker
 * keys its filmstrip on each still's `t` and two of the same still would collide.
 */
export function thin(list, count) {
  const all = Array.isArray(list) ? list : [];
  if (!Number.isInteger(count) || count < 1) return [];
  if (all.length <= count) return all.slice();
  const out = [];
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    let at = Math.floor(((i + 0.5) / count) * all.length);
    while (seen.has(at) && at < all.length - 1) at += 1;
    if (seen.has(at)) continue;
    seen.add(at);
    out.push(all[at]);
  }
  return out;
}

/**
 * A photograph taken off a live camera preview, or null.
 *
 * The other two paths here start from a file the operating system handed over. This one
 * starts from a <video> element already showing the camera, so there is no file, no decode
 * and no camera app in between — which is the entire point of it. The still it returns is
 * the same shape as the other two, label included, so nothing downstream can tell where the
 * picture came from.
 *
 * Synchronous: the frame is already decoded and on screen. Null if the preview has not
 * reported its dimensions yet, which is what videoWidth being 0 means.
 */
export function grabStill(video, surface = domSurface()) {
  if (!video || !surface) return null;
  const size = drawSize(video.videoWidth, video.videoHeight);
  if (!size) return null;
  const canvas = surface.canvas();
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    // Through a canvas like everything else, which is what strips EXIF and GPS. A frame off
    // a live MediaStream carries neither to begin with — there is no file for a phone to
    // have written them into — so here it is the shape and the quality that are the point.
    ctx.drawImage(video, 0, 0, size.width, size.height);
    return { t: 0, label: null, w: size.width, h: size.height,
             src: canvas.toDataURL("image/jpeg", JPEG_QUALITY) };
  } catch {
    return null;
  }
}

/**
 * Stills out of whatever was taken or picked — a clip or a photograph.
 *
 * Empty on anything going wrong, from either path, and the caller falls back to the
 * placeholder photographs exactly as before.
 */
export function stillsFrom(file, count = 8, knownSeconds = 0) {
  if (!file) return Promise.resolve([]);
  return String(file.type || "").startsWith("image/")
    ? stillFromImage(file)
    : extractStills(file, count, knownSeconds);
}

/**
 * The still with the drawn boxes painted over it, or null.
 *
 * The masking screen measured coverage, opened its gate, and then the untouched still was
 * what got sent — draft.boxes was read by nothing at all. The screen said "Covered" and
 * meant nothing by it, against a CLAUDE.md line that is not negotiable.
 *
 * **Null on every failure, and null is not a fallback to the original.** A frame that could
 * not be redacted is not sent. Sending the unmasked one because the canvas threw is the
 * exact outcome the gate exists to prevent; no picture beats the wrong picture here.
 *
 * Painted opaque, not blurred: a blur can be undone well enough to matter, and the subject
 * is a neighbour's face or a number plate on somebody's street.
 */
export function redact(src, boxes, maxWidth = 0, surface = domSurface()) {
  return new Promise((resolve) => {
    const drawn = Array.isArray(boxes) ? boxes : [];
    if (!src || !drawn.length || !surface) {
      resolve(null);
      return;
    }
    const img = surface.image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        // maxWidth 0 keeps the frame's own size, which is what the model is sent. The copy
        // kept on the entry is drawn smaller: every sighting on a timeline carries one, and
        // a storyboard opened on a phone at the fence pays for all of them at once.
        //
        // The boxes are percentages, so they are converted against the size actually being
        // drawn. Converting against the original and then scaling would move them.
        const scaled = maxWidth ? drawSize(img.naturalWidth, img.naturalHeight, maxWidth) : null;
        const width = scaled ? scaled.width : img.naturalWidth;
        const height = scaled ? scaled.height : img.naturalHeight;
        const rects = drawn.map((b) => boxPixels(b, width, height)).filter(Boolean);
        // Boxes that all fell outside the frame cover nothing. Sending the original because
        // the arithmetic came back empty would be the same bug wearing a different hat.
        if (!rects.length) {
          resolve(null);
          return;
        }
        const canvas = surface.canvas();
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        ctx.fillStyle = "#000";
        for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      } catch {
        resolve(null);
      }
    };
    img.src = src;
  });
}

/**
 * The same frame at a smaller width, with nothing painted over it. Null on failure.
 *
 * Module-private on purpose. Nothing outside this file should be able to ask for "the frame,
 * unmasked" — the only caller is maskedFrame below, which reaches it in exactly one case.
 */
function redraw(src, maxWidth = 0, surface = domSurface()) {
  return new Promise((resolve) => {
    if (!src || !surface) {
      resolve(null);
      return;
    }
    const img = surface.image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const scaled = maxWidth ? drawSize(img.naturalWidth, img.naturalHeight, maxWidth) : null;
        const width = scaled ? scaled.width : img.naturalWidth;
        const height = scaled ? scaled.height : img.naturalHeight;
        const canvas = surface.canvas();
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      } catch {
        resolve(null);
      }
    };
    img.src = src;
  });
}

/**
 * The frame that is safe to use, given what the author said about this picture.
 *
 *   boxes drawn  → burn them in. redact() answers null on any failure, and null is never a
 *                  fallback to the original.
 *   no boxes     → there is nothing to burn in, so the frame already is the masked frame.
 *
 * That second branch is the whole reason this exists. redact() reads an empty box list as a
 * failure and answers null, which is the right answer to the question *it* asks — but the
 * masking screen used it for both jobs, so the ordinary case (a possum on a fence, no face
 * and no number plate in shot, author ticks "nothing here identifies a person or a house")
 * silently lost their own photograph and the entry carried a stock picture of somebody else's
 * possum. Which is the exact thing that keeping the author's frame was added to stop.
 * Found by an adversarial review on 2026-09-17 and reproduced in a browser: zero canvas
 * exports down that path, against two when a box is drawn.
 *
 * An empty list is only reachable here because the masking screen's gate gives it a meaning:
 * you cannot leave that screen without either drawing a box or ticking to say there is
 * nothing to cover. Empty means affirmed, not unanswered. If that gate ever goes, this
 * branch has to go with it.
 */
export function maskedFrame(src, boxes, maxWidth = 0, surface = domSurface()) {
  const drawn = Array.isArray(boxes) ? boxes : [];
  return drawn.length ? redact(src, drawn, maxWidth, surface) : redraw(src, maxWidth, surface);
}

export function base64Of(src) {
  const at = String(src || "").indexOf(";base64,");
  if (at < 0) return null;
  const body = src.slice(at + ";base64,".length);
  return body || null;
}
