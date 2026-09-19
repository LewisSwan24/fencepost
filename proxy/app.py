"""One endpoint, dispatched by role. Four hard rules close here:
rate limiting, fail-open, Writer validation, and never leaking an error outward.
"""

import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import auth, roles
from .model import UpstreamError, redact
from .ports import (CEILINGS, MemoryContext, MemoryHistory, MemoryRateLimiter,
                    MemoryScreeningLog, PermissionDenied, RateLimited)

# Which ceiling each role counts against. operations.md §3 lists chat, vision and
# submission and says nothing about the Writer, so it is folded into chat for now; the
# doc needs a line added (see the stage 3 report).
SCOPE = {"neighbour": "chat", "writer": "chat", "screener": "submission"}

FIELDS = {"fun_fact", "story", "forum_post"}
SUBJECTS = {"entry", "forum_post", "submission"}
# What a request from outside may screen. The other two subject kinds are real rows that
# belong to somebody, and they are only ever written by the server about its own work —
# see the note in _screener.
CALLER_SUBJECTS = {"submission"}
SPECIES = {"brushtail", "ringtail", "other", "unknown"}
WRITE_LEVELS = {"contribute", "reshare"}          # view can only look
LEVEL_RANK = {"view": 0, "contribute": 1, "reshare": 2}
# How long a share code lasts when the request does not say. Decided 2026-09-18.
#
# A code is handed over in person — shown on a phone at the fence, or sent to a neighbour to
# scan that evening. Seven days covers that with a weekend of slack, and a code that is
# photographed, forwarded or left on a screenshot goes stale inside a week instead of standing
# as an open invitation for a season. Twenty-four hours is the safer number and breaks the
# ordinary case, the neighbour who scans it next weekend; thirty is a month of somebody else's
# screenshot being a way in. The owner can pick any of 1, 7, 30 or 90 on the share screen, so
# this only decides what they are offered first.
#
# This used to read a SHARE_LINK_DAYS environment variable, and that variable could not do
# what its name said. The share screen always sends expires_in_days, so the server default
# only ever reached callers that omit the field, which in practice meant nobody: setting it
# on the deployment would have changed nothing a person sees. A knob that silently does
# nothing is worse than no knob, so it is gone. The same number lives in web/lib/copy.js as
# DEFAULT_EXPIRY_DAYS — two languages, so two places — and test_resources pins them together.
#
# scripts/issue_join_code.py defaults to 90 on purpose: the demo join code has to outlive the
# exhibit it is printed for (operations.md). That is an exception, not drift.
SHARE_LINK_DAYS = 7

# Length caps for the two fields on an entry. A story is the same kind of free text as a
# forum body, which is already capped at 4000, so it takes the same number. A fun fact is
# one fact rather than a paragraph: 500 is generous for that and still stops a pasted
# document arriving in a field meant for a sentence.
FUN_FACT_LIMIT = 500
STORY_LIMIT = 4000

# The masked frame an entry carries, as base64. The client draws it at card width and about
# 25 kB, so 120,000 characters is roughly five times what it should ever send — a ceiling on
# a client gone wrong, not a size anybody will meet. It is deliberately not generous: every
# entry on a timeline carries one, and a storyboard opened on a phone at the fence pays for
# all of them at once.
STILL_LIMIT = 120_000
# The standard alphabet with its padding, which is exactly what lib/stills.js base64Of emits.
# Every character in it is ASCII, so a still's length in characters is its size in bytes in
# the JSON - the assumption TIMELINE_PAGE's arithmetic rests on.
_BASE64 = re.compile(r"[A-Za-z0-9+/]+={0,2}")

# How many entries one /api/timeline response carries.
#
# This number is not a taste in page length, it is arithmetic. A Vercel function's response
# body is capped at 4.5 MB and over it the platform answers 413 FUNCTION_PAYLOAD_TOO_LARGE
# (vercel.com/docs/functions/limitations, read 2026-09-17) — so an unbounded timeline does not
# get slow as a storyboard fills up, it stops working, and the cliff is invisible until a real
# storyboard walks off it. Measured on this schema: 25.4 kB per entry at the size the mask
# screen actually produces, 117.6 kB at STILL_LIMIT. That is 181 entries to the cliff in the
# ordinary case and 39 from a client sending frames at the ceiling.
#
# 20 rows is therefore about 500 kB in the ordinary case and 2.4 MB in the worst one, which
# leaves most of the budget unspent even against a client gone wrong. The client does not get
# to choose it: a page size is a constraint the server knows and the caller does not, and a
# limit somebody may pass is one somebody may pass 10,000 to. test_resources pins
# TIMELINE_PAGE * STILL_LIMIT against the platform cap so the two cannot drift apart quietly.
#
# The real fix for the underlying shape is to stop putting images in JSON at all — a URL into
# object storage, fetched by the browser and cached by a CDN, which would make the page size a
# UX question again instead of a payload one. That is a migration, not a patch; this bounds the
# damage in the meantime.
TIMELINE_PAGE = 20

# What may be handed to the model, in characters.
#
# Everything the Screener sees was already bounded — fun_fact, story, titles and the closing
# note all go through _plain_text. The three role endpoints were not: a question to the
# assistant, a story draft for the Writer and a submission to the Screener each reached the
# model at whatever length arrived, and so did the image beside them. Under
# FENCEPOST_OPEN_SIGNUP anybody can swap a handle for a token, so "uncapped free text into a
# paid endpoint" is a sentence with no qualifier left on it.
#
# A question is a question; nobody needs two thousand characters to ask one. The draft and
# the submission take the limit of the field they come from, so the door and the database
# agree about what is too long.
MESSAGE_LIMIT = 2_000
# A 720px JPEG at the quality lib/stills.js uses runs 80–150 KB, so roughly 110–200k
# characters of base64. Twice the top of that, and still not enough to post a film through.
IMAGE_B64_LIMIT = 400_000

# Accounts. A handle is one word that sits next to what somebody wrote, so 24 is generous
# and 3 stops a single letter. The password floor is 8; the ceiling is not a rule about
# passwords but about scrypt, which is deliberately expensive and should not be pointed at
# a megabyte of text by anybody who asks.
HANDLE_MIN = 3
HANDLE_MAX = 24
PASSWORD_MIN = 8
PASSWORD_MAX = 200

# Copy sent to the client is always fixed; where ux-copy.md has a line, that line is used.
# Upstream errors, prompt contents and keys never travel outward, not a word.
COPY = {
    "unauthorized": "Sign in again to keep using the assistant.",
    "no_access": "You do not have access to this storyboard.",
    "bad_request": "The assistant could not read that request.",
    "not_found": "There is nothing at that address.",
    "signup_closed": "Sign-up is closed on this deployment.",
    "read_only_access": "You can read this storyboard, but not add to it.",
    "storyboard_closed": "This storyboard is closed to new entries.",
    "not_your_entry": "You can only change your own entries.",
    "gone": "That entry is no longer there.",
    "invalid_link": "That link does not work.",
    "link_revoked": "That link has been turned off.",
    # Said plainly rather than as "invalid link". Somebody who was removed and scans the
    # old code again should learn that the code still works and they do not, which is the
    # truth and is what tells them to ask the owner rather than hunt for a fresher QR.
    "access_revoked": "Your access to this storyboard was turned off. The owner can add you back.",
    "link_expired": "That link has expired.",
    "link_used_up": "That link has been used as many times as it allows.",
    "cannot_share": "You cannot hand out access to this storyboard.",
    "not_the_owner": "Only the storyboard owner can do that.",
    # Never reached from the interface, which offers Sign out only to an account. It exists
    # for a caller who asks anyway: a guest identity has no sign-in to end.
    "not_an_account": "There is nothing to sign out of: this is a guest identity, not an account.",
    "not_your_call": "You cannot vote on your own entry.",
    "frame_consent_missing": "The frame needs the consent step before it can be sent.",
    "upstream_unavailable": "The assistant is offline right now. Writing and posting work as normal.",
    "rate_limited_chat": "You have used today's assistant allowance. Writing, posting and sharing all still work.",
    "rate_limited_vision": "You have used this hour's frame identifications. You can still ask in words.",
    "rate_limited_submission": "That is a lot of posts in a short time. Try again shortly.",
    "bad_handle": "A name needs 3 to 24 characters and no spaces.",
    "weak_password": "A password needs at least 8 characters.",
    "handle_taken": "That name is taken. Try another one.",
    # One sentence for every way of failing to sign in. Saying which half was wrong tells
    # somebody whether that name exists, which is the first thing worth knowing to an
    # attacker and of no use at all to the person who mistyped their own password.
    "bad_credentials": "That name and password do not match.",
    "use_password": "That name has an account. Sign in with its password.",
    "not_in_review": "That post is not waiting on a second look.",
    "not_your_post": "You can only take down your own posts.",
    "rate_limited_login": "Too many sign-in attempts. Try again in a few minutes.",
    "rate_limited_session": "Too many new sessions from this network right now. Try again in a little while.",
}


@dataclass
class Deps:
    client: object
    limiter: object = field(default_factory=MemoryRateLimiter)
    history: object = field(default_factory=MemoryHistory)
    context: object = field(default_factory=MemoryContext)
    screening: object = field(default_factory=MemoryScreeningLog)
    db: object = None                            # resource endpoints write directly; the assistant path does not
    # The ceilings that belong to no user (operations.md §3). None means /api/session is not
    # limited per address; the model ceiling lives on the client itself, see CappedClient.
    ceilings: object = None


def _error(code: str, copy_key: str = None, **extra) -> dict:
    return {"error": {"code": code, "message": COPY[copy_key or code], **extra}}


def _plain_text(value, limit: int, multiline: bool = False):
    """Validate a piece of free text, returning (cleaned value, is it acceptable).

    Two jobs, and the second was added on 2026-09-17.

    For **the fields the Screener never sees** — the storyboard title, the forum thread
    title, the closing line — this is the only layer there is, so it has to stop what no
    model is needed for: wrong type, too long, hidden control characters, and "a few spaces",
    which lands in the database and shows up in the interface as a blank nobody can identify.

    For **the text going to the model** — a question to the assistant, a draft for the
    Writer, a submission to the Screener — it is the door. Those three arrived uncapped,
    which under FENCEPOST_OPEN_SIGNUP means anybody holding a token could point unbounded
    free text at a paid endpoint. Screening happens after; a length check does not need a
    model and should not wait for one.

    `None` passes through untouched (an optional field); empty after strip counts as not
    given rather than as an empty string. Why these are not screened as well: see
    operations.md §1.1. In short, neither path has a model call to ride along with, and a
    `review` verdict has nowhere to land on a title.
    """
    if value is None:
        return None, True
    if not isinstance(value, str):
        return None, False
    text = value.strip()
    if not text:
        return None, True
    if len(text) > limit:
        return None, False
    allowed = "\n\t" if multiline else ""
    if any(ch < " " and ch not in allowed or ch == "\x7f" for ch in text):
        return None, False
    return text, True


def _image_b64(value):
    """The optional frame beside a question. Returns (value, ok).

    Not run through _plain_text: base64 has no control characters to strip and no
    "a few spaces" case, so length and type are the whole of it.
    """
    if value is None:
        return None, True
    if not isinstance(value, str) or len(value) > IMAGE_B64_LIMIT:
        return None, False
    return value, True


def _admit(body: dict, token: str, deps: Deps):
    """Identify, check the role, charge the quota.

    Allowed returns (user_id, None); blocked returns (None, (status, payload)).
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return None, refusal

    role = body.get("role")
    if role not in SCOPE:
        return None, (400, _error("bad_request"))

    try:
        deps.limiter.check_and_count(user_id, SCOPE[role])
        if role == "neighbour" and body.get("image_b64"):
            # §2.5.1 item 5 is a client-side confirmation step; this blocks it again, so no
            # frame is sent without the confirmation.
            if not body.get("frame_consent"):
                return None, (400, _error("frame_consent_missing"))
            deps.limiter.check_and_count(user_id, "vision")
    except RateLimited as limited:
        return None, (429, _error("rate_limited", f"rate_limited_{limited.scope}",
                                  scope=limited.scope))
    return user_id, None


def handle(body: dict, token: str, deps: Deps):
    """Returns (http_status, payload). The payload is always safe to hand to the client."""
    body = body or {}
    user_id, refusal = _admit(body, token, deps)
    if refusal:
        return refusal
    role = body["role"]

    try:
        if role == "neighbour":
            return _neighbour(body, user_id, deps)
        if role == "writer":
            return _writer(body, deps)
        return _screener(body, user_id, deps)
    except PermissionDenied:
        return 403, _error("no_access")
    except UpstreamError:
        # A Neighbour timeout never fabricates a reply (prompts.md §5); the client offers a retry.
        return 503, _error("upstream_unavailable")
    except Exception as exc:
        print(f"[proxy] unhandled: {redact(str(exc))[:300]}", file=sys.stderr)
        return 503, _error("upstream_unavailable")


def _neighbour(body: dict, user_id: str, deps: Deps):
    storyboard_id = body.get("storyboard_id")
    message, message_ok = _plain_text(body.get("message"), MESSAGE_LIMIT, multiline=True)
    image, image_ok = _image_b64(body.get("image_b64"))
    if not storyboard_id or not message or not message_ok or not image_ok:
        return 400, _error("bad_request")
    # The permission gate and the context both live on the server. history and context in
    # the request body are ignored even when present.
    _settle(deps)
    context = deps.context.build(user_id, storyboard_id)
    history = deps.history.recent(user_id, storyboard_id)
    result = roles.neighbour(deps.client, context, history, message, image)
    # Stored is sent, byte for byte: the user turn went out as this bare message (the
    # context block rides with the system prompt — roles._context_block), so the next
    # call replays history unchanged and the prefix cache survives the turn boundary.
    # Wrapping what is stored here would break the cache and keep deleted entry text
    # alive inside history, past the invariant that a deletion takes effect at once.
    deps.history.append(user_id, storyboard_id, "user", message)
    # Every model call stores the prompt version alongside it (CLAUDE.md working rule 2)
    deps.history.append(user_id, storyboard_id, "assistant", result["reply"],
                        prompt_version=result["prompt_version"],
                        model=getattr(deps.client, "chat_model", None))
    return 200, {"role": "neighbour", "reply": result["reply"], "prompt_version": result["prompt_version"]}


def _writer(body: dict, deps: Deps):
    draft, draft_ok = _plain_text(body.get("story_draft", ""), STORY_LIMIT, multiline=True)
    if not draft_ok:
        return 400, _error("bad_request")
    result = roles.writer(deps.client, body.get("species_selected", "unknown"), draft or "")
    return 200, {
        "role": "writer",
        "fun_facts": result["fun_facts"],
        "tidied_story": result["tidied_story"],
        "question": result["question"],
        "skipped": result["skipped"],
        "prompt_version": result["prompt_version"],
    }


def _screener(body: dict, user_id: str, deps: Deps):
    submission, submission_ok = _plain_text(body.get("submission"), STORY_LIMIT, multiline=True)
    if submission is None or not submission_ok or body.get("field") not in FIELDS:
        return 400, _error("bad_request")
    subject_type = body.get("subject_type", "submission")
    subject_id = body.get("subject_id")
    # A caller may screen loose text and nothing else. This used to accept "entry" and
    # "forum_post" with an id of the caller's choosing, and _admit is only token, role and
    # quota — so anybody with a token, holding `view` or holding no grant at all, could file
    # a review verdict against somebody else's entry with reason codes of their choosing.
    # That put the victim's entry in the storyboard's review queue, made awaiting_review
    # true, and so handed the owner a working remove button for an entry nobody had
    # flagged. The audit row also recorded the attacker as the author of text they never
    # wrote. Found by an adversarial review on 2026-09-16 and reproduced end to end.
    #
    # Nothing legitimate is lost. The places a screening is recorded against a real subject
    # — submit_entry, create_post and the forum edit — call _record_screening directly,
    # server-side, with an author and an id the server itself established. No client has
    # ever sent subject_type at all.
    if subject_type not in CALLER_SUBJECTS:
        return 400, _error("bad_request")
    subject_id = None
    internal = roles.screener(deps.client, body.get("species_selected", "unknown"),
                              body["field"], submission)
    _record_screening(deps, internal, body["field"], submission, subject_type, subject_id,
                      author_id=user_id)
    # A review verdict is invisible to the author (operations.md §2.3), so the client is
    # told only whether it can post; verdict, codes, note and fail_open stay server-side.
    published = internal["verdict"] != "reject"
    payload = {"role": "screener", "published": published, "prompt_version": internal["prompt_version"]}
    if not published:
        payload["reason_codes"] = internal["codes"]
    return 200, payload


class StreamSession:
    """The stream itself, plus a storing step that runs only after the whole run finishes.

    Cutting out halfway stores nothing. §5 says a failed Neighbour must not fabricate a
    reply, and half a reply is a fabrication too.
    """

    def __init__(self, stream, deps: Deps, user_id: str, storyboard_id: str, message: str):
        self.prompt_version = stream.prompt_version
        self._stream = stream
        self._deps = deps
        self._user_id = user_id
        self._storyboard_id = storyboard_id
        self._message = message

    def __iter__(self):
        return iter(self._stream)

    def finish(self) -> None:
        # The bare message is exactly what went out as the user turn — see _neighbour.
        self._deps.history.append(self._user_id, self._storyboard_id, "user", self._message)
        self._deps.history.append(
            self._user_id, self._storyboard_id, "assistant", self._stream.text,
            prompt_version=self.prompt_version,
            model=getattr(self._deps.client, "chat_model", None))


def handle_stream(body: dict, token: str, deps: Deps):
    """Streaming is open to the Neighbour only. Success returns (200, StreamSession);
    failure takes the same shape as handle.
    """
    body = body or {}
    if body.get("role") != "neighbour":
        return 400, _error("bad_request")
    user_id, refusal = _admit(body, token, deps)
    if refusal:
        return refusal
    storyboard_id = body.get("storyboard_id")
    message, message_ok = _plain_text(body.get("message"), MESSAGE_LIMIT, multiline=True)
    image, image_ok = _image_b64(body.get("image_b64"))
    if not storyboard_id or not message or not message_ok or not image_ok:
        return 400, _error("bad_request")
    try:
        context = deps.context.build(user_id, storyboard_id)
        history = deps.history.recent(user_id, storyboard_id)
    except PermissionDenied:
        return 403, _error("no_access")
    try:
        stream = roles.neighbour_stream(deps.client, context, history, message, image)
    except UpstreamError:
        # The model ceiling refuses when the stream is asked for, before a byte of SSE has
        # gone out, so it can still be the same plain 503 the non-streaming path gives.
        return 503, _error("upstream_unavailable")
    return 200, StreamSession(stream, deps, user_id, storyboard_id, message)


# ---------- resource endpoints ----------

def _handle(value):
    """A display name: one word, shown as @handle beside what a person wrote.

    Deliberately not restricted to ASCII. This product already refuses to treat non-English
    writing as second class (operations.md §4.3 and the language floor), and somebody's name
    is a worse place to start than their sighting. What is refused is whitespace inside it,
    because the interface renders it as one token and a space there reads as two people.
    """
    text, ok = _plain_text(value, HANDLE_MAX)
    if not ok or not text or len(text) < HANDLE_MIN or any(c.isspace() for c in text):
        return None, False
    return text, True


def register(body: dict, deps: Deps):
    """Create an account with a password.

    Not behind FENCEPOST_OPEN_SIGNUP, unlike /api/session: this endpoint is the thing that
    makes that flag removable. Open sign-up exists because there was no other way to become
    somebody; once there is, the flag is only needed by the demo's join flow and by the
    scripts that walk the deployment.

    There is no password reset, because there is no email service. Say so on the form.
    """
    handle, ok = _handle(body.get("handle"))
    if not ok:
        return 400, _error("bad_handle")
    password = body.get("password")
    if not isinstance(password, str) or not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        return 400, _error("weak_password")
    user_id = deps.db.create_account(handle, auth.hash_password(password))
    if user_id is None:
        return 409, _error("handle_taken")
    return 200, {"user_id": user_id, "handle": handle, "token": _mint(deps, user_id)}


def login(body: dict, deps: Deps):
    """Exchange a handle and password for the same token /api/session hands out.

    A malformed handle answers 401 rather than 400. Telling somebody their input was not a
    valid handle is a small oracle, and there is nothing a real person gains from the
    distinction: either way, they cannot get in with what they typed.

    The ceiling is counted before the password is checked, so a wrong guess costs the same
    as a right one. It is counted only when the handle belongs to somebody, because
    rate_limits.user_id is a foreign key with nowhere to point otherwise — and an identity
    with no password is one that guessing cannot open anyway.
    """
    handle, ok = _handle(body.get("handle"))
    password = body.get("password")
    if not ok or not isinstance(password, str):
        return 401, _error("bad_credentials")
    record = deps.db.user_by_handle(handle)
    if record is not None:
        try:
            deps.limiter.check_and_count(record["id"], "login")
        except RateLimited:
            return 429, _error("rate_limited_login")
    # check_password against None still does the work, so "no such person" and "wrong
    # password" take the same time as well as saying the same thing.
    if not auth.check_password(password, record["password_hash"] if record else None):
        return 401, _error("bad_credentials")
    return 200, {"user_id": record["id"], "handle": record["handle"],
                 "token": _mint(deps, record["id"])}


def create_session(body: dict, deps: Deps, address: str = None):
    """Demo-grade identity: hand over a handle and get a token, with no password.

    Which is why it is off by default. Anyone can exchange somebody else's handle for a
    token, and in a real environment that is impersonation, so turning it on means setting
    FENCEPOST_OPEN_SIGNUP explicitly.

    `address` is the client's, as the entry point saw it. It only feeds the per-address
    ceiling on minting tokens, and only ever as a keyed hash, never stored as it came.
    """
    if not os.getenv("FENCEPOST_OPEN_SIGNUP"):
        return 403, _error("signup_closed")
    handle = (body.get("handle") or "").strip()
    if not handle or len(handle) > 40:
        return 400, _error("bad_request")
    # An identity that has a password is an account, and an account is entered through
    # /api/login. Without this line the two endpoints contradict each other: /api/login
    # refuses a wrong password with some care, and the door beside it hands out a token for
    # the same person to anybody who types their name. Measured on the deployment on
    # 2026-09-15 — register, then ask /api/session for that handle, and it answers 200 with
    # a token for the same user_id. The password was decorative.
    #
    # It does admit that a given handle is registered, which open sign-up otherwise hides.
    # That is the smaller of the two: handles are printed beside everything their owner
    # writes, so they were never secret, while a password that can be walked around is not
    # a password at all.
    existing = deps.db.user_by_handle(handle)
    if existing is not None and existing["password_hash"]:
        return 403, _error("use_password")
    # Counted here, after every refusal above, so only a request that is about to mint a
    # token spends a slot. Per address rather than per handle, because a fresh handle is
    # exactly what an open door hands out for free.
    if deps.ceilings is not None and address:
        cap, window = CEILINGS["session"]
        if not deps.ceilings.claim("session:" + auth.address_key(address), cap, window):
            return 429, _error("rate_limited", "rate_limited_session", scope="session")
    user_id = deps.db.ensure_user(handle)
    return 200, {"user_id": user_id, "handle": handle, "token": _mint(deps, user_id)}


def my_record(params: dict, token: str, deps: Deps):
    """Your own record of what you have written. Yours alone, and about nobody else.

    There is no equivalent for looking at somebody else's, and there should not be: the
    decision this is allowed to exist under is that it characterises nobody, and an endpoint
    that took a user id would be the thing CLAUDE.md rules out wearing a different name.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    return 200, deps.db.my_record(user_id)


def create_storyboard(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    # The title never reaches the Screener, so this layer judges everything no model is
    # needed for: type, length, control characters, and "a few spaces". Reasons and
    # trade-offs in operations.md §1.1.
    title, ok = _plain_text(body.get("title"), 120)
    if not ok:
        return 400, _error("bad_request")
    # add_storyboard hands the owner a grant too, or they cannot enter their own storyboard
    return 200, {"storyboard_id": deps.db.add_storyboard(user_id, title), "title": title}


def _settle(deps: Deps) -> None:
    """Settle before touching a storyboard: 30 days quiet turns it read-only.

    No cron; whoever touches it settles it.
    """
    if deps.db is not None:
        deps.db.settle_stale()


def _purge(deps: Deps) -> None:
    """Screening records disposed of more than 30 days ago should go (operations.md §1,
    the retention table).

    Same approach as settle_stale and settle_review: no cron, whoever touches this table
    clears it in passing. This promise used to be empty — `purge_screening()` was written
    and tested but had no caller at all, so the line in the retention table saying deleted
    30 days after disposal had never once happened.

    **Its position differs from the other two on purpose: this one goes after the
    permission gate.** The other two only flip a status bit; this one DELETEs. And
    `FENCEPOST_OPEN_SIGNUP` is on in production (CLAUDE.md decision table), which makes
    holding a valid token the same thing as being anybody on the internet. A caller who is
    about to be refused should not be able to drive a table-wide delete.
    """
    if deps.db is not None:
        deps.db.purge_screening()


def _identify(token: str, deps: Deps):
    """(user_id, None) or (None, refusal). See _identify_stamped for what it checks."""
    user_id, _, refusal = _identify_stamped(token, deps)
    return user_id, refusal


def _identify_stamped(token: str, deps: Deps):
    """Allowed gives (user_id, issued_at, None); unrecognised (None, None, (401, payload)).

    Two checks, in two layers on purpose. auth.verify has no database dependency and answers
    what the token says about itself: the signature, and whether it is inside
    TOKEN_TTL_SECONDS. Revocation is the part that cannot be answered from the token alone —
    somebody signed out after it was issued — so it is read here, where there is a database.

    The cost is one SELECT on an indexed primary key per authenticated request. Every one of
    these already reads access_grants a line or two later, so it is another small read on a
    path that was never dependency-free, not a new kind of work.
    """
    try:
        user_id, issued_at = auth.verify(token)
    except auth.AuthError:
        return None, None, (401, _error("unauthorized"))
    # Deps.db is None on the assistant-only path, which is a configuration this module
    # supports on purpose (see the field, and ports.py). A deployment with no store has no
    # revocation list to consult and no sign-out endpoint that could write one, so the token
    # stands on its signature and its age. api/index.py always provides a database, so this
    # is not the shape anything is actually served from.
    if deps.db is not None:
        cutoff = deps.db.tokens_valid_from(user_id)
        # None is "no such person": a token signed for a row that has since gone, most
        # plausibly after scripts/teardown_demo.py. Refusing it is what lets the client's
        # 401 recovery run; admitting it produced a ghost that could read nothing and write
        # nothing and was never told why.
        if cutoff is None or issued_at < cutoff:
            return None, None, (401, _error("unauthorized"))
    return user_id, issued_at, None


def _mint(deps: Deps, user_id: str) -> str:
    """Issue a token that is guaranteed to be on the right side of this person's cutoff.

    sign_out writes its cutoff past the token that asked, and that cutoff can be ahead of
    this instance's clock - it may have been written by a faster instance, or be one past a
    token that a faster instance stamped. A token stamped with plain now() could then land
    below it and be refused the moment it was handed over: signing back in after signing
    out would fail for as long as the drift lasted. Stamping at max(now, cutoff) puts it on
    or above the line, and _identify admits equality. That holds on any instance whose clock
    is within verify's five minutes of the one that wrote the cutoff - the assumption verify
    makes of every token anyway. An earlier version of this said "always good"; beyond that
    skew a minted token reads as from the future. NTP keeps real skew to milliseconds.
    """
    floor = deps.db.tokens_valid_from(user_id) if deps.db is not None else 0
    return auth.issue(user_id, max(auth.now_ms(), floor or 0))


def sign_out(body: dict, token: str, deps: Deps):
    """Sign out: refuse every token this person holds, including the one used to ask.

    Until 2026-09-18 signing out was a front-end act only — it cleared localStorage and the
    token stayed valid, unbounded, for ever. So the button said something the server had
    never agreed to. This is the server agreeing.

    All of this person's tokens, not this one. There is no session table and no device list
    to be selective with, and "sign out" on the only button the product has is fairly read
    as all of them. A signed-in account is the case that matters: its token lives in
    localStorage, there is no password reset, and before this nothing at all took it back.

    Idempotent in effect. A second call arrives with a token the first one refused, so it is
    a 401 - signed out either way, which is the state the caller wanted.

    The cutoff is written past the token that asked, not at this instance's "now". Tokens
    are minted on whichever instance answers, and one can run fast: a token stamped a minute
    ahead of this clock would otherwise be later than the cutoff, survive, and leave its
    holder told signed_out while still signed in - every time they tried. The same goes for
    two readings inside one tick of a coarse clock. max(now, issued_at + 1) kills the asking
    token whatever the clocks do, and _mint stamps the next sign-in on or above the line.
    It is the asking token that is clock-proof: another device's token, stamped by an instance
    running ahead of this one, outlives the cutoff by at most that instance's lead.

    Accounts only. Under FENCEPOST_OPEN_SIGNUP anybody who reads a guest's @handle off a
    storyboard can exchange it for a token, and so could revoke that guest's tokens - in a
    loop, faster than the client's one retry - and lock them out of their own identity. A
    guest gains nothing from signing out anyway: the same handle re-exchanges at once. An
    account's token needs its password to obtain, so only its holder can reach this.
    """
    # The stamp comes back from the one check. A second verify, here, could see a token that
    # had expired in the moment between them and escape as a 500. Found by the pre-deploy recheck.
    user_id, issued_at, refusal = _identify_stamped(token, deps)
    if refusal:
        return refusal
    if not deps.db.is_account(user_id):
        return 403, _error("not_an_account")
    deps.db.revoke_tokens(user_id, at_least=issued_at + 1)
    return 200, {"signed_out": True}


def _record_screening(deps: Deps, result: dict, field: str, text: str,
                      subject_type: str, subject_id, author_id=None) -> None:
    deps.screening.record({
        **result,
        "field": field,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "author_id": author_id,
        # operations.md §1: an ok verdict keeps no original text, to reduce what is retained
        "original_text": None if result["verdict"] == "ok" else text,
        "model": getattr(deps.client, "screener_model", None),
    })


def register_video(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storage_key = body.get("storage_key")
    if not isinstance(storage_key, str) or not 1 <= len(storage_key) <= 200:
        return 400, _error("bad_request")
    return 200, {"video_id": deps.db.add_video(user_id, storage_key)}


def submit_entry(body: dict, token: str, deps: Deps):
    """Submit an entry: screen first, create only if it passes.

    fun_fact and story are screened separately (the prompts.md §4.3 template takes one field
    at a time). If either is rejected the whole entry stays unposted; if neither is, it posts
    as normal — including when it was marked review. The response gives no sign of review,
    because operations.md §2.3 requires that the author is never told.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = body.get("storyboard_id")
    species = body.get("species")
    # The Screener judges what a piece of writing says, not what shape it arrives in.
    # These two were the only free text reaching the database without passing through
    # _plain_text, on the assumption that being screened was protection enough. Measured
    # on 2026-09-14, it is not: a list in `story` reached the INSERT and took the whole
    # function down with a ProgrammingError and no response at all, an integer was stored
    # as an integer, and 200,000 characters were stored and sent to the model.
    fun_fact, fact_ok = _plain_text(body.get("fun_fact"), FUN_FACT_LIMIT, multiline=True)
    story, story_ok = _plain_text(body.get("story"), STORY_LIMIT, multiline=True)
    if (not storyboard_id or species not in SPECIES or not fact_ok or not story_ok
            or not (fun_fact or story)):
        return 400, _error("bad_request")

    _settle(deps)
    level = deps.db.grant_level(storyboard_id, user_id)
    if level is None:
        return 403, _error("no_access")
    if level not in WRITE_LEVELS:
        return 403, _error("read_only_access")
    if deps.db.storyboard_status(storyboard_id) != "active":
        return 409, _error("storyboard_closed")

    _purge(deps)

    video_id = body.get("video_id")
    if video_id and deps.db.video_owner(video_id) != user_id:
        # Somebody else's footage cannot be hung on your own entry
        return 403, _error("no_access")

    try:
        deps.limiter.check_and_count(user_id, "submission")
    except RateLimited as limited:
        return 429, _error("rate_limited", f"rate_limited_{limited.scope}", scope=limited.scope)

    screened = [(field, value, roles.screener(deps.client, species, field, value))
                for field, value in (("fun_fact", fun_fact), ("story", story)) if value]
    version = screened[0][2]["prompt_version"]
    rejected = [result for _, _, result in screened if result["verdict"] == "reject"]

    if rejected:
        for field, value, result in screened:
            _record_screening(deps, result, field, value, "submission", None, user_id)
        codes = sorted({code for result in rejected for code in result["codes"]})
        return 200, {"published": False, "reason_codes": codes, "prompt_version": version}

    # The frame the author masked, if their browser could produce one. A still that is
    # missing, the wrong type or too big is stored as nothing rather than refused: the
    # sighting is the point, and losing a picture should not lose somebody's account of
    # their own evening. The client sends a card-sized JPEG, so anything over the cap is a
    # fault in the client rather than a reason to fail a submission.
    #
    # And it has to be base64, which is what the client sends and what the column holds. That
    # is a payload rule as much as a type rule: TIMELINE_PAGE is sized by counting a still's
    # characters as bytes, which is true only of ASCII. A still of 120,000 emoji passed the
    # length check, and json.dumps escapes each one to twelve bytes - 1.44 MB for a single
    # entry, and four of them take one page past the 4.5 MB cap. Anybody holding the demo
    # join code could have planted those, and the Screener never sees a still. Found by the
    # pre-deploy review and measured there at 5,761,218 bytes.
    still = body.get("still")
    if (not isinstance(still, str) or not 0 < len(still) <= STILL_LIMIT
            or not _BASE64.fullmatch(still)):
        still = None
    entry_id = deps.db.add_entry(storyboard_id, user_id, species, fun_fact, story, video_id,
                                 still=still)
    for field, value, result in screened:
        _record_screening(deps, result, field, value, "entry", entry_id, user_id)
    return 200, {"entry_id": entry_id, "published": True, "prompt_version": version}


def timeline(params: dict, token: str, deps: Deps):
    """One page of the storyboard timeline: entries from every contributor.

    A different query from the assistant's Tier 1 context.

    Paged, because every entry carries a base64 frame and an unbounded list walks into the
    platform's 4.5 MB response cap — see TIMELINE_PAGE for the arithmetic. `after` is the id
    of the last entry the caller already has; `next` comes back with the id to pass next
    time, or null when the list is finished. An `after` this storyboard has never heard of is
    a 400 rather than a silent restart at the top, because a cursor the server does not
    recognise means the client and the server disagree about where they are, and answering
    page one to a request for page three looks like data loss.

    The three summary fields are counted over every live entry, not over the page. The header
    on the detail screen states how many sightings there are, who has contributed and what
    date the storyboard runs from; those are facts about the storyboard, and a page of twenty
    cannot answer them. Sending the page alone would have left the screen doing the counting
    it used to do and reporting the page as the whole.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = params.get("storyboard_id")
    if not storyboard_id:
        return 400, _error("bad_request")
    after = params.get("after") or None
    _settle(deps)
    if deps.db.grant_level(storyboard_id, user_id) is None:
        return 403, _error("no_access")
    if after is not None and deps.db.entry_position(storyboard_id, after) is None:
        return 400, _error("bad_request")
    # One more than the page, to learn whether there is another one.
    rows = deps.db.timeline(storyboard_id, TIMELINE_PAGE + 1, after)
    more = len(rows) > TIMELINE_PAGE
    rows = rows[:TIMELINE_PAGE]
    # The base64 rule on writes cannot reach a still stored before it existed: the deployed API
    # took any string, and the join code that lets anybody post is in the public bundle. A page
    # of old emoji stills would still be 5.76 MB. So the rule is applied on the way out as
    # well - a still that is not base64 is not sent. Found by the pre-deploy recheck.
    for row in rows:
        if row["still"] and not _BASE64.fullmatch(row["still"]):
            row["still"] = None
    return 200, {"storyboard_id": storyboard_id, "entries": rows,
                 "next": rows[-1]["id"] if more else None,
                 **deps.db.timeline_summary(storyboard_id)}


def _own_editable_entry(body: dict, token: str, deps: Deps):
    """Fetch this entry and confirm: I wrote it, it still exists, the storyboard still takes changes."""
    user_id, refusal = _identify(token, deps)
    if refusal:
        return None, refusal
    record = deps.db.entry(body.get("entry_id") or "")
    if record is None or record["deleted_at"]:
        return None, (404, _error("gone"))
    if record["author_id"] != user_id:
        # An owner removing somebody else's entry is a review-queue disposal, not this path (see #18)
        return None, (403, _error("not_your_entry"))
    if deps.db.storyboard_status(record["storyboard_id"]) != "active":
        return None, (409, _error("storyboard_closed"))
    return record, None


def delete_entry(body: dict, token: str, deps: Deps):
    record, refusal = _own_editable_entry(body, token, deps)
    if refusal:
        return refusal
    deps.db.soft_delete_entry(record["id"])
    return 200, {"entry_id": record["id"], "deleted": True}


def edit_entry(body: dict, token: str, deps: Deps):
    """Changed fields go through screening again. If either is rejected the whole edit
    is dropped and the original text stays.
    """
    record, refusal = _own_editable_entry(body, token, deps)
    if refusal:
        return refusal
    # Same validation as submitting. A missing key means "leave that field alone", so the
    # stored value stands in and only what was actually sent gets checked.
    fun_fact, fact_ok = (_plain_text(body["fun_fact"], FUN_FACT_LIMIT, multiline=True)
                         if "fun_fact" in body else (record["fun_fact"], True))
    story, story_ok = (_plain_text(body["story"], STORY_LIMIT, multiline=True)
                       if "story" in body else (record["story"], True))
    if not fact_ok or not story_ok or not (fun_fact or story):
        return 400, _error("bad_request")

    changed = [(field, value) for field, value, before in
               (("fun_fact", fun_fact, record["fun_fact"]), ("story", story, record["story"]))
               if value and value != before]
    if not changed:
        return 200, {"entry_id": record["id"], "published": True, "unchanged": True}

    screened = [(field, value, roles.screener(deps.client, record["species"], field, value))
                for field, value in changed]
    version = screened[0][2]["prompt_version"]
    for field, value, result in screened:
        _record_screening(deps, result, field, value, "entry", record["id"], record["author_id"])

    rejected = [result for _, _, result in screened if result["verdict"] == "reject"]
    if rejected:
        codes = sorted({code for result in rejected for code in result["codes"]})
        return 200, {"entry_id": record["id"], "published": False, "reason_codes": codes,
                     "prompt_version": version}

    deps.db.update_entry(record["id"], fun_fact, story)
    return 200, {"entry_id": record["id"], "published": True, "prompt_version": version}


# ---------- share links and access ----------

def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def issue_share_link(body: dict, token: str, deps: Deps):
    """Issue a link carrying an access level.

    The plaintext token is returned this once; the database holds only a hash.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = body.get("storyboard_id")
    level = body.get("level", "contribute")
    if not storyboard_id or level not in LEVEL_RANK:
        return 400, _error("bad_request")

    mine = deps.db.grant_level(storyboard_id, user_id)
    if mine is None:
        return 403, _error("no_access")
    # Issuing needs reshare, and nobody can hand out a level they do not hold (user-flow §6)
    if mine != "reshare" or LEVEL_RANK[level] > LEVEL_RANK[mine]:
        return 403, _error("cannot_share")

    days = body.get("expires_in_days", SHARE_LINK_DAYS)
    max_uses = body.get("max_uses")
    if not isinstance(days, int) or not 1 <= days <= 90:
        return 400, _error("bad_request")
    if max_uses is not None and (not isinstance(max_uses, int) or max_uses < 1):
        return 400, _error("bad_request")

    plain = auth.new_share_token()
    expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(timespec="seconds")
    link_id = deps.db.add_share_link(storyboard_id, user_id, auth.hash_share_token(plain),
                                     level, expires_at, max_uses)
    return 200, {"share_link_id": link_id, "token": plain, "level": level,
                 "expires_at": expires_at, "max_uses": max_uses}


def redeem_share_link(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    link = deps.db.share_link_by_hash(auth.hash_share_token(body.get("token") or ""))
    if link is None:
        return 404, _error("invalid_link")
    if link["revoked_at"]:
        return 403, _error("link_revoked")
    if link["expires_at"] and link["expires_at"] <= _stamp():
        return 403, _error("link_expired")
    if link["max_uses"] is not None and link["used_count"] >= link["max_uses"]:
        return 403, _error("link_used_up")
    # Being thrown off is not undone by the person who was thrown off. grant_level() reports
    # None both for a stranger and for somebody who was removed, so redeeming treated the two
    # alike and the upsert below put them straight back — one request, no consent from
    # anybody, for as long as the code they already held remained valid. The owner's only
    # remedy was to guess which code it was and turn that off too, which also shuts out
    # everyone who has not redeemed it yet; the project deliberately keeps those two controls
    # apart. Found by an adversarial review on 2026-09-16.
    #
    # Refused before the use is counted: a redemption that grants nothing should not spend
    # one. Letting them back on is a grant, which somebody entitled to decide has to make.
    if deps.db.revoked_grant(link["storyboard_id"], user_id):
        return 403, _error("access_revoked")

    existing = deps.db.grant_level(link["storyboard_id"], user_id)
    # Upgrade only, never downgrade: a view link must not demote the owner
    upgrade = existing is None or LEVEL_RANK[existing] < LEVEL_RANK[link["level"]]
    granted = link["level"] if upgrade else existing
    # Granting and counting the use have to land together. As two calls, a failure between
    # them lets somebody in without counting the use, so a max_uses=3 link admits a fourth.
    deps.db.redeem_link(link["id"], link["storyboard_id"], user_id,
                        link["level"], link["created_by"], upgrade)
    return 200, {"storyboard_id": link["storyboard_id"], "level": granted}


def revoke_share_link(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    link = deps.db.share_link(body.get("share_link_id") or "")
    if link is None:
        return 404, _error("invalid_link")
    if user_id not in (link["created_by"], deps.db.storyboard_owner(link["storyboard_id"])):
        return 403, _error("not_the_owner")
    deps.db.revoke_share_link(link["id"])
    return 200, {"share_link_id": link["id"], "revoked": True}


def revoke_grant(body: dict, token: str, deps: Deps):
    """Revoke somebody's access. Immediate: context, history and timeline are gone on the next call."""
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id, target = body.get("storyboard_id"), body.get("user_id")
    if not storyboard_id or not target or target == user_id:
        return 400, _error("bad_request")
    if deps.db.storyboard_owner(storyboard_id) != user_id:
        return 403, _error("not_the_owner")
    deps.db.revoke(storyboard_id, target)
    return 200, {"storyboard_id": storyboard_id, "user_id": target, "revoked": True}


def list_share_links(params: dict, token: str, deps: Deps):
    """The links this storyboard has issued. The share screen needs it to know what can
    be turned off.

    The gate is reshare, the same as list_grants: only somebody who can issue should see
    what has been issued. owner_id comes back for the same reason — revoking a link takes
    either the owner or the person who issued it (see revoke_share_link), and the interface
    uses those two fields to decide who gets the button.

    **There is no token in the response, and there cannot be.** The database stores only a
    SHA-256; the plaintext existed for one moment at issue time and is gone. This is not
    something withheld: an endpoint that could fetch a code back afterwards would be a
    redeemable grant left hanging on a screen.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = params.get("storyboard_id")
    if not storyboard_id:
        return 400, _error("bad_request")
    if deps.db.grant_level(storyboard_id, user_id) != "reshare":
        return 403, _error("cannot_share")
    return 200, {"storyboard_id": storyboard_id,
                 "owner_id": deps.db.storyboard_owner(storyboard_id),
                 "links": deps.db.share_links(storyboard_id)}


def list_grants(params: dict, token: str, deps: Deps):
    """Who holds access to this storyboard, and at what level. The share screen needs it.

    Reshare is required to see it: this is the list of who can get in, and it has no use to
    somebody with read-only access. owner_id comes back so the interface can decide whether
    to show the revoke control — only an owner can revoke (see revoke_grant), and without
    that field the interface could only show everybody a button certain to 403.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = params.get("storyboard_id")
    if not storyboard_id:
        return 400, _error("bad_request")
    if deps.db.grant_level(storyboard_id, user_id) != "reshare":
        return 403, _error("cannot_share")
    return 200, {"storyboard_id": storyboard_id,
                 "owner_id": deps.db.storyboard_owner(storyboard_id),
                 "grants": deps.db.grants(storyboard_id)}


def dashboard(params: dict, token: str, deps: Deps):
    """The storyboards I can reach, active and past kept apart (user-flow §9)."""
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    _settle(deps)
    boards = deps.db.dashboard(user_id)
    return 200, {"active": [b for b in boards if b["status"] == "active"],
                 "past": [b for b in boards if b["status"] != "active"]}


def close_storyboard(body: dict, token: str, deps: Deps):
    """The owner closing it deliberately, with an optional closing line. Archived is not deleted."""
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = body.get("storyboard_id")
    note, ok = _plain_text(body.get("closed_note"), 280, multiline=True)
    if not storyboard_id or not ok:
        return 400, _error("bad_request")
    if deps.db.storyboard_owner(storyboard_id) != user_id:
        return 403, _error("not_the_owner")
    deps.db.close_storyboard(storyboard_id, note)
    return 200, {"storyboard_id": storyboard_id, "status": "archived", "closed_note": note}


# ---------- forum ----------

def delete_post(body: dict, token: str, deps: Deps):
    """Take down your own words in the discussion.

    Entries could always be deleted by whoever wrote them, and forum posts could be deleted
    by nobody at all, including their author. That asymmetry was never a decision; it is
    simply an endpoint that was never written, and the data model has carried deleted_at on
    both forum tables from the start with every read already filtering on it.

    The same shape as delete_entry, deliberately: yours, still there, on a storyboard that
    still takes changes. No grant is required, for the same reason it is not there — what
    you wrote stays yours to withdraw even after somebody has revoked your access.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    record = deps.db.post(body.get("post_id") or "")
    if record is None or record["deleted_at"]:
        return 404, _error("gone")
    if record["author_id"] != user_id:
        return 403, _error("not_your_post")
    storyboard_id = deps.db.thread_storyboard(record["thread_id"])
    if storyboard_id is None:
        return 404, _error("gone")
    if deps.db.storyboard_status(storyboard_id) != "active":
        return 409, _error("storyboard_closed")
    deps.db.soft_delete_post(record["id"])
    return 200, {"post_id": record["id"], "deleted": True}


def _owned_storyboard(storyboard_id: str, user_id: str, deps: Deps):
    """The caller owns this storyboard and it still takes changes, or a refusal."""
    if storyboard_id is None:
        return 404, _error("gone")
    if deps.db.storyboard_owner(storyboard_id) != user_id:
        return 403, _error("not_the_owner")
    if deps.db.storyboard_status(storyboard_id) != "active":
        return 409, _error("storyboard_closed")
    return None


def remove_entry(body: dict, token: str, deps: Deps):
    """A storyboard owner taking somebody else's entry off their storyboard.

    Deleting what you wrote is the author's, and stays that way; delete_entry answers
    not_your_entry to everybody else. This is the deliberate exception, and it is written
    down as one: you made the space and invited people into it, so you can clear it, and
    the database records that you were the one who did.

    It is a separate endpoint from the review disposal on purpose. That path is the last
    word on something a neighbour marked, and it used to double as this one by accident —
    db.dispose matched no screening row, said nothing at all, and set deleted_at anyway, so
    an owner could quietly remove anything and leave no trace. The power was never the
    problem. Having no name and no record was.

    Not the same as centralised moderation, which CLAUDE.md rules out for want of anybody
    to do it: that is the platform judging content, this is the owner of one storyboard
    tidying their own.
    """
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    record = deps.db.entry(body.get("entry_id") or "")
    if record is None or record["deleted_at"]:
        return 404, _error("gone")
    refusal = _owned_storyboard(record["storyboard_id"], user_id, deps)
    if refusal:
        return refusal
    deps.db.remove_entry(record["id"], user_id)
    return 200, {"entry_id": record["id"], "removed": True}


def remove_post(body: dict, token: str, deps: Deps):
    """The same for a post in the discussion on a storyboard you own."""
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    record = deps.db.post(body.get("post_id") or "")
    if record is None or record["deleted_at"]:
        return 404, _error("gone")
    refusal = _owned_storyboard(deps.db.thread_storyboard(record["thread_id"]), user_id, deps)
    if refusal:
        return refusal
    deps.db.remove_post(record["id"], user_id)
    return 200, {"post_id": record["id"], "removed": True}


def _forum_gate(storyboard_id: str, user_id: str, deps: Deps, writing: bool):
    """Forum access follows the storyboard: a grant to see it, contribute or above to write."""
    _settle(deps)
    level = deps.db.grant_level(storyboard_id, user_id)
    if level is None:
        return 403, _error("no_access")
    if writing:
        if level not in WRITE_LEVELS:
            return 403, _error("read_only_access")
        if deps.db.storyboard_status(storyboard_id) != "active":
            return 409, _error("storyboard_closed")
    return None


def _screen_forum_body(body_text: str, user_id: str, deps: Deps):
    """Returns (result, refusal). A rejection creates no post and records against submission."""
    result = roles.screener(deps.client, "other", "forum_post", body_text)
    if result["verdict"] == "reject":
        _record_screening(deps, result, "forum_post", body_text, "submission", None, user_id)
        return result, (200, {"published": False, "reason_codes": sorted(set(result["codes"])),
                              "prompt_version": result["prompt_version"]})
    return result, None


def create_thread(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = body.get("storyboard_id")
    title, title_ok = _plain_text(body.get("title"), 120)
    text, text_ok = _plain_text(body.get("body"), 4000, multiline=True)
    if not storyboard_id or not title_ok or not text_ok or title is None or text is None:
        return 400, _error("bad_request")
    refusal = _forum_gate(storyboard_id, user_id, deps, writing=True)
    if refusal:
        return refusal
    try:
        deps.limiter.check_and_count(user_id, "submission")
    except RateLimited as limited:
        return 429, _error("rate_limited", f"rate_limited_{limited.scope}", scope=limited.scope)

    # The title is screened together with the body. It used to go unchecked entirely, so
    # "Anyone else seen the one at the Smiths', 42 Example St?" with a clean body could sit
    # in front of everyone — and pii is the first thing the Screener exists to catch.
    #
    # Joined into one piece rather than screened by a second call: judging one post twice
    # costs two model calls and two slices of quota, and produces states like "the body
    # passed but the title did not" with nowhere to put them. The title is part of the post.
    screened = f"{title}\n\n{text}"
    result, refusal = _screen_forum_body(screened, user_id, deps)
    if refusal:
        return refusal
    thread_id, post_id = deps.db.add_thread(storyboard_id, user_id, title, text)
    # What goes into the audit row has to match what the model actually read, word for word,
    # or a later look back will not line up.
    _record_screening(deps, result, "forum_post", screened, "forum_post", post_id, user_id)
    return 200, {"thread_id": thread_id, "post_id": post_id, "published": True,
                 "prompt_version": result["prompt_version"]}


def create_post(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    thread_id = body.get("thread_id")
    text, text_ok = _plain_text(body.get("body"), 4000, multiline=True)
    if not thread_id or not text_ok or text is None:
        return 400, _error("bad_request")
    storyboard_id = deps.db.thread_storyboard(thread_id)
    if storyboard_id is None:
        return 404, _error("gone")
    refusal = _forum_gate(storyboard_id, user_id, deps, writing=True)
    if refusal:
        return refusal
    try:
        deps.limiter.check_and_count(user_id, "submission")
    except RateLimited as limited:
        return 429, _error("rate_limited", f"rate_limited_{limited.scope}", scope=limited.scope)

    result, refusal = _screen_forum_body(text, user_id, deps)
    if refusal:
        return refusal
    post_id = deps.db.add_post(thread_id, user_id, text)
    _record_screening(deps, result, "forum_post", text, "forum_post", post_id, user_id)
    return 200, {"thread_id": thread_id, "post_id": post_id, "published": True,
                 "prompt_version": result["prompt_version"]}


def list_threads(params: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = params.get("storyboard_id")
    if not storyboard_id:
        return 400, _error("bad_request")
    refusal = _forum_gate(storyboard_id, user_id, deps, writing=False)
    if refusal:
        return refusal
    return 200, {"storyboard_id": storyboard_id, "threads": deps.db.threads(storyboard_id)}


def read_thread(params: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    thread_id = params.get("thread_id")
    storyboard_id = deps.db.thread_storyboard(thread_id or "")
    if storyboard_id is None:
        return 404, _error("gone")
    refusal = _forum_gate(storyboard_id, user_id, deps, writing=False)
    if refusal:
        return refusal
    # Carry the title: without it the thread screen sits under a bare "Discussion" and you
    # cannot tell what you are reading, and a shared link is blank. The title is visible
    # alongside the post already; this is not an extra leak.
    return 200, {"thread_id": thread_id, "title": deps.db.thread_title(thread_id),
                 "posts": deps.db.posts(thread_id)}


# ---------- review queue ----------

VOTES = {"looks_right", "worth_checking"}
DISPOSITIONS = {"kept", "labelled", "removed"}


def review_queue(params: dict, token: str, deps: Deps):
    """Entries awaiting a second look, for the other contributors. Never your own."""
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    storyboard_id = params.get("storyboard_id")
    if not storyboard_id:
        return 400, _error("bad_request")
    _settle(deps)
    deps.db.settle_review()
    level = deps.db.grant_level(storyboard_id, user_id)
    if level is None:
        return 403, _error("no_access")
    if level not in WRITE_LEVELS:
        # Read-only people take no part in review: this is between contributors
        return 403, _error("read_only_access")
    _purge(deps)
    return 200, {"storyboard_id": storyboard_id,
                 "items": deps.db.review_queue(storyboard_id, user_id)}


def cast_review_vote(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    entry_id, vote = body.get("entry_id"), body.get("vote")
    if not entry_id or vote not in VOTES:
        return 400, _error("bad_request")
    record = deps.db.entry(entry_id)
    if record is None or record["deleted_at"]:
        return 404, _error("gone")
    if record["author_id"] == user_id:
        # Voting on your own entry is meaningless, and the author should not have learned it
        # was marked in the first place
        return 403, _error("not_your_call")
    level = deps.db.grant_level(record["storyboard_id"], user_id)
    if level is None:
        return 403, _error("no_access")
    if level not in WRITE_LEVELS:
        return 403, _error("read_only_access")
    deps.db.settle_review()
    _purge(deps)
    tally = deps.db.cast_vote(entry_id, user_id, vote)
    # Only the counts come back, never who voted (operations §2.3)
    return 200, {"entry_id": entry_id, "worth_checking": tally["worth_checking"],
                 "looks_right": tally["looks_right"]}


def dispose_entry(body: dict, token: str, deps: Deps):
    """The owner's final say: keep, label, or remove."""
    user_id, refusal = _identify(token, deps)
    if refusal:
        return refusal
    entry_id, action = body.get("entry_id"), body.get("action")
    if not entry_id or action not in DISPOSITIONS:
        return 400, _error("bad_request")
    record = deps.db.entry(entry_id)
    if record is None or record["deleted_at"]:
        return 404, _error("gone")
    if deps.db.storyboard_owner(record["storyboard_id"]) != user_id:
        return 403, _error("not_the_owner")
    # Settle first, so a mark nobody touched for seven days is already closed and this
    # answers the same way the queue would (operations §2.2).
    deps.db.settle_review()
    # An owner's disposal is the last word on something a neighbour marked. Without this
    # it was a delete button for anything on the storyboard: db.dispose updates the
    # screening row "WHERE disposition IS NULL", which matches nothing and says nothing
    # when there is no mark, while the UPDATE that sets deleted_at runs regardless. So an
    # owner could quietly remove anybody's entry, at any time, leaving no disposal record.
    #
    # Deleting an entry is the author's (delete_entry answers not_your_entry to everyone
    # else), and CLAUDE.md rules out centralised moderation outright. This endpoint is the
    # end of a review, not a way around either of those.
    #
    # Checked after the owner test on purpose: somebody who does not own the storyboard
    # learns nothing here about what is or is not under review.
    if not deps.db.awaiting_review(entry_id):
        return 409, _error("not_in_review")
    _purge(deps)
    deps.db.dispose(entry_id, action)
    return 200, {"entry_id": entry_id, "disposition": action}
