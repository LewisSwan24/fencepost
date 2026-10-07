"use client";

// 1 · My storyboards — the ones I have access to, with Active and Past kept apart.
// Past holds the readonly and archived states; there is no status called past.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dashboard, createStoryboard, me, MODE, assistantIsLive } from "../lib/api";
import { COPY, reasonSentence } from "../lib/copy";
import { relative, initials } from "../lib/format";
import { ErrorNote, Sheet, ui } from "../components/ui";
import Shot from "../components/Shot";
import { frameForSpecies } from "../lib/frames";
import styles from "./page.module.css";

export default function Home() {
  const router = useRouter();
  const [boards, setBoards] = useState(null);
  const [who, setWho] = useState(null);
  const [error, setError] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    dashboard().then(setBoards, (e) => setError(e.message));
    // The header has to say who is actually signed in. Hard-coded to mel_k, it lies the
    // moment the handle changes.
    me().then(setWho, () => {});
  }, []);

  async function create() {
    setBusy(true);
    setBlocked(null);
    try {
      const made = await createStoryboard(title.trim());
      // A refused title comes back 200 with published:false and no storyboard_id, so catch
      // never sees it and pushing straight on would land on /b/undefined with the title
      // gone. The same shape as the forum sheet next door.
      if (made.published === false) {
        setBlocked(reasonSentence(made.reason_codes));
        setBusy(false);
        return;
      }
      router.push("/b/" + made.storyboard_id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={styles.head}>
        <span className={styles.wordmark}>Fencepost</span>
        {/* The one way in to your own account page. Before this the handle sat here as
            static text, so a visitor could read the name this browser had invented for
            them and had nowhere at all to go with it. */}
        <a className={styles.who} href="/you" aria-label="You">
          <span className={styles.initials} aria-hidden="true">
            {initials(who?.handle)}
          </span>
          {who?.handle || ""}
        </a>
      </div>

      <div className={ui.body}>
        <h1 className={styles.title}>My storyboards</h1>

        <ErrorNote className={styles.empty}>{error}</ErrorNote>
        {!boards && !error ? <p className={styles.empty}>Loading…</p> : null}

        {boards ? (
          <>
            <div className={ui.kicker} style={{ marginTop: 0 }}>Active</div>
            {boards.active.length === 0 ? (
              <p className={styles.empty}>Nothing on the go. Start one below.</p>
            ) : (
              boards.active.map((b) => <Card key={b.id} board={b} />)
            )}

            <div className={ui.kicker}>Past</div>
            {boards.past.length === 0 ? (
              <p className={styles.empty}>Nothing here yet.</p>
            ) : (
              boards.past.map((b) => <Card key={b.id} board={b} past />)
            )}
          </>
        ) : null}

        {/* Where a short code is typed (#54): three words read off a neighbour's screen.
            Sent as typed; the server knows the word list and does the tidying. */}
        <form className={styles.codeForm}
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) router.push("/c/" + encodeURIComponent(code.trim()));
              }}>
          <label htmlFor="have-code" className={ui.kicker}>{COPY.haveCode}</label>
          <p id="have-code-hint" className={styles.codeHint}>{COPY.haveCodeHint}</p>
          <div className={styles.codeRow}>
            <input id="have-code" className={styles.codeInput} value={code}
                   onChange={(e) => setCode(e.target.value)} maxLength={64}
                   autoComplete="off" autoCapitalize="none" spellCheck={false}
                   aria-describedby="have-code-hint" placeholder="wattle moon possum" />
            <button type="submit" className={styles.codeGo} disabled={!code.trim()}>
              {COPY.haveCodeGo}
            </button>
          </div>
        </form>
      </div>

      <div className={styles.newWrap}>
        <button type="button" className={styles.new} onClick={() => setNewOpen(true)}
                aria-label="New storyboard">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.75" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      <p className={styles.mode}>
        {MODE === "fixtures"
          ? "fixtures — nothing leaves this browser"
          : assistantIsLive
            ? "live — the assistant is answering for real"
            : "live storyboards · Possum Help is running from fixtures"}
        {" · "}
        {/* Attribution is a condition of CC BY-SA, so this link cannot live only in the README */}
        <a href="/credits" className={styles.credits}>Image credits</a>
      </p>

      {newOpen ? (
        <Sheet onClose={() => setNewOpen(false)} labelledBy="new-title">
          <h2 id="new-title" className={ui.sheetTitle}>New storyboard</h2>
          <label htmlFor="sb-title" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Title</label>
          {/* Capped where the server caps it, so nobody types past a limit they cannot
              see and then meets a 400 that explains nothing. */}
          <input id="sb-title" value={title}
                 onChange={(e) => { setTitle(e.target.value); setBlocked(null); }}
                 maxLength={120}
                 placeholder="The one in the jacaranda"
                 style={{
                   width: "100%", height: 48, padding: "0 16px", marginTop: 6,
                   borderRadius: 999, border: "1px solid var(--line)",
                   background: "var(--bg)", color: "var(--text)", fontSize: 15,
                 }} />
          {blocked ? (
            <>
              <p className={styles.refused}>{blocked}</p>
              <p className={styles.blockedQuiet}>{COPY.blockedKept}</p>
            </>
          ) : null}
          <button type="button" className={ui.btn} style={{ marginTop: 20 }}
                  disabled={!title.trim() || busy} onClick={create}>
            {busy ? "Creating…" : "Create"}
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}

function Card({ board, past }) {
  // entry_count and latest_species really do come from dashboard; participants and suburb
  // do not, so they are not drawn. The cover follows the species of the most recent
  // sighting — in the real product this is a still from that video. With no entries yet,
  // or a most recent one that is other or unknown, there is no cover and a patch of night
  // stays: dropping any possum in would assert on the user's behalf what they filmed.
  const cover = frameForSpecies(board.latest_species, board.id);
  return (
    <a href={"/b/" + board.id} className={[styles.card, past ? styles.cardPast : ""].join(" ")}>
      <div style={{ opacity: past ? 0.62 : 1 }}>
        <Shot src={cover?.file} alt={cover?.alt} graded={cover ? !cover.night : false}
              height={past ? 110 : 148} radius="none" />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.titleRow}>
          <span className={past ? styles.cardTitlePast : styles.cardTitle}>{board.title}</span>
          {past ? <span className={styles.readonly}>Read-only</span> : null}
        </div>
        <div className={styles.meta}>
          <span>{board.entry_count === 1 ? "1 sighting" : board.entry_count + " sightings"}</span>
          <span className={styles.dot} />
          <span>{relative(board.last_entry_at)}</span>
        </div>
      </div>
    </a>
  );
}
