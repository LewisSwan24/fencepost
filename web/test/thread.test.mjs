// 11 · Thread detail: reading a discussion, replying to it, and taking your words back.
//
//   node --import ./test/setup.mjs --test test/thread.test.mjs
//
// A reply goes through the Screener like everything else, and a refusal comes back **200 with
// published:false**. So it is the same trap the forum list, the title and the closing note
// had: catch never sees it, and the draft must not be cleared as if it had gone through.
//
// Since 61443d1 /api/forum/thread is paged, thirty to a page, oldest first. Two things follow
// and both are pinned here: "Show more replies" exists only when the server hands back a
// cursor, and a reply just posted on a long thread is on a later page, so posting pages on
// until it is on screen. Taking a post down reloads rather than splicing locally, keeps the
// thread as long as it was showing, and when the last post goes the thread goes too — offline
// that comes back as an empty thread, and the screen goes back to the list.
//
// There is no assistant here, as on the forum list: forum posts are a table its context
// cannot reach.
//
// Setup. The page needs `threadId` as well as `id`, which renderScreen does not pass, so the
// params promise is handed in through `props` (spread after the harness's own). Threads long
// enough to page, and threads with only my own posts in them, are made through the fixture
// module's own createThread / createPost — the same calls the screens make offline — rather
// than by editing the dataset. Offline, "I" am mel_k / u_mel, the owner of sb_jacaranda.
//
// Not reachable offline, stated rather than forced:
//   - A view grant on an open storyboard, or contribute on an archived one. sb_roof is both
//     view-only and archived, so which half of canReply hides the reply box cannot be told
//     apart (the same gap forum.test.mjs records).
//   - The server's 404 "gone" after the last post is taken down. Offline answers an empty
//     thread instead; only that branch of reloadAfterRemoval is exercised.
//   - A reply held for `review`. Offline createPost publishes or refuses; there is no third
//     outcome, so "review never blocks and never tells the author" has nothing to render.
//   - Posts by anybody other than mel_k in a fresh thread: createPost always writes as mel_k,
//     so "somebody else's post" means the seeded t1 / t2.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Thread from "../app/b/[id]/forum/[threadId]/page.js";
import { COPY, reasonSentence } from "../lib/copy.js";
import { BLOCKED_TRIGGER, createThread, createPost } from "../lib/fixtures.js";
import { renderScreen } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

const WRITABLE = "sb_jacaranda";
const PAGE = 30;   // FORUM_PAGE in proxy/app.py and lib/fixtures.js

let n = 0;

// A thread of `count` posts, every one of them mine, on the given board.
function makeThread(count, board = WRITABLE) {
  n += 1;
  const { thread_id } = createThread({ storyboardId: board, title: `Test thread ${n}`,
                                       body: `thread ${n} post 0` });
  for (let i = 1; i < count; i += 1) createPost({ threadId: thread_id, body: `thread ${n} post ${i}` });
  return { threadId: thread_id, tag: `thread ${n}` };
}

async function open(threadId, { id = WRITABLE, heading = true } = {}) {
  await renderScreen(Thread, { id, heading, props: { params: Promise.resolve({ id, threadId }) } });
  return userEvent.setup();
}

const posts = () => Array.from(document.querySelectorAll("article"));
const postBy = (text) => posts().find((a) => a.textContent.includes(text));
const replyField = () => screen.queryByLabelText(COPY.reply);
const replyButton = () => screen.getByRole("button", { name: COPY.reply });
const showMore = () => screen.queryByRole("button", { name: COPY.moreReplies });
const dialog = () => screen.queryByRole("dialog");

// The reply box is drawn once boardAccess has answered; anything about writing waits for it.
const writable = () => waitFor(() => assert.ok(replyField()));

beforeEach(() => reset());
afterEach(() => cleanup());

test("a refused reply stays on the thread, says why, and keeps the draft", async () => {
  // published:false is a 200: the draft must survive, the author must be told it did, and
  // nothing may read as success — no new post, no cleared box, no stuck "Posting…".
  const { threadId } = makeThread(2);
  const user = await open(threadId);
  await writable();
  const draft = `It was on the fence at ${BLOCKED_TRIGGER} again.`;
  await user.type(replyField(), draft);
  await user.click(replyButton());

  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));
  assert.ok(screen.getByText(COPY.blockedKept), "nobody is told the writing survived");
  assert.equal(replyField().value, draft, "the draft was cleared as though it had posted");
  assert.equal(posts().length, 2, "a refused reply appeared in the thread");
  assert.deepEqual(navigated, [], "a refusal navigated somewhere");
  assert.equal(replyButton().disabled, false, "a refusal left the button disabled for good");
});

test("editing the draft after a refusal takes the refusal down", async () => {
  // A sentence about text that is no longer there is a sentence about nothing.
  const { threadId } = makeThread(1);
  const user = await open(threadId);
  await writable();
  await user.type(replyField(), BLOCKED_TRIGGER);
  await user.click(replyButton());
  await waitFor(() => assert.ok(screen.queryByText(reasonSentence(["pii"]))));

  await user.type(replyField(), " no, somewhere else");
  assert.equal(screen.queryByText(reasonSentence(["pii"])), null);
  assert.equal(screen.queryByText(COPY.blockedKept), null);
});

test("Reply waits for something to say, and whitespace is not something", async () => {
  // The body is trimmed before it is sent, so a button live on spaces posts an empty reply.
  const { threadId } = makeThread(1);
  const user = await open(threadId);
  await writable();
  assert.equal(replyButton().disabled, true);
  await user.type(replyField(), "    ");
  assert.equal(replyButton().disabled, true, "spaces accepted as a reply");
  await user.type(replyField(), "Saw it too.");
  assert.equal(replyButton().disabled, false);
});

test("a reply that goes through is shown in the thread and the box is emptied", async () => {
  // Success is the only path that clears the draft, and it stays on the thread.
  const { threadId } = makeThread(2);
  const user = await open(threadId);
  await writable();
  await user.type(replyField(), "Netting worked for us.");
  await user.click(replyButton());

  await waitFor(() => assert.ok(postBy("Netting worked for us."), "the reply is not on screen"));
  assert.equal(replyField().value, "");
  assert.deepEqual(navigated, []);
});

test("a short thread offers no Show more", async () => {
  // `next` is null when there is nothing more, and the button must never press for nothing.
  await open("t1");
  await waitFor(() => assert.equal(posts().length, 4));
  assert.equal(showMore(), null);
});

test("a long thread shows one page, and Show more appends the rest in order", async () => {
  // Paged thirty at a time, oldest first: the button exists because the server gave a cursor,
  // loads later replies onto the end, and goes away once there is nothing left.
  const { threadId, tag } = makeThread(PAGE + 5);
  const user = await open(threadId);
  await waitFor(() => assert.equal(posts().length, PAGE));
  assert.ok(postBy(`${tag} post 0`), "page one does not start at the oldest post");
  assert.equal(postBy(`${tag} post ${PAGE}`), undefined);
  assert.ok(showMore(), "a thread with another page offers no way to reach it");

  await user.click(showMore());
  await waitFor(() => assert.equal(posts().length, PAGE + 5));
  assert.match(posts()[PAGE].textContent, new RegExp(`${tag} post ${PAGE}\\b`),
               "the second page was not appended after the first");
  assert.equal(showMore(), null, "Show more is still offered with nothing more to show");
});

test("posting on a long thread pages on until the new reply is on screen", async () => {
  // The reply lands after everything else, so on a thread longer than a page it is not on
  // page one; reloading page one alone would say nothing and show nothing.
  const { threadId } = makeThread(PAGE + 8);
  const user = await open(threadId);
  await writable();
  await waitFor(() => assert.equal(posts().length, PAGE));

  await user.type(replyField(), "Mine is the newest one.");
  await user.click(replyButton());

  await waitFor(() => assert.ok(postBy("Mine is the newest one."),
                                "a posted reply is not on screen: it is on a page not loaded"));
});

test("only your own posts offer Take it down; on your storyboard the rest offer Remove", async () => {
  // The interface narrows to the server's rule: your words are yours to withdraw, and the
  // owner's power over anybody else's is a separate, recorded action.
  await open("t1");
  await writable();
  await waitFor(() => assert.ok(within(postBy("dan_h")).queryByRole("button", { name: COPY.removeIt })));

  const mine = postBy("@mel_k");
  assert.ok(within(mine).queryByRole("button", { name: COPY.deletePost }));
  assert.equal(within(mine).queryByRole("button", { name: COPY.removeIt }), null);
  for (const handle of ["@dan_h", "@aroha_t", "@sione_f"]) {
    const theirs = postBy(handle);
    assert.equal(within(theirs).queryByRole("button", { name: COPY.deletePost }), null,
                 `${handle}'s post offers to be taken down as if it were mine`);
  }
});

test("Take it down asks first, and Cancel leaves the post where it was", async () => {
  // Irreversible, so it is a confirmation sheet rather than a one-tap delete.
  const { threadId, tag } = makeThread(2);
  const user = await open(threadId);
  await writable();
  await user.click(within(postBy(`${tag} post 1`)).getByRole("button", { name: COPY.deletePost }));

  const sheet = await screen.findByRole("dialog");
  assert.ok(within(sheet).getByRole("heading", { name: COPY.deletePostTitle }));
  await user.click(within(sheet).getByRole("button", { name: COPY.cancel }));
  await waitFor(() => assert.equal(dialog(), null));
  assert.equal(posts().length, 2);
});

test("taking one post down keeps the rest, and does not collapse an expanded thread", async () => {
  // Reloading after a take-down keeps at least as many as were showing, or somebody reading
  // far down a long thread is thrown back to page one.
  const { threadId, tag } = makeThread(PAGE + 5);
  const user = await open(threadId);
  await waitFor(() => assert.ok(showMore()));
  await user.click(showMore());
  await waitFor(() => assert.equal(posts().length, PAGE + 5));
  await writable();

  await user.click(within(postBy(`${tag} post ${PAGE + 2}`)).getByRole("button", { name: COPY.deletePost }));
  const sheet = await screen.findByRole("dialog");
  await user.click(within(sheet).getByRole("button", { name: COPY.deletePostConfirm }));

  await waitFor(() => assert.equal(postBy(`${tag} post ${PAGE + 2}`), undefined));
  assert.equal(posts().length, PAGE + 4, "the thread collapsed back to one page");
  assert.deepEqual(navigated, [], "a thread that still has posts sent you away");
});

test("taking down the last post goes back to the forum list", async () => {
  // The thread goes with its last post. Offline answers an empty thread; either way there is
  // nothing to show, so back to the list rather than an empty page or an error.
  const { threadId, tag } = makeThread(1);
  const user = await open(threadId);
  await writable();
  await user.click(within(postBy(`${tag} post 0`)).getByRole("button", { name: COPY.deletePost }));
  const sheet = await screen.findByRole("dialog");
  await user.click(within(sheet).getByRole("button", { name: COPY.deletePostConfirm }));

  await waitFor(() => assert.deepEqual(navigated, [["replace", `/b/${WRITABLE}/forum`]]));
});

test("an owner removing somebody else's post confirms first, and the thread stays", async () => {
  // Not yours, but the storyboard is: a separate sheet, and afterwards the rest is still there.
  // Uses t2, and is the only test that does, because it changes it for the process.
  const user = await open("t2");
  await writable();
  const theirs = postBy("Sealing the gaps");
  await waitFor(() => assert.ok(within(theirs).queryByRole("button", { name: COPY.removeIt })));
  await user.click(within(theirs).getByRole("button", { name: COPY.removeIt }));

  const sheet = await screen.findByRole("dialog");
  assert.ok(within(sheet).getByRole("heading", { name: COPY.removeTitle }));
  await user.click(within(sheet).getByRole("button", { name: COPY.removeConfirm }));

  await waitFor(() => assert.equal(postBy("Sealing the gaps"), undefined));
  assert.equal(posts().length, 2);
  assert.deepEqual(navigated, []);
});

test("a storyboard you can only read offers no reply and no take-downs, not even your own", async () => {
  // The server takes no reply, and no take-down, on a view grant or a closed storyboard; a
  // button certain to be refused is worse than none. (sb_roof is both; see the header.)
  const { tag, threadId } = makeThread(2, "sb_roof");
  await open(threadId, { id: "sb_roof" });
  await waitFor(() => assert.ok(postBy(`${tag} post 1`)));
  // Give access and identity time to land, so absence is not just "not loaded yet".
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(replyField(), null, "a reply box on a storyboard you can only read");
  assert.equal(screen.queryByRole("button", { name: COPY.reply }), null);
  assert.equal(screen.queryByRole("button", { name: COPY.deletePost }), null);
  assert.equal(screen.queryByRole("button", { name: COPY.removeIt }), null);
});

test("there is no way to ask the assistant anything from here", async () => {
  // Forum posts are a table the assistant's context cannot reach, so nothing here may
  // suggest it can: no Possum Help, no ask button.
  await open("t1");
  await writable();
  assert.doesNotMatch(document.body.textContent, /Possum Help/i);
  assert.equal(screen.queryByRole("button", { name: /ask/i }), null);
});

test("Back goes to this storyboard's discussion list", async () => {
  // The thread sits under its board's forum; back is there, not the dashboard.
  const user = await open("t1");
  await user.click(screen.getByRole("button", { name: /back/i }));
  assert.deepEqual(navigated, [["push", `/b/${WRITABLE}/forum`]]);
});
