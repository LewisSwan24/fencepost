// Study mode (#52): what the fixed-reply assistant could not answer, noted during an
// evaluation session, on this device and nowhere else.
//
// In evaluation the assistant runs from fixtures, inside the browser, and keeps no record. A
// question that misses every route gets the general reply, and unless the facilitator writes
// it down on the spot nobody learns it happened. At Exhibit 1 most of that went unrecorded.
// Those misses are what an evaluation is for: what people actually ask, and which namings of
// a snake or a bat the routes still do not catch.
//
// What it keeps, and why so little. A question that got the general reply is kept word for
// word with its time, because that question is the finding. A question that hit a route is
// only counted: it was answered, and what it was answered with is already in fixtures.js.
//
// Nothing here touches the network. The only way out is the file the facilitator exports
// from /study. It is off unless somebody started it in this browser, and the chat sheet says
// so for as long as it is on. lib/api.js calls noteExchange on the fixed-reply path only; the
// live path already records server-side, in chat_messages.

import { assistantReply, PROMPT_VERSION } from "./fixtures.js";

export const STUDY_KEY = "fencepost.study";

// The general reply, recognised without touching fixtures.js: an empty question matches no
// route, so what comes back is the fallback. lib/study.test.mjs pins that it is.
export const GENERAL_REPLY = assistantReply("").reply;

function read() {
  try {
    const record = JSON.parse(window.localStorage.getItem(STUDY_KEY) || "null");
    // A half-written or hand-edited value is not a session in progress.
    return record && typeof record.started_at === "string"
      && Number.isInteger(record.routed) && Array.isArray(record.misses) ? record : null;
  } catch {
    return null;
  }
}

// Read back rather than trusting setItem: a full quota and some privacy settings accept the
// write and drop it. A note that silently did not land is worse than one that says so.
function write(record) {
  try {
    const value = JSON.stringify(record);
    window.localStorage.setItem(STUDY_KEY, value);
    return window.localStorage.getItem(STUDY_KEY) === value;
  } catch {
    return false;
  }
}

// Whether this browser will keep anything at all, asked before offering to start. A private
// window or refused site data would otherwise let the facilitator start a session that
// records nothing, and they would only find out at the end.
export function storageWorks() {
  const probe = `${STUDY_KEY}.probe`;
  try {
    window.localStorage.setItem(probe, "1");
    const kept = window.localStorage.getItem(probe) === "1";
    window.localStorage.removeItem(probe);
    return kept;
  } catch {
    return false;
  }
}

// The session in progress, or null when study mode is off.
export function studyRecord() {
  return read();
}

export function startStudy(now = new Date()) {
  const record = { started_at: now.toISOString(), prompt_version: PROMPT_VERSION,
                   routed: 0, misses: [] };
  return write(record) ? record : null;
}

// Returns whether anything was noted. Off means nothing happens and nothing is stored.
export function noteExchange(question, reply, now = new Date()) {
  const record = read();
  if (!record) return false;
  if (reply === GENERAL_REPLY) {
    record.misses.push({ at: now.toISOString(), question: String(question) });
  } else {
    record.routed += 1;
  }
  return write(record);
}

// Ends the session and deletes what it noted, in one step: there is no "paused with notes
// still sitting in the browser" state for anybody to forget about.
export function endStudy() {
  try { window.localStorage.removeItem(STUDY_KEY); } catch { /* nothing was kept */ }
  return read() === null;
}

export function studyExport(record, now = new Date()) {
  return JSON.stringify({
    started_at: record.started_at,
    exported_at: now.toISOString(),
    prompt_version: record.prompt_version,
    answered_by_a_route: record.routed,
    got_the_general_reply: record.misses.length,
    general_replies: record.misses,
  }, null, 2);
}

// Named by when the session started, so two sessions exported on one afternoon do not land
// on top of each other in Downloads.
export function studyFileName(record) {
  const stamp = record.started_at.slice(0, 16).replace(/[:T]/g, "-");
  return `fencepost-study-${stamp}.json`;
}
