"use client";

// 待核实队列（operations.md §2）。两件事在这一屏发生：贡献者投第一票，owner 拿主意。
//
// **这一屏是必须的，不是补充。** 故事版详情页上那两个投票按钮挂在 `being_checked` 下面，
// 而 `being_checked` 要凑够两票 `worth_checking` 才会为真——也就是说没有这一屏，
// 第一票根本无处可投，那两个按钮永远不会出现。复核这条链在产品里原本是断的。
//
// 三条红线在这里同时成立，而且都不是靠界面藏：
//   · 看不到自己的条目 —— 服务端 SQL 里就写着 e.author_id != viewer
//   · 看不到作者是谁   —— 返回的字段里根本没有 handle 或 author_id
//   · 看不到谁投了票   —— 只回票数
// 界面能泄漏的前提是数据到了界面上。这里数据就没来。
//
// 还有一件刻意的事：**不把 Screener 的 reason code 摆给复核的人看。** 告诉邻居
// 「该重读哪一段」，而不是「模型判了 pii」。后者等于请邻居当审查员，
// 而 Screener 连文采与价值都不判（CLAUDE.md 决策表）。

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewQueue, castVote, disposeEntry, storyboard, isOwner } from "../../../../lib/api";
import { SPECIES_LABEL } from "../../../../lib/fixtures";
import { COPY } from "../../../../lib/copy";
import { stamp } from "../../../../lib/format";
import { BackButton, Sheet, ui } from "../../../../components/ui";
import styles from "./review.module.css";

// 哪一段被挑出来了。fields 是 fun_fact / story 的组合。
function whichPart(fields) {
  const list = fields || [];
  const fact = list.includes("fun_fact");
  const story = list.includes("story");
  if (fact && story) return COPY.secondLookBoth;
  return fact ? COPY.secondLookFact : COPY.secondLookStory;
}

export default function Review({ params }) {
  const { id } = use(params);
  const router = useRouter();

  const [items, setItems] = useState(null);
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState(null);
  const [voted, setVoted] = useState({});
  const [done, setDone] = useState({});
  const [confirming, setConfirming] = useState(null);   // {entryId, action}
  const [busy, setBusy] = useState(false);

  function load() {
    reviewQueue(id).then((view) => setItems(view.items), (e) => setError(e.message));
  }

  useEffect(() => {
    load();
    storyboard(id).then((got) => isOwner(id, got.level).then(setOwner, () => {}), () => {});
  }, [id]);

  async function vote(entryId, choice) {
    setVoted((prev) => ({ ...prev, [entryId]: choice }));
    try {
      await castVote(entryId, choice);
      // 这里刻意**不**重取队列。投完要出现的那句话挂在这一行上，而重取会把这一行
      // 抽走——够两票的时候 cast_vote 当场结算，它就不在队列里了。于是投下决定性
      // 那一票的人什么也读不到，一行字凭空消失。列表下次进这一屏再取。
    } catch (e) {
      // 最常见的一种：这条 entry 在你读队列和你点下去之间被作者自己删了。
      setVoted((prev) => ({ ...prev, [entryId]: undefined }));
      setError(e.message);
    }
  }

  async function settle(entryId, action) {
    setBusy(true);
    try {
      await disposeEntry(entryId, action);
      setDone((prev) => ({ ...prev, [entryId]: true }));
      setConfirming(null);
      // 同上，而且这里更严重：处置一定把条目移出队列，所以 COPY.disposeDone
      // 那句话一次都没出现过。留着这一行，让它说完再走。
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <div className={ui.screen}>
      <div className={ui.bar}>
        <BackButton onClick={() => router.push("/b/" + id)} />
        <span className={ui.barTitle}>{COPY.secondLookNav}</span>
      </div>

      <div className={ui.body}>
        <h1 className={styles.title}>{COPY.secondLookTitle}</h1>
        <p className={styles.lede}>{COPY.secondLookLede}</p>

        {error ? <p className={styles.error}>{error}</p> : null}
        {!items && !error ? <p className={styles.quiet}>Loading…</p> : null}

        {items?.length === 0 ? <p className={styles.empty}>{COPY.secondLookEmpty}</p> : null}

        {items?.map((item) => (
          <article key={item.entry_id} className={styles.card}>
            <div className={styles.head}>
              {/* 这里没有 @handle。队列里就没有这个字段。 */}
              <span className={styles.when}>{stamp(item.created_at)}</span>
              <span className={styles.species}>
                {SPECIES_LABEL[item.species] || "Not sure"}
              </span>
            </div>

            <p className={styles.which}>{whichPart(item.fields)}</p>

            {item.fun_fact ? (
              <div className={styles.fact}>
                <div className={styles.factKicker}>Fun fact</div>
                <div className={styles.factText}>{item.fun_fact}</div>
              </div>
            ) : null}
            {item.story ? <p className={styles.story}>{item.story}</p> : null}

            {done[item.entry_id] ? (
              <p className={styles.thanks}>{COPY.disposeDone}</p>
            ) : (
              <>
                {voted[item.entry_id] ? (
                  <p className={styles.thanks}>
                    {voted[item.entry_id] === "looks_right" ? COPY.votedYes : COPY.votedNo}
                  </p>
                ) : (
                  <div className={styles.votes}>
                    <button type="button" className={styles.vote}
                            onClick={() => vote(item.entry_id, "looks_right")}>
                      {COPY.checkedYes}
                    </button>
                    <button type="button" className={styles.vote}
                            onClick={() => vote(item.entry_id, "worth_checking")}>
                      {COPY.checkedNo}
                    </button>
                  </div>
                )}

                {/* owner 的最终处置。只有 owner 看得到——服务端对别人回 not_the_owner。 */}
                {owner ? (
                  <div className={styles.owner}>
                    <p className={styles.ownerCall}>{COPY.ownerCall}</p>
                    {/* 「保留」不问第二遍：它不改变任何人看到的东西。另外两个会。 */}
                    <button type="button" className={styles.ownerBtn} disabled={busy}
                            onClick={() => settle(item.entry_id, "kept")}>
                      {COPY.disposeKeep}
                    </button>
                    <button type="button" className={styles.ownerBtn} disabled={busy}
                            onClick={() => setConfirming({ entryId: item.entry_id, action: "labelled" })}>
                      <span>{COPY.disposeLabel}</span>
                      <span className={styles.ownerNote}>{COPY.disposeLabelNote}</span>
                    </button>
                    <button type="button" className={styles.ownerBtn} disabled={busy}
                            onClick={() => setConfirming({ entryId: item.entry_id, action: "removed" })}>
                      {COPY.disposeRemove}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </article>
        ))}

        {items?.length ? <p className={styles.window}>{COPY.secondLookWindow}</p> : null}
      </div>

      {/* 这两个选项一个加上去就撤不掉、一个直接把别人的条目拿下来，是全站风险最高的
          确认框 —— 而它原先是手写的一层 div：没有 role="dialog"，没有名字，Escape
          关不掉，焦点也不进来。改用 Sheet，和「删掉自己那一条」用的是同一件东西。 */}
      {confirming ? (
        <Sheet onClose={() => !busy && setConfirming(null)} labelledBy="dispose-confirm">
          <p id="dispose-confirm" className={styles.confirmText}>
            {confirming.action === "removed"
              ? COPY.disposeRemoveConfirm
              : COPY.disposeLabelConfirm}
          </p>
          <button type="button" className={ui.btn} disabled={busy}
                  onClick={() => settle(confirming.entryId, confirming.action)}>
            {busy ? COPY.saving
              : confirming.action === "removed" ? COPY.disposeRemove : COPY.disposeLabel}
          </button>
          <button type="button" className={styles.cancel} disabled={busy}
                  onClick={() => setConfirming(null)}>
            {COPY.cancel}
          </button>
        </Sheet>
      ) : null}
    </div>
  );
}
