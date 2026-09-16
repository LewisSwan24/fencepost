"use client";

// 4 · Mask, plus the 5 · Send frame? consent sheet.
//
// Two things are hard requirements:
//   the masking gate really measures coverage rather than letting a single tap through;
//   the two buttons in the sheet carry equal visual weight — they share one class rather
//   than having a style each, so nobody can later make one lighter without the other.

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CLIP } from "../../../../../lib/fixtures";
import { COPY } from "../../../../../lib/copy";
import { identifyFrame } from "../../../../../lib/api";
import { covered, isDeliberate } from "../../../../../lib/mask";
import { base64Of } from "../../../../../lib/stills";
import { BackButton, Sheet, Steps, Spinner, ui } from "../../../../../components/ui";
import { useDraft } from "../DraftContext";
import styles from "../add.module.css";

export default function Mask({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const canvas = useRef(null);
  const drag = useRef(null);
  const [live, setLive] = useState(null);   // the box currently being dragged
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);

  const boxes = draft.boxes;
  const drawn = live ? [...boxes, live] : boxes;
  const targets = CLIP.mask_targets.map((t) => ({ ...t, done: covered(t, drawn) }));
  const blocked = targets.some((t) => !t.done);

  const pos = (e) => {
    const box = canvas.current.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - box.top) / box.height) * 100)),
    };
  };

  // The box being dragged lives in a ref and is committed to state on release.
  // The earlier version read boxes from the render closure inside pointerup — with a real
  // hand the events land in separate tasks with a re-render between them, so it read the
  // new value and looked fine; the moment all three events fall in one task it reads the
  // old array and the box just drawn is treated as never drawn, and dropped. Not depending
  // on render timing removes that coin-flip.
  //
  // The version after that reached the box through a setLive updater and called setBoxes
  // from inside it. Updaters have to be pure, and StrictMode invokes them twice to say so,
  // which meant every drag under `npm run dev` left two identical boxes stacked exactly on
  // top of each other. The remove button then looked broken: the first click took one away
  // and the copy underneath was still there, in the same place. Measured on 2026-09-15 by
  // dispatching one drag, which gave two boxes with StrictMode on and one with it off. The
  // live box is in the ref now, so release reads it without an updater in the way.
  function down(e) {
    // A synthetic pointer event has no active pointerId and capture throws NotFoundError.
    // If it cannot be captured, let it go: dragging still works, it only breaks when a
    // finger leaves the element — better than the whole handler exploding.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const p = pos(e);
    drag.current = { from: p };
    setLive({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function move(e) {
    if (!drag.current) return;
    const p = pos(e);
    const { from } = drag.current;
    const box = {
      x: Math.min(p.x, from.x), y: Math.min(p.y, from.y),
      w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y),
    };
    drag.current.box = box;
    setLive(box);
  }

  function up() {
    if (!drag.current) return;
    const { box } = drag.current;
    drag.current = null;
    if (isDeliberate(box)) draft.setBoxes((prev) => [...prev, box]);
    setLive(null);
  }

  async function sendFrame() {
    setSending(true);
    try {
      // The real endpoint is a neighbour call carrying the frame and this confirmation.
      // Without frame_consent it comes back refused.
      //
      // This used to send null, which made the consent sheet ask permission to send
      // something that was never sent. With a real clip it now carries the frame the user
      // actually chose — null only where there is no clip, which is the placeholder path,
      // and sending a stock photograph of somebody else's possum would be worse than
      // sending nothing. proxy/roles.py wraps the value in the data:image prefix itself, so
      // what goes over the wire is the base64 alone.
      //
      // In `hybrid` — the mode this is delivered in — assistantIsLive is false and
      // identifyFrame answers from the fixture without reaching the network at all. So
      // nothing leaves the device tonight either way. What changed is that the path is
      // now true when the assistant is switched on, instead of hard-wired to null.
      const still = draft.stills[draft.frameIndex];
      const answer = await identifyFrame({
        storyboardId: id,
        imageBase64: still ? base64Of(still.src) : null,
      });
      draft.setSuggestion(answer.reply);
    } catch {
      draft.setSuggestion(null);   // not recognising it does not block anybody; carry on
    }
    router.push(`/b/${id}/add/species`);
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add/frame`)} />
      </div>
      <Steps at={2} />

      <div className={ui.body}>
        <h1 className={ui.h1}>Mask the frame</h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--accent-hover)", margin: "0 0 16px" }}>
          {COPY.maskLede}
        </p>

        <div ref={canvas} className={styles.canvas}
             onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {targets.map((t) => (
            <span key={t.id} className={styles.target}
                  style={{
                    left: t.x + "%", top: t.y + "%", width: t.w + "%", height: t.h + "%",
                    border: "1px dashed " + (t.done ? "transparent" : "rgba(246,160,107,0.7)"),
                  }}>
              {t.done ? null : <span className={styles.targetLabel}
                                     style={{ color: "var(--accent-hover)" }}>{t.label}</span>}
            </span>
          ))}
          {drawn.map((b, i) => (
            <span key={i} className={styles.box}
                  style={{ left: b.x + "%", top: b.y + "%", width: b.w + "%", height: b.h + "%" }}>
              <button type="button" className={styles.boxKill} aria-label="Remove mask"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        draft.setBoxes(boxes.filter((_, j) => j !== i));
                      }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
          {drawn.length === 0 ? <span className={styles.hint}>{COPY.maskHint}</span> : null}
        </div>
        <p className={styles.footnote} style={{ marginTop: 10 }}>{COPY.maskNote}</p>

        <div className={styles.checklist}>
          {targets.map((t) => (
            <div key={t.id} className={styles.checkRow}>
              <span className={styles.pip}
                    style={{ background: t.done ? "var(--leaf)" : "var(--accent-hover)" }} />
              <span style={{ color: "var(--text-muted)" }}>{t.label}</span>
              <span className={styles.state}
                    style={{ color: t.done ? "var(--leaf)" : "var(--text-dim)" }}>
                {t.done ? "Covered" : "Showing"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={ui.footer}>
        {blocked ? <p className={styles.blockedNote}>{COPY.maskBlocked}</p> : null}
        <button type="button" className={ui.btn} disabled={blocked}
                onClick={() => setConsent(true)}>Next</button>
      </div>

      {consent ? (
        <Sheet onClose={() => !sending && setConsent(false)} labelledBy="consent-title">
          <h2 id="consent-title" className={ui.sheetTitle}>{COPY.consentTitle}</h2>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-body)", margin: "0 0 16px" }}>
            {COPY.consentBody}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px",
                       display: "flex", flexDirection: "column", gap: 9 }}>
            {COPY.consentPoints.map((point) => (
              <li key={point} style={{ display: "flex", gap: 10, fontSize: 13.5,
                                       lineHeight: 1.5, color: "var(--text-muted)" }}>
                <span style={{ color: "var(--accent-hover)" }} aria-hidden="true">·</span>
                {point}
              </li>
            ))}
          </ul>
          {sending ? (
            <Spinner label="Sending one frame" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* One class, one size. Neither is lighter than the other. */}
              <button type="button" className={ui.btnQuiet} onClick={sendFrame}>
                {COPY.consentSend}
              </button>
              <button type="button" className={ui.btnQuiet}
                      onClick={() => router.push(`/b/${id}/add/species`)}>
                {COPY.consentSkip}
              </button>
            </div>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
