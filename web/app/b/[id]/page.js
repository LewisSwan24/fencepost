"use client";

// 9 · 故事版详情。时间线、公开的复核标签、讨论区入口、助手抽屉。
//
// 「Being checked by neighbours」是社区投票的结果，不是系统判定，所以人人可见，
// 作者也一样——没有只给作者看的状态，也没有「你被标记了」这种提示。
// 但作者不能给自己的 entry 投票（服务端回 403 not_your_call），所以那两个按钮
// 在自己的条目上根本不出现，而不是点下去吃一个错误。

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { storyboard, isArchived, castVote, me } from "../../../lib/api";
import { SPECIES_LABEL } from "../../../lib/fixtures";
import { COPY } from "../../../lib/copy";
import { stamp, countLabel } from "../../../lib/format";
import { BackButton, ui } from "../../../components/ui";
import Chat from "../../../components/Chat";
import styles from "./page.module.css";

export default function Storyboard({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const query = useSearchParams();
  const justPosted = query.get("posted");
  const viaLink = query.get("via") === "link";

  const [view, setView] = useState(null);
  const [who, setWho] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(Boolean(justPosted));
  const [open, setOpen] = useState(null); // 展开的那条 entry
  const [voted, setVoted] = useState({});
  const [chat, setChat] = useState(false);

  useEffect(() => {
    storyboard(id).then(setView, (e) => setError(e.message));
    me().then(setWho, () => {});
  }, [id]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const archived = view ? isArchived(view.status) : false;
  const entries = view?.entries || [];
  const level = view?.level;
  const canContribute = !archived && level !== "view";
  const canShare = level === "reshare";
  const people = [...new Set(entries.map((e) => e.handle))];

  async function vote(entryId, choice) {
    setVoted((prev) => ({ ...prev, [entryId]: choice }));
    try {
      await castVote(entryId, choice);
    } catch (e) {
      setVoted((prev) => ({ ...prev, [entryId]: undefined }));
      setError(e.message);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        {viaLink ? (
          <span className={styles.shared}>
            Shared with you{level ? " · " + COPY.levelLabel[level] : ""}
          </span>
        ) : (
          <>
            <BackButton onClick={() => router.push("/")} label="All storyboards" />
            <span className={ui.barTitle}>{view?.title || ""}</span>
          </>
        )}
      </div>

      <div className={ui.body}>
        {error ? <p className={styles.quiet}>{error}</p> : null}
        {!view && !error ? <p className={styles.quiet}>Loading…</p> : null}

        {view ? (
          <>
            <div className={styles.cover} />
            <h1 className={styles.title}>{view.title}</h1>
            <div className={styles.meta}>
              <span>{countLabel(entries.length, "sighting", "sightings")}</span>
            </div>
            {/* 参与者从时间线的作者去重来。/api/dashboard 不回 participants，
                照着原型写 view.participants 的话这里永远是空的——而这就是
                「这个故事里有谁」，不是「谁有权限」（那份名单在分享页，且要 reshare 才看得到）。*/}
            {people.length ? (
              <div className={styles.people}>
                {people.map((h) => (
                  <span key={h} className={styles.who}>@{h}</span>
                ))}
              </div>
            ) : null}

            {archived ? <p className={styles.banner}>{COPY.archived}</p> : null}

            <button
              type="button"
              className={styles.forumRow}
              onClick={() => router.push("/b/" + id + "/forum")}
            >
              <span className={styles.forumLabel}>Discussion</span>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>

            <div className={styles.rule} />

            {entries.length === 0 ? (
              <p className={styles.quiet}>Nothing here yet. Yours would be the first.</p>
            ) : (
              entries.map((e) => {
                const mine = who && e.handle === who.handle;
                return (
                  <article
                    key={e.id}
                    className={[styles.entry, e.id === justPosted ? styles.entryNew : ""].join(" ")}
                  >
                    <div className={styles.entryHead}>
                      <span className={styles.handle}>@{e.handle}</span>
                      <span className={styles.dot} />
                      <span className={styles.when}>{stamp(e.created_at)}</span>
                      <span className={styles.species}>
                        {SPECIES_LABEL[e.species] || "Not sure"}
                      </span>
                    </div>
                    <div className={styles.shot} />

                    {e.being_checked ? (
                      <div className={styles.checked}>
                        <button
                          type="button"
                          className={styles.checkedHead}
                          aria-expanded={open === e.id}
                          onClick={() => setOpen(open === e.id ? null : e.id)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                               strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 8v4M12 16h.01" />
                            <circle cx="12" cy="12" r="9" />
                          </svg>
                          {COPY.checkedLabel}
                        </button>
                        {open === e.id ? (
                          <div className={styles.checkedBody}>
                            <p className={styles.checkedText}>{COPY.checkedBody}</p>
                            {/* 只读的人不参与复核——服务端回 read_only_access，
                                理由是「这是贡献者之间的事」。界面照这个来，
                                不要给一个按下去必然被拒的按钮。 */}
                            {mine || !canContribute ? null : voted[e.id] ? (
                              <p className={styles.thanks}>
                                {voted[e.id] === "looks_right"
                                  ? "You said it looks right."
                                  : "Noted — thanks."}
                              </p>
                            ) : (
                              <div className={styles.votes}>
                                <button type="button" className={styles.vote}
                                        onClick={() => vote(e.id, "looks_right")}>
                                  {COPY.checkedYes}
                                </button>
                                <button type="button" className={styles.vote}
                                        onClick={() => vote(e.id, "worth_checking")}>
                                  {COPY.checkedNo}
                                </button>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {e.fun_fact ? (
                      <div className={styles.fact}>
                        <div className={styles.factKicker}>Fun fact</div>
                        <div className={styles.factText}>{e.fun_fact}</div>
                      </div>
                    ) : null}
                    <p className={styles.story}>{e.story}</p>
                  </article>
                );
              })
            )}
          </>
        ) : null}
      </div>

      {view ? (
        <div className={[ui.footer, ui.footerSticky].join(" ")}>
          {canContribute ? (
            <button type="button" className={ui.btn} onClick={() => router.push("/b/" + id + "/add")}>
              {COPY.addSighting}
            </button>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.action} onClick={() => setChat(true)}>
              {COPY.askAssistant}
            </button>
            {canShare ? (
              <button type="button" className={styles.action}
                      onClick={() => router.push("/b/" + id + "/share")}>
                Share
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {chat ? <Chat storyboardId={id} onClose={() => setChat(false)} /> : null}
      {toast ? <div className={styles.toast}>{COPY.posted}</div> : null}
    </div>
  );
}
