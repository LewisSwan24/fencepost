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
import { appendPage, fillTo } from "../../../../../lib/paging";
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
  const [loadingMore, setLoadingMore] = useState(false);

  // /api/forum/thread is paged (FORUM_PAGE in proxy/app.py) behind the same 4.5 MB cap as the
  // timeline, so a reload lands on page one — and a thread runs oldest first, which puts the
  // reply you just posted on a later page. So load() carries the timeline's two remedies via
  // lib/paging: keep at least as many replies as were showing (`keep`, after a take-down), and
  // page on until a given reply is in the list (`containing`, after posting one). Returns the
  // view so the callers below can read what came back.
  function fetchView(keep = 0, containing = null) {
    return readThread(threadId)
      .then((first) => fillTo(first, (after) => readThread(threadId, after),
                              { atLeast: keep, containing, key: "posts" }));
  }

  function load(keep = 0, containing = null) {
    return fetchView(keep, containing)
      .then((v) => { setView(v); return v; }, (e) => { setError(e.message); return null; });
  }

  // After a take-down. When the last post goes the thread goes with it: the server then
  // answers 404 "gone", while offline fixtures hand back an empty thread. Either way there is
  // nothing left to show, so back to the list rather than an error about a thread we emptied.
  async function reloadAfterRemoval(keep) {
    const back = () => router.replace("/b/" + id + "/forum");
    try {
      const v = await fetchView(keep);
      if ((v.posts || []).length === 0) back();
      else setView(v);
    } catch (e) {
      if (e.status === 404) back();
      else setError(e.message);
    }
  }

  useEffect(() => { load(); }, [threadId]);
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
        // Page on until the reply just posted is on screen: on a long thread it is on a later
        // page, the same trap the timeline landing hit. See lib/paging.
        load(posts.length, result.post_id);
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
      // with it, and the server is the one that decides that. Keep what was showing so a
      // take-down on an expanded thread does not collapse it back to page one.
      await reloadAfterRemoval(posts.length);
    } catch (e) {
      setError(e.message);
    }
  }

  async function clear(postId) {
    setClearing(null);
    try {
      await removeForumPost(postId);
      await reloadAfterRemoval(posts.length);
    } catch (e) {
      setError(e.message);
    }
  }

  // One more page of replies, appended. `view.next` is the server's cursor or null, so the
  // button exists only when there is really more. Appends onto the list it was fetched for:
  // a reload may have replaced it while the page was on its way, and appendPage also drops
  // anything already held, so a take-down shifting later posts up cannot double a card.
  async function loadMore() {
    if (!view?.next || loadingMore) return;
    setLoadingMore(true);
    try {
      const cursor = view.next;
      const page = await readThread(threadId, cursor);
      setView((prev) => (prev?.next === cursor ? appendPage(prev, page, "posts") : prev));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
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

        {/* Drawn only when the server says there is another page. `next` is a cursor or null,
            so this is never a button that could be pressed for nothing. Replies run oldest
            first, so this loads later ones and appends: reading down a long thread should not
            lose your place. */}
        {view?.next ? (
          <button type="button" className={styles.showMore} disabled={loadingMore}
                  onClick={loadMore}>
            {loadingMore ? "Loading…" : COPY.moreReplies}
          </button>
        ) : null}

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
