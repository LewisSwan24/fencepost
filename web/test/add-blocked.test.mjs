// Step 8b of the posting flow: the submission was stopped.
//
//   node --import ./test/setup.mjs --test test/add-blocked.test.mjs
//
// The page's header states the rule: all the author sees is the sentence the reason_codes map
// to. No verdict, no note, not the code itself — nothing that reads as the system passing
// judgement on them. The Screener sends only codes, and ux-copy §1 says to show the first
// sentence that matches, falling back to a generic line for codes with no author-facing
// sentence (fact_conflict is one on purpose). Then it has to say the writing is still there,
// and the way back has to lead to that writing — the write step, where the draft lives in the
// provider above the flow. That the draft really survives is add-write.test.mjs's subject;
// this suite pins what the blocked screen says and where it sends you.
//
// The codes arrive in the query string, so each test sets them through the navigation stub.

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Blocked from "../app/b/[id]/add/blocked/page.js";
import { COPY, REASON_COPY, REASON_FALLBACK, reasonSentence } from "../lib/copy.js";
import { renderInFlow } from "./harness.mjs";
import { navigated, reset } from "./stubs/navigation.mjs";

beforeEach(() => reset());
afterEach(() => cleanup());

const open = (query, id = "sb_jacaranda") => {
  reset({ query });
  return renderInFlow(Blocked, { id });
};

test("a refusal is told as Not posted, with the reason's own sentence", async () => {
  // The author must not think it went up; what they read is the ux-copy sentence for the
  // code, which says what to change.
  await open("codes=pii");

  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, COPY.blockedTitle);
  assert.ok(screen.getByText(REASON_COPY.pii));
});

test("it says the writing is still there", async () => {
  // Refusal keeps your draft — and the author has to be told so, or they will retype it.
  await open("codes=pii");
  assert.ok(screen.getByText(COPY.blockedKept));
});

test("the codes themselves, a verdict or a note are never shown", async () => {
  // Only the mapped sentence. A raw "pii" or "harm_advocacy" in front of somebody is the
  // system's internal judgement showing, which the header rules out.
  await open("codes=harm_advocacy,pii");

  const text = document.body.textContent;
  for (const leak of [/\bpii\b/, /harm_advocacy/, /verdict/i, /\bnote\b/i, /\bflagged\b/i, /\breject/i]) {
    assert.doesNotMatch(text, leak);
  }
});

test("with several codes only the first matching sentence is shown", async () => {
  // ux-copy §1: first match, never every match stacked together.
  await open("codes=fact_conflict,spam,pii");

  assert.ok(screen.getByText(REASON_COPY.spam));
  assert.equal(screen.queryByText(REASON_COPY.pii), null, "a second reason was stacked on the first");
  assert.equal(screen.queryByText(REASON_FALLBACK), null);
});

test("a code with no author-facing sentence, or none at all, gets the fallback", async () => {
  // fact_conflict falls through deliberately; an empty codes list must still explain rather
  // than show a blank line.
  await open("codes=fact_conflict");
  assert.ok(screen.getByText(REASON_FALLBACK));
  cleanup();

  await open("");
  assert.ok(screen.getByText(REASON_FALLBACK));
});

test("the snakes-and-bats refusal says it is a safety call, not a judgement", async () => {
  // Red line: no reassurance about handling snakes or bats. The refusal for it must say it
  // is about safety and not about the author.
  await open("codes=dangerous_reassurance");
  assert.ok(screen.getByText(reasonSentence(["dangerous_reassurance"])));
  assert.match(document.body.textContent, /safety call, not a judgement/);
});

test("Back to editing returns to the write step of the same storyboard, and nothing else happens by itself", async () => {
  // The way back leads to the writing that was kept. The screen must not navigate on its own
  // (as if the post had gone through) before the person chooses to go back.
  const user = userEvent.setup({ document });
  await open("codes=pii", "sb_roof_test");

  assert.deepEqual(navigated, [], "the blocked screen moved on without being asked");
  await user.click(screen.getByRole("button", { name: COPY.backToEditing }));
  assert.deepEqual(navigated, [["push", "/b/sb_roof_test/add/write"]]);
});
