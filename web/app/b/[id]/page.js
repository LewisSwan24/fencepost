"use client";

// 9 · 故事版详情。时间线、公开的复核标签、讨论区入口、助手抽屉。
//
// 「Being checked by neighbours」是社区投票的结果，不是系统判定，所以人人可见，
// 作者也一样——没有只给作者看的状态，也没有「你被标记了」这种提示。
// 但作者不能给自己的 entry 投票（服务端回 403 not_your_call），所以那两个按钮
// 在自己的条目上根本不出现，而不是点下去吃一个错误。

import { use, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { storyboard, isArchived, castVote, me, editEntry, deleteEntry, isOwner } from "../../../lib/api";
import { SPECIES_LABEL } from "../../../lib/fixtures";
import { COPY, reasonSentence } from "../../../lib/copy";
import { stamp, countLabel } from "../../../lib/format";
import { BackButton, Sheet, ui } from "../../../components/ui";
import Chat from "../../../components/Chat";
import Shot from "../../../components/Shot";
import { frameFor } from "../../../lib/frames";
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
  const [editing, setEditing] = useState(null);    // {id, funFact, story, species, codes}
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [owner, setOwner] = useState(false);

  function load() {
    storyboard(id).then(setView, (e) => setError(e.message));
  }

  useEffect(() => {
    load();
    me().then(setWho, () => {});
  }, [id]);

  // 完结只有 owner 能做（服务端回 not_the_owner），而 owner 一定是 reshare 档。
  useEffect(() => {
    if (!view?.level) return;
    isOwner(id, view.level).then(setOwner, () => {});
  }, [id, view?.level]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(timer);
  }, [note]);

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

  // 改动是否真的存在，要和服务端算 changed 的方式一致（app.py edit_entry）：
  // 空字符串等于「这一项别动」，不是「清空它」。
  function changed(draft) {
    const row = entries.find((e) => e.id === draft.id) || {};
    const ff = draft.funFact.trim();
    const st = draft.story.trim();
    return (ff && ff !== (row.fun_fact || "")) || (st && st !== (row.story || ""));
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const ff = editing.funFact.trim();
      const st = editing.story.trim();
      const result = await editEntry({
        entryId: editing.id,
        funFact: ff || undefined,
        story: st || undefined,
      });
      // 被 Screener 拒掉回的是 200 带 published:false —— catch 接不到它。
      // 库里那一条一个字没动，所以面板不关，字也不清。
      if (result.published === false) {
        setEditing({ ...editing, codes: result.reason_codes || [] });
        setBusy(false);
        return;
      }
      setEditing(null);
      setNote(result.unchanged ? COPY.noChanges : null);
      load();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirming) return;
    setBusy(true);
    try {
      await deleteEntry(confirming);
      setConfirming(null);
      setNote(COPY.deleted);
      load();          // 计数、参与者、封面都跟着这一次重取变
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
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
            {/* 这里原本还有一张封面。它取的是第一条配得到图的 entry，于是只有一条
                目击的时候，同一张照片在一屏里出现两次，看着像坏的。封面留在列表卡片上
                ——那儿它是唯一的一张；这一页的画面属于每一条 entry 自己。 */}
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

            {archived ? (
              <>
                <p className={styles.banner}>{view.closed_note ? COPY.closed : COPY.archived}</p>
                {/* 结语。owner 完结时写的那句，写的时候说的是「留给所有参与过的人」，
                    所以它必须有人读得到——在此之前它只存不读。 */}
                {view.closed_note ? (
                  <blockquote className={styles.closedNote}>
                    <p className={styles.closedNoteText}>{view.closed_note}</p>
                    <cite className={styles.closedNoteFrom}>{COPY.closedNoteFrom}</cite>
                  </blockquote>
                ) : null}
              </>
            ) : null}

            {/* 待核实。只有贡献者以上看得到——服务端对 view 档回 read_only_access，
                理由是「复核是贡献者之间的事」。刻意**不**按归档状态收：review_queue、
                cast_review_vote、dispose_entry 三个都不查 storyboard_status，
                归档的故事版上这些照样能做，藏起来就是界面在另一个方向上撒谎。 */}
            {level && level !== "view" ? (
              <button
                type="button"
                className={styles.forumRow}
                onClick={() => router.push("/b/" + id + "/review")}
              >
                <span className={styles.forumLabel}>{COPY.secondLookNav}</span>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ) : null}

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
                // 服务端比的是 author_id（app.py 的 _own_editable_entry），界面也照它来。
                // handle 在库里虽然唯一，但它不是主键，不该被当成主键用。
                // fixtures 的行没有 author_id，所以留一条 handle 的退路。
                const mine = !!who && (e.author_id ? e.author_id === who.user_id
                                                   : e.handle === who.handle);
                const frame = frameFor(e);
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
                    <Shot src={frame?.file} alt={frame?.alt}
                          graded={frame ? !frame.night : false} height={170} />

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
                                {voted[e.id] === "looks_right" ? COPY.votedYes : COPY.votedNo}
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
                    {/* 只有作者看得到，而且故事版归档后没有——服务端对归档的回
                        storyboard_closed，改和删都不收。 */}
                    {mine && !archived ? (
                      <div className={styles.own}>
                        <button type="button" className={styles.ownBtn}
                                onClick={() => setEditing({
                                  id: e.id, funFact: e.fun_fact || "", story: e.story || "",
                                  species: e.species, codes: null,
                                })}>
                          {COPY.editEntry}
                        </button>
                        <button type="button" className={styles.ownBtn}
                                onClick={() => setConfirming(e.id)}>
                          {COPY.deleteEntry}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })
            )}

            {/* 完结的入口放在时间线末尾，不放页脚：它罕用、只有 owner 有、而且不可逆，
                不该和「Add your sighting」并排。归档之后也不再出现——服务端其实允许
                owner 再关一次，但那会悄悄盖掉上一句结语。 */}
            {owner && !archived ? (
              <button type="button" className={styles.closeRow}
                      onClick={() => router.push("/b/" + id + "/close")}>
                {COPY.closeStoryboard}
              </button>
            ) : null}
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

      {editing ? (
        <Sheet onClose={() => !busy && setEditing(null)} labelledBy="edit-title">
          <h2 id="edit-title" className={ui.sheetTitle}>{COPY.editTitle}</h2>
          {/* 物种是只读的。服务端的 edit handler 根本不读请求体里的 species，
              而「视觉识别不得自动设定物种」那条红线的另一面是：物种归当初选它的那一步。 */}
          <p className={styles.editSpecies}>
            {SPECIES_LABEL[editing.species] || "Not sure"}
          </p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="edit-fact">Fun fact</label>
            <textarea id="edit-fact" className={styles.input} rows={3} value={editing.funFact}
                      onChange={(ev) => setEditing({ ...editing, funFact: ev.target.value, codes: null })} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="edit-story">What happened</label>
            <textarea id="edit-story" className={styles.input} rows={6} value={editing.story}
                      onChange={(ev) => setEditing({ ...editing, story: ev.target.value, codes: null })} />
          </div>
          <p className={styles.quiet}>{COPY.editHint}</p>
          {editing.codes ? (
            <div className={styles.rejected}>
              <div className={styles.rejectedHead}>{COPY.editNotSaved}</div>
              <p className={styles.rejectedText}>{reasonSentence(editing.codes)}</p>
              <p className={styles.quiet}>{COPY.editOriginalKept}</p>
            </div>
          ) : null}
          <button type="button" className={ui.btn} style={{ marginTop: 16 }}
                  disabled={busy || !changed(editing)} onClick={save}>
            {busy ? COPY.saving : COPY.saveChanges}
          </button>
          <button type="button" className={styles.sheetQuiet}
                  disabled={busy} onClick={() => setEditing(null)}>
            {COPY.cancel}
          </button>
        </Sheet>
      ) : null}

      {confirming ? (
        <Sheet onClose={() => !busy && setConfirming(null)} labelledBy="del-title">
          <h2 id="del-title" className={ui.sheetTitle}>{COPY.deleteTitle}</h2>
          <p className={styles.quiet}>{COPY.deleteBody}</p>
          <button type="button" className={ui.btn} style={{ marginTop: 18 }}
                  disabled={busy} onClick={remove}>
            {busy ? COPY.saving : COPY.deleteConfirm}
          </button>
          <button type="button" className={styles.sheetQuiet}
                  disabled={busy} onClick={() => setConfirming(null)}>
            {COPY.cancel}
          </button>
        </Sheet>
      ) : null}

      {chat ? <Chat storyboardId={id} onClose={() => setChat(false)} /> : null}
      {toast ? <div className={styles.toast}>{COPY.posted}</div> : null}
      {note ? <div className={styles.toast}>{note}</div> : null}
    </div>
  );
}
