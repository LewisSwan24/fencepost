"use client";

// 4 · Mask, plus the 5 · Send frame? consent sheet.
//
// Two things are hard requirements:
//   what is covered on screen is covered in the pixels that leave — the boxes are burned in
//   by redact() before the frame goes anywhere, and the canvas is the same shape as the
//   still so the rectangle lands where the person drew it;
//   the two buttons in the sheet carry equal visual weight — they share one class rather
//   than having a style each, so nobody can later make one lighter without the other.
//
// What this screen does NOT do is claim to know what is in the picture. It used to draw a
// FACE and a NUMBER PLATE marker from the fixture, in fixed positions, over a canvas with no
// image under it at all, and the gate was "cover those two". Somebody could satisfy it
// exactly and leave a real face in shot. Automatic detection is the right answer and this
// prototype has none, so it falls back to what prompts.md §2.5.1 specifies: you say what
// needs covering, and "nothing does" is a tick rather than the default.

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COPY } from "../../../../../lib/copy";
import { identifyFrame } from "../../../../../lib/api";
import { isDeliberate } from "../../../../../lib/mask";
import { base64Of, redact } from "../../../../../lib/stills";

import { BackButton, Sheet, Steps, Spinner, ui } from "../../../../../components/ui";
import { useDraft } from "../DraftContext";
import styles from "../add.module.css";

// Card width for the copy kept on the entry. The frame sent to the model stays full size;
// this one is read at about 170px tall in a list, and a timeline carries one per sighting.
const CARD_WIDTH = 480;

export default function Mask({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const canvas = useRef(null);
  const drag = useRef(null);
  const [live, setLive] = useState(null);   // the box currently being dragged
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [nothing, setNothing] = useState(false);   // "there is nothing here to cover"

  const boxes = draft.boxes;
  const drawn = live ? [...boxes, live] : boxes;

  // The frame they picked, shown at its own shape. Boxes are stored as percentages of what
  // is on screen and redact() applies them as percentages of the image, so the canvas has to
  // be the same shape as the still or the black rectangle lands somewhere other than where
  // the person drew it. A portrait phone clip in a fixed-height box is exactly that case.
  const still = draft.stills[draft.frameIndex] || null;
  // No label means a photograph rather than a frame out of a clip: there was no timeline to
  // take it from, so the copy must not claim one was picked.
  const photo = !!still && !still.label;
  const shape = still && still.w && still.h ? still.w / still.h : null;

  // Either you covered something, or you said there is nothing to cover. There is no third
  // answer, and "nothing to cover" is a tick rather than the default — this used to be
  // "cover the two rectangles we invented", which somebody could satisfy exactly while
  // leaving a real face in shot.
  const blocked = drawn.length === 0 && !nothing;

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

  // The frame that goes on the entry: the same still, the same boxes, drawn small. Both ways
  // off this screen call it, because the masking is done either way — somebody who skips the
  // identification has still said what needs covering, and their sighting should carry their
  // own picture rather than a stock photograph of somebody else's possum.
  //
  // CARD_WIDTH rather than full size: every entry on a timeline carries one of these.
  async function carryCover() {
    try {
      const masked = still ? await redact(still.src, draft.boxes, CARD_WIDTH) : null;
      draft.setCover(masked ? base64Of(masked) : null);
    } catch {
      draft.setCover(null);          // no picture is always better than the wrong picture
    }
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
      //
      // The boxes are painted on before it goes. For a day this screen measured coverage,
      // opened its gate, and then sent the untouched still — draft.boxes was read by
      // nothing at all, so "Covered" was a word on a screen while the original face went
      // out. An adversarial review found it on 2026-09-16; in hybrid it had never run.
      //
      // redact answers null on anything going wrong, and null here means the frame is not
      // sent rather than sent unmasked. Losing the suggestion costs a sentence this
      // interface already treats as optional; the other way costs somebody their face.
      await carryCover();
      const masked = still ? await redact(still.src, draft.boxes) : null;
      const answer = await identifyFrame({
        storyboardId: id,
        imageBase64: masked ? base64Of(masked) : null,
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
             style={shape ? {
               // The still's own shape, with the *width* bounded so the height cannot run
               // past the viewport: a 9:16 clip at full width is 667px tall on a phone and
               // pushes the tick and the button off the screen. Bounding the width keeps the
               // ratio exact, which is what the boxes depend on; bounding the height would
               // leave the element full-width and silently distort it.
               aspectRatio: String(shape), height: "auto", width: "100%",
               maxWidth: `calc(52vh * ${shape})`, margin: "0 auto",
             } : undefined}
             onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {/* The frame itself, underneath everything. Drawing over a gradient and calling it
              masking was the old version of this screen. */}
          {still ? <img className={styles.canvasShot} src={still.src} alt="" draggable="false" /> : null}
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
        <p className={styles.footnote} style={{ marginTop: 10 }}>
          {!still ? COPY.maskNoFrame : photo ? COPY.maskPhoto : COPY.maskNote}
        </p>

        {/* Saying "there is nothing to cover" is an act, not the default. Ticking it while
            boxes are drawn would be a contradiction, so drawing one clears it. */}
        <label className={styles.nothing}>
          <input type="checkbox" checked={nothing} disabled={drawn.length > 0}
                 onChange={(e) => setNothing(e.target.checked)} />
          <span>{COPY.maskNothing}</span>
        </label>
      </div>

      <div className={ui.footer}>
        {blocked ? <p className={styles.blockedNote}>{COPY.maskBlockedNow}</p> : null}
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
                      onClick={async () => {
                        await carryCover();
                        router.push(`/b/${id}/add/species`);
                      }}>
                {COPY.consentSkip}
              </button>
            </div>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
