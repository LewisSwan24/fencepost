"use client";

// 2 · Capture
//
// Both buttons used to call next(). The screen said "Record" and "Choose from library" and
// did neither, and the frame screen then offered photographs of somebody else's possum —
// so the clip at the centre of the whole product was the one thing in it that was never
// real.
//
// A file input with capture="environment" is what a phone needs to open the camera straight
// into a recording; the same input without it is the library. On a laptop the attribute is
// ignored and both are a file picker, which is honest rather than broken.
//
// Nothing is uploaded here. The clip is decoded in the page (lib/stills.js) and the frames
// live in the draft until the tab closes. Drawing through a canvas also strips EXIF and GPS
// on the way past, which is the safety line in CLAUDE.md, met by construction rather than
// by a step somebody has to remember.

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COPY } from "../../../../lib/copy";
import { BackButton, Steps, ui } from "../../../../components/ui";
import Camera, { cameraSupported } from "../../../../components/Camera";
import { stillsFrom } from "../../../../lib/stills";
import { useDraft } from "./DraftContext";
import styles from "./add.module.css";

export default function Capture({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const recorder = useRef(null);
  const library = useRef(null);
  const [reading, setReading] = useState(false);
  const [camera, setCamera] = useState(false);

  // A photograph has no frame to pick, so that screen is skipped rather than shown with one
  // cell and a scrubber that cannot move. The placeholder path keeps the picker: it has ten
  // stand-in photographs to choose between.
  //
  // The default matters. This took a list argument while the skip button below still called
  // it with nothing, and `stills.length` on undefined threw — so the one way off this screen
  // for somebody holding a phone with no clip on it crashed the page. Shipped 2026-09-17 and
  // caught the same hour. A parameter that is only ever right when every caller remembers to
  // pass it is a parameter that wants a default.
  const next = (stills = []) => {
    const photo = stills.length === 1 && !stills[0].label;
    router.push(`/b/${id}/add/${photo ? "mask" : "frame"}`);
  };

  async function chosen(event) {
    const file = event.target.files?.[0];
    // Clear it straight away, so choosing the same file twice in a row still fires change —
    // and so a cancelled second attempt does not re-use the first clip.
    event.target.value = "";
    if (!file) return;

    setReading(true);
    // stillsFrom resolves to [] rather than throwing, on a codec the browser will not decode
    // or a seek that never lands. An empty list means the frame screen falls back to the
    // placeholders, so a phone with an opinion about H.265 costs a picture, not a flow.
    const stills = await stillsFrom(file);
    draft.setStills(stills);
    setReading(false);
    next(stills);
  }

  // The viewfinder hands back finished stills rather than a file — it drew them off the live
  // preview, so there is nothing to decode and no reading state to show.
  function fromCamera(stills) {
    setCamera(false);
    draft.setStills(stills);
    next(stills);
  }

  // Record opens the camera in the page. The file input behind it is not dead code: it is
  // what happens on a browser with no getUserMedia, on http where the API does not exist at
  // all, and when somebody has told the browser to refuse this site the camera.
  function record() {
    if (cameraSupported()) setCamera(true);
    else recorder.current?.click();
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}`)} />
      </div>
      <Steps at={0} />

      <div className={ui.body}>
        <h1 className={ui.h1} style={{ fontSize: 28 }}>Add a sighting</h1>
        <p className={ui.lede}>{COPY.captureLede}</p>

        {/* Record opens the viewfinder in components/Camera.js and only reaches the first
            input when there is no getUserMedia to open it with. Why the handoff stopped being
            the main path is written up there; the two accept values here are the part that
            matters at this line.

            image/* alone, with capture. Chromium hands over to the camera only when the
            accept list resolves to a single media supertype — acceptsOnlyType() is a count
            equality, so "image/*,video/*" matches neither branch and the capture attribute is
            silently discarded. What happens next is worse than the old chooser: every
            remaining type is a media type, so Chrome routes to the Android system photo
            picker, which on Android 13 and up has no camera tile at all. A single image type
            gives MediaStore.ACTION_IMAGE_CAPTURE, which is also the only branch Chromium sets
            EXTRA_OUTPUT on — the video branch does not, and a camera app that returns without
            data there is read as if it were the photo branch.

            So the fallback takes photographs and not clips. That is the most a file input can
            honestly offer on Android, and somebody who needs a clip has Choose from library
            below, which wants exactly the picker this one is avoiding. */}
        <input ref={recorder} type="file" accept="image/*" capture="environment"
               hidden onChange={chosen} />
        <input ref={library} type="file" accept="image/*,video/*" hidden onChange={chosen} />

        <button type="button" className={styles.bigPrimary} disabled={reading}
                onClick={record}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 10l5-3v10l-5-3z" /><rect x="2" y="6" width="13" height="12" rx="3" />
          </svg>
          Record
        </button>
        <button type="button" className={styles.bigQuiet} disabled={reading}
                onClick={() => library.current?.click()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M3 15l4.5-4.5 5 5M14 13l2.5-2.5L21 15" />
          </svg>
          Choose from library
        </button>

        {reading ? <p className={styles.reading} role="status">{COPY.captureReading}</p> : null}

        <p className={styles.footnote}>{COPY.noCameras}</p>

        {/* A cancelled file picker fires no event, so without this there is no way off this
            screen for somebody who has no clip on the device they are holding. */}
        <button type="button" className={styles.skip} disabled={reading}
                onClick={() => { draft.setStills([]); next(); }}>
          {COPY.captureSkip}
        </button>
      </div>

      {/* Mounted only while it is open, so the camera is started by mounting and stopped by
          unmounting. Keeping it mounted and hidden would hold the phone's camera — and its
          indicator light — for the rest of the flow. */}
      {camera ? (
        <Camera onPhoto={fromCamera} onClip={fromCamera}
                onClose={() => setCamera(false)}
                onFallback={() => { setCamera(false); recorder.current?.click(); }}
                onLibrary={() => { setCamera(false); library.current?.click(); }} />
      ) : null}
    </div>
  );
}
