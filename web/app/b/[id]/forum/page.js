"use client";

// 11 · Forum。故事版下面的讨论。
//
// 这里没有助手，一个入口都没有。不是忘了放——论坛帖子和 entry 是分开的两张表、
// 两组端点，助手的上下文物理上够不到这里（data-model §2）。界面上也不该出现
// 任何暗示它能读到这些的东西。

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { forumThreads, createThread } from "../../../../lib/api";
import { COPY } from "../../../../lib/copy";
import { relative, countLabel } from "../../../../lib/format";
import { BackButton, Sheet, ui } from "../../../../components/ui";
import styles from "./forum.module.css";

export default function Forum({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    forumThreads(id).then((view) => setThreads(view.threads), (e) => setError(e.message));
  }, [id]);

  async function start() {
    setBusy(true);
    try {
      const made = await createThread({ storyboardId: id, title: title.trim(), body: body.trim() });
      router.push("/b/" + id + "/forum/" + made.thread_id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/b/" + id)} />
        <span className={ui.barTitle}>{COPY.discussion}</span>
      </div>

      <div className={ui.body}>
        <h1 className={styles.title}>{COPY.discussion}</h1>
        <p className={styles.lede}>Everything that isn&apos;t a sighting.</p>

        {error ? <p className={styles.error}>{error}</p> : null}
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

      <div className={ui.footer}>
        <button type="button" className={ui.btn} onClick={() => setOpen(true)}>
          {COPY.newThread}
        </button>
      </div>

      {open ? (
        <Sheet onClose={() => !busy && setOpen(false)} labelledBy="thread-title">
          <h2 id="thread-title" className={ui.sheetTitle}>{COPY.newThread}</h2>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="t-title">Title</label>
            <input id="t-title" className={styles.input} value={title}
                   onChange={(e) => setTitle(e.target.value)}
                   placeholder="What actually keeps them out of the roof?" />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="t-body">Your message</label>
            <textarea id="t-body" className={styles.input} rows={5} value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="In your own words" />
          </div>
          <button type="button" className={ui.btn}
                  disabled={!title.trim() || !body.trim() || busy} onClick={start}>
            {busy ? "Posting…" : "Post"}
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}
