"""One endpoint, dispatched by role. Four hard rules close here:
rate limiting, fail-open, Writer validation, and never leaking an error outward.
"""

import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import auth, roles
from .model import UpstreamError, redact
from .ports import (MemoryContext, MemoryHistory, MemoryRateLimiter, MemoryScreeningLog,
                    PermissionDenied, RateLimited)

# Which ceiling each role counts against. operations.md §3 lists chat, vision and
# submission and says nothing about the Writer, so it is folded into chat for now; the
# doc needs a line added (see the stage 3 report).
SCOPE = {"neighbour": "chat", "writer": "chat", "screener": "submission"}

FIELDS = {"fun_fact", "story", "forum_post"}
SUBJECTS = {"entry", "forum_post", "submission"}
SPECIES = {"brushtail", "ringtail", "other", "unknown"}
WRITE_LEVELS = {"contribute", "reshare"}          # view can only look
LEVEL_RANK = {"view": 0, "contribute": 1, "reshare": 2}
SHARE_LINK_DAYS = int(os.getenv("SHARE_LINK_DAYS", "7"))

# Length caps for the two fields on an entry. A story is the same kind of free text as a
# forum body, which is already capped at 4000, so it takes the same number. A fun fact is
# one fact rather than a paragraph: 500 is generous for that and still stops a pasted
# document arriving in a field meant for a sentence.
FUN_FACT_LIMIT = 500
STORY_LIMIT = 4000

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
    "link_expired": "That link has expired.",
    "link_used_up": "That link has been used as many times as it allows.",
    "cannot_share": "You cannot hand out access to this storyboard.",
    "not_the_owner": "Only the storyboard owner can do that.",
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
    "rate_limited_login": "Too many sign-in attempts. Try again in a few minutes.",
}


@dataclass
class Deps:
    client: object
    limiter: object = field(default_factory=MemoryRateLimiter)
    history: object = field(default_factory=MemoryHistory)
    context: object = field(default_factory=MemoryContext)
    screening: object = field(default_factory=MemoryScreeningLog)
    db: object = None                            # resource endpoints write directly; the assistant path does not


def _error(code: str, copy_key: str = None, **extra) -> dict:
    return {"error": {"code": code, "message": COPY[copy_key or code], **extra}}


def _plain_text(value, limit: int, multiline: bool = False):
    """Validate a piece of free text, returning (cleaned value, is it acceptable).

    This is for **the fields the Screener never sees**: the storyboard title, the forum
    thread title, the closing line. They pass through this layer alone, so this layer has to
    stop what no model is needed for — wrong type, too long, hidden control characters, and
    "a few spaces", which lands in the database and shows up in the interface as a blank
    nobody can identify.

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


def _admit(body: dict, token: str, deps: Deps):
    """Identify, check the role, charge the quota.

    Allowed returns (user_id, None); blocked returns (None, (status, payload)).
    """
    try:
        user_id = auth.verify(token)
    except auth.AuthError:
        return None, (401, _error("unauthorized"))

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
    message = body.get("message")
    if not storyboard_id or not message:
        return 400, _error("bad_request")
    # The permission gate and the context both live on the server. history and context in
    # the request body are ignored even when present.
    _settle(deps)
    context = deps.context.build(user_id, storyboard_id)
    history = deps.history.recent(user_id, storyboard_id)
    result = roles.neighbour(deps.client, context, history, message, body.get("image_b64"))
    deps.history.append(user_id, storyboard_id, "user", message)
    # Every model call stores the prompt version alongside it (CLAUDE.md working rule 2)
    deps.history.append(user_id, storyboard_id, "assistant", result["reply"],
                        prompt_version=result["prompt_version"],
                        model=getattr(deps.client, "chat_model", None))
    return 200, {"role": "neighbour", "reply": result["reply"], "prompt_version": result["prompt_version"]}


def _writer(body: dict, deps: Deps):
    result = roles.writer(deps.client, body.get("species_selected", "unknown"), body.get("story_draft", ""))
    return 200, {
        "role": "writer",
        "fun_facts": result["fun_facts"],
        "tidied_story": result["tidied_story"],
        "question": result["question"],
        "skipped": result["skipped"],
        "prompt_version": result["prompt_version"],
    }


def _screener(body: dict, user_id: str, deps: Deps):
    submission = body.get("submission")
    if submission is None or body.get("field") not in FIELDS:
        return 400, _error("bad_request")
    subject_type = body.get("subject_type", "submission")
    subject_id = body.get("subject_id")
    if subject_type not in SUBJECTS or (subject_type != "submission" and not subject_id):
        return 400, _error("bad_request")
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
    storyboard_id, message = body.get("storyboard_id"), body.get("message")
    if not storyboard_id or not message:
        return 400, _error("bad_request")
    try:
        context = deps.context.build(user_id, storyboard_id)
        history = deps.history.recent(user_id, storyboard_id)
    except PermissionDenied:
        return 403, _error("no_access")
    stream = roles.neighbour_stream(deps.client, context, history, message, body.get("image_b64"))
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
    return 200, {"user_id": user_id, "handle": handle, "token": auth.issue(user_id)}


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
                 "token": auth.issue(record["id"])}


def create_session(body: dict, deps: Deps):
    """Demo-grade identity: hand over a handle and get a token, with no password.

    Which is why it is off by default. Anyone can exchange somebody else's handle for a
    token, and in a real environment that is impersonation, so turning it on means setting
    FENCEPOST_OPEN_SIGNUP explicitly.
    """
    if not os.getenv("FENCEPOST_OPEN_SIGNUP"):
        return 403, _error("signup_closed")
    handle = (body.get("handle") or "").strip()
    if not handle or len(handle) > 40:
        return 400, _error("bad_request")
    user_id = deps.db.ensure_user(handle)
    return 200, {"user_id": user_id, "handle": handle, "token": auth.issue(user_id)}


def create_storyboard(body: dict, token: str, deps: Deps):
    try:
        user_id = auth.verify(token)
    except auth.AuthError:
        return 401, _error("unauthorized")
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


def _identify(token: str):
    """Allowed gives (user_id, None); unrecognised gives (None, (401, payload))."""
    try:
        return auth.verify(token), None
    except auth.AuthError:
        return None, (401, _error("unauthorized"))


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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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

    entry_id = deps.db.add_entry(storyboard_id, user_id, species, fun_fact, story, video_id)
    for field, value, result in screened:
        _record_screening(deps, result, field, value, "entry", entry_id, user_id)
    return 200, {"entry_id": entry_id, "published": True, "prompt_version": version}


def timeline(params: dict, token: str, deps: Deps):
    """The storyboard timeline: entries from every contributor.

    A different query from the assistant's Tier 1 context.
    """
    user_id, refusal = _identify(token)
    if refusal:
        return refusal
    storyboard_id = params.get("storyboard_id")
    if not storyboard_id:
        return 400, _error("bad_request")
    _settle(deps)
    if deps.db.grant_level(storyboard_id, user_id) is None:
        return 403, _error("no_access")
    return 200, {"storyboard_id": storyboard_id, "entries": deps.db.timeline(storyboard_id)}


def _own_editable_entry(body: dict, token: str, deps: Deps):
    """Fetch this entry and confirm: I wrote it, it still exists, the storyboard still takes changes."""
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
    if refusal:
        return refusal
    _settle(deps)
    boards = deps.db.dashboard(user_id)
    return 200, {"active": [b for b in boards if b["status"] == "active"],
                 "past": [b for b in boards if b["status"] != "active"]}


def close_storyboard(body: dict, token: str, deps: Deps):
    """The owner closing it deliberately, with an optional closing line. Archived is not deleted."""
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    user_id, refusal = _identify(token)
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
    _purge(deps)
    deps.db.dispose(entry_id, action)
    return 200, {"entry_id": entry_id, "disposition": action}
