// The Fencepost API client. Two Vercel projects, so every call here is cross-origin.
//
// Three modes, chosen with NEXT_PUBLIC_FENCEPOST_MODE:
//
//   hybrid   (default) CRUD hits the real backend, the assistant runs from fixtures.
//            This is what the demo uses.
//   fixtures no request is sent at all. Works with the network down, but shows no backend.
//   live     everything hits the real backend, the assistant included. For development.
//
// Why the assistant is singled out: a real model can say something that crosses a red
// line, and in the room there is no second chance (CLAUDE.md). The CRUD half carries no
// such risk, and that chain measured 12/12 against the real deployment on 2026-09-13, so
// hiding it would be a waste.
//
// hybrid and live both need a token, and a token can only come from /api/session, which
// is closed unless FENCEPOST_OPEN_SIGNUP is set on the deployment. That is a precondition
// of both modes, not an option.

// Keep the extension: Next accepts either spelling, but `node --test` only accepts this
// one, and lib/api.test.mjs has to import this file directly.
import * as fixtures from "./fixtures.js";
import { COPY } from "./copy.js";
import { toHandle } from "./handle.js";

export const BASE = process.env.NEXT_PUBLIC_FENCEPOST_API || "http://127.0.0.1:8787";
export const MODE = process.env.NEXT_PUBLIC_FENCEPOST_MODE || "hybrid";
// A fixed handle. **Set it and it is used; leave it unset and everyone gets their own** —
// see visitorHandle below.
//
// The default here used to be "mel_k", and mel_k owns the demo storyboard: anyone who
// forgot to configure this variable turned every visitor into the owner, with archiving,
// revoking and deleting other people's entries all within reach. The default is empty now.
// Better to fall back to "a stranger with their own name" than to "everyone is the owner".
export const HANDLE = process.env.NEXT_PUBLIC_FENCEPOST_HANDLE || "";

// Each visitor's own handle lives here, and a redeemed join code is noted alongside it so
// that opening the page again does not redeem a second time.
const HANDLE_KEY = "fencepost.handle";
const JOINED_KEY = "fencepost.joined";
// A signed-in session, kept so that a refresh does not sign you out. A guest identity
// does not need this: its token is free to exchange again from the handle beside it,
// which is why the token used to live only in memory.
//
// The cost, said plainly: a token in localStorage is readable by any script that gets
// itself onto the page. The alternative is an httpOnly cookie, and the front end and the
// API are two different origins, so that means SameSite=None with credentialed CORS, on
// a deployment whose CORS allow-list is already the fiddliest thing about it. For a
// prototype the trade is worth stating rather than pretending away.
const SESSION_KEY = "fencepost.session";

// The join code: a share link to the demo storyboard, in plaintext in the front end.
// This exposes nothing new — open sign-up already lets anyone exchange any handle for a
// token, and the code reaches one storyboard holding demo data. What it buys is
// **a separate identity per visitor** instead of everyone sharing one.
//
// The level it carries is decided when the code is issued, not here, so it is not written
// down in this file. It was contribute at first, and that quietly took the share screen out
// of the product: the Share button needs reshare, so every visitor arrived one level below
// the thing Fencepost is actually about. scripts/issue_join_code.py is how a code is made.
// Comma-separated, because one code reaches one storyboard. A code carries a level for a
// single board by design, so a visitor arriving on a link only ever lands on the board that
// code was made for — which is why the archived storyboard, the one demonstrating that a
// board closes and turns read-only, was invisible to everybody who arrived after it was
// seeded. A second code fixes that without weakening anything: each is still redeemed on its
// own, at its own level, and can be turned off on its own.
//
// One value splits to one code, so an unchanged setting behaves exactly as before.
const JOIN_TOKENS = (process.env.NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const FIXTURES_HANDLE = "mel_k";     // who "I" am offline, matching the fixtures owner

function readStore(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

// Returns whether the value is really there afterwards, which is a different question from
// whether setItem threw. A full quota, a locked-down embedded webview and some privacy
// settings all accept the write and drop it, so the only reliable check is to read it back.
function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return window.localStorage.getItem(key) === String(value);
  } catch {
    return false;
  }
}

function clearStore(key) {
  try { window.localStorage.removeItem(key); } catch { /* as above */ }
}

function readSession() {
  try {
    const saved = JSON.parse(readStore(SESSION_KEY) || "null");
    // A half-written or hand-edited value is not a session. Checking the shape here
    // means the rest of the file can treat what it gets back as real.
    return saved && saved.token && saved.user_id ? saved : null;
  } catch {
    return null;
  }
}

function saveSession(value) {
  if (value) writeStore(SESSION_KEY, JSON.stringify(value));
  else clearStore(SESSION_KEY);
}

// Eight cryptographically random bytes as hex. Not Math.random: V8 implements it as
// xorshift128+, so a handful of outputs is enough to recover the state and predict the
// rest — and under open sign-up, knowing a handle is the same as being able to sign in as
// that person. Generating a name that can be exchanged for a token out of predictable
// numbers is the wrong thing to do.
//
// **But say it in full: this does not close the hole.** The handle is printed on every
// entry (`@{e.handle}`) and the timeline returns it. It is public. Anyone who reads
// `@guest_…` off the screen can exchange it at `/api/session` for a token and then edit or
// delete as that person. Entropy cannot defend a value that exists to be read.
//
// So one identity per visitor fixes **collisions**: visitor A no longer edits visitor B
// by accident, because they are no longer the same user. It is not a security boundary —
// the boundary is the open sign-up decision (CLAUDE.md decision table), taken knowing the
// cost. See operations.md §1.1.
function randomSuffix() {
  const bytes = new Uint8Array(8);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // An environment without a CSPRNG stopped existing long ago (IE11 had one). Even if we
  // land here the site must not break, and as said above this value is public anyway: it
  // was never protected by being hard to guess.
  return Array.from({ length: 8 },
    () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join("");
}

// One handle each, kept in the browser, so somebody returning is still themselves and the
// entries they wrote are still theirs.
//
// Why it has to be this way: when every visitor shared one handle, `author_id` was equal
// between them, so visitor A could edit and delete what visitor B wrote — the owner layer
// stopped that, but nothing stood between two visitors.
// Null when this browser cannot keep a handle. There used to be a fallback here that
// invented one for the page load, on the reasoning that being the same person for a while
// beats changing on every request. Measured on the deployment on 2026-09-16, that reasoning
// was worth less than it cost. The fallback lasted one page load, not a session — a refresh
// was a different person — while every one of those people was a permanent row in `users`
// and a permanent row in `access_grants`, because arriving redeems the join code. Anything
// that does not keep storage, which in practice means crawlers and link-preview fetchers
// rather than people, minted one per view. They collected on the share screen, which is the
// screen listing who has access to a storyboard.
//
// So the identity model's requirement is stated instead of worked around: Fencepost needs
// somewhere to remember who you are on this device. A browser that cannot do that is told,
// which is also more use to somebody in that position than silently becoming a stranger
// every time they reload.
export function visitorHandle() {
  if (HANDLE) return HANDLE;                     // an explicit setting wins (local dev, tests)
  const saved = readStore(HANDLE_KEY);
  if (saved) return saved;
  // The server checks the handle is 1..40 characters; this is 22.
  const made = "guest_" + randomSuffix();
  return writeStore(HANDLE_KEY, made) ? made : null;
}

// Whether this browser already knows who it is. The name screen asks this before rendering
// anything else, because the answer has to be settled before the first request goes out:
// once visitorHandle() has minted a random name there is nothing left to ask about, and
// changing a handle afterwards makes you a different user on the server.
export function hasHandle() {
  return !!HANDLE || !!readStore(HANDLE_KEY);
}

// Take a name and be that person. Returns the handle, or null if the name had nothing
// usable in it or the browser would not keep it — in both cases the caller carries on and
// lets visitorHandle() mint the random one, which is what everybody got until now.
//
// The storage key lives in this file and nowhere else. Spelling "fencepost.handle" a second
// time in the screen that writes it is how the two quietly drift apart.
export function chooseHandle(name) {
  const made = toHandle(name);
  if (!made) return null;
  return writeStore(HANDLE_KEY, made) ? made : null;
}

export const usesNetwork = MODE !== "fixtures";
export const assistantIsLive = MODE === "live";

// The token stays in memory. A refresh exchanges a new one, which costs nothing under open
// sign-up, and putting a bearer token in localStorage is asking for trouble.
let session = null;
let pending = null;

// The whole session is kept, not only the token: the interface needs user_id to tell
// whether an entry is its own (your own entry shows no vote buttons, and the server answers
// a vote on your own with 403 not_your_call) and whether you are the owner (only an owner
// can revoke access).
async function ensureSession() {
  if (session) return session;
  // Somebody who signed in stays signed in across a refresh. Nothing is verified here:
  // a token that has stopped working answers 401 on the first call that uses it, and
  // that is where it gets cleared. Checking up front would cost a round trip on every
  // page load to learn something the next request tells us anyway.
  const saved = readSession();
  if (saved) {
    session = saved;
    // The restored path has to offer the join code too, not only the path that exchanges a
    // fresh one. A code is replaced when it expires or when the level it grants changes, and
    // a signed-in person only ever comes back through here — so without this they keep
    // whatever the code gave them on the day they registered, for good, while every guest
    // around them is upgraded. Measured on 2026-09-15 against the deployment: a restored
    // session made one request, /api/dashboard, and left a stale mark exactly as it was.
    //
    // It costs nothing when there is nothing to do: joinDemo compares the mark first and
    // returns without a request.
    await joinDemo(saved.token, saved.user_id);
    return session;
  }
  const handle = visitorHandle();
  // No handle means this browser cannot keep one, and asking the server for a token anyway
  // would write a person into the database who can never come back as themselves. Said in
  // words instead — see visitorHandle.
  if (!handle) throw new Error(COPY.needsStorage);
  if (!pending) {
    pending = request("/api/session", { body: { handle } })
      .then(async (got) => {
        session = { ...got, account: false };
        await joinDemo(got.token, got.user_id);
        return session;
      })
      .finally(() => (pending = null));
  }
  return pending;
}

// Once a new visitor has a token, redeem the join code, or they open to an empty dashboard:
// that is the price of one identity per visitor — a new identity has access to no
// storyboard at all.
//
// What is remembered is **the code that was redeemed**, not the fact of having redeemed one.
// It used to write "1", which answers "has this browser ever joined?", and that is the wrong
// question. A join code does not last: the server allows at most 90 days, and the level it
// grants is a decision that can change. The moment a replacement is issued, every visitor
// who had already joined would skip it for good and stay on whatever the old code gave them
// — with nothing to see, because joining is silent and the difference only shows up as a
// missing button. Keying on the code means a new code is redeemed exactly once more, by
// everybody, and an unchanged one is still never redeemed twice.
//
// Keeping the code in localStorage exposes nothing: NEXT_PUBLIC_ puts it in the bundle in
// plaintext, which is where this copy came from.
//
// A failed redemption does not block anybody. The code may have expired or been turned off,
// and then the interface carries on and simply shows no demo storyboard — better than the
// whole site collapsing.
// The marks already redeemed in this browser, as a list. The old shape was a single string
// and is still read: a visitor who has one keeps it rather than redeeming again on the next
// page open, which would be invisible to them and one more use counted on the code.
function redeemedMarks() {
  const raw = readStore(JOINED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    return [raw];
  }
}

async function joinDemo(token, userId) {
  if (!userId || JOIN_TOKENS.length === 0) return;
  const done = redeemedMarks();
  for (const code of JOIN_TOKENS) {
    // The mark is the code **and** who redeemed it. Keyed on the code alone it was one
    // answer per browser, which was right while a browser was one person; registering an
    // account makes a second person in the same browser, and that person holds a grant to
    // nothing. They would sign up and land on an empty dashboard.
    const mark = code + "|" + userId;
    if (done.includes(mark)) continue;
    try {
      await request("/api/share-links/redeem", { body: { token: code }, auth: token });
      done.push(mark);
      writeStore(JOINED_KEY, JSON.stringify(done));
    } catch {
      /* this one did not take; the others still should, and it retries on the next open */
    }
  }
}

export async function me() {
  // Matches owner_id in the fixtures GRANTS, or the share screen can never work out that
  // "I am the owner" and the revoke button would never appear once.
  // Offline this has to agree with whoAmI(), or the dashboard header and the account
  // page show two different names for the same person.
  if (!usesNetwork) {
    const { user_id, handle } = offlineIdentity();
    return { user_id, handle };
  }
  const { user_id, handle } = await ensureSession();
  return { user_id, handle };
}

async function request(path, { method, body, auth } = {}) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  if (auth) headers.authorization = "Bearer " + auth;
  let response;
  try {
    response = await fetch(BASE + path, {
      method: method || (body ? "POST" : "GET"),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    // fetch rejects before there is a response at all: the network is down, DNS failed,
    // or the browser refused the origin. Every one of those arrives as a browser-specific
    // string, and putting one in front of somebody makes a reachability problem look like
    // a broken site.
    //
    // CORS lands here too, which matters on a deployment split across two projects: the
    // browser says only that it failed, never which origin was refused. The original is
    // kept on `cause`, so the console still has it while the screen does not.
    throw new ApiError(COPY.unreachable, 0, "unreachable", cause);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // The proxy always returns fixed copy, so it is safe to show the user directly.
    throw new ApiError(payload?.error?.message || "Something went wrong.", response.status,
                       payload?.error?.code);
  }
  return payload;
}

export class ApiError extends Error {
  constructor(message, status, code, cause) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.cause = cause;   // the browser own error, for the console rather than the screen
  }
}

async function call(path, options = {}) {
  const current = await ensureSession();
  try {
    return await request(path, { ...options, auth: current.token });
  } catch (err) {
    // A stored token stops working if the server secret is rotated or the row goes. Left
    // in place it fails every call for ever, and the interface reads as broken rather
    // than as signed out. Dropped here, the next page load starts again as a guest.
    if (err && err.status === 401) {
      session = null;
      saveSession(null);
    }
    throw err;
  }
}

// Accounts. Registering and signing in both answer with the same session shape
// /api/session does, so everything downstream is unchanged. `account` is the one thing
// added, and it is a client-side fact rather than something the server says: it records
// how this token was obtained, which is what the interface needs in order to offer
// "sign out" to a person who has an account and "sign in" to one who does not.
async function becomeAccount(path, handle, password) {
  const got = await request(path, { body: { handle, password } });
  session = { ...got, account: true };
  saveSession(session);
  await joinDemo(got.token, got.user_id);
  return session;
}

// Offline, the whole fixture dataset belongs to u_mel. Signing in therefore takes the name
// and keeps the user_id: change it and "this is your own entry" and "you own this
// storyboard" both stop being true, and the offline mode exists precisely so those can be
// shown with the network down. There is no password to check, because there is nothing to
// check it against; the screen is there to be walked, not to guard anything.
function becomeOffline(handle) {
  session = { user_id: "u_mel", handle, token: "offline", account: true };
  saveSession(session);
  return session;
}

export async function registerAccount(handle, password) {
  if (!usesNetwork) return becomeOffline(handle);
  return becomeAccount("/api/register", handle, password);
}

export async function signIn(handle, password) {
  if (!usesNetwork) return becomeOffline(handle);
  return becomeAccount("/api/login", handle, password);
}

export function signOut() {
  // The guest handle beside this is deliberately left alone. Signing out returns you to
  // being the guest you were before, rather than minting a new person on the server
  // every time somebody signs out.
  session = null;
  saveSession(null);
}

export async function whoAmI() {
  if (!usesNetwork) return offlineIdentity();
  const current = await ensureSession();
  return { user_id: current.user_id, handle: current.handle, account: !!current.account };
}

function offlineIdentity() {
  const saved = readSession();
  return saved
    ? { user_id: saved.user_id, handle: saved.handle, account: !!saved.account }
    : { user_id: "u_mel", handle: FIXTURES_HANDLE, account: false };
}

// ── Storyboards ────────────────────────
export async function dashboard() {
  if (!usesNetwork) return fixtures.dashboard();
  return call("/api/dashboard");
}

export async function createStoryboard(title) {
  if (!usesNetwork) return fixtures.createStoryboard(title);
  return call("/api/storyboards", { body: { title } });
}

export async function timeline(storyboardId) {
  if (!usesNetwork) return fixtures.timeline(storyboardId);
  return call("/api/timeline?storyboard_id=" + encodeURIComponent(storyboardId));
}

// Status is active | readonly | archived — there is no past value. The prototype wrote
// past, and copying that across meant the archived state could never fire (issue #22,
// finding 3).
//
// Written as an allow-list rather than status !== "active": /api/timeline does not return
// status, and the negated form reads undefined as archived, so a storyboard created a
// moment ago would carry a banner saying it had gone quiet. Blocking is the server job
// (storyboard_closed); the client only displays, and displaying it wrongly is a lie.
export function isArchived(status) {
  return status === "readonly" || status === "archived";
}

// "What can I do on this storyboard" — level and status, without the timeline.
//
// The two forum screens need it. They used to draw the new-thread button and the reply box
// unconditionally, while the server answers read_only_access for a view grant and
// storyboard_closed for an archived board: a button certain to be refused is exactly what
// the rule in web/README.md says not to draw.
//
// If it cannot be fetched, return an empty level and the interface treats it as read-only.
// Better one button too few than one that is a lie.
export async function boardAccess(id) {
  if (!usesNetwork) return fixtures.boardAccess(id);
  try {
    const boards = await dashboard();
    const board = [...boards.active, ...boards.past].find((b) => b.id === id);
    return { level: board?.level || null, status: board?.status || null };
  } catch {
    return { level: null, status: null };
  }
}

// The timeline carries nothing about the storyboard itself; dashboard does. Fetch both.
export async function storyboard(id) {
  if (!usesNetwork) return fixtures.timeline(id);
  const [boards, feed] = await Promise.all([dashboard(), timeline(id)]);
  const board = [...boards.active, ...boards.past].find((b) => b.id === id);
  return { ...(board || {}), ...feed };
}

// ── Posting ────────────────────────────
export async function submitEntry({ storyboardId, species, funFact, story, still }) {
  const body = {
    storyboard_id: storyboardId,
    species,                        // brushtail | ringtail | other | unknown
    fun_fact: funFact || undefined,
    story,
    // The frame the author masked, base64 without the data: prefix. Undefined where there
    // was no clip, which is the placeholder path and every browser that could not decode
    // one — the server stores nothing and the entry shows a placeholder, as before.
    still: still || undefined,
  };
  if (!usesNetwork) return fixtures.submitEntry(body);
  return call("/api/entries", { body });
}

// Edit your own entry. Changed fields go back through the Screener, and on a refusal **the
// original stays in the database untouched**; the server answers 200 with published:false —
// not an error, so do not expect catch to see it. A missing field means "leave that one
// alone": send only what changed.
export async function editEntry({ entryId, funFact, story }) {
  const body = { entry_id: entryId };
  if (funFact !== undefined) body.fun_fact = funFact;
  if (story !== undefined) body.story = story;
  if (!usesNetwork) return fixtures.editEntry(body);
  return call("/api/entries/edit", { body });
}

// Soft delete, effective immediately: the next timeline fetch does not have it, and the
// assistant's context loses it at the same moment (CLAUDE.md safety line: no cache, no TTL).
export async function deleteEntry(entryId) {
  if (!usesNetwork) return fixtures.deleteEntry(entryId);
  return call("/api/entries/delete", { body: { entry_id: entryId } });
}

// ── Assistant ──────────────────────────
export async function askAssistant(message, storyboardId) {
  if (!assistantIsLive) return delayed(fixtures.assistantReply(message));
  return call("/api/assistant", {
    body: { role: "neighbour", storyboard_id: storyboardId, message },
  });
}

export async function writerHelp(species, story) {
  if (!assistantIsLive) return delayed(fixtures.writer(species, story));
  return call("/api/assistant", {
    body: { role: "writer", species_selected: species, story_draft: story },
  });
}

// Identify a frame. There is no role:"vision" in the real API — it is a neighbour call
// carrying the frame and the user's confirmation. Without frame_consent, _admit answers
// frame_consent_missing (issue #22, finding 4).
export async function identifyFrame({ storyboardId, imageBase64 }) {
  if (!assistantIsLive) {
    return delayed({ role: "neighbour", reply: fixtures.VISION_REPLY,
                     prompt_version: fixtures.PROMPT_VERSION });
  }
  return call("/api/assistant", {
    body: {
      role: "neighbour",
      storyboard_id: storyboardId,
      message: "Which possum is this?",
      image_b64: imageBase64,
      frame_consent: true,
    },
  });
}

// The fixture answers instantly, but the interface has to show that it is thinking, so
// give it a real wait.
function delayed(value, ms = 650) {
  return new Promise((done) => setTimeout(() => done(value), ms));
}

// ── Review (a public community vote, not a system verdict) ──────
export async function castVote(entryId, vote) {
  // vote is looks_right or worth_checking. The server refuses an author voting on their
  // own entry, so the interface does not draw these two buttons there at all.
  if (!usesNetwork) return fixtures.castVote(entryId, vote);
  return call("/api/review/vote", { body: { entry_id: entryId, vote } });
}

// The second-look queue. **It never shows your own entries**, and it carries no author
// identity at all — the server SQL says `author_id != viewer`, and the returned fields have
// no handle or author_id in them. The author never being told (operations §2.3) is not the
// interface hiding it; the query does not carry it.
export async function reviewQueue(storyboardId) {
  if (!usesNetwork) return fixtures.reviewQueue(storyboardId);
  return call("/api/review?storyboard_id=" + encodeURIComponent(storyboardId));
}

// The owner's final disposal: kept | labelled | removed. removed is a soft delete.
export async function disposeEntry(entryId, action) {
  if (!usesNetwork) return fixtures.disposeEntry(entryId, action);
  return call("/api/review/dispose", { body: { entry_id: entryId, action } });
}

// ── Discussion ─────────────────────────
// Its own table, its own endpoints. The assistant context physically cannot reach it, and
// that is deliberate.
export async function forumThreads(storyboardId) {
  if (!usesNetwork) return fixtures.forumThreads(storyboardId);
  return call("/api/forum?storyboard_id=" + encodeURIComponent(storyboardId));
}

export async function readThread(threadId) {
  if (!usesNetwork) return fixtures.readThread(threadId);
  return call("/api/forum/thread?thread_id=" + encodeURIComponent(threadId));
}

export async function createThread({ storyboardId, title, body }) {
  if (!usesNetwork) return fixtures.createThread({ storyboardId, title, body });
  return call("/api/forum/threads", { body: { storyboard_id: storyboardId, title, body } });
}

export async function createPost({ threadId, body }) {
  if (!usesNetwork) return fixtures.createPost({ threadId, body });
  return call("/api/forum/posts", { body: { thread_id: threadId, body } });
}

export async function deleteForumPost(postId) {
  if (!usesNetwork) return fixtures.deleteForumPost(postId);
  return call("/api/forum/posts/delete", { body: { post_id: postId } });
}

// The owner clearing their own storyboard. A different endpoint from the two above, and
// deliberately so: those are "mine, and I am withdrawing it", this is "not mine, and I own
// the space it is in". The server records who did it; taking somebody else's words down
// without a name on it is the arrangement this replaced.
export async function removeEntry(entryId) {
  if (!usesNetwork) return fixtures.removeEntry(entryId);
  return call("/api/entries/remove", { body: { entry_id: entryId } });
}

export async function removeForumPost(postId) {
  if (!usesNetwork) return fixtures.deleteForumPost(postId);
  return call("/api/forum/posts/remove", { body: { post_id: postId } });
}

// Your own record of what you have written. There is deliberately no version of this that
// takes somebody else's id: the reason it is allowed to exist at all is that it describes
// nobody but you, and an endpoint that answered about a neighbour would be the thing the
// decision table rules out under another name.
export async function myRecord() {
  if (!usesNetwork) return fixtures.myRecord();
  return call("/api/record");
}

// ── Sharing and access ─────────────────
export async function issueShareLink({ storyboardId, level, expiresInDays }) {
  if (!usesNetwork) return fixtures.issueShareLink({ storyboardId, level, expiresInDays });
  return call("/api/share-links", {
    body: { storyboard_id: storyboardId, level, expires_in_days: expiresInDays },
  });
}

export async function redeemShareLink(token) {
  if (!usesNetwork) return fixtures.redeemShareLink(token);
  return call("/api/share-links/redeem", { body: { token } });
}

export async function grants(storyboardId) {
  if (!usesNetwork) return fixtures.grants(storyboardId);
  return call("/api/grants?storyboard_id=" + encodeURIComponent(storyboardId));
}

// Am I the owner of this storyboard?
//
// Only an owner can close one (the server close_storyboard answers not_the_owner), and an
// owner always holds reshare — so anything below reshare returns false without asking.
// That also sidesteps the /api/grants gate: that endpoint needs reshare to read, and
// owner_id is given only to them on purpose.
//
// owner_id was not added to /api/dashboard so as not to widen that field to people holding
// only view.
export async function isOwner(storyboardId, level) {
  if (level !== "reshare") return false;
  try {
    const [access, who] = await Promise.all([grants(storyboardId), me()]);
    return !!who && who.user_id === access.owner_id;
  } catch {
    return false;
  }
}

// The owner closing it deliberately, optionally with a closing line. **Irreversible** — no
// endpoint can open it again — and it deletes the assistant conversation on this storyboard
// as well (the DELETE inside db.close_storyboard). The interface has to say both.
export async function closeStoryboard({ storyboardId, closedNote }) {
  const body = { storyboard_id: storyboardId };
  if (closedNote) body.closed_note = closedNote;
  if (!usesNetwork) return fixtures.closeStoryboard(body);
  return call("/api/storyboards/close", { body });
}

// The codes this storyboard has issued. **Never the token** — the database holds only a
// SHA-256, and the plaintext existed for one moment at issue time. So the list knows which
// level, who issued it, when it expires and whether it still works, not what the code is.
// Revoked ones are listed too: after turning one off you have to see that it took.
export async function shareLinks(storyboardId) {
  if (!usesNetwork) return fixtures.shareLinks(storyboardId);
  return call("/api/share-links?storyboard_id=" + encodeURIComponent(storyboardId));
}

// Turn a code off. **It does not revoke access already redeemed with it** — that is a
// separate thing, through revokeGrant. The server gate is "you issued it, or you are the
// owner", not reshare: somebody with reshare cannot turn off a code another person issued.
export async function revokeShareLink(shareLinkId) {
  if (!usesNetwork) return fixtures.revokeShareLink(shareLinkId);
  return call("/api/share-links/revoke", { body: { share_link_id: shareLinkId } });
}

export async function revokeGrant({ storyboardId, userId }) {
  if (!usesNetwork) return fixtures.revokeGrant({ storyboardId, userId });
  return call("/api/grants/revoke", { body: { storyboard_id: storyboardId, user_id: userId } });
}

// Offline degradation for the demo. Set offline and the assistant area shows the degraded
// copy while the input stays usable — this is the state prototype-user-flow asks for, not
// error handling.
export const assistantOffline = process.env.NEXT_PUBLIC_FENCEPOST_ASSISTANT === "offline";
