"use client";

// 1 · My storyboards —— 我有权限的故事版，Active 与 Past 分开。
// Past 里是 readonly 和 archived 两种状态，不是一个叫 past 的状态。

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dashboard, createStoryboard, MODE, assistantIsLive } from "../lib/api";
import { relative } from "../lib/format";
import { Sheet, ui } from "../components/ui";
import styles from "./page.module.css";

export default function Home() {
  const router = useRouter();
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dashboard().then(setBoards, (e) => setError(e.message));
  }, []);

  async function create() {
    setBusy(true);
    try {
      const made = await createStoryboard(title.trim());
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
        <span className={styles.who}>
          <span className={styles.initials} aria-hidden="true">mk</span>
          mel_k
        </span>
      </div>

      <div className={ui.body}>
        <h1 className={styles.title}>My storyboards</h1>

        {error ? <p className={styles.empty}>{error}</p> : null}
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
      </p>

      {newOpen ? (
        <Sheet onClose={() => setNewOpen(false)} labelledBy="new-title">
          <h2 id="new-title" className={ui.sheetTitle}>New storyboard</h2>
          <label htmlFor="sb-title" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>Title</label>
          <input id="sb-title" value={title} onChange={(e) => setTitle(e.target.value)}
                 placeholder="The one in the jacaranda"
                 style={{
                   width: "100%", height: 48, padding: "0 16px", marginTop: 6,
                   borderRadius: 999, border: "1px solid var(--line)",
                   background: "var(--bg)", color: "var(--text)", fontSize: 15,
                 }} />
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
  // entry_count 是 dashboard 真给的；participants 和 suburb 它不给，所以不画。
  return (
    <a href={"/b/" + board.id} className={[styles.card, past ? styles.cardPast : ""].join(" ")}>
      <div style={{ height: past ? 110 : 148, background: "var(--surface-sunken)",
                    opacity: past ? 0.62 : 1 }} />
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
