"use client";

// 10 · The Possum Help conversation.
//
// No avatar, no name bubble, no anthropomorphic typing animation — it is a plain
// conversation area. The first thing said is always the AI disclosure. The four demo
// scripts are tappable questions, to save typing them in the room.

import { useEffect, useRef, useState } from "react";
import { askAssistant, assistantOffline, assistantIsLive } from "../lib/api";
import { ASSISTANT_DISCLOSURE, ASSISTANT_SCRIPT } from "../lib/fixtures";
import { COPY } from "../lib/copy";
import { endStudy, studyRecord } from "../lib/study";
import { Sheet, Spinner, ui } from "./ui";
import styles from "./Chat.module.css";

export default function Chat({ storyboardId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [offline, setOffline] = useState(assistantOffline);
  const [studying, setStudying] = useState(() => !assistantIsLive && studyRecord() !== null);
  const [optedOut, setOptedOut] = useState(false);
  const bottom = useRef(null);
  const field = useRef(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

  function optOut() {
    endStudy();
    setStudying(false);
    setOptedOut(true);
    // The button goes with the notice; without this, focus falls to body, outside the
    // sheet's Tab trap — the same reason the chips hand it to the field.
    field.current?.focus();
  }

  async function ask(text) {
    const question = text.trim();
    if (!question) return;
    setMessages((prev) => [...prev, { from: "me", text: question }]);
    setInput("");
    if (offline) return;
    setThinking(true);
    try {
      const answer = await askAssistant(question, storyboardId);
      setMessages((prev) => [...prev, { from: "it", text: answer.reply }]);
    } catch {
      // If it fails, degrade rather than fabricate a reply; half an answer is a
      // fabrication too (prompts.md §5)
      setOffline(true);
    }
    setThinking(false);
  }

  return (
    <Sheet onClose={onClose} labelledBy="chat-title">
      <h2 id="chat-title" className={ui.sheetTitle} style={{ fontSize: 16, marginBottom: 14 }}>
        Possum Help
      </h2>

      {/* A log, so each reply and the offline notice are read out as they land; without it
          a screen-reader user asked and heard nothing come back (#45). */}
      <div className={styles.log} role="log">
        {offline ? (
          <p className={styles.offline}>{COPY.assistantOffline}</p>
        ) : (
          <>
            <p className={styles.disclosure}>
              <strong>{ASSISTANT_DISCLOSURE.lead}</strong>{ASSISTANT_DISCLOSURE.rest}
            </p>
            {/* The demo runs hybrid, and the assistant half comes from fixtures (CLAUDE.md
                decision table: a real model can say something that crosses a red line on
                the spot). That is deliberate, but it cannot be stated only in the home
                page footer — somebody who opens a storyboard directly never sees it. */}
            {assistantIsLive ? null : (
              <p className={styles.canned}>{COPY.assistantCanned}</p>
            )}
            {/* For as long as study mode is noting misses (#52), the person asking is told,
                and can stop it right here. Stopping ends the session and deletes its notes:
                a session is one participant, so what it holds is theirs. Read once on open:
                a session is started from /study, never mid-conversation. */}
            {studying ? (
              <div className={styles.study}>
                <p className={styles.studyText}>{COPY.studyNotice}</p>
                <button type="button" className={styles.studyStop} onClick={optOut}>
                  {COPY.studyOptOut}
                </button>
              </div>
            ) : null}
            {optedOut ? <p className={styles.study}>{COPY.studyOptedOut}</p> : null}
          </>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.from === "me" ? styles.rowMe : styles.rowIt}>
            <span className={m.from === "me" ? styles.me : styles.it}>{m.text}</span>
          </div>
        ))}

        {thinking ? <div className={styles.working}><Spinner label="Working" /></div> : null}
        <span ref={bottom} />
      </div>

      {messages.length === 0 && !offline ? (
        <div className={styles.chips}>
          {ASSISTANT_SCRIPT.map((s) => (
            <button key={s.key} type="button" className={styles.chip}
                    onClick={() => {
                      // The chips go once the conversation starts, taking the focused one
                      // with them; focus would fall to body, outside the sheet's Tab trap.
                      field.current?.focus();
                      ask(s.question);
                    }}>
              {s.question}
            </button>
          ))}
        </div>
      ) : null}

      <form className={styles.compose}
            onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input ref={field} className={styles.input} value={input} onChange={(e) => setInput(e.target.value)}
               placeholder="Ask about the one you filmed" aria-label="Ask Possum Help" />
        <button type="submit" className={styles.send} disabled={!input.trim()} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h13M12 5l7 7-7 7" />
          </svg>
        </button>
      </form>
    </Sheet>
  );
}
