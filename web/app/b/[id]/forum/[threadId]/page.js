"use client";

// 11 · Thread detail. No assistant entry point here either.
//
// Replies go through the Screener too — a refusal returns only reason_codes, and as with
// an entry the author never sees the internal judgement.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readThread, createPost, deleteForumPost, removeForumPost, boardAccess,
         isArchived, isOwner, me } from "../../../../../lib/api";
import { COPY, reasonSentence } from "../../../../../lib/copy";
import { stamp } from "../../../../../lib/format";
import { BackButton, Sheet, ui } from "../../../../../components/ui";
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
  const [who, setWho] = useState(null);
  const [confirming, setConfirming] = useState(null);   // my own, being taken down
  const [clearing, setClearing] = useState(null);       // somebody else's, on a board I own
  const [owner, setOwner] = useState(false);

  function load() {
    readThread(threadId).then(setView, (e) => setError(e.message));
  }

  useEffect(load, [threadId]);
  // As above: the server takes no reply for a view grant or an archived storyboard.
  useEffect(() => { boardAccess(id).then(setAccess, () => {}); }, [id]);
  // Needed to tell which posts are mine. Same comparison the timeline makes: author_id
  // when the server sends one, falling back to the handle, which is what the offline
  // fixtures carry.
  useEffect(() => { me().then(setWho, () => {}); }, []);
  // An owner can clear their own storyboard, which includes the discussion on it. The
  // server answers not_the_owner to anybody else, so this only decides what is drawn.
  useEffect(() => {
    if (!access?.level) return;
    isOwner(id, access.level).then(setOwner, () => {});
  }, [id, access?.level]);

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

  const mine = (post) => !!who && (post.author_id ? post.author_id === who.user_id
                                                  : post.handle === who.handle);

  async function takeDown(postId) {
    setConfirming(null);
    try {
      await deleteForumPost(postId);
      // Reload rather than splice it out locally: when the last post goes the thread goes
      // with it, and the server is the one that decides that.
      const left = await readThread(threadId);
      if ((left.posts || []).length === 0) router.replace("/b/" + id + "/forum");
      else setView(left);
    } catch (e) {
      setError(e.message);
    }
  }

  async function clear(postId) {
    setClearing(null);
    try {
      await removeForumPost(postId);
      const left = await readThread(threadId);
      if ((left.posts || []).length === 0) router.replace("/b/" + id + "/forum");
      else setView(left);
    } catch (e) {
      setError(e.message);
    }
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
              {/* Your own words, and only your own. The server answers not_your_post to
                  anybody else, so this is the interface narrowing to that rather than
                  being the thing that holds the rule up. */}
              {mine(p) && canReply ? (
                <button type="button" className={styles.takeDown}
                        onClick={() => setConfirming(p.id)}>{COPY.deletePost}</button>
              ) : null}
              {/* Not yours, but the storyboard is. Recorded against you, not silent. */}
              {!mine(p) && owner && canReply ? (
                <button type="button" className={styles.takeDown}
                        onClick={() => setClearing(p.id)}>{COPY.removeIt}</button>
              ) : null}
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

      {clearing ? (
        <Sheet onClose={() => setClearing(null)} labelledBy="clear-title">
          <h2 id="clear-title" className={ui.sheetTitle}>{COPY.removeTitle}</h2>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-body)",
                      margin: "0 0 20px" }}>
            {COPY.removeBody}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" className={ui.btn}
                    onClick={() => clear(clearing)}>{COPY.removeConfirm}</button>
            <button type="button" className={ui.btnQuiet}
                    onClick={() => setClearing(null)}>{COPY.cancel}</button>
          </div>
        </Sheet>
      ) : null}

      {confirming ? (
        <Sheet onClose={() => setConfirming(null)} labelledBy="take-down-title">
          <h2 id="take-down-title" className={ui.sheetTitle}>{COPY.deletePostTitle}</h2>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-body)",
                      margin: "0 0 20px" }}>
            {COPY.deletePostBody}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button type="button" className={ui.btn}
                    onClick={() => takeDown(confirming)}>{COPY.deletePostConfirm}</button>
            <button type="button" className={ui.btnQuiet}
                    onClick={() => setConfirming(null)}>{COPY.cancel}</button>
          </div>
        </Sheet>
      ) : null}

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
