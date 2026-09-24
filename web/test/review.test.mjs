// The second-look queue: a neighbour casts the first vote, and the owner has the last word.
//
//   node --import ./test/setup.mjs --test test/review.test.mjs
//
// The red line on this screen is that it never characterises contributors. The queue carries
// no author identity and no reason code, so a card that names who was flagged, or says what
// the Screener judged it to be, is the failure. The reviewer is told which part to read again
// and nothing else. And review never blocks publication: labelling adds a public note and the
// post stays up.
//
// The second stated behaviour is the one the page's own comments spend the most words on:
// after a vote or a disposal the row is **not** refetched away. The deciding vote settles the
// entry on the spot and it leaves the queue, and a refetch would blink out the very sentence
// that has to appear. Only a deciding vote can show that, so it is exercised below.
//
// Fixtures: sb_jacaranda (owned by "me") holds one queued entry, e3, written by aroha_t with
// codes ["fact_conflict"] and fields ["fun_fact"]. Every other storyboard has an empty queue.
// The queue is one mutable object for the whole process, so the order of tests matters: two
// earlier tests cast one vote each, and the last test casts the deciding worth_checking vote.
//
// Not reachable offline, and deliberately not forced by editing the fixtures:
//   · a non-owner looking at a non-empty queue (the owner block must be absent there) — the
//     only queued entry is on a board "me" owns; sb_roof is checked with an empty queue instead
//   · one of my own sightings under review (it must never appear to me) — no fixture holds one
//   · a failed vote or disposal (the author deleted the entry meanwhile) — fixtures never throw
//   · "Leave it as it is" asking nothing — there is only one queued entry and only one
//     disposal per process, which the labelled path takes because it is the higher-risk confirm

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Review from "../app/b/[id]/review/page.js";
import { COPY, REASON_COPY, REASON_FALLBACK } from "../lib/copy.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

const QUEUED_STORY = "Same one as last week I think, on the power line between the two poles.";
const QUEUED_FACT = "Ringtails can live up to 40 years in the wild.";

const card = () => screen.getByText(QUEUED_STORY).closest("article");
const loaded = () => waitFor(() => screen.getByText(QUEUED_STORY));
const ownerReady = () => waitFor(() => screen.getByText(COPY.ownerCall));

beforeEach(() => reset());
afterEach(() => cleanup());

test("a queued entry names no author and no reason code", async () => {
  // The red line: never characterise contributors. The card says which part to read again,
  // never who wrote it and never that the model judged it fact_conflict.
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();

  const text = card().textContent;
  assert.ok(text.includes(COPY.secondLookFact), "not told which part to read again");
  assert.ok(text.includes(QUEUED_FACT));
  assert.ok(!document.body.textContent.includes("aroha_t"), "the author was named");
  assert.ok(!text.includes("@"), "a handle-shaped thing appeared on the card");
  assert.ok(!document.body.textContent.includes("fact_conflict"), "the reason code leaked");
  assert.ok(!document.body.textContent.includes(REASON_FALLBACK),
            "the reviewer was shown the author-facing refusal wording");
  for (const sentence of Object.values(REASON_COPY)) {
    assert.ok(!document.body.textContent.includes(sentence), `reason copy leaked: ${sentence}`);
  }
});

test("the week-long clearing window is stated under a non-empty queue", async () => {
  // Anything left in the queue clears on its own; nobody is made responsible for emptying it.
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();
  assert.ok(screen.getByText(COPY.secondLookWindow));
});

test("the owner gets the last word, and labelling says the post stays up", async () => {
  // Review never blocks publication: the labelled disposal adds a note, it does not hide.
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();
  await ownerReady();

  const here = within(card());
  assert.ok(here.getByRole("button", { name: COPY.disposeKeep }));
  const label = here.getByRole("button", { name: new RegExp(COPY.disposeLabel) });
  assert.ok(label.textContent.includes(COPY.disposeLabelNote),
            "labelling no longer says the post stays up");
  assert.ok(here.getByRole("button", { name: COPY.disposeRemove }));
});

test("somebody who is not the owner sees no disposal and no stray vote buttons", async () => {
  // Only the owner decides; sb_roof is view-only and its queue is empty, so the screen must
  // say there is nothing rather than offer anything to press.
  await renderScreen(Review, { id: "sb_roof" });
  await waitFor(() => screen.getByText(COPY.secondLookEmpty));
  // Give the owner check its chance to come back before asserting its absence.
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(screen.queryByText(COPY.ownerCall), null);
  assert.equal(screen.queryByRole("button", { name: COPY.checkedYes }), null);
  assert.equal(screen.queryByRole("button", { name: COPY.checkedNo }), null);
  assert.equal(screen.queryByText(COPY.secondLookWindow), null);
});

test("taking somebody's entry down asks first, and cancelling changes nothing", async () => {
  // The highest-risk confirm in the product: a real dialog, the irreversible wording, and a
  // way out that leaves the entry exactly where it was.
  const user = userEvent.setup({ document });
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();
  await ownerReady();

  await user.click(within(card()).getByRole("button", { name: COPY.disposeRemove }));
  const dialog = screen.getByRole("dialog", { name: COPY.disposeRemoveConfirm });
  await user.click(within(dialog).getByRole("button", { name: COPY.cancel }));

  assert.equal(screen.queryByRole("dialog"), null);
  assert.equal(screen.queryByText(COPY.disposeDone), null, "cancel disposed of it anyway");
  assert.ok(within(card()).getByRole("button", { name: COPY.checkedYes }));
});

test("the label dialog says the note cannot be taken off", async () => {
  // Adding the public note is permanent, and the confirm has to say that, not the removal text.
  const user = userEvent.setup({ document });
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();
  await ownerReady();

  await user.click(within(card()).getByRole("button", { name: new RegExp(COPY.disposeLabel) }));
  assert.ok(screen.getByRole("dialog", { name: COPY.disposeLabelConfirm }));
  await user.keyboard("{Escape}");
  assert.equal(screen.queryByRole("dialog"), null, "Escape did not close the confirm");
});

test("saying it looks right thanks you and stays on the screen", async () => {
  // A vote is a neighbour's opinion, not a verdict: it is acknowledged in place, with no
  // navigation and no second chance to pile on. (looks_right → 1 in the fixtures.)
  const user = userEvent.setup({ document });
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();

  await user.click(within(card()).getByRole("button", { name: COPY.checkedYes }));
  await waitFor(() => screen.getByText(COPY.votedYes));
  assert.equal(within(card()).queryByRole("button", { name: COPY.checkedNo }), null);
  assert.deepEqual(navigated, []);
});

test("worth checking is thanked neutrally, and one vote does not decide it", async () => {
  // The acknowledgement for the doubting vote must not read as a charge against anybody, and
  // a single vote leaves the entry in the queue (worth_checking → 1 in the fixtures).
  const user = userEvent.setup({ document });
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();

  await user.click(within(card()).getByRole("button", { name: COPY.checkedNo }));
  await waitFor(() => screen.getByText(COPY.votedNo));
  assert.equal(screen.queryByText(COPY.votedYes), null);

  cleanup();
  reset();
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();
});

test("back goes to the storyboard", async () => {
  // The queue hangs off one storyboard, and leaving it returns there rather than home.
  const user = userEvent.setup({ document });
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();
  await user.click(screen.getByRole("button", { name: "Back" }));
  assert.deepEqual(navigated, [["push", "/b/sb_jacaranda"]]);
});

// Last, because it empties the queue for the rest of the process.
test("the deciding vote and the owner's disposal both finish on the row", async () => {
  // Not refetching after a vote or a disposal is stated in the page: the deciding vote takes
  // the entry out of the queue, and a refetch would blink out the thank-you mid-read. The
  // same for disposal, where COPY.disposeDone had once never appeared at all.
  const user = userEvent.setup({ document });
  await renderScreen(Review, { id: "sb_jacaranda" });
  await loaded();
  await ownerReady();

  // The second worth_checking vote: the fixtures settle it as labelled and drop it.
  await user.click(within(card()).getByRole("button", { name: COPY.checkedNo }));
  await waitFor(() => screen.getByText(COPY.votedNo));
  await new Promise((done) => setTimeout(done, 20));
  assert.ok(screen.getByText(QUEUED_STORY), "the row blinked out after the deciding vote");
  assert.ok(screen.getByText(COPY.votedNo));

  await user.click(within(card()).getByRole("button", { name: new RegExp(COPY.disposeLabel) }));
  const dialog = screen.getByRole("dialog", { name: COPY.disposeLabelConfirm });
  await user.click(within(dialog).getByRole("button", { name: COPY.disposeLabel }));

  await waitFor(() => screen.getByText(COPY.disposeDone));
  assert.equal(screen.queryByRole("dialog"), null, "the confirm stayed open after it worked");
  assert.ok(screen.getByText(QUEUED_STORY), "the row went before its closing sentence could");

  // And the next visit fetches afresh: the queue is empty and says so.
  cleanup();
  reset();
  await renderScreen(Review, { id: "sb_jacaranda" });
  await waitFor(() => screen.getByText(COPY.secondLookEmpty));
  assert.equal(screen.queryByText(COPY.secondLookWindow), null);
});
