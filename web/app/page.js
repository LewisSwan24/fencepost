"use client";

// 这不是产品界面，是一个把整条契约从浏览器里走一遍的验证台：
// 换令牌、建故事版、发 entry、读时间线、和助手流式对话、开讨论串。
//
// 真正的界面来自 Claude Design 的原型，核验通过之后再复刻。在那之前，这一页存在的意义
// 是证明两个 Vercel 专案的形状跑得通：跨域、鉴权、SSE 都过得去。

import { useState } from "react";
import { BASE, MODE, call, get, streamAssistant } from "../lib/api";

const SPECIES = ["brushtail", "ringtail", "other", "unknown"];

function Panel({ title, children }) {
  return (
    <section style={{ border: "1px solid #d8d3cc", borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px", letterSpacing: 0.2 }}>{title}</h2>
      {children}
    </section>
  );
}

const input = { padding: "6px 8px", border: "1px solid #c9c4bd", borderRadius: 5, font: "inherit" };
const button = { ...input, cursor: "pointer", background: "#f3f0ec" };

export default function Harness() {
  const [handle, setHandle] = useState("neighbour-a");
  const [session, setSession] = useState(null);
  const [board, setBoard] = useState(null);
  const [story, setStory] = useState("One on the fence at eleven, stared at me for a while.");
  const [species, setSpecies] = useState("ringtail");
  const [entries, setEntries] = useState([]);
  const [question, setQuestion] = useState("Is the ringtail the one with the curly tail?");
  const [answer, setAnswer] = useState("");
  const [threads, setThreads] = useState([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const token = session?.token;

  async function run(what, job) {
    setBusy(true);
    setNote(what + "…");
    try {
      const result = await job();
      setNote(what + " ✓");
      return result;
    } catch (error) {
      setNote(what + " ✗ " + error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Fencepost harness</h1>
      <p style={{ color: "#6b645c", marginTop: 0 }}>
        {MODE === "fixtures" ? "fixtures — nothing leaves this browser" : "live — " + BASE}
        {note ? " · " + note : ""}
      </p>

      <Panel title="1. Session">
        <input style={input} value={handle} onChange={(e) => setHandle(e.target.value)} />{" "}
        <button
          style={button}
          disabled={busy}
          onClick={() =>
            run("session", async () => {
              const result = await call("/api/session", { body: { handle } });
              setSession(result);
            })
          }
        >
          Get a token
        </button>
        {session ? (
          <p style={{ color: "#6b645c" }}>
            {session.handle} · token {String(session.token).slice(0, 12)}…
          </p>
        ) : null}
      </Panel>

      <Panel title="2. Storyboard">
        <button
          style={button}
          disabled={!token || busy}
          onClick={() =>
            run("storyboard", async () => {
              const result = await call("/api/storyboards", {
                body: { title: "Fence at number 12" },
                token,
              });
              setBoard(result.storyboard_id);
            })
          }
        >
          Create
        </button>{" "}
        <button
          style={button}
          disabled={!token || busy}
          onClick={() => run("dashboard", () => get("/api/dashboard", token))}
        >
          Dashboard
        </button>
        {board ? <p style={{ color: "#6b645c" }}>storyboard {board}</p> : null}
      </Panel>

      <Panel title="3. Entry">
        <select style={input} value={species} onChange={(e) => setSpecies(e.target.value)}>
          {SPECIES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>{" "}
        <input
          style={{ ...input, width: 380 }}
          value={story}
          onChange={(e) => setStory(e.target.value)}
        />{" "}
        <button
          style={button}
          disabled={!board || busy}
          onClick={() =>
            run("entry", () =>
              call("/api/entries", { body: { storyboard_id: board, species, story }, token })
            )
          }
        >
          Post
        </button>{" "}
        <button
          style={button}
          disabled={!board || busy}
          onClick={() =>
            run("timeline", async () => {
              const view = await get("/api/timeline?storyboard_id=" + board, token);
              setEntries(view.entries);
            })
          }
        >
          Timeline
        </button>
        <ul>
          {entries.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.handle}</strong> · {entry.species} — {entry.story}
              {entry.being_checked ? " · being checked" : ""}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="4. Assistant">
        <input
          style={{ ...input, width: 460 }}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />{" "}
        <button
          style={button}
          disabled={!board || busy}
          onClick={() =>
            run("assistant", async () => {
              setAnswer("");
              await streamAssistant({
                token,
                storyboardId: board,
                message: question,
                onDelta: (piece) => setAnswer((soFar) => soFar + piece),
              });
            })
          }
        >
          Ask (streaming)
        </button>
        {answer ? (
          <p style={{ background: "#f7f5f2", padding: 12, borderRadius: 6 }}>{answer}</p>
        ) : null}
      </Panel>

      <Panel title="5. Forum">
        <button
          style={button}
          disabled={!board || busy}
          onClick={() =>
            run("thread", () =>
              call("/api/forum/threads", {
                body: {
                  storyboard_id: board,
                  title: "Who else hears it at 2am",
                  body: "there is something walking on my roof every night",
                },
                token,
              })
            )
          }
        >
          Start a thread
        </button>{" "}
        <button
          style={button}
          disabled={!board || busy}
          onClick={() =>
            run("forum", async () => {
              const view = await get("/api/forum?storyboard_id=" + board, token);
              setThreads(view.threads);
            })
          }
        >
          List threads
        </button>
        <ul>
          {threads.map((thread) => (
            <li key={thread.id}>
              {thread.title} · {thread.handle} · {thread.post_count} posts
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
