// Study mode on the screen (#52): the facilitator's page, the notice in the chat, and that a
// session noting misses never puts anything on the network.
//
//   node --import ./test/setup.mjs --test test/study.test.mjs
//
// Screens run in fixtures mode (test/setup.mjs), so assistantIsLive is false here and the
// "live assistant" refusal on /study cannot be rendered in this process. What is pinned
// instead is the reason it exists: lib/api.js only notes on the fixed-reply path.

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { act, render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import StudyPage from "../app/study/page.js";
import Chat from "../components/Chat.js";
import { askAssistant } from "../lib/api.js";
import { COPY } from "../lib/copy.js";
import { GENERAL_REPLY, startStudy, studyRecord, STUDY_KEY } from "../lib/study.js";

const UNMATCHED = "can I borrow a ladder from the council";

async function openStudy() {
  await act(async () => { render(<StudyPage />); });
  await screen.findByRole("heading", { level: 1, name: COPY.studyTitle });
  return userEvent.setup({ document });
}

async function openChat() {
  await act(async () => { render(<Chat storyboardId="sb_jacaranda" onClose={() => {}} />); });
  return userEvent.setup({ document });
}

let hadScroll;
before(() => {
  hadScroll = Object.prototype.hasOwnProperty.call(Element.prototype, "scrollIntoView");
  if (!hadScroll) Element.prototype.scrollIntoView = function () {};
});
after(() => { if (!hadScroll) delete Element.prototype.scrollIntoView; });

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

test("the chat says nothing about a study when none is running", async () => {
  await openChat();
  assert.equal(screen.queryByText(COPY.studyNotice), null);
});

test("while a session is noting, the chat says so inside the log a screen reader follows", async () => {
  startStudy();
  await openChat();
  const notice = screen.getByText(COPY.studyNotice);
  assert.ok(within(screen.getByRole("log")).getByText(COPY.studyNotice) === notice);
});

test("a question the fixed replies miss is noted, and nothing goes on the network", async () => {
  startStudy();
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (...args) => { calls.push(args); return realFetch(...args); };
  try {
    const answer = await askAssistant(UNMATCHED, "sb_jacaranda");
    assert.equal(answer.reply, GENERAL_REPLY);
    await askAssistant("Do they eat fruit?", "sb_jacaranda");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(calls, [], "noting a miss made a request");
  const record = studyRecord();
  assert.equal(record.routed, 1);
  assert.deepEqual(record.misses.map((m) => m.question), [UNMATCHED]);
});

test("asking with study mode off stores nothing", async () => {
  await askAssistant(UNMATCHED, "sb_jacaranda");
  assert.equal(window.localStorage.getItem(STUDY_KEY), null);
});

test("the facilitator starts a session, sees what was missed, and deletes it", async () => {
  const user = await openStudy();
  assert.ok(screen.getByText(COPY.studyTell));
  await user.click(screen.getByRole("button", { name: COPY.studyStart }));
  assert.ok(studyRecord(), "starting did not start anything");
  assert.ok(screen.getByText(COPY.studyNoMisses));
  cleanup();

  await askAssistant(UNMATCHED, "sb_jacaranda");
  const again = await openStudy();
  assert.ok(screen.getByText(UNMATCHED));
  assert.ok(screen.getByText(COPY.studyCounts(0, 1)));

  // Deleting takes a second, deliberate press; the first only asks.
  await again.click(screen.getByRole("button", { name: COPY.studyEnd }));
  assert.ok(studyRecord(), "the first press deleted the notes without asking");
  await again.click(screen.getByRole("button", { name: COPY.studyEndNo }));
  assert.ok(studyRecord());
  await again.click(screen.getByRole("button", { name: COPY.studyEnd }));
  await again.click(screen.getByRole("button", { name: COPY.studyEndYes }));
  assert.equal(studyRecord(), null);
  assert.ok(screen.getByRole("button", { name: COPY.studyStart }));
});

test("export hands over a file named for the session and holding the misses", async () => {
  startStudy(new Date("2026-10-08T09:30:00.000Z"));
  await askAssistant(UNMATCHED, "sb_jacaranda");
  const user = await openStudy();

  const made = [];
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;
  const realClick = HTMLAnchorElement.prototype.click;
  let clicked = null;
  URL.createObjectURL = (blob) => { made.push(blob); return "blob:study"; };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () { clicked = this.download; };
  try {
    await user.click(screen.getByRole("button", { name: COPY.studyExport }));
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    HTMLAnchorElement.prototype.click = realClick;
  }
  assert.equal(clicked, "fencepost-study-2026-10-08-09-30.json");
  const out = JSON.parse(await made[0].text());
  assert.deepEqual(out.general_replies.map((m) => m.question), [UNMATCHED]);
  assert.ok(studyRecord(), "exporting deleted the notes");
});

test("a browser that keeps nothing is told so instead of offered a start button", async () => {
  const proto = Object.getPrototypeOf(window.localStorage);
  const realSet = proto.setItem;
  proto.setItem = function () { throw new Error("SecurityError"); };
  try {
    await openStudy();
    await waitFor(() => screen.getByText(COPY.studyNoStorage));
    assert.equal(screen.queryByRole("button", { name: COPY.studyStart }), null);
  } finally {
    proto.setItem = realSet;
  }
});
