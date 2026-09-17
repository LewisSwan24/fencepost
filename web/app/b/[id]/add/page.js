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

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}`)} />
      </div>
      <Steps at={0} />

      <div className={ui.body}>
        <h1 className={ui.h1} style={{ fontSize: 28 }}>Add a sighting</h1>
        <p className={ui.lede}>{COPY.captureLede}</p>

        {/* Two inputs rather than one, because the difference between them is the capture
            attribute and that cannot be changed per click on iOS.

            accept takes photographs as well as clips, and that is two things at once. It is
            what Record has always meant — whatever is in front of you, filmed or
            photographed — and a possum on a fence at midnight is at least as often a
            photograph. It is also the fix for a real failure: Android Chrome chooses its
            camera intent from accept, and a video-only one asks for ACTION_VIDEO_CAPTURE,
            which plenty of stock camera apps do not handle. Reported from a phone on
            2026-09-17: the camera opened and bounced straight back out. */}
        <input ref={recorder} type="file" accept="image/*,video/*" capture="environment"
               hidden onChange={chosen} />
        <input ref={library} type="file" accept="image/*,video/*" hidden onChange={chosen} />

        <button type="button" className={styles.bigPrimary} disabled={reading}
                onClick={() => recorder.current?.click()}>
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
    </div>
  );
}
