"use client";

// 3 · Pick a frame

import { use, useRef } from "react";
import { useRouter } from "next/navigation";
import { CLIP } from "../../../../../lib/fixtures";
import { COPY } from "../../../../../lib/copy";
import { FRAMES } from "../../../../../lib/frames";
import { BackButton, Steps, ui } from "../../../../../components/ui";
import Shot from "../../../../../components/Shot";
import { useDraft } from "../DraftContext";
import styles from "../add.module.css";

// 这一屏原先画的是四块棕色色块。加进真实素材之后，全站只剩这里还是空的——
// 而这偏偏是「画面」本身就是主角的那一屏。
//
// 用 lib/frames.js 那四张顶上，八个刻度两两对应一张，所以拖动是看得见变化的。
// 它们是**占位**，底下那行字直说了——和分享页那个二维码占位一个路数。
//
// **挑出来的帧不会被带走，这是实情，不是遗漏。** frameIndex 只在这一屏被读：
// 提交时不发，服务端也没有存帧的地方（`videos` 只记 storage_key，而
// 「视觉帧是否落盘」在 CLAUDE.md 里仍是未决项，落盘要加 frames 表和 TTL 任务）。
// 所以文案也改了，不再说「这就是别人会看到的那一帧」——那句话是假的。
function stillFor(index) {
  return FRAMES[Math.floor(index / 2) % FRAMES.length];
}

export default function PickFrame({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const draft = useDraft();
  const track = useRef(null);
  const dragging = useRef(false);

  const frames = CLIP.frames;
  const at = (e) => {
    const box = track.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    return Math.round(frac * (frames.length - 1));
  };

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push(`/b/${id}/add`)} />
      </div>
      <Steps at={1} />

      <div className={ui.body}>
        <h1 className={ui.h1}>Pick a frame</h1>
        <p className={ui.lede} style={{ marginBottom: 18 }}>{COPY.frameLede}</p>

        <Shot src={stillFor(draft.frameIndex).file}
              alt={stillFor(draft.frameIndex).alt}
              graded={!stillFor(draft.frameIndex).night}
              height={206}>
          <span className={styles.stampChip}>{frames[draft.frameIndex].label}</span>
        </Shot>
        <p className={styles.footnote}>{COPY.frameNote}</p>

        <div style={{ marginTop: 20 }}
             onPointerDown={(e) => {
               try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
               dragging.current = true;
               draft.setFrameIndex(at(e));
             }}
             onPointerMove={(e) => dragging.current && draft.setFrameIndex(at(e))}
             onPointerUp={() => { dragging.current = false; }}
             onPointerCancel={() => { dragging.current = false; }}>
          <div ref={track} className={styles.track}>
            <div className={styles.strip}>
              {frames.map((f, i) => (
                <span key={f.t} className={styles.cell}
                      style={{ backgroundImage: `url(${stillFor(i).file})`,
                               backgroundSize: "cover", backgroundPosition: "center",
                               opacity: i === draft.frameIndex ? 1 : 0.45 }} />
              ))}
            </div>
            <div className={styles.scrub}
                 style={{ left: `calc(${(draft.frameIndex / (frames.length - 1)) * 100}% - 9px)` }}>
              <span className={styles.knob} />
              <span className={styles.stem} />
            </div>
          </div>
          <div className={styles.times}>
            <span>0:00</span>
            <span>{frames[frames.length - 1].label}</span>
          </div>
        </div>
      </div>

      <div className={ui.footer}>
        <button type="button" className={ui.btn}
                onClick={() => router.push(`/b/${id}/add/mask`)}>Next</button>
      </div>
    </div>
  );
}
