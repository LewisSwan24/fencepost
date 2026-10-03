"use client";

// 11 · Forum. The discussion under a storyboard.
//
// There is no assistant here, not one entry point. Not an oversight — forum posts and
// entries are two separate tables with two sets of endpoints, and the assistant's context
// physically cannot reach this (data-model §2). Nothing in the interface should suggest
// otherwise.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { forumThreads, createThread, boardAccess, isArchived } from "../../../../lib/api";
import { COPY, reasonSentence } from "../../../../lib/copy";
import { relative, countLabel } from "../../../../lib/format";
import { BackButton, ErrorNote, Sheet, ui } from "../../../../components/ui";
import styles from "./forum.module.css";

export default function Forum({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [blocked, setBlocked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState(null);

  useEffect(() => {
    forumThreads(id).then((view) => setThreads(view.threads), (e) => setError(e.message));
    // The server answers read_only_access for a view grant and storyboard_closed for an
    // archived board. The interface follows that rather than drawing a button certain to
    // be refused.
    boardAccess(id).then(setAccess, () => {});
  }, [id]);

  async function start() {
    setBusy(true);
    setBlocked(null);
    try {
      const made = await createThread({ storyboardId: id, title: title.trim(), body: body.trim() });
      // A Screener refusal comes back 200 with published:false and **no thread_id**.
      // This used to navigate straight to thread_id, so a refusal sent somebody to
      // /forum/undefined, where the page answered "There is nothing at that address." —
      // and what they wrote looked lost. The reply() next door in [threadId] was always
      // right; this now matches it.
      if (made.published === false) {
        setBlocked(reasonSentence(made.reason_codes));
        setBusy(false);
        return;
      }
      router.push("/b/" + id + "/forum/" + made.thread_id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  // While access is still loading, assume you cannot write: a button missing briefly beats
  // one that flashes up and does not work.
  const canPost = access?.level === "contribute" || access?.level === "reshare";
  const canPostNow = canPost && !isArchived(access?.status);

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/b/" + id)} />
        <span className={ui.barTitle}>{COPY.discussion}</span>
      </div>

      <div className={ui.body}>
        <h1 className={styles.title}>{COPY.discussion}</h1>
        <p className={styles.lede}>Everything that isn&apos;t a sighting.</p>

        <ErrorNote className={styles.error}>{error}</ErrorNote>
        {!threads && !error ? <p className={styles.quiet}>Loading…</p> : null}

        {threads?.length === 0 ? (
          <p className={styles.quiet}>Nothing yet. Start the first one.</p>
        ) : null}

        {threads?.map((t) => (
          <button key={t.id} type="button" className={styles.thread}
                  onClick={() => router.push("/b/" + id + "/forum/" + t.id)}>
            <span className={styles.threadTitle}>{t.title}</span>
            <span className={styles.threadMeta}>
              <span>@{t.handle}</span>
              <span className={styles.dot} />
              <span>{countLabel(t.post_count, "post", "posts")}</span>
              <span className={styles.dot} />
              <span>{relative(t.created_at)}</span>
            </span>
          </button>
        ))}
      </div>

      {canPostNow ? (
        <div className={ui.footer}>
          <button type="button" className={ui.btn} onClick={() => setOpen(true)}>
            {COPY.newThread}
          </button>
        </div>
      ) : null}

      {open ? (
        <Sheet onClose={() => !busy && setOpen(false)} labelledBy="thread-title">
          <h2 id="thread-title" className={ui.sheetTitle}>{COPY.newThread}</h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="t-title">Title</label>
            <input id="t-title" className={styles.input} value={title} maxLength={120}
                   onChange={(e) => { setTitle(e.target.value); setBlocked(null); }}
                   placeholder="What actually keeps them out of the roof?" />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="t-body">Your message</label>
            <textarea id="t-body" className={styles.input} rows={5} maxLength={4000} value={body}
                      onChange={(e) => { setBody(e.target.value); setBlocked(null); }}
                      placeholder="In your own words" />
          </div>
          {blocked ? (
            <>
              <p className={styles.error}>{blocked}</p>
              <p className={styles.quiet}>{COPY.blockedKept}</p>
            </>
          ) : null}
          <button type="button" className={ui.btn}
                  disabled={!title.trim() || !body.trim() || busy} onClick={start}>
            {busy ? "Posting…" : "Post"}
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}
