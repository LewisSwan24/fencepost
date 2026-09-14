"use client";

// 11 · Thread detail. No assistant entry point here either.
//
// Replies go through the Screener too — a refusal returns only reason_codes, and as with
// an entry the author never sees the internal judgement.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readThread, createPost, boardAccess, isArchived } from "../../../../../lib/api";
import { COPY, reasonSentence } from "../../../../../lib/copy";
import { stamp } from "../../../../../lib/format";
import { BackButton, ui } from "../../../../../components/ui";
import styles from "../forum.module.css";

export default function Thread({ params }) {
  const { id, threadId } = use(params);
  const router = useRouter();
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(null);

  function load() {
    readThread(threadId).then(setView, (e) => setError(e.message));
  }

  useEffect(load, [threadId]);
  // As above: the server takes no reply for a view grant or an archived storyboard.
  useEffect(() => { boardAccess(id).then(setAccess, () => {}); }, [id]);

  const canReply = (access?.level === "contribute" || access?.level === "reshare")
    && !isArchived(access?.status);

  async function reply() {
    setBusy(true);
    setBlocked(null);
    try {
      const result = await createPost({ threadId, body: body.trim() });
      if (result.published === false) {
        setBlocked(reasonSentence(result.reason_codes));
      } else {
        setBody("");
        load();
      }
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const posts = view?.posts || [];

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/b/" + id + "/forum")} />
        <span className={ui.barTitle}>{view?.title || COPY.discussion}</span>
      </div>

      <div className={ui.body}>
        {error ? <p className={styles.error}>{error}</p> : null}
        {!view && !error ? <p className={styles.quiet}>Loading…</p> : null}

        {view?.title ? <h1 className={styles.title}>{view.title}</h1> : null}

        {posts.map((p) => (
          <article key={p.id} className={styles.post}>
            <div className={styles.postHead}>
              <span className={styles.handle}>@{p.handle}</span>
              <span className={styles.dot} />
              <span className={styles.when}>{stamp(p.created_at)}</span>
            </div>
            <p className={styles.body}>{p.body}</p>
          </article>
        ))}

        {canReply ? (
          <div className={styles.field} style={{ marginTop: 20 }}>
            <label className={styles.label} htmlFor="reply">{COPY.reply}</label>
            <textarea id="reply" className={styles.input} rows={4} maxLength={4000} value={body}
                      onChange={(e) => { setBody(e.target.value); setBlocked(null); }}
                      placeholder="Add to the thread" />
          </div>
        ) : null}
        {blocked ? (
          <>
            <p className={styles.error}>{blocked}</p>
            <p className={styles.quiet}>{COPY.blockedKept}</p>
          </>
        ) : null}
      </div>

      {canReply ? (
        <div className={ui.footer}>
          <button type="button" className={ui.btn} disabled={!body.trim() || busy} onClick={reply}>
            {busy ? "Posting…" : COPY.reply}
          </button>
        </div>
      ) : null}
    </div>
  );
}
