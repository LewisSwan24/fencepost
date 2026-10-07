// Study mode's record (#52): what is kept, what is only counted, and that ending deletes it.
//
//   node --import ./test/setup.mjs --test lib/study.test.mjs

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { assistantReply, ASSISTANT_SCRIPT, PROMPT_VERSION } from "./fixtures.js";
import { endStudy, GENERAL_REPLY, noteExchange, startStudy, storageWorks, studyExport,
         studyFileName, studyRecord, STUDY_KEY } from "./study.js";

const UNMATCHED = "what's the wifi password at the library";
const AT = new Date("2026-10-08T09:30:00.000Z");

beforeEach(() => window.localStorage.clear());

test("the general reply is the fallback, not one of the routed answers", () => {
  // study.js recognises a miss by comparing against the reply to an empty question. If that
  // ever stopped being the fallback, every miss would be counted as answered, silently.
  assert.equal(GENERAL_REPLY, assistantReply(UNMATCHED).reply);
  for (const s of ASSISTANT_SCRIPT) {
    assert.notEqual(assistantReply(s.question).reply, GENERAL_REPLY, `${s.key} reads as a miss`);
  }
  assert.notEqual(assistantReply("Do they eat fruit?").reply, GENERAL_REPLY);
});

test("off by default: nothing is noted and nothing is stored", () => {
  assert.equal(studyRecord(), null);
  assert.equal(noteExchange(UNMATCHED, GENERAL_REPLY), false);
  assert.equal(window.localStorage.getItem(STUDY_KEY), null);
});

test("a miss is kept word for word; an answered question is only counted", () => {
  startStudy(AT);
  noteExchange(UNMATCHED, GENERAL_REPLY, AT);
  const routed = "Do they eat fruit?";
  noteExchange(routed, assistantReply(routed).reply, AT);

  const record = studyRecord();
  assert.equal(record.routed, 1);
  assert.deepEqual(record.misses, [{ at: AT.toISOString(), question: UNMATCHED }]);
  assert.ok(!window.localStorage.getItem(STUDY_KEY).includes(routed),
    "a question that was answered was stored, not just counted");
});

test("the export carries the counts, the times and the prompt version", () => {
  startStudy(AT);
  noteExchange(UNMATCHED, GENERAL_REPLY, AT);
  noteExchange("x", "a routed answer", AT);
  const out = JSON.parse(studyExport(studyRecord(), AT));
  assert.equal(out.prompt_version, PROMPT_VERSION);
  assert.equal(out.started_at, AT.toISOString());
  assert.equal(out.answered_by_a_route, 1);
  assert.equal(out.got_the_general_reply, 1);
  assert.deepEqual(out.general_replies, [{ at: AT.toISOString(), question: UNMATCHED }]);
  assert.equal(studyFileName(studyRecord()), "fencepost-study-2026-10-08-09-30.json");
});

test("ending deletes everything it noted", () => {
  startStudy(AT);
  noteExchange(UNMATCHED, GENERAL_REPLY, AT);
  assert.equal(endStudy(), true);
  assert.equal(studyRecord(), null);
  assert.equal(window.localStorage.getItem(STUDY_KEY), null);
});

test("a hand-edited or half-written value is not a session in progress", () => {
  window.localStorage.setItem(STUDY_KEY, "{not json");
  assert.equal(studyRecord(), null);
  window.localStorage.setItem(STUDY_KEY, JSON.stringify({ started_at: "x" }));
  assert.equal(studyRecord(), null);
  assert.equal(noteExchange(UNMATCHED, GENERAL_REPLY), false);
});

test("storage that throws or drops writes is reported, and starting says it failed", () => {
  const proto = Object.getPrototypeOf(window.localStorage);
  const realSet = proto.setItem;
  try {
    proto.setItem = function () { throw new Error("QuotaExceededError"); };
    assert.equal(storageWorks(), false);
    assert.equal(startStudy(AT), null);

    proto.setItem = function () { /* accepted and dropped */ };
    assert.equal(storageWorks(), false);
    assert.equal(startStudy(AT), null);
  } finally {
    proto.setItem = realSet;
  }
  assert.equal(storageWorks(), true);
});
