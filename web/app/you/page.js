"use client";

// Your own account page. Not a profile.
//
// CLAUDE.md rules out points, streaks, badges and leaderboards, and the reason given is
// that they characterise contributors. That reason applies to a page as much as to a
// number: the moment this shows what somebody has done in a way another person could read,
// it has become the thing that was ruled out. So everything here is about you, visible
// only to you, and never comparative — who you are, what you can reach, and how to leave.
//
// It works for a guest as well as for an account, which is the whole point of having it.
// Until now a visitor's identity was a name this browser invented, shown once in a corner
// of the dashboard, with nowhere to see it, change it or leave it behind.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { dashboard, signOut, whoAmI } from "../../lib/api";
import { COPY } from "../../lib/copy";
import { initials } from "../../lib/format";
import { BackButton, ui } from "../../components/ui";
import styles from "./you.module.css";

export default function You() {
  const router = useRouter();
  const [who, setWho] = useState(null);
  const [boards, setBoards] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    whoAmI().then(setWho, (e) => setError(e.message));
    // The same call the dashboard makes. What it adds here is the level on each one, which
    // is the only place a person can see what they are actually allowed to do and where.
    dashboard().then(
      (view) => setBoards([...(view.active || []), ...(view.past || [])]),
      () => setBoards([])
    );
  }, []);

  function leave() {
    signOut();
    router.replace("/");
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/")} label="All storyboards" />
      </div>

      <div className={ui.body}>
        <div className={styles.identity}>
          <span className={styles.initials} aria-hidden="true">{initials(who?.handle)}</span>
          <div>
            <div className={styles.handle}>{who?.handle || " "}</div>
            <div className={styles.kind}>
              {who ? (who.account ? "Signed in" : COPY.guestTitle) : ""}
            </div>
          </div>
        </div>

        {error ? <p className={styles.error}>{error}</p> : null}

        {who && !who.account ? (
          <>
            <p className={styles.body}>{COPY.guestBody}</p>
            <button type="button" className={ui.btn} onClick={() => router.push("/sign-in")}>
              {COPY.signInTitle}
            </button>
          </>
        ) : null}

        <h2 className={styles.section}>{COPY.accessTitle}</h2>
        {boards === null ? null : boards.length === 0 ? (
          <p className={styles.body}>{COPY.accessEmpty}</p>
        ) : (
          <ul className={styles.list}>
            {boards.map((board) => (
              <li key={board.id} className={styles.row}>
                <a className={styles.name} href={"/b/" + board.id}>
                  {board.title || "Untitled"}
                </a>
                <span className={styles.level}>
                  {COPY.levelLabel[board.level] || board.level}
                  {board.status && board.status !== "active" ? " · past" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        {who && who.account ? (
          <button type="button" className={styles.leave} onClick={leave}>
            {COPY.signOut}
          </button>
        ) : null}
      </div>
    </div>
  );
}
