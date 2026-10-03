"use client";

// An owner closing a storyboard deliberately, leaving a closing line (user-flow §9).
//
// Why a screen of its own rather than a confirm sheet: this is irreversible, and it also
// deletes the assistant conversation on this storyboard (the DELETE inside
// db.close_storyboard). Four consequences have to be laid out to be read, a sheet cannot
// hold them, and nobody should make this decision inside a small box covering the content.
//
// This screen also says deliberately that you do not have to do it: 30 days quiet turns a
// storyboard read-only by itself. Closing is for the moment when something has ended, not
// a maintenance duty.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { boardRow, isOwner, closeStoryboard, isArchived } from "../../../../lib/api";
import { COPY, reasonSentence } from "../../../../lib/copy";
import { BackButton, ErrorNote, ui } from "../../../../components/ui";
import styles from "./close.module.css";

const NOTE_LIMIT = 280;      // matches the server's _plain_text(..., 280)

export default function CloseStoryboard({ params }) {
  const { id } = use(params);
  const router = useRouter();

  const [view, setView] = useState(null);
  const [allowed, setAllowed] = useState(null);   // null = not known yet, true/false = known
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(null);

  useEffect(() => {
    let live = true;
    boardRow(id).then(
      async (got) => {
        if (!live) return;
        setView(got);
        // An already archived board counts as not allowed either: the server would in fact
        // let an owner close it again, and that would **quietly overwrite the previous
        // closing line**. This is the one place this screen is stricter than the server,
        // and it errs on the safe side.
        const owner = await isOwner(id, got.level);
        if (live) setAllowed(owner && !isArchived(got.status));
      },
      (e) => { if (live) setError(e.message); },
    );
    return () => { live = false; };
  }, [id]);

  // Somebody who should not be here should not sit on this screen. There is no dedicated
  // refusal state — this is not "you lack permission" but "there is nothing here", so send
  // them back to the storyboard.
  useEffect(() => {
    if (allowed === false) router.replace("/b/" + id);
  }, [allowed, id, router]);

  async function close() {
    setBusy(true);
    setBlocked(null);
    try {
      const done = await closeStoryboard({ storyboardId: id, closedNote: note.trim() || undefined });
      // The note is screened, and a refusal comes back 200 with published:false — catch
      // never sees it. **The storyboard is still open**, so going back to it would look
      // like the closing worked. Stay here with the note still in the box.
      if (done.published === false) {
        setBlocked(reasonSentence(done.reason_codes));
        setBusy(false);
        return;
      }
      router.replace("/b/" + id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const left = NOTE_LIMIT - note.length;

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/b/" + id)} />
        <span className={ui.barTitle}>{view?.title || ""}</span>
      </div>

      <div className={ui.body}>
        <ErrorNote className={styles.error}>{error}</ErrorNote>
        {allowed !== true ? (
          <p className={styles.quiet}>Loading…</p>
        ) : (
          <>
            <h1 className={styles.title}>{COPY.closeTitle}</h1>
            <p className={styles.lede}>{COPY.closeLede}</p>

            <ul className={styles.points}>
              {COPY.closePoints.map((point) => (
                <li key={point} className={styles.point}>{point}</li>
              ))}
            </ul>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="closing-note">
                {COPY.closeNoteLabel}
              </label>
              <textarea
                id="closing-note"
                className={styles.input}
                rows={4}
                maxLength={NOTE_LIMIT}
                value={note}
                placeholder={COPY.closeNotePlaceholder}
                onChange={(e) => { setNote(e.target.value); setBlocked(null); }}
              />
              <div className={styles.hintRow}>
                <span className={styles.hint}>{COPY.closeNoteHint}</span>
                {/* Only appears near the limit. A counter present from the first character
                    is pressure to write less, and this line has no obligation to exist. */}
                {left <= 40 ? <span className={styles.count}>{left}</span> : null}
              </div>
            </div>

            {blocked ? (
              <>
                <p className={styles.refused}>{blocked}</p>
                <p className={styles.quiet}>{COPY.blockedKept}</p>
              </>
            ) : null}

            <p className={styles.notRequired}>{COPY.closeNotRequired}</p>
          </>
        )}
      </div>

      {allowed === true ? (
        <div className={ui.footer}>
          <button type="button" className={ui.btn} disabled={busy} onClick={close}>
            {busy ? COPY.closing : COPY.closeStoryboard}
          </button>
          <button type="button" className={styles.cancel} disabled={busy}
                  onClick={() => router.push("/b/" + id)}>
            {COPY.cancel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
