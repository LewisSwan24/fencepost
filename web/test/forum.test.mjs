// 11 · Discussion, and the third screen where a refusal reads as success.
//
//   node --import ./test/setup.mjs --test test/forum.test.mjs
//
// A refused thread comes back 200 with published:false and **no thread_id**. This screen once
// pushed straight to it, so a refusal landed on /forum/undefined — "There is nothing at that
// address." — with the writing apparently gone. The storyboard title and the closing note had
// the same shape; three screens, one trap, and this is the last of the three.
//
// The other rule is quieter and is in the page's first comment: there is no assistant here,
// not one entry point. Forum posts and entries are separate tables and the assistant's
// context cannot reach this one, so nothing in the interface may suggest it can.
//
// One gap, stated rather than papered over. Whether the button is hidden by the grant or by
// the storyboard being closed cannot be told apart offline: the only read-only board in the
// fixtures, sb_roof, is archived as well, so each half of `canPostNow` is true exactly when
// the other is. Separating them would mean a third demo storyboard on the dashboard, which is
// a decision about what the demo shows rather than a test fixture.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Forum from "../app/b/[id]/forum/page.js";
import { COPY, reasonSentence } from "../lib/copy.js";
import { BLOCKED_TRIGGER } from "../lib/fixtures.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

let n = 0;
const fresh = () => "sb_forum_test_" + (n += 1);

// Writing needs contribute or reshare on an open storyboard, and offline exactly one board
// is that. An address nobody holds a grant on answers level null, which is indistinguishable
// from being refused — right for the tests about the button not being drawn, useless for the
// ones that have to get the sheet open. Those all run here, and each leaves its thread in
// this board's list, which is why nothing below counts threads.
const WRITABLE = "sb_jacaranda";

const startButton = () => screen.queryByRole("button", { name: COPY.newThread });
const sheet = () => screen.queryByRole("dialog");
const titleField = () => screen.getByLabelText("Title");
const bodyField = () => screen.getByLabelText("Your message");
const post = () => screen.getByRole("button", { name: "Post" });

async function open(id) {
  await renderScreen(Forum, { id });
  const user = userEvent.setup();
  await waitFor(() => assert.ok(startButton() || screen.queryByText(/Nothing yet/)));
  return user;
}

// Open the sheet and write a thread into it, without posting.
async function compose(user, { title, body }) {
  await user.click(startButton());
  await waitFor(() => assert.ok(sheet()));
  await user.type(titleField(), title);
  await user.type(bodyField(), body);
}

beforeEach(() => reset());
afterEach(() => cleanup());

test("an address in the title keeps you in the sheet rather than sending you nowhere", async () => {
  const user = await open(WRITABLE);
  await compose(user, { title: `Seen at ${BLOCKED_TRIGGER}`, body: "Out on the fence again." });
  await user.click(post());

  // The whole trap in one assertion: published:false is a 200, so catch never runs, and a
  // push here goes to /forum/undefined.
  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));
  assert.deepEqual(navigated, [], "a refusal navigated somewhere");
  assert.ok(sheet(), "the sheet closed over a refusal");
});

test("and what was written is still in the boxes, and says so", async () => {
  const user = await open(WRITABLE);
  const written = { title: `Bin night at ${BLOCKED_TRIGGER}`, body: "Two of them on the wheelie bin." };
  await compose(user, written);
  await user.click(post());

  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));
  assert.ok(screen.getByText(COPY.blockedKept), "nobody is told the writing survived");
  assert.equal(titleField().value, written.title);
  assert.equal(bodyField().value, written.body);
  assert.equal(post().textContent, "Post", "still saying Posting… after it stopped");
  assert.equal(post().disabled, false, "a refusal left the button disabled for good");
});

test("an address in the message is refused the same way a title is", async () => {
  const user = await open(WRITABLE);
  await compose(user, { title: "Where do they get in", body: `Round the back of ${BLOCKED_TRIGGER}.` });
  await user.click(post());

  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));
  assert.deepEqual(navigated, []);
});

test("editing the title takes the refusal down with it", async () => {
  const user = await open(WRITABLE);
  await compose(user, { title: `At ${BLOCKED_TRIGGER}`, body: "On the fence." });
  await user.click(post());
  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));

  await user.type(titleField(), "x");

  // A sentence about text that is no longer on screen is a sentence about nothing.
  assert.equal(screen.queryByText(reasonSentence(["pii"])), null);
  assert.equal(screen.queryByText(COPY.blockedKept), null);
});

test("and so does editing the message", async () => {
  const user = await open(WRITABLE);
  await compose(user, { title: "Where do they get in", body: `Behind ${BLOCKED_TRIGGER}.` });
  await user.click(post());
  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));

  await user.type(bodyField(), "x");

  assert.equal(screen.queryByText(reasonSentence(["pii"])), null);
});

test("a thread that goes through opens at its own address", async () => {
  const user = await open(WRITABLE);
  await compose(user, { title: "Mango tree again", body: "Stripped overnight." });
  await user.click(post());

  await waitFor(() => assert.equal(navigated.length, 1));
  const [[how, where]] = navigated;
  assert.equal(how, "push");
  assert.match(where, new RegExp(`^/b/${WRITABLE}/forum/t_new_\\d+$`),
               "a published thread did not open at a real thread id");
});

test("Post waits for both a title and a message, and whitespace is neither", async () => {
  const user = await open(WRITABLE);
  await user.click(startButton());
  await waitFor(() => assert.ok(sheet()));

  assert.equal(post().disabled, true, "empty on both counts and still offering to post");

  // Each half is checked with the other one already satisfied, or the field under test is
  // not what is holding the button down and the case proves nothing.
  await user.type(bodyField(), "Started about ten.");
  assert.equal(post().disabled, true, "a message with no title is enough to post");

  await user.type(titleField(), "   ");
  assert.equal(post().disabled, true, "spaces accepted as a title");

  await user.clear(titleField());
  await user.type(titleField(), "Roof noise");
  assert.equal(post().disabled, false);

  await user.clear(bodyField());
  assert.equal(post().disabled, true, "a title with no message is enough to post");

  await user.type(bodyField(), "   ");
  assert.equal(post().disabled, true, "spaces accepted as a message");

  await user.clear(bodyField());
  await user.type(bodyField(), "Started about ten.");
  assert.equal(post().disabled, false);
});

test("a storyboard you can only read offers no way to start a thread", async () => {
  await renderScreen(Forum, { id: "sb_roof" });
  await waitFor(() => assert.ok(screen.getByText(/Nothing yet|Loading/)));

  // sb_roof is a view grant on a closed storyboard. The server answers read_only_access and
  // storyboard_closed to these two, and drawing a button certain to be refused is worse than
  // not drawing one.
  await waitFor(() => assert.equal(startButton(), null));
});

test("the sheet is a dialog, and takes its name from its own heading", async () => {
  const user = await open(WRITABLE);
  await user.click(startButton());

  const dialog = await screen.findByRole("dialog");
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  const named = document.getElementById(dialog.getAttribute("aria-labelledby"));
  assert.ok(named, "aria-labelledby points at nothing");
  assert.equal(named.textContent, COPY.newThread);
  assert.ok(within(dialog).getByRole("heading", { name: COPY.newThread }));
});

test("there is no way to ask the assistant anything from here", async () => {
  await open("sb_jacaranda");

  // Not an oversight to be tidied up later: the assistant's context is built from entries,
  // and a forum post is a different table it cannot reach. An entry point here would promise
  // something the data model cannot do.
  assert.doesNotMatch(document.body.textContent, /Possum Help/i);
  assert.equal(screen.queryByRole("button", { name: /ask/i }), null);
});

test("a discussion with nothing in it says so", async () => {
  await open(fresh());

  assert.ok(screen.getByText(/Nothing yet\. Start the first one\./));
});

test("a thread says who started it and how many posts are in it", async () => {
  await open("sb_jacaranda");

  // A thread is a button whose whole text is the row, so it is found by what it says
  // rather than by an accessible name nobody wrote.
  const thread = screen.getAllByRole("button").find((b) => b.textContent.includes("mango tree"));
  assert.ok(thread, "the seeded thread is not on screen");
  assert.match(thread.textContent, /@dan_h/);
  assert.match(thread.textContent, /4 posts/, "the count is wrong, or not plural");
});
