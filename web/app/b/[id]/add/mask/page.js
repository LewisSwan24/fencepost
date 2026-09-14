"use client";

// 4 · Mask，外加 5 · Send frame? 那个同意弹窗。
//
// 两件事是硬要求：
//   打码这道门要真算覆盖率，不是点一下就放行；
//   弹窗那两个按钮视觉等重——它们共用同一个 class，不是各写一份样式，
//   这样以后改其中一个也没法把另一个改轻。

import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CLIP } from "../../../../../lib/fixtures";
import { COPY } from "../../../../../lib/copy";
import { identifyFrame } from "../../../../../lib/api";
import { BackButton, Sheet, Steps, Spinner, ui } from "../../../../../components/ui";
import { useDraft } from "../DraftContext";
import styles from "../add.module.css";

const COVERED_ENOUGH = 0.78;

function coverage(target, boxes) {
  let best = 0;
  for (const b of boxes) {
    const ix = Math.max(0, Math.min(b.x + b.w, target.x + target.w) - Math.max(b.x, target.x));
    const iy = Math.max(0, Math.min(b.y + b.h, target.y + target.h) - Math.max(b.y, target.y));
    best = Math.max(best, (ix * iy) / (target.w * target.h));
  }
  return best;
}

export default function Mask({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const canvas = useRef(null);
  const drag = useRef(null);
  const [live, setLive] = useState(null);   // 正在拖的那个框
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);

  const boxes = draft.boxes;
  const drawn = live ? [...boxes, live] : boxes;
  const targets = CLIP.mask_targets.map((t) => ({ ...t, done: coverage(t, drawn) >= COVERED_ENOUGH }));
  const blocked = targets.some((t) => !t.done);

  const pos = (e) => {
    const box = canvas.current.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)),
      y: Math.min(100, Math.max(0, ((e.clientY - box.top) / box.height) * 100)),
    };
  };

  // 拖动中的框放在 ref 里，抬手才提交进 state。
  // 之前的写法在 pointerup 里读渲染闭包的 boxes——真人操作时事件跨任务、中间有重渲染，
  // 读到的是新值所以看不出问题；一旦三个事件落在同一个任务里，读到的是旧数组，
  // 刚画的框会被当成没画出来而删掉。不依赖渲染时机的写法就没有这个「看运气」。
  function down(e) {
    // 合成的指针事件没有活动的 pointerId，捕获会抛 NotFoundError。抓不到就算了：
    // 拖动照常工作，只是手指滑出元素外会断——比整个处理函数当场炸掉好。
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const p = pos(e);
    drag.current = { from: p };
    setLive({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function move(e) {
    if (!drag.current) return;
    const p = pos(e);
    const { from } = drag.current;
    setLive({
      x: Math.min(p.x, from.x), y: Math.min(p.y, from.y),
      w: Math.abs(p.x - from.x), h: Math.abs(p.y - from.y),
    });
  }

  function up() {
    if (!drag.current) return;
    drag.current = null;
    setLive((box) => {
      // 手抖点一下不算一个框
      if (box && box.w >= 5 && box.h >= 5) draft.setBoxes((prev) => [...prev, box]);
      return null;
    });
  }

  async function sendFrame() {
    setSending(true);
    try {
      // 真接口是一次 neighbour 调用，带帧和这一下确认。少了 frame_consent 会被挡回来。
      const answer = await identifyFrame({ storyboardId: id, imageBase64: null });
      draft.setSuggestion(answer.reply);
    } catch {
      draft.setSuggestion(null);   // 认不出来不拦人，照样往下走
    }
    router.push(`/b/${id}/add/species`);
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add/frame`)} />
      </div>
      <Steps at={2} />

      <div className={ui.body}>
        <h1 className={ui.h1}>Mask the frame</h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--accent-hover)", margin: "0 0 16px" }}>
          {COPY.maskLede}
        </p>

        <div ref={canvas} className={styles.canvas}
             onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {targets.map((t) => (
            <span key={t.id} className={styles.target}
                  style={{
                    left: t.x + "%", top: t.y + "%", width: t.w + "%", height: t.h + "%",
                    border: "1px dashed " + (t.done ? "transparent" : "rgba(246,160,107,0.7)"),
                  }}>
              {t.done ? null : <span className={styles.targetLabel}
                                     style={{ color: "var(--accent-hover)" }}>{t.label}</span>}
            </span>
          ))}
          {drawn.map((b, i) => (
            <span key={i} className={styles.box}
                  style={{ left: b.x + "%", top: b.y + "%", width: b.w + "%", height: b.h + "%" }}>
              <button type="button" className={styles.boxKill} aria-label="Remove mask"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        draft.setBoxes(boxes.filter((_, j) => j !== i));
                      }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
          {drawn.length === 0 ? <span className={styles.hint}>{COPY.maskHint}</span> : null}
        </div>
        <p className={styles.footnote} style={{ marginTop: 10 }}>{COPY.maskNote}</p>

        <div className={styles.checklist}>
          {targets.map((t) => (
            <div key={t.id} className={styles.checkRow}>
              <span className={styles.pip}
                    style={{ background: t.done ? "var(--leaf)" : "var(--accent-hover)" }} />
              <span style={{ color: "var(--text-muted)" }}>{t.label}</span>
              <span className={styles.state}
                    style={{ color: t.done ? "var(--leaf)" : "var(--text-dim)" }}>
                {t.done ? "Covered" : "Showing"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className={ui.footer}>
        {blocked ? <p className={styles.blockedNote}>{COPY.maskBlocked}</p> : null}
        <button type="button" className={ui.btn} disabled={blocked}
                onClick={() => setConsent(true)}>Next</button>
      </div>

      {consent ? (
        <Sheet onClose={() => !sending && setConsent(false)} labelledBy="consent-title">
          <h2 id="consent-title" className={ui.sheetTitle}>{COPY.consentTitle}</h2>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text-body)", margin: "0 0 16px" }}>
            {COPY.consentBody}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 24px",
                       display: "flex", flexDirection: "column", gap: 9 }}>
            {COPY.consentPoints.map((point) => (
              <li key={point} style={{ display: "flex", gap: 10, fontSize: 13.5,
                                       lineHeight: 1.5, color: "var(--text-muted)" }}>
                <span style={{ color: "var(--accent-hover)" }} aria-hidden="true">·</span>
                {point}
              </li>
            ))}
          </ul>
          {sending ? (
            <Spinner label="Sending one frame" />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* 同一个 class，同一个尺寸。谁也不比谁轻。 */}
              <button type="button" className={ui.btnQuiet} onClick={sendFrame}>
                {COPY.consentSend}
              </button>
              <button type="button" className={ui.btnQuiet}
                      onClick={() => router.push(`/b/${id}/add/species`)}>
                {COPY.consentSkip}
              </button>
            </div>
          )}
        </Sheet>
      ) : null}
    </div>
  );
}
