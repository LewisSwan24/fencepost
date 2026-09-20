// 9 · The storyboard itself: the timeline, the review label, and the author's own controls.
//
//   node --import ./test/setup.mjs --test test/board.test.mjs
//
// Three rules from the decision table meet on this screen.
//
//   Being checked is a community outcome, not a verdict, so the label is public — there is no
//   author-only state and no "you have been flagged" notice. But an author cannot answer for
//   their own sighting (the server answers not_your_call), and a read-only grant takes no part
//   at all, so in those two cases the buttons are not drawn rather than drawn and refused.
//
//   Withdrawing your own writing and taking somebody else's off a storyboard you made are two
//   different acts. Two controls, two words, two confirmations.
//
//   The species is not editable. "Visual identification must never set the species" has a
//   second half: nor does anything after the step that chose it, and the server's edit handler
//   does not read species from the body at all.
//
// A refused edit is the fourth screen where 200 + published:false reads as success. Here the
// consequence is the worst of the four, because the entry already exists: falling through
// would close the panel and leave the author believing their edit is on the storyboard.
//
// Three things the offline dataset cannot show, so they are untested rather than quietly
// assumed. There is no sighting of my own under review, so neither half of "an author sees
// the label and not the buttons" can be reached. There is no read-only *open* storyboard, so
// a view grant's lack of vote buttons cannot be separated from the board being closed. And no
// storyboard is longer than one page, so "Show more sightings" is never drawn. All three are
// decisions about what the demo contains.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Board from "../app/b/[id]/page.js";
import { COPY, reasonSentence } from "../lib/copy.js";
import { BLOCKED_TRIGGER, closeStoryboard } from "../lib/fixtures.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

// mel_k offline, who owns sb_jacaranda and wrote e1 and e5 on it. e3 is aroha_t's and is the
// one under review. sb_roof is archived and read-only.
const MINE = "e1";
const THEIRS = "e2";
const UNDER_REVIEW = "e3";

const entries = () => [...document.querySelectorAll(".entry")];
const card = (text) => entries().find((el) => el.textContent.includes(text));
const button = (within_, name) => [...within_.querySelectorAll("button")]
  .find((b) => b.textContent.trim() === name);
const sheet = () => screen.queryByRole("dialog");

async function open(id, { query = "" } = {}) {
  reset({ query });
  await renderScreen(Board, { id });
  await waitFor(() => assert.ok(screen.getByText("Discussion")));
  return userEvent.setup();
}

// The card for an entry, found by a line only that entry carries.
const handles = { e1: "@mel_k", e2: "@dan_h", e3: "@aroha_t" };
function entryCard(id) {
  const all = entries();
  const found = all.find((el) => el.textContent.includes(handles[id]));
  assert.ok(found, `no card for ${id}`);
  return found;
}

beforeEach(() => reset());
afterEach(() => cleanup());

test("a sighting under review says so to everybody, the author included", async () => {
  const user = await open("sb_jacaranda");

  // Not an author-only state and not a notice. It is the one label on this screen that is
  // the outcome of other people's reading, and hiding it from anybody would make it a
  // verdict delivered privately instead.
  const head = screen.getByRole("button", { name: new RegExp(COPY.checkedLabel) });
  assert.equal(head.getAttribute("aria-expanded"), "false");
  assert.equal(screen.queryByText(COPY.checkedBody), null);

  await user.click(head);
  assert.equal(head.getAttribute("aria-expanded"), "true");
  assert.ok(screen.getByText(COPY.checkedBody), "the label explains nothing when opened");
});

test("a neighbour's sighting offers two ways to answer, and answering replaces them", async () => {
  const user = await open("sb_jacaranda");
  await user.click(screen.getByRole("button", { name: new RegExp(COPY.checkedLabel) }));

  const yes = screen.getByRole("button", { name: COPY.checkedYes });
  assert.ok(screen.getByRole("button", { name: COPY.checkedNo }));

  await user.click(yes);

  // One answer, not a tally the voter can keep adding to.
  await waitFor(() => assert.ok(screen.queryByText(COPY.votedYes)));
  assert.equal(screen.queryByRole("button", { name: COPY.checkedYes }), null);
  assert.equal(screen.queryByRole("button", { name: COPY.checkedNo }), null);
});

test("your own sighting is edited or deleted; somebody else's is removed", async () => {
  await open("sb_jacaranda");

  const mine = entryCard(MINE);
  assert.ok(button(mine, COPY.editEntry), "no way to edit your own sighting");
  assert.ok(button(mine, COPY.deleteEntry));
  assert.equal(button(mine, COPY.removeIt), undefined,
               "your own writing is deleted, not removed from somebody's storyboard");

  const theirs = entryCard(THEIRS);
  assert.ok(button(theirs, COPY.removeIt), "an owner cannot take somebody else's off the board");
  assert.equal(button(theirs, COPY.editEntry), undefined, "an owner can rewrite somebody else's words");
  assert.equal(button(theirs, COPY.deleteEntry), undefined);
});

test("a closed storyboard offers none of the three", async () => {
  await open("sb_roof");

  // The server answers storyboard_closed to an edit and to a delete, so the interface does
  // not draw them. Every entry on sb_roof is either mine or mine to remove.
  for (const name of [COPY.editEntry, COPY.deleteEntry, COPY.removeIt]) {
    assert.equal(screen.queryByRole("button", { name }), null, `${name} on a closed storyboard`);
  }
  assert.equal(screen.queryByRole("button", { name: COPY.closeStoryboard }), null,
               "an archived storyboard offers to be closed again, overwriting the closing line");
  assert.ok(screen.getByText(COPY.archived));
});

test("the sheet that edits a sighting cannot change what it was", async () => {
  const user = await open("sb_jacaranda");
  await user.click(button(entryCard(MINE), COPY.editEntry));

  const panel = await screen.findByRole("dialog");
  assert.ok(within(panel).getByRole("heading", { name: COPY.editTitle }));

  // The species is text in the panel, not a control, and the hint says as much. The other
  // half of "visual identification must never set the species".
  assert.ok(within(panel).getByText("Ringtail"));
  assert.equal(within(panel).queryByRole("radio"), null);
  assert.equal(within(panel).queryByRole("combobox"), null);
  assert.equal(within(panel).queryByRole("button", { name: /Ringtail|Brushtail|Not sure/ }), null);
  assert.ok(within(panel).getByText(COPY.editHint));
});

test("Save waits for something to have actually changed", async () => {
  const user = await open("sb_jacaranda");
  await user.click(button(entryCard(MINE), COPY.editEntry));
  await screen.findByRole("dialog");

  const save = () => screen.getByRole("button", { name: COPY.saveChanges });
  assert.equal(save().disabled, true, "offering to save a sighting nobody has touched");

  // An empty box means "leave this one alone", which is how the server reads it too, so
  // clearing a field is not a change.
  await user.clear(screen.getByLabelText("What happened"));
  assert.equal(save().disabled, true, "an emptied box counted as an edit");

  await user.type(screen.getByLabelText("What happened"), "Back on the same branch.");
  assert.equal(save().disabled, false);
});

test("a refused edit leaves the sighting exactly as it was, and says so", async () => {
  const user = await open("sb_jacaranda");
  await user.click(button(entryCard(MINE), COPY.editEntry));
  await screen.findByRole("dialog");

  const story = screen.getByLabelText("What happened");
  await user.clear(story);
  await user.type(story, `Came over the fence at ${BLOCKED_TRIGGER}.`);
  await user.click(screen.getByRole("button", { name: COPY.saveChanges }));

  // published:false is a 200. Falling through here closes the panel over an edit that was
  // never stored, which is the worst version of this trap on any of the four screens.
  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));
  assert.ok(sheet(), "the panel closed over a refusal");
  assert.ok(screen.getByText(COPY.editNotSaved));
  assert.ok(screen.getByText(COPY.editOriginalKept));
  assert.equal(story.value, `Came over the fence at ${BLOCKED_TRIGGER}.`,
               "the edit was thrown away as well as refused");
});

test("editing the words takes the refusal down with it", async () => {
  const user = await open("sb_jacaranda");
  await user.click(button(entryCard(MINE), COPY.editEntry));
  await screen.findByRole("dialog");

  const story = screen.getByLabelText("What happened");
  await user.clear(story);
  await user.type(story, `Out by ${BLOCKED_TRIGGER}.`);
  await user.click(screen.getByRole("button", { name: COPY.saveChanges }));
  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));

  await user.type(story, "x");

  assert.equal(screen.queryByText(COPY.editNotSaved), null);
  assert.equal(screen.queryByText(reasonSentence(["pii"])), null);
});

test("deleting asks first, in a dialog that names what it is about", async () => {
  const user = await open("sb_jacaranda");
  await user.click(button(entryCard(MINE), COPY.deleteEntry));

  const panel = await screen.findByRole("dialog");
  assert.equal(panel.getAttribute("aria-modal"), "true");
  assert.ok(within(panel).getByRole("heading", { name: COPY.deleteTitle }));
  assert.ok(within(panel).getByRole("button", { name: COPY.deleteConfirm }));

  // And backing out changes nothing.
  const before = entries().length;
  await user.click(within(panel).getByRole("button", { name: COPY.cancel }));
  await waitFor(() => assert.equal(sheet(), null));
  assert.equal(entries().length, before);
});

test("taking somebody else's off asks a different question", async () => {
  const user = await open("sb_jacaranda");
  await user.click(button(entryCard(THEIRS), COPY.removeIt));

  const panel = await screen.findByRole("dialog");
  assert.ok(within(panel).getByRole("heading", { name: COPY.removeTitle }),
            "removing somebody else's writing asks the author's own question");
  assert.ok(within(panel).getByRole("button", { name: COPY.removeConfirm }));
  assert.equal(within(panel).queryByRole("button", { name: COPY.deleteConfirm }), null);
});

test("what you can do on a storyboard follows the grant and the status", async () => {
  await open("sb_jacaranda");
  assert.ok(screen.getByRole("button", { name: COPY.addSighting }));
  assert.ok(screen.getByRole("button", { name: "Share" }), "reshare was offered no way to reshare");
  assert.ok(screen.getByRole("button", { name: COPY.secondLookNav }));
  cleanup();

  await open("sb_roof");
  assert.equal(screen.queryByRole("button", { name: COPY.addSighting }), null,
               "a closed, read-only storyboard offered to be written in");
  assert.equal(screen.queryByRole("button", { name: "Share" }), null,
               "a view grant was offered a way to pass the code on");
  assert.equal(screen.queryByRole("button", { name: COPY.secondLookNav }), null,
               "a view grant was offered a part in review");
});

test("the assistant is there to read on a storyboard nobody can write on", async () => {
  await open("sb_roof");

  // Reading it is not writing, so being read-only and closed takes nothing away here. The
  // drawer is the one thing on this screen that survives both.
  assert.ok(screen.getByRole("button", { name: COPY.askAssistant }));
});

test("arriving from having posted says so, once", async () => {
  await open("sb_jacaranda", { query: "posted=" + MINE });

  assert.ok(screen.getByText(COPY.posted));
});

test("arriving by a code says so instead of offering the way back to a list you cannot see", async () => {
  await open("sb_jacaranda", { query: "via=link" });

  // Somebody who scanned a code has no dashboard to go back to, so "All storyboards" would
  // be a door onto nothing. What they get instead is what the code gave them.
  assert.equal(screen.queryByRole("button", { name: "All storyboards" }), null);
  assert.ok(screen.getByText(/Shared with you/));
  assert.ok(screen.getByText(new RegExp(COPY.levelLabel.reshare)));
});

// Last, because they take entries out of the shared fixture list.

test("deleting your own sighting takes it off the storyboard and says so", async () => {
  const user = await open("sb_jacaranda");
  const before = entries().length;
  const gone = entryCard(MINE).textContent;

  await user.click(button(entryCard(MINE), COPY.deleteEntry));
  await user.click(await screen.findByRole("button", { name: COPY.deleteConfirm }));

  await waitFor(() => assert.equal(entries().length, before - 1));
  assert.ok(screen.getByText(COPY.deleted));
  assert.equal(entries().some((el) => el.textContent === gone), false);
  // The total is the storyboard's, not this page's, so it has to move with the list.
  assert.ok(screen.getByText(new RegExp(`${before - 1} sightings`)));
});

test("removing somebody else's takes it off too, under the owner's own word for it", async () => {
  const user = await open("sb_jacaranda");
  const before = entries().length;

  await user.click(button(entryCard(THEIRS), COPY.removeIt));
  await user.click(await screen.findByRole("button", { name: COPY.removeConfirm }));

  await waitFor(() => assert.equal(entries().length, before - 1));
  assert.ok(screen.getByText(COPY.removed), "removing somebody else's said Deleted");
});

test("a storyboard you own and have closed keeps second look, and the code", async () => {
  // sb_roof is read-only as well as archived, so `owner` is false there and the archived
  // half of the owner's controls is never reached. Closing the board I do own is the only
  // way to see it, and it is the fixture's own door rather than a hand-edited row. Last in
  // the file because it does not open again.
  closeStoryboard({ storyboard_id: "sb_jacaranda", closed_note: null });
  await open("sb_jacaranda");

  // Deliberately still there, and the page says why: review_queue, cast_review_vote and
  // dispose_entry none of them consult storyboard_status, so review really does still work
  // on a closed storyboard and hiding the way in would be the interface lying in the other
  // direction.
  assert.ok(screen.getByRole("button", { name: COPY.secondLookNav }),
            "closing a storyboard hid a queue that still works");
  // And the banner's promise that the code still works is kept by the button being there.
  assert.ok(screen.getByRole("button", { name: "Share" }));

  for (const name of [COPY.closeStoryboard, COPY.removeIt, COPY.editEntry,
                      COPY.deleteEntry, COPY.addSighting]) {
    assert.equal(screen.queryByRole("button", { name }), null,
                 `${name} survived the storyboard being closed`);
  }
});
