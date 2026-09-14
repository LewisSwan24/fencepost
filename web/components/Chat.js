"use client";

// 10 · Possum Help 对话。
//
// 没有头像、没有名字气泡、没有拟人化的打字动画——它是一块朴素的对话区。
// 第一句永远是 AI 披露。四条演示脚本做成可点的问题，省得现场手打。

import { useEffect, useRef, useState } from "react";
import { askAssistant, assistantOffline, assistantIsLive } from "../lib/api";
import { ASSISTANT_DISCLOSURE, ASSISTANT_SCRIPT } from "../lib/fixtures";
import { COPY } from "../lib/copy";
import { Sheet, Spinner, ui } from "./ui";
import styles from "./Chat.module.css";

export default function Chat({ storyboardId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [offline, setOffline] = useState(assistantOffline);
  const bottom = useRef(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, thinking]);

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
      // 挂了就转降级态，不伪造回复——半个回答也是伪造（prompts.md §5）
      setOffline(true);
    }
    setThinking(false);
  }

  return (
    <Sheet onClose={onClose} labelledBy="chat-title">
      <h2 id="chat-title" className={ui.sheetTitle} style={{ fontSize: 16, marginBottom: 14 }}>
        Possum Help
      </h2>

      <div className={styles.log}>
        {offline ? (
          <p className={styles.offline}>{COPY.assistantOffline}</p>
        ) : (
          <>
            <p className={styles.disclosure}>
              <strong>{ASSISTANT_DISCLOSURE.lead}</strong>{ASSISTANT_DISCLOSURE.rest}
            </p>
            {/* 答辩跑的是 hybrid，助手那一半走 fixture（CLAUDE.md 决策表：真模型有概率
                当场说出违反红线的话）。这是刻意的，但不能只写在首页页脚—— 
                直接点进来的人看不到那行字。 */}
            {assistantIsLive ? null : (
              <p className={styles.canned}>{COPY.assistantCanned}</p>
            )}
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
            <button key={s.key} type="button" className={styles.chip} onClick={() => ask(s.question)}>
              {s.question}
            </button>
          ))}
        </div>
      ) : null}

      <form className={styles.compose}
            onSubmit={(e) => { e.preventDefault(); ask(input); }}>
        <input className={styles.input} value={input} onChange={(e) => setInput(e.target.value)}
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
