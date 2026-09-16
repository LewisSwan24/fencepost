// Stills out of the clip the person actually filmed.
//
// Until now the first screen was two buttons that both went to the next screen, and the
// frame picker offered photographs of somebody else's possum. This is the part that makes
// the clip real: chosen on the phone, decoded in the page, never sent anywhere.
//
// Nothing here uploads. There is no storage behind this product, and CLAUDE.md leaves
// "whether frames are kept" explicitly undecided with "frames are not retained" as the
// safety line beside it. So the stills live in memory for the length of the posting flow and
// go when the tab does. That is a smaller product than one with a media library, and it is
// the one the decisions taken so far actually describe.
//
// Drawing through a canvas settles the other safety line for free: a re-encoded bitmap
// carries no EXIF and no GPS, because none of that survives the pixels.

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
export function pickTimes(duration, count) {
  const length = usableDuration(duration);
  if (!length || !Number.isInteger(count) || count < 1) return [];
  const times = [];
  for (let i = 0; i < count; i += 1) {
    const at = ((i + 0.5) / count) * length;
    // Seeking to exactly the last frame lands past the end on some decoders and never fires
    // `seeked`, which would hang the extraction on the final still.
    times.push(Math.min(at, Math.max(0, length - 0.05)));
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
export function extractStills(file, count = 8) {
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
        const times = pickTimes(video.duration, count);
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
          out.push({ t, label: clockLabel(t), src: canvas.toDataURL("image/jpeg", JPEG_QUALITY) });
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
 * The base64 out of a data URL, or null.
 *
 * proxy/roles.py builds `data:image/jpeg;base64,{image_b64}` itself, so sending the whole
 * data URL would produce `data:image/jpeg;base64,data:image/jpeg;base64,…` and the model
 * would be handed something that is not a picture.
 */
export function base64Of(src) {
  const at = String(src || "").indexOf(";base64,");
  if (at < 0) return null;
  const body = src.slice(at + ";base64,".length);
  return body || null;
}
