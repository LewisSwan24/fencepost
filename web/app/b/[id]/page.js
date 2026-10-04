"use client";

// 9 · Storyboard detail. The timeline, the public review label, the way into the
// discussion, and the assistant drawer.
//
// "Being checked by neighbours" is the outcome of a community vote, not a system verdict,
// so everybody sees it including the author — there is no author-only state and no "you
// have been flagged" notice. But an author cannot vote on their own entry (the server
// answers 403 not_your_call), so those two buttons simply do not appear there, rather
// than appearing and then failing.

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { storyboard, timeline, isArchived, castVote, me, editEntry, deleteEntry, removeEntry, isOwner } from "../../../lib/api";
import { SPECIES_LABEL } from "../../../lib/fixtures";
import { COPY, reasonSentence } from "../../../lib/copy";
import { stamp, countLabel, monthDay } from "../../../lib/format";
import { BackButton, ErrorNote, Sheet, ui } from "../../../components/ui";
import Chat from "../../../components/Chat";
import Shot from "../../../components/Shot";
import { frameFor } from "../../../lib/frames";
import { appendPage, fillTo } from "../../../lib/paging";
import styles from "./page.module.css";

export default function Storyboard({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const query = useSearchParams();
  const justPosted = query.get("posted");
  const viaLink = query.get("via") === "link";

  const [view, setView] = useState(null);
  const [who, setWho] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(Boolean(justPosted));
  const [open, setOpen] = useState(null); // the entry currently expanded
  const [voted, setVoted] = useState({});
  const [chat, setChat] = useState(false);
  const [editing, setEditing] = useState(null);    // {id, funFact, story, species, codes}
  const [confirming, setConfirming] = useState(null);
  const [clearing, setClearing] = useState(null);   // somebody else's, on a board I own
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [owner, setOwner] = useState(false);

  // `keep` is how many entries were showing: a reload after an edit or a delete fetches at
  // least that many again rather than collapsing to page one, and on arrival from posting it
  // keeps going until the new sighting is in the list. See lib/paging.js for what went wrong
  // without either. Returns its promise, so the callers below can wait for it.
  function load(keep = 0) {
    return storyboard(id)
      .then((first) => fillTo(first, (after) => timeline(id, after),
                              { atLeast: keep, containing: justPosted }))
      .then(setView, (e) => setError(e.message));
  }

  useEffect(() => {
    load();
    me().then(setWho, () => {});
  }, [id]);

  // Only an owner can close it (the server answers not_the_owner), and an owner always
  // holds reshare.
  useEffect(() => {
    if (!view?.level) return;
    isOwner(id, view.level).then(setOwner, () => {});
  }, [id, view?.level]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(timer);
  }, [note]);

  const archived = view ? isArchived(view.status) : false;
  const entries = view?.entries || [];
  const level = view?.level;
  const canContribute = !archived && level !== "view";
  const canShare = level === "reshare";
  // From the server now, not deduplicated out of the entries on screen. /api/timeline is
  // paged, so counting what has loaded would answer "who is in the part you have read" and
  // present it as "who is in this story". Same reason the count and the date come from the
  // response rather than the array: see TIMELINE_PAGE in proxy/app.py.
  // Each of the three falls back to what this screen used to compute for itself. Not
  // defensiveness for its own sake: a `git push` rebuilds fencepost-web and does nothing to
  // the API, so between the two deploys this page runs against a server that has never heard
  // of these fields. Without the fallbacks that window shows a storyboard with no
  // contributors and no date — quietly, and on the live site. CLAUDE.md working rule 7.
  const people = view?.participants || [...new Set(entries.map((e) => e.handle))];
  // The server names at most PARTICIPANT_LIMIT contributors and counts them all.
  const morePeople = Math.max(0, (view?.contributors ?? people.length) - people.length);
  const sightings = view?.sightings ?? entries.length;
  const firstSeen = view?.first_seen || entries.map((e) => e.created_at).sort()[0];

  // The next page, appended. `view.next` is the cursor the server handed back, or null when
  // the list is finished, so the button exists only when there is really more to fetch.
  // Appending into `view` rather than into a second piece of state means load() resets the
  // list on any refetch, which is what every other mutation on this screen already relies on.
  async function loadMore() {
    if (!view?.next || busy) return;
    setBusy(true);
    try {
      const cursor = view.next;
      const page = await timeline(id, cursor);
      // Only onto the list it was fetched for. If a reload replaced the list while this page
      // was on its way, the page belongs to a list that no longer exists, and appending it
      // repeated a card. appendPage also drops anything already held, for the same reason.
      setView((prev) => (prev?.next === cursor ? appendPage(prev, page) : prev));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function vote(entryId, choice) {
    setVoted((prev) => ({ ...prev, [entryId]: choice }));
    try {
      await castVote(entryId, choice);
    } catch (e) {
      setVoted((prev) => ({ ...prev, [entryId]: undefined }));
      setError(e.message);
    }
  }

  // Whether anything really changed has to match how the server computes changed
  // (app.py edit_entry): an empty string means "leave this one alone", not "clear it".
  function changed(draft) {
    const row = entries.find((e) => e.id === draft.id) || {};
    const ff = draft.funFact.trim();
    const st = draft.story.trim();
    return (ff && ff !== (row.fun_fact || "")) || (st && st !== (row.story || ""));
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const ff = editing.funFact.trim();
      const st = editing.story.trim();
      const result = await editEntry({
        entryId: editing.id,
        funFact: ff || undefined,
        story: st || undefined,
      });
      // A Screener refusal comes back 200 with published:false — catch never sees it.
      // Nothing in the database moved, so the panel stays open and the text stays put.
      if (result.published === false) {
        setEditing({ ...editing, codes: result.reason_codes || [] });
        setBusy(false);
        return;
      }
      setEditing(null);
      setNote(result.unchanged ? COPY.noChanges : null);
      await load(entries.length);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirming) return;
    setBusy(true);
    try {
      await deleteEntry(confirming);
      setConfirming(null);
      setNote(COPY.deleted);
      // Awaited, and as long as it was: busy stays set until the list is back, so Show more
      // cannot fetch a page for the list that is about to be replaced.
      await load(entries.length);   // the count, the participants and the cover all follow
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function clear() {
    if (!clearing) return;
    setBusy(true);
    try {
      await removeEntry(clearing);
      setClearing(null);
      setNote(COPY.removed);
      await load(entries.length);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        {viaLink ? (
          <span className={styles.shared}>
            Shared with you{level ? " · " + COPY.levelLabel[level] : ""}
          </span>
        ) : (
          <>
            <BackButton onClick={() => router.push("/")} label="All storyboards" />
            <span className={ui.barTitle}>{view?.title || ""}</span>
          </>
        )}
      </div>

      <div className={ui.body}>
        <ErrorNote className={styles.quiet}>{error}</ErrorNote>
        {!view && !error ? <p className={styles.quiet}>Loading…</p> : null}

        {view ? (
          <>
            {/* There used to be a cover image here. It took the first entry that had a
                picture, so with only one sighting the same photograph appeared twice on
                one screen and looked broken. The cover belongs on the list card, where it
                is the only one; on this page the pictures belong to the entries. */}
            <h1 className={styles.title}>{view.title}</h1>
            <div className={styles.meta}>
              <span>{countLabel(sightings, "sighting", "sightings")}</span>
              {/* The collective half: what this street has kept together, with nobody's
                  name on it. A shared total characterises no individual, and it is the one
                  number that points at what the product is actually about. Which is why it
                  is the storyboard's total and not this page's: /api/timeline sends
                  `sightings` and `first_seen` counted over every live entry, because a page
                  of twenty cannot answer either and guessing from the array would put two
                  confident wrong numbers in the one place that says what this is for. */}
              {firstSeen ? (
                <span className={styles.since}>since {monthDay(firstSeen)}</span>
              ) : null}
            </div>
            {/* "Who is in this story", not "who has access" — that list is on the share
                screen and needs reshare to see. This used to deduplicate the authors of the
                entries on screen, because /api/dashboard does not return participants and
                the prototype's view.participants was permanently empty. /api/timeline
                returns them now, in first-appearance order, which is the order that
                deduplication produced; it has to come from the server because the entries on
                screen are one page of them. */}
            {people.length ? (
              <div className={styles.people}>
                {people.map((h) => (
                  <span key={h} className={styles.who}>@{h}</span>
                ))}
                {morePeople ? <span className={styles.who}>+{morePeople} more</span> : null}
              </div>
            ) : null}

            {archived ? (
              <>
                <p className={styles.banner}>{view.closed_note ? COPY.closed : COPY.archived}</p>
                {/* The closing line. When an owner writes it they are told it is for
                    everyone who contributed, so somebody has to be able to read it — until
                    now it was written and never read. */}
                {view.closed_note ? (
                  <blockquote className={styles.closedNote}>
                    <p className={styles.closedNoteText}>{view.closed_note}</p>
                    <cite className={styles.closedNoteFrom}>{COPY.closedNoteFrom}</cite>
                  </blockquote>
                ) : null}
              </>
            ) : null}

            {/* Second look. Only contributors and above see it — the server answers
                read_only_access for a view grant, because reviewing is between
                contributors. Deliberately **not** hidden on an archived storyboard:
                review_queue, cast_review_vote and dispose_entry none of them consult
                storyboard_status, so these still work there, and hiding them would be the
                interface lying in the other direction. */}
            {level && level !== "view" ? (
              <button
                type="button"
                className={styles.forumRow}
                onClick={() => router.push("/b/" + id + "/review")}
              >
                <span className={styles.forumLabel}>{COPY.secondLookNav}</span>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : null}

            <button
              type="button"
              className={styles.forumRow}
              onClick={() => router.push("/b/" + id + "/forum")}
            >
              <span className={styles.forumLabel}>Discussion</span>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>

            <div className={styles.rule} />

            {entries.length === 0 ? (
              <p className={styles.quiet}>Nothing here yet. Yours would be the first.</p>
            ) : (
              entries.map((e) => {
                // The server compares author_id (_own_editable_entry in app.py), so the
                // interface does the same. A handle is unique in the database but it is
                // not the primary key and should not be used as one. Fixtures rows have no
                // author_id, so a handle fallback stays.
                const mine = !!who && (e.author_id ? e.author_id === who.user_id
                                                   : e.handle === who.handle);
                const frame = frameFor(e);
                return (
                  <article
                    key={e.id}
                    className={[styles.entry, e.id === justPosted ? styles.entryNew : ""].join(" ")}
                  >
                    <div className={styles.entryHead}>
                      <span className={styles.handle}>@{e.handle}</span>
                      <span className={styles.dot} />
                      <span className={styles.when}>{stamp(e.created_at)}</span>
                      <span className={styles.species}>
                        {SPECIES_LABEL[e.species] || "Not sure"}
                      </span>
                    </div>
                    {/* The author's own frame when there is one. The placeholder is what a
                        sighting posted before this existed still shows, and what the
                        placeholder path still produces — lib/frames.js says outright that
                        those are somebody else's photographs. */}
                    {e.still
                      ? <Shot src={`data:image/jpeg;base64,${e.still}`}
                              alt="A frame from this sighting" height={170} />
                      : <Shot src={frame?.file} alt={frame?.alt}
                              graded={frame ? !frame.night : false} height={170} />}

                    {e.being_checked ? (
                      <div className={styles.checked}>
                        <button
                          type="button"
                          className={styles.checkedHead}
                          aria-expanded={open === e.id}
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 8v4M12 16h.01" />
                            <circle cx="12" cy="12" r="9" />
                          </svg>
                          {COPY.checkedLabel}
                        </button>
                        {open === e.id ? (
                          <div className={styles.checkedBody}>
                            <p className={styles.checkedText}>{COPY.checkedBody}</p>
                            {/* Read-only people take no part in review — the server
                                answers read_only_access, because this is between
                                contributors. The interface follows that rather than
                                drawing a button certain to be refused. */}
                            {mine || !canContribute ? null : voted[e.id] ? (
                              <p className={styles.thanks}>
                                {voted[e.id] === "looks_right" ? COPY.votedYes : COPY.votedNo}
                              </p>
                            ) : (
                              <div className={styles.votes}>
                                <button type="button" className={styles.vote}
                                        onClick={() => vote(e.id, "looks_right")}>
                                  {COPY.checkedYes}
                                </button>
                                <button type="button" className={styles.vote}
                                        onClick={() => vote(e.id, "worth_checking")}>
                                  {COPY.checkedNo}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {e.fun_fact ? (
                      <div className={styles.fact}>
                        <div className={styles.factKicker}>Fun fact</div>
                        <div className={styles.factText}>{e.fun_fact}</div>
                      </div>
                    ) : null}
                    <p className={styles.story}>{e.story}</p>
                    {/* Only the author sees these, and they are gone once the storyboard
                        is archived — the server answers storyboard_closed and takes
                        neither an edit nor a delete. */}
                    {/* Not yours, but this is your storyboard. A separate control from
                        the two below on purpose: those withdraw your own writing, this
                        takes somebody else's off a space you made, and the server records
                        that you were the one who did it. */}
                    {!mine && owner && !archived ? (
                      <div className={styles.own}>
                        <button type="button" className={styles.ownBtn}
                                onClick={() => setClearing(e.id)}>
                          {COPY.removeIt}
                        </button>
                      </div>
                    ) : null}
                    {mine && !archived ? (
                      <div className={styles.own}>
                        <button type="button" className={styles.ownBtn}
                                onClick={() => setEditing({
                                  id: e.id, funFact: e.fun_fact || "", story: e.story || "",
                                  species: e.species, codes: null,
                                })}>
                          {COPY.editEntry}
                        </button>
                        <button type="button" className={styles.ownBtn}
                                onClick={() => setConfirming(e.id)}>
                          {COPY.deleteEntry}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}

            {/* Drawn only when the server says there is another page. `next` is a cursor or
                null, so this is never a button that could be pressed for nothing — the rule
                in web/README.md. It loads later sightings, because the timeline runs oldest
                first, and it appends rather than replacing: somebody reading down a long
                storyboard should not lose their place to find out how it ends. */}
            {view.next ? (
              <button type="button" className={styles.closeRow} disabled={busy}
                      onClick={loadMore}>
                {busy ? "Loading…" : COPY.moreSightings}
              </button>
            ) : null}

            {/* Closing sits at the end of the timeline rather than in the footer: it is
                rare, owner-only and irreversible, and does not belong beside "Add your
                sighting". It disappears once archived too — the server would let an owner
                close it again, but that would quietly overwrite the previous line. */}
            {owner && !archived ? (
              <button type="button" className={styles.closeRow}
                      onClick={() => router.push("/b/" + id + "/close")}>
                {COPY.closeStoryboard}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {view ? (
        <div className={[ui.footer, ui.footerSticky, styles.dock].join(" ")}>
          {canContribute ? (
            <button type="button" className={ui.btn} onClick={() => router.push("/b/" + id + "/add")}>
              {COPY.addSighting}
            </button>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.action} onClick={() => setChat(true)}>
              {COPY.askAssistant}
            </button>
            {canShare ? (
              <button type="button" className={styles.action}
                      onClick={() => router.push("/b/" + id + "/share")}>
                Share
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {editing ? (
        <Sheet onClose={() => !busy && setEditing(null)} labelledBy="edit-title">
          <h2 id="edit-title" className={ui.sheetTitle}>{COPY.editTitle}</h2>
          {/* The species is read-only. The server edit handler does not read species from
              the request body at all, and the other side of "visual identification must
              never set the species" is that the species belongs to the step that chose it. */}
          <p className={styles.editSpecies}>
            {SPECIES_LABEL[editing.species] || "Not sure"}
          </p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="edit-fact">Fun fact</label>
            <textarea id="edit-fact" className={styles.input} rows={3} value={editing.funFact}
                      onChange={(ev) => setEditing({ ...editing, funFact: ev.target.value, codes: null })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="edit-story">What happened</label>
            <textarea id="edit-story" className={styles.input} rows={6} value={editing.story}
                      onChange={(ev) => setEditing({ ...editing, story: ev.target.value, codes: null })} />
          </div>
          <p className={styles.quiet}>{COPY.editHint}</p>
          {editing.codes ? (
            <div className={styles.rejected}>
              <div className={styles.rejectedHead}>{COPY.editNotSaved}</div>
              <p className={styles.rejectedText}>{reasonSentence(editing.codes)}</p>
              <p className={styles.quiet}>{COPY.editOriginalKept}</p>
            </div>
          ) : null}
          <button type="button" className={ui.btn} style={{ marginTop: 16 }}
                  disabled={busy || !changed(editing)} onClick={save}>
            {busy ? COPY.saving : COPY.saveChanges}
          </button>
          <button type="button" className={styles.sheetQuiet}
                  disabled={busy} onClick={() => setEditing(null)}>
            {COPY.cancel}
          </button>
        </Sheet>
      ) : null}

      {clearing ? (
        <Sheet onClose={() => !busy && setClearing(null)} labelledBy="rm-title">
          <h2 id="rm-title" className={ui.sheetTitle}>{COPY.removeTitle}</h2>
          <p className={styles.quiet}>{COPY.removeBody}</p>
          <button type="button" className={ui.btn} style={{ marginTop: 18 }}
                  disabled={busy} onClick={clear}>
            {busy ? COPY.saving : COPY.removeConfirm}
          </button>
          <button type="button" className={styles.sheetQuiet}
                  disabled={busy} onClick={() => setClearing(null)}>
            {COPY.cancel}
          </button>
        </Sheet>
      ) : null}

      {confirming ? (
        <Sheet onClose={() => !busy && setConfirming(null)} labelledBy="del-title">
          <h2 id="del-title" className={ui.sheetTitle}>{COPY.deleteTitle}</h2>
          <p className={styles.quiet}>{COPY.deleteBody}</p>
          <button type="button" className={ui.btn} style={{ marginTop: 18 }}
                  disabled={busy} onClick={remove}>
            {busy ? COPY.saving : COPY.deleteConfirm}
          </button>
          <button type="button" className={styles.sheetQuiet}
                  disabled={busy} onClick={() => setConfirming(null)}>
            {COPY.cancel}
          </button>
        </Sheet>
      ) : null}

      {chat ? <Chat storyboardId={id} onClose={() => setChat(false)} /> : null}
      {toast ? <div className={styles.toast}>{COPY.posted}</div> : null}
      {note ? <div className={styles.toast}>{note}</div> : null}
    </div>
  );
}
