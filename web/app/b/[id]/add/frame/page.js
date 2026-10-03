"use client";

// 3 · Pick a frame

import { use, useRef } from "react";
import { useRouter } from "next/navigation";
import { CLIP } from "../../../../../lib/fixtures";
import { COPY } from "../../../../../lib/copy";
import { FRAMES } from "../../../../../lib/frames";
import { BackButton, Steps, ui } from "../../../../../components/ui";
import Shot from "../../../../../components/Shot";
import { useDraft } from "../DraftContext";
import styles from "../add.module.css";

// This screen used to be four brown blocks, then ten placeholder photographs, and now it is
// the clip itself when there is one. The placeholders did not go away: a browser that will
// not decode what the phone recorded still lands here, and an empty stills list is a
// perfectly ordinary outcome rather than an error to report.
//
// So both paths stay, and the line underneath says which one you are looking at. What
// changed is which one is the default.
//
// The mapping below is proportional rather than `floor(index / 2)`, which is what it was
// when there were four images and eight positions. That was arithmetic pinned to two counts
// with no reason to stay in step: at ten images it would have reached frames 0 to 3 and no
// others, quietly turning this screen ringtail-only with nothing on screen to notice.
function placeholderFor(index) {
  const positions = Math.max(1, CLIP.frames.length);
  return FRAMES[Math.min(FRAMES.length - 1, Math.floor((index * FRAMES.length) / positions))];
}

export default function PickFrame({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const track = useRef(null);
  const dragging = useRef(false);

  // One list of positions either way, so everything below — the scrubber, the strip, the
  // timestamps — is written once and does not know which it is showing.
  const real = draft.stills;
  const live = real.length > 0;
  const frames = live ? real : CLIP.frames;
  // A clip that yielded fewer stills than the fixture has positions would otherwise leave a
  // stale index pointing past the end. DraftContext clamps on the way in; this covers
  // arriving here by the back button with the list already changed underneath.
  const index = Math.min(Math.max(0, draft.frameIndex), frames.length - 1);
  const span = Math.max(1, frames.length - 1);
  // A photograph arrives as a single still with no label, because it has no timeline. It
  // skips this screen on the way in; coming back from the masking screen is the one way to
  // see it here, and a scrubber that cannot move would be furniture.
  const photo = live && frames.length === 1 && !frames[0].label;

  // A real still is the user's own footage and is shown as it came out of the camera. The
  // placeholders are graded, because they are daytime stock standing in for a night clip
  // and ungraded they look nothing like the thing they represent.
  // A real still carries its own shape and the picker has to honour it. At a fixed 206px a
  // 360x640 phone clip showed 35% of itself — cropped from the middle, so the top and bottom
  // of the frame were simply absent while somebody decided which frame to use. The masking
  // screen then displayed the whole thing, including whatever had been hidden here. Choosing
  // a frame you cannot see all of, and only then being asked what in it needs covering, is
  // the wrong way round. Measured on 2026-09-16 by walking the flow on the deployment.
  //
  // The placeholders keep the fixed height: they are landscape stock photographs, and the
  // shape they would impose is nobody's footage.
  function shotFor(i) {
    if (live) {
      const still = real[i];
      return { src: still.src, graded: false,
               alt: still.label ? "A frame from your clip" : "Your photograph",
               aspect: still.w && still.h ? still.w / still.h : null };
    }
    const frame = placeholderFor(i);
    return { src: frame.file, alt: frame.alt, graded: !frame.night, aspect: null };
  }

  const at = (e) => {
    const box = track.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    return Math.round(frac * span);
  };

  // Choosing a frame clears the boxes drawn on the old one, so landing on the frame already
  // chosen (a tap on it, Left on the first, End on the last) must not choose at all, or
  // coming back from masking would wipe the covering-up for the same frame.
  const choose = (next) => {
    if (next !== index) draft.setFrameIndex(next);
  };

  // The same control from a keyboard, as the ARIA slider pattern has it: Right and Up step
  // forward, Left and Down back, Home and End to the ends. It was pointer-only until #43, so
  // anybody without a pointer posted whichever frame the screen happened to open on.
  const step = (e) => {
    const to = { ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1,
                 ArrowDown: index - 1, Home: 0, End: frames.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    choose(Math.min(Math.max(0, to), frames.length - 1));
  };

  const chosen = shotFor(index);

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add`)} />
      </div>
      <Steps at={1} />

      <div className={ui.body}>
        <h1 className={ui.h1}>Pick a frame</h1>
        <p className={ui.lede} style={{ marginBottom: 18 }}>{COPY.frameLede}</p>

        <Shot src={chosen.src} alt={chosen.alt} graded={chosen.graded}
              height={206} aspect={chosen.aspect} maxHeight="38vh">
          {frames[index].label ? (
            <span className={styles.stampChip}>{frames[index].label}</span>
          ) : null}
        </Shot>
        <p className={styles.footnote}>
          {photo ? COPY.framePhoto : live ? COPY.frameNoteLive : COPY.frameNote}
        </p>

        <div style={{ marginTop: 20, display: photo ? "none" : undefined }}
             role="slider" tabIndex={photo ? -1 : 0} aria-label={COPY.frameScrubber}
             aria-valuemin={0} aria-valuemax={frames.length - 1} aria-valuenow={index}
             aria-valuetext={frames[index].label || `Frame ${index + 1} of ${frames.length}`}
             onKeyDown={step}
             onPointerDown={(e) => {
               try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
               dragging.current = true;
               choose(at(e));
             }}
             onPointerMove={(e) => dragging.current && choose(at(e))}
             onPointerUp={() => { dragging.current = false; }}
             onPointerCancel={() => { dragging.current = false; }}>
          <div ref={track} className={styles.track}>
            <div className={styles.strip}>
              {frames.map((f, i) => (
                <span key={f.t} className={styles.cell}
                      style={{ backgroundImage: `url(${shotFor(i).src})`,
                               backgroundSize: "cover", backgroundPosition: "center",
                               opacity: i === index ? 1 : 0.45 }} />
              ))}
            </div>
            <div className={styles.scrub}
                 style={{ left: `calc(${(index / span) * 100}% - 9px)` }}>
              <span className={styles.knob} />
              <span className={styles.stem} />
            </div>
          </div>
          <div className={styles.times}>
            <span>0:00</span>
            <span>{frames[frames.length - 1].label}</span>
          </div>
        </div>
      </div>

      <div className={ui.footer}>
        <button type="button" className={ui.btn}
                onClick={() => router.push(`/b/${id}/add/mask`)}>Next</button>
      </div>
    </div>
  );
}
