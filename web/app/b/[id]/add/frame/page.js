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

// This screen used to be four brown blocks. Once real material went in, it was the last
// empty one in the whole app — and it is precisely the screen where the picture is the
// subject.
//
// The four images from lib/frames.js fill it, two scrub positions to each, so dragging
// visibly changes something. They are **placeholders**, and the line underneath says so
// outright — the same approach as the QR placeholder on the share screen.
//
// **The chosen frame is not carried anywhere, and that is the truth rather than an
// omission.** frameIndex is read only on this screen: it is not sent on submit, and the
// server has nowhere to put a frame (`videos` records only a storage_key, and whether
// frames are persisted is still open in CLAUDE.md; persisting them would need a frames
// table and a TTL job). So the copy changed too, and no longer says "this is the still
// people see" — that was false.
function stillFor(index) {
  return FRAMES[Math.floor(index / 2) % FRAMES.length];
}

export default function PickFrame({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const track = useRef(null);
  const dragging = useRef(false);

  const frames = CLIP.frames;
  const at = (e) => {
    const box = track.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    return Math.round(frac * (frames.length - 1));
  };

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add`)} />
      </div>
      <Steps at={1} />

      <div className={ui.body}>
        <h1 className={ui.h1}>Pick a frame</h1>
        <p className={ui.lede} style={{ marginBottom: 18 }}>{COPY.frameLede}</p>

        <Shot src={stillFor(draft.frameIndex).file}
              alt={stillFor(draft.frameIndex).alt}
              graded={!stillFor(draft.frameIndex).night}
              height={206}>
          <span className={styles.stampChip}>{frames[draft.frameIndex].label}</span>
        </Shot>
        <p className={styles.footnote}>{COPY.frameNote}</p>

        <div style={{ marginTop: 20 }}
             onPointerDown={(e) => {
               try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
               dragging.current = true;
               draft.setFrameIndex(at(e));
             }}
             onPointerMove={(e) => dragging.current && draft.setFrameIndex(at(e))}
             onPointerUp={() => { dragging.current = false; }}
             onPointerCancel={() => { dragging.current = false; }}>
          <div ref={track} className={styles.track}>
            <div className={styles.strip}>
              {frames.map((f, i) => (
                <span key={f.t} className={styles.cell}
                      style={{ backgroundImage: `url(${stillFor(i).file})`,
                               backgroundSize: "cover", backgroundPosition: "center",
                               opacity: i === draft.frameIndex ? 1 : 0.45 }} />
              ))}
            </div>
            <div className={styles.scrub}
                 style={{ left: `calc(${(draft.frameIndex / (frames.length - 1)) * 100}% - 9px)` }}>
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
