"use client";

// The second-look queue (operations.md §2). Two things happen on this screen: a
// contributor casts the first vote, and the owner decides.
//
// **This screen is required, not an extra.** The two vote buttons on the storyboard page
// hang off `being_checked`, and `being_checked` is only true once two `worth_checking`
// votes have landed — which means that without this screen the first vote has nowhere to
// go and those buttons can never appear. The review chain was broken in the product.
//
// Three red lines hold here at once, and none of them by the interface hiding anything:
//   · you never see your own entries — the server SQL itself says e.author_id != viewer
//   · you never see who wrote it     — no handle and no author_id are returned
//   · you never see who voted        — only the counts come back
// An interface can only leak what reached it. Here the data never arrives.
//
// And one more deliberate thing: **the Screener's reason code is never shown to the
// reviewer.** Tell a neighbour which part to read again, not that the model judged it pii.
// The latter makes a censor of a neighbour, and the Screener does not even judge writing
// quality or worth (CLAUDE.md decision table).

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewQueue, castVote, disposeEntry, boardRow, isOwner } from "../../../../lib/api";
import { SPECIES_LABEL } from "../../../../lib/fixtures";
import { COPY } from "../../../../lib/copy";
import { stamp } from "../../../../lib/format";
import { BackButton, ErrorNote, Sheet, ui } from "../../../../components/ui";
import styles from "./review.module.css";

// Which part was picked out. fields is a combination of fun_fact and story.
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
    boardRow(id).then((got) => isOwner(id, got.level).then(setOwner, () => {}), () => {});
  }, [id]);

  async function vote(entryId, choice) {
    setVoted((prev) => ({ ...prev, [entryId]: choice }));
    try {
      await castVote(entryId, choice);
      // Deliberately **not** refetching the queue here. The sentence that has to appear
      // after a vote hangs on this row, and a refetch takes the row away — once two votes
      // land, cast_vote settles it on the spot and it leaves the queue. Whoever cast the
      // deciding vote would then read nothing at all, with a line of writing blinking out.
      // The list is fetched again the next time this screen is opened.
    } catch (e) {
      // The most common one: the author deleted the entry between you reading the queue
      // and you pressing the button.
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
      // As above, and worse here: disposal always removes the item from the queue, so the
      // COPY.disposeDone sentence had never once appeared. Keep the row and let it finish.
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

        <ErrorNote className={styles.error}>{error}</ErrorNote>
        {!items && !error ? <p className={styles.quiet}>Loading…</p> : null}

        {items?.length === 0 ? <p className={styles.empty}>{COPY.secondLookEmpty}</p> : null}

        {items?.map((item) => (
          <article key={item.entry_id} className={styles.card}>
            <div className={styles.head}>
              {/* No @handle here. The queue does not carry that field. */}
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

                {/* The owner's final disposal. Only the owner sees it; the server answers
                    not_the_owner to anybody else. */}
                {owner ? (
                  <div className={styles.owner}>
                    <p className={styles.ownerCall}>{COPY.ownerCall}</p>
                    {/* "Leave it" asks nothing: it changes nothing anybody sees. The other two do. */}
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

      {/* These two options add something that cannot be taken off and take somebody else's
          entry down, which makes this the highest-risk confirm in the product — and it used
          to be a hand-written div: no role="dialog", no name, Escape did nothing, focus
          never moved in. It is a Sheet now, the same thing "delete your own" uses. */}
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
