"use client";

// 3 · Pick a frame

import { use, useRef } from "react";
import { useRouter } from "next/navigation";
import { CLIP } from "../../../../../lib/fixtures";
import { COPY } from "../../../../../lib/copy";
import { BackButton, Steps, ui } from "../../../../../components/ui";
import { useDraft } from "../DraftContext";
import styles from "../add.module.css";

const TONES = ["#1d1812", "#251e16", "#2f251a", "#3a2d1f"];

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

        <div style={{ position: "relative", width: "100%", height: 206,
                      borderRadius: "var(--radius-md)", overflow: "hidden",
                      background: TONES[frames[draft.frameIndex].tone] }}>
          <span className={styles.stampChip}>{frames[draft.frameIndex].label}</span>
        </div>

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
                      style={{ background: TONES[f.tone],
                               opacity: i === draft.frameIndex ? 1 : 0.55 }} />
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
