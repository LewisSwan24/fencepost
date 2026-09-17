"use client";

// The viewfinder — a camera inside the page.
//
// Record used to hand off to the phone's camera app through an <input capture>. That broke
// twice, in two different ways, and both failures come from the same place: an input element
// gets to name exactly one capture intent.
//
//   accept="video/*" capture      asks Android for ACTION_VIDEO_CAPTURE. The stock camera app
//                                 on the phone this was reported from opened and bounced
//                                 straight back out with no file. 2026-09-17. Chromium builds
//                                 that intent with no EXTRA_OUTPUT — the image one gets a
//                                 content URI, the video one does not — and then reads a
//                                 RESULT_OK carrying no data as if it had been the image
//                                 branch all along.
//   accept="image/*,video/*"      names two, and Chromium's acceptsOnlyType() is a count
//                    capture      equality, so neither the image nor the video branch matches
//                                 and `capture` is discarded without a word. What is left is
//                                 all media types, which routes to the Android system photo
//                                 picker — and on Android 13 and up that has no camera tile
//                                 at all. The crash became a button that opens the gallery.
//
// So the second attempt was worse than the first: not a camera that crashes, a camera that
// never appears. There is no third setting — Chromium says as much in its own source. The
// sentence "photograph or film, whichever this moment needs" is not something a file input
// can be asked, so Record stops asking and does it here: getUserMedia, a live preview, and a
// shutter that takes a photograph or runs a recording depending on one toggle. No camera app,
// no intent, nothing to bounce off.
//
// What this does NOT do is record video, and that is deliberate rather than a shortcut.
// Fencepost has no object storage: a sighting has never had watchable footage, and the only
// reason the clip path exists at all is to reach a few frames. So filming here samples the
// preview as it goes and keeps the frames directly. That removes the entire class of problem
// the recorded-file route carries — codec negotiation, a WebM whose header says its duration
// is Infinity because MediaRecorder wrote it before the recording ended, a blob the same
// browser then declines to seek. None of it can happen to frames that were never encoded.
//
// The frames go through a canvas like every other path here, which is also what guarantees
// the EXIF and GPS line in CLAUDE.md — though a frame off a live MediaStream never had
// either, because no file was ever written for a phone to put them in.

import { useCallback, useEffect, useRef, useState } from "react";
import { COPY } from "../lib/copy";
import { NOTICES, cameraSupported, reasonFor } from "../lib/camera";
import { clockLabel, grabStill, thin } from "../lib/stills";
import styles from "./Camera.module.css";

// Re-exported so the capture screen can ask "is there a camera worth opening?" without
// importing the pure module separately. The logic lives in lib/camera.js because that is
// the only place npm test can reach it.
export { cameraSupported };

// How many frames the picker wants at the end. The same eight as the file path.
const FRAMES = 8;

// Half a second between samples. Fast enough that a possum turning its head lands in at
// least one of them, slow enough that drawing and encoding never competes with the preview.
const SAMPLE_MS = 500;

// Twenty seconds, then it stops itself. Two reasons, and the second is the real one: a
// sighting does not need longer, and every sample is a full-size JPEG held in memory until
// the thinning at the end — forty of them is already several megabytes on a phone.
const MAX_SECONDS = 20;


export default function Camera({ onPhoto, onClip, onClose, onFallback, onLibrary }) {
  const video = useRef(null);
  const stream = useRef(null);
  const samples = useRef([]);
  const ticker = useRef(null);
  const startedAt = useRef(0);

  // True for as long as a recording is running. The stream effect below needs to know this
  // from inside a closure that React will not re-create, so it cannot read the state.
  const filming = useRef(false);

  const [state, setState] = useState("starting");   // starting | ready | recording | blocked
  const [reason, setReason] = useState("other");    // why, when blocked
  const [mode, setMode] = useState("photo");
  const [elapsed, setElapsed] = useState(0);
  const [facing, setFacing] = useState("environment");   // environment = the rear lens
  const [swapping, setSwapping] = useState(false);
  // Whether the element has actually reported a frame size.
  //
  // Ready is not the same as ready to shoot. play() can reject — the comment above the call
  // says so, and recovering later is the normal case — but setState("ready") runs regardless,
  // so the shutter lit up while the element still had no dimensions. A press then reached
  // grabStill() with videoWidth 0, got null back, closed the camera and dropped somebody on
  // the stock-photograph picker with no explanation. loadedmetadata is the event that says
  // there is a frame to take, and it fires on every new stream, so a flip re-arms it too.
  const [framed, setFramed] = useState(false);
  const [cameras, setCameras] = useState(null);     // how many lenses, null until asked

  // Letting go of the lens, and nothing else.
  //
  // Separate from release() because swapping between the front and rear cameras is exactly
  // this and only this: the old stream has to stop before the new one is asked for, while the
  // recording clock, the interval and — the part that matters — every frame sampled so far
  // carry straight on. Folding the two together would mean flipping the camera halfway
  // through filming silently threw away everything filmed up to that point.
  const stopStream = useCallback(() => {
    const live = stream.current;
    stream.current = null;
    if (live) {
      try { live.getTracks().forEach((track) => track.stop()); } catch { /* already gone */ }
    }
    // Stopping the tracks is what actually releases the lens and puts the phone's camera
    // indicator out. Clearing srcObject as well is the canonical teardown: without it the
    // stopped MediaStream stays reachable from the element for as long as the element lives.
    if (video.current) {
      try { video.current.srcObject = null; } catch { /* the element is already gone */ }
    }
  }, []);

  // Everything that has to happen whether this closes by the X, by Escape, by a shot being
  // taken, or by the route changing underneath it. Leaving a track running leaves the phone's
  // camera indicator lit while somebody is masking and writing, which reads — correctly — as
  // the app still watching them.
  const release = useCallback(() => {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    filming.current = false;
    samples.current = [];
    stopStream();
  }, [stopStream]);

  useEffect(() => {
    let dead = false;

    (async () => {
      try {
        // facingMode as a preference rather than { exact: facing }. Exact is a constraint the
        // browser must satisfy or fail, and a laptop with one front-facing webcam fails it —
        // which would make this screen unusable on every machine this prototype is
        // demonstrated from, and would turn the flip button into a way to break the camera.
        // A plain value is read as `ideal`, so it never rejects: a device with one lens just
        // hands the same one back.
        const got = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } },
          // No microphone. Nothing here keeps audio, and asking for a permission in order to
          // throw the result away is not a thing to do to somebody.
          audio: false,
        });
        if (dead) {
          got.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = got;
        if (video.current) {
          video.current.srcObject = got;
          // muted + playsInline are what let this play without a gesture and without going
          // fullscreen on iOS. play() still rejects sometimes; the preview recovers on its
          // own once the element has its metadata, so a rejection is not worth a screen.
          try { await video.current.play(); } catch { /* the element catches up by itself */ }
        }
        // A swap that lands mid-recording must not knock the screen back to "ready" — the
        // shutter would turn from a stop button into a start button underneath a finger.
        setState((was) => (was === "recording" ? was : "ready"));
        setSwapping(false);

        // Whether there is a second lens to offer at all. Only worth asking once the stream
        // exists, because before permission the list is unlabelled and on some browsers
        // empty. A device with one camera gets no flip button rather than a button that
        // appears to do nothing — facingMode is a preference, so flipping a single-lens
        // device silently hands the same lens back.
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!dead) setCameras(devices.filter((d) => d.kind === "videoinput").length);
        } catch { /* leave it unknown, and keep offering the flip */ }
      } catch (error) {
        // One screen, four sentences. See reasonFor: what the person should do about this is
        // different in each case, and only the browser knows which case it is.
        //
        // If getUserMedia ever starts failing here with NotAllowedError on a phone that has
        // plainly granted permission, look at response headers before looking at this file: a
        // Permissions-Policy without `camera=(self)` blocks it on the top-level page and also
        // makes enumerateDevices report no camera, so it presents as a phone with no lens.
        if (dead) return;
        setSwapping(false);
        // A flip that fails while filming must not cost somebody the frames they already
        // have. Hand back what was sampled and let the flow carry on; the alternative is an
        // error screen holding a recording hostage over a lens that was working a second ago.
        if (filming.current && samples.current.length) {
          stopVideo();
          return;
        }
        // A recording with nothing in it yet still has to be torn down. Left running, the
        // 500ms sampler keeps ticking behind the error notice, and up to twenty seconds later
        // the cap fires stopVideo() and routes somebody off the screen they were reading —
        // with no input from them and nothing to show for it. release() clears the interval
        // and the filming flag; the stream is already gone.
        if (filming.current) release();
        setReason(reasonFor(error));
        setState("blocked");
      }
    })();

    // Keyed on `facing`, so flipping the camera is just this effect running again. The
    // cleanup lets go of the lens and nothing else — the interval, the clock and the frames
    // already sampled belong to the recording, not to the stream that happened to produce
    // them, and a flip halfway through filming must not cost somebody what they already
    // filmed.
    return () => {
      dead = true;
      stopStream();
    };
  }, [facing, stopStream]);

  // The full teardown, on the way out only. Separate from the stream effect above because
  // that one now runs on every flip, and this must not.
  useEffect(() => release, [release]);

  // Escape closes, like the Sheet everywhere else in this flow. This is a fixed overlay
  // rather than a Sheet — a camera should not be dismissable by a drag that ends off the
  // edge of a panel — so the key handling is its own.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      release();
      onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [release, onClose]);

  function shut() {
    release();
    onClose?.();
  }

  function takePhoto() {
    const still = grabStill(video.current);
    release();
    // A shutter that produced nothing closes anyway rather than sitting there looking
    // broken; the capture screen falls back to the placeholder stills, which is the same
    // answer it gives for a clip the browser would not decode.
    onPhoto?.(still ? [still] : []);
  }

  function sample() {
    const still = grabStill(video.current);
    if (!still) return;
    const t = (Date.now() - startedAt.current) / 1000;
    // t and label are re-stamped from the stopwatch: the frame picker keys its filmstrip on
    // t, and these have to be the real offsets into the recording rather than the 0 that
    // grabStill hands back for a single photograph.
    samples.current.push({ ...still, t, label: clockLabel(t) });
  }

  // Flipping is a change of one piece of state; the stream effect does the rest. Allowed
  // while filming as well as before it, because a camera you cannot turn round mid-shot is
  // not a camera — the frames sampled before the swap and after it sit in one list, in order,
  // and the picker cannot tell which lens produced which.
  function flip() {
    if (swapping) return;
    setSwapping(true);
    setFramed(false);
    setFacing((was) => (was === "environment" ? "user" : "environment"));
  }

  function startVideo() {
    samples.current = [];
    startedAt.current = Date.now();
    filming.current = true;
    setElapsed(0);
    setState("recording");
    // One straight away, so that a press and release faster than the interval still produces
    // a frame rather than nothing at all.
    sample();
    ticker.current = setInterval(() => {
      const seconds = (Date.now() - startedAt.current) / 1000;
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS) {
        stopVideo();
        return;
      }
      sample();
    }, SAMPLE_MS);
  }

  function stopVideo() {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    filming.current = false;
    // thin() copies references out before release() empties the list, so the frames survive
    // the teardown that follows.
    const taken = thin(samples.current, FRAMES);
    release();
    onClip?.(taken);
  }

  const recording = state === "recording";
  // Mid-swap the preview is briefly black, so the shutter is held shut — except while
  // filming, where the same button is the only way to stop, and refusing a stop press because
  // a lens is still opening is how a recording runs on past the moment somebody wanted it to
  // end.
  const busy = state === "starting" || state === "blocked"
    || (swapping && !recording) || (!framed && !recording);
  // A device known to have one lens gets no flip button rather than one that appears to do
  // nothing. Unknown — enumerateDevices refused, or has not answered yet — still offers it,
  // because the phones this is for all have two.
  const canFlip = state !== "starting" && state !== "blocked" && cameras !== 1;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Camera">
      <div className={styles.stage}>
        {/* Rendered even while starting, so the stream has an element to attach to the
            moment it arrives rather than waiting for another render. */}
        <video ref={video} className={styles.preview} playsInline muted autoPlay
               onLoadedMetadata={() => setFramed(true)} />

        {state === "starting" ? (
          <div className={styles.notice}>
            <p className={styles.noticeBody}>{COPY.cameraStarting}</p>
          </div>
        ) : null}

        {state === "blocked" ? (
          <div className={styles.notice}>
            <p className={styles.noticeTitle}>{COPY[NOTICES[reason].title]}</p>
            <p className={styles.noticeBody}>{COPY[NOTICES[reason].body]}</p>
            {/* A device with no camera is not helped by being sent to its camera app, so that
                one case offers the library instead. Offering the wrong exit is worse than
                offering none — it reads as the app not having understood the answer. */}
            {NOTICES[reason].exit === "library" ? (
              <button type="button" className={styles.noticeAction}
                      onClick={() => { release(); onLibrary?.(); }}>
                {COPY.cameraUseLibrary}
              </button>
            ) : (
              <button type="button" className={styles.noticeAction}
                      onClick={() => { release(); onFallback?.(); }}>
                {COPY.cameraFallback}
              </button>
            )}
          </div>
        ) : null}

        <div className={styles.bar}>
          <button type="button" className={styles.close} aria-label={COPY.cameraClose}
                  onClick={shut}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <span className={styles.barRight}>
            {recording ? (
              <span className={styles.badge} role="status">
                <span className={styles.dot} />
                {clockLabel(elapsed)}
              </span>
            ) : null}
            {canFlip ? (
              <button type="button" className={styles.flip} aria-label={COPY.cameraFlip}
                      disabled={swapping} onClick={flip}>
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {/* A lens with two arrows going round it. */}
                  <path d="M3 8a4 4 0 014-4h10M21 16a4 4 0 01-4 4H7" />
                  <path d="M17 1l4 3-4 3M7 17l-4 3 4 3" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              </button>
            ) : null}
          </span>
        </div>
      </div>

      <div className={styles.controls}>
        {/* Hidden while recording rather than disabled: switching mode mid-recording has no
            meaning, and a control that is visible but dead invites a second press. */}
        {recording ? null : (
          <div className={styles.modes} role="group" aria-label="What to capture">
            <button type="button" disabled={busy}
                    className={`${styles.mode} ${mode === "photo" ? styles.modeOn : ""}`}
                    aria-pressed={mode === "photo"} onClick={() => setMode("photo")}>
              {COPY.cameraModePhoto}
            </button>
            <button type="button" disabled={busy}
                    className={`${styles.mode} ${mode === "video" ? styles.modeOn : ""}`}
                    aria-pressed={mode === "video"} onClick={() => setMode("video")}>
              {COPY.cameraModeVideo}
            </button>
          </div>
        )}

        <button type="button" className={styles.shutter} disabled={busy}
                aria-label={recording ? COPY.cameraStopVideo
                          : mode === "video" ? COPY.cameraStartVideo : COPY.cameraTakePhoto}
                onClick={() => {
                  if (recording) stopVideo();
                  else if (mode === "video") startVideo();
                  else takePhoto();
                }}>
          <span className={recording ? styles.coreRecording : styles.core} />
        </button>

        {recording ? null : (
          <p className={styles.hint}>
            {mode === "video" ? COPY.cameraVideoHint : COPY.cameraPhotoHint}
          </p>
        )}
      </div>
    </div>
  );
}
