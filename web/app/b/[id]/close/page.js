"use client";

// owner 主动完结一个故事版，并留一句结语（user-flow §9）。
//
// 为什么是单独一屏，不是一个确认弹窗：这件事不可逆，而且它会顺手删掉这个故事版上的
// 助手对话（db.close_storyboard 里那条 DELETE）。四条后果要摆出来给人读完，
// 弹窗放不下，也不该让人在一个盖住内容的小框里做这种决定。
//
// 这一屏还刻意说了「你不必这么做」：30 天没动静会自动转只读。完结是给「这件事结束了」
// 这样的时刻用的，不是一项维护义务。

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { storyboard, isOwner, closeStoryboard, isArchived } from "../../../../lib/api";
import { COPY } from "../../../../lib/copy";
import { BackButton, ui } from "../../../../components/ui";
import styles from "./close.module.css";

const NOTE_LIMIT = 280;      // 和服务端 _plain_text(..., 280) 对齐

export default function CloseStoryboard({ params }) {
  const { id } = use(params);
  const router = useRouter();

  const [view, setView] = useState(null);
  const [allowed, setAllowed] = useState(null);   // null=还不知道，true/false=知道了
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    storyboard(id).then(
      async (got) => {
        if (!live) return;
        setView(got);
        // 已经归档的也当作不允许：服务端其实会让 owner 再关一次，而那会**悄悄盖掉
        // 上一句结语**。这是这一屏唯一一处比服务端更紧的地方，方向是安全的那一边。
        const owner = await isOwner(id, got.level);
        if (live) setAllowed(owner && !isArchived(got.status));
      },
      (e) => { if (live) setError(e.message); },
    );
    return () => { live = false; };
  }, [id]);

  // 不该来的人别停在这一屏上。没有专门的拒绝态——这不是「你没有权限」，
  // 而是「这里没有这个东西」，送回故事版就好。
  useEffect(() => {
    if (allowed === false) router.replace("/b/" + id);
  }, [allowed, id, router]);

  async function close() {
    setBusy(true);
    try {
      await closeStoryboard({ storyboardId: id, closedNote: note.trim() || undefined });
      router.replace("/b/" + id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const left = NOTE_LIMIT - note.length;

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/b/" + id)} />
        <span className={ui.barTitle}>{view?.title || ""}</span>
      </div>

      <div className={ui.body}>
        {error ? <p className={styles.error}>{error}</p> : null}
        {allowed !== true ? (
          <p className={styles.quiet}>Loading…</p>
        ) : (
          <>
            <h1 className={styles.title}>{COPY.closeTitle}</h1>
            <p className={styles.lede}>{COPY.closeLede}</p>

            <ul className={styles.points}>
              {COPY.closePoints.map((point) => (
                <li key={point} className={styles.point}>{point}</li>
              ))}
            </ul>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="closing-note">
                {COPY.closeNoteLabel}
              </label>
              <textarea
                id="closing-note"
                className={styles.input}
                rows={4}
                maxLength={NOTE_LIMIT}
                value={note}
                placeholder={COPY.closeNotePlaceholder}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className={styles.hintRow}>
                <span className={styles.hint}>{COPY.closeNoteHint}</span>
                {/* 只在快到头的时候才出现。一个从头挂到尾的计数器是在催人写短，
                    而这句话本来就没有非写不可的理由。 */}
                {left <= 40 ? <span className={styles.count}>{left}</span> : null}
              </div>
            </div>

            <p className={styles.notRequired}>{COPY.closeNotRequired}</p>
          </>
        )}
      </div>

      {allowed === true ? (
        <div className={ui.footer}>
          <button type="button" className={ui.btn} disabled={busy} onClick={close}>
            {busy ? COPY.closing : COPY.closeStoryboard}
          </button>
          <button type="button" className={styles.cancel} disabled={busy}
                  onClick={() => router.push("/b/" + id)}>
            {COPY.cancel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
