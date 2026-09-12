"""单个端点，按 role 分发。四条硬规则在这里收口：
限流、fail-open、Writer 校验、报错不外泄。
"""

import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from . import auth, roles
from .model import UpstreamError, redact
from .ports import (MemoryContext, MemoryHistory, MemoryRateLimiter, MemoryScreeningLog,
                    PermissionDenied, RateLimited)

# 每个角色算在哪条上限。operations.md §3 只列了聊天、视觉、提交三项，没提 Writer，
# 这里先并进聊天，文档要补一行（见阶段 3 报告）。
SCOPE = {"neighbour": "chat", "writer": "chat", "screener": "submission"}

FIELDS = {"fun_fact", "story", "forum_post"}
SUBJECTS = {"entry", "forum_post", "submission"}
SPECIES = {"brushtail", "ringtail", "other", "unknown"}
WRITE_LEVELS = {"contribute", "reshare"}          # view 只能看
LEVEL_RANK = {"view": 0, "contribute": 1, "reshare": 2}
# user-flow §6：默认 7 天。窗口短，链接万一流出去暴露面也短。
SHARE_LINK_DAYS = int(os.getenv("SHARE_LINK_DAYS", "7"))

# 给客户端的文案一律固定，ux-copy.md 里有的就用原文。
# 上游报错、prompt 内容、key 一个字都不往外带。
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
}


@dataclass
class Deps:
    client: object
    limiter: object = field(default_factory=MemoryRateLimiter)
    history: object = field(default_factory=MemoryHistory)
    context: object = field(default_factory=MemoryContext)
    screening: object = field(default_factory=MemoryScreeningLog)
    db: object = None                            # 资源端点要直接写库，助手那条路用不上


def _error(code: str, copy_key: str = None, **extra) -> dict:
    return {"error": {"code": code, "message": COPY[copy_key or code], **extra}}


def _admit(body: dict, token: str, deps: Deps):
    """认身分、认 role、扣配额。放行给 (user_id, None)，拦下给 (None, (status, payload))。"""
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
            # §2.5.1 第 5 条是客户端的确认步骤，这里再拦一道：没带确认就不发帧。
            if not body.get("frame_consent"):
                return None, (400, _error("frame_consent_missing"))
            deps.limiter.check_and_count(user_id, "vision")
    except RateLimited as limited:
        return None, (429, _error("rate_limited", f"rate_limited_{limited.scope}",
                                  scope=limited.scope))
    return user_id, None


def handle(body: dict, token: str, deps: Deps):
    """返回 (http_status, payload)。payload 永远是可以直接发给客户端的东西。"""
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
        # Neighbour 超时不伪造回复（prompts.md §5），客户端自己给重试按钮。
        return 503, _error("upstream_unavailable")
    except Exception as exc:
        print(f"[proxy] unhandled: {redact(str(exc))[:300]}", file=sys.stderr)
        return 503, _error("upstream_unavailable")


def _neighbour(body: dict, user_id: str, deps: Deps):
    storyboard_id = body.get("storyboard_id")
    message = body.get("message")
    if not storyboard_id or not message:
        return 400, _error("bad_request")
    # 权限门与上下文都在服务端。请求体里就算带了 history/context 也一概不看。
    _settle(deps)
    context = deps.context.build(user_id, storyboard_id)
    history = deps.history.recent(user_id, storyboard_id)
    result = roles.neighbour(deps.client, context, history, message, body.get("image_b64"))
    deps.history.append(user_id, storyboard_id, "user", message)
    # 每次模型调用都要把 prompt 版本号一起落库（CLAUDE.md 工作约定 2）
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
    # review 档作者无感（operations.md §2.3），所以客户端只拿得到能不能发；
    # verdict、codes、note、fail_open 留在服务端记录里。
    published = internal["verdict"] != "reject"
    payload = {"role": "screener", "published": published, "prompt_version": internal["prompt_version"]}
    if not published:
        payload["reason_codes"] = internal["codes"]
    return 200, payload


class StreamSession:
    """流本身，外加一个跑完整趟之后才执行的落库动作。

    中途断掉就不落库。§5 说 Neighbour 失败不伪造回复，半截回复也是伪造。
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
    """流式只开给 Neighbour。成功返回 (200, StreamSession)，失败与 handle 同形状。"""
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


# ---------- 资源端点 ----------

def create_session(body: dict, deps: Deps):
    """demo 级的身分：给一个 handle 就签令牌，没有密码。

    所以它默认关着。任何人拿别人的 handle 都能换到令牌，这在真环境里就是冒充，
    要开得显式设 FENCEPOST_OPEN_SIGNUP。
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
    title = body.get("title")
    if title is not None and (not isinstance(title, str) or len(title) > 120):
        return 400, _error("bad_request")
    # add_storyboard 顺手给 owner 一条 grant，否则他进不了自己的故事版
    return 200, {"storyboard_id": deps.db.add_storyboard(user_id, title), "title": title}


def _settle(deps: Deps) -> None:
    """碰故事版之前先结算：30 天没动静的翻成只读。没有 cron，谁碰谁结算。"""
    if deps.db is not None:
        deps.db.settle_stale()


def _identify(token: str):
    """放行给 (user_id, None)，认不出给 (None, (401, payload))。"""
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
        # operations.md §1：ok 不留原文，减少留存面
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
    """提交一条 entry：先筛查，通过才建。

    fun_fact 与 story 各筛一次（prompts.md §4.3 的模板一次只认一个 field）。任一条被 reject
    就整条不发，两条都不是 reject 就照常发——包括被标 review 的那种。响应里看不出 review，
    作者无感是 operations.md §2.3 的要求。
    """
    user_id, refusal = _identify(token)
    if refusal:
        return refusal
    storyboard_id = body.get("storyboard_id")
    species = body.get("species")
    fun_fact, story = body.get("fun_fact"), body.get("story")
    if not storyboard_id or species not in SPECIES or not (fun_fact or story):
        return 400, _error("bad_request")

    _settle(deps)
    level = deps.db.grant_level(storyboard_id, user_id)
    if level is None:
        return 403, _error("no_access")
    if level not in WRITE_LEVELS:
        return 403, _error("read_only_access")
    if deps.db.storyboard_status(storyboard_id) != "active":
        return 409, _error("storyboard_closed")

    video_id = body.get("video_id")
    if video_id and deps.db.video_owner(video_id) != user_id:
        # 别人的素材不能挂到自己的 entry 上
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
    """故事版时间线：所有贡献者的 entry。与助手的 Tier 1 上下文是两条不同的查询。"""
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
    """取出这条 entry，并确认：是我写的、还在、故事版还收改动。"""
    user_id, refusal = _identify(token)
    if refusal:
        return None, refusal
    record = deps.db.entry(body.get("entry_id") or "")
    if record is None or record["deleted_at"]:
        return None, (404, _error("gone"))
    if record["author_id"] != user_id:
        # owner 移除他人 entry 是复核队列的处置权，不走这条路（见 #18）
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
    """改过的字段重新过一次筛查。任一条被 reject，整次编辑不生效，原内容留着。"""
    record, refusal = _own_editable_entry(body, token, deps)
    if refusal:
        return refusal
    fun_fact = body.get("fun_fact", record["fun_fact"])
    story = body.get("story", record["story"])
    if not (fun_fact or story):
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


# ---------- 分享链接与权限 ----------

def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def issue_share_link(body: dict, token: str, deps: Deps):
    """签发一张带权限的链接。明文 token 只在这一次返回，库里只有哈希。"""
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
    # 签发要 reshare 档，而且给不出自己没有的档位（user-flow §6）
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
    granted = existing
    # 只升不降：一张 view 链接不该把 owner 降级
    if existing is None or LEVEL_RANK[existing] < LEVEL_RANK[link["level"]]:
        deps.db.grant(link["storyboard_id"], user_id, link["level"], link["created_by"])
        granted = link["level"]
    deps.db.consume_share_link(link["id"])
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
    """撤销某人的访问。立刻生效：上下文、历史、时间线下一次调用就都没了。"""
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


def dashboard(params: dict, token: str, deps: Deps):
    """我能访问的故事版，活跃与往期分开（user-flow §9）。"""
    user_id, refusal = _identify(token)
    if refusal:
        return refusal
    _settle(deps)
    boards = deps.db.dashboard(user_id)
    return 200, {"active": [b for b in boards if b["status"] == "active"],
                 "past": [b for b in boards if b["status"] != "active"]}


def close_storyboard(body: dict, token: str, deps: Deps):
    """owner 主动完结，可以附一句结语。归档不等于删除。"""
    user_id, refusal = _identify(token)
    if refusal:
        return refusal
    storyboard_id = body.get("storyboard_id")
    note = body.get("closed_note")
    if not storyboard_id or (note is not None and (not isinstance(note, str) or len(note) > 280)):
        return 400, _error("bad_request")
    if deps.db.storyboard_owner(storyboard_id) != user_id:
        return 403, _error("not_the_owner")
    deps.db.close_storyboard(storyboard_id, note)
    return 200, {"storyboard_id": storyboard_id, "status": "archived", "closed_note": note}


# ---------- 论坛 ----------

def _forum_gate(storyboard_id: str, user_id: str, deps: Deps, writing: bool):
    """论坛的权限跟着故事版走：有 grant 才看得到，能写要 contribute 以上。"""
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
    """返回 (result, refusal)。被 reject 就不建贴文，记录挂 submission。"""
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
    storyboard_id, title, text = body.get("storyboard_id"), body.get("title"), body.get("body")
    if not storyboard_id or not title or not text or len(title) > 120:
        return 400, _error("bad_request")
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
    thread_id, post_id = deps.db.add_thread(storyboard_id, user_id, title, text)
    _record_screening(deps, result, "forum_post", text, "forum_post", post_id, user_id)
    return 200, {"thread_id": thread_id, "post_id": post_id, "published": True,
                 "prompt_version": result["prompt_version"]}


def create_post(body: dict, token: str, deps: Deps):
    user_id, refusal = _identify(token)
    if refusal:
        return refusal
    thread_id, text = body.get("thread_id"), body.get("body")
    if not thread_id or not text:
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
    return 200, {"thread_id": thread_id, "posts": deps.db.posts(thread_id)}


# ---------- 复核队列 ----------

VOTES = {"looks_right", "worth_checking"}
DISPOSITIONS = {"kept", "labelled", "removed"}


def review_queue(params: dict, token: str, deps: Deps):
    """待核实的条目，给同故事版的其他贡献者看。看不到自己的。"""
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
        # 只读的人不参与复核：这是贡献者之间的事
        return 403, _error("read_only_access")
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
        # 自己的条目自己投票没有意义，何况作者本来就不该知道它被标记了
        return 403, _error("not_your_call")
    level = deps.db.grant_level(record["storyboard_id"], user_id)
    if level is None:
        return 403, _error("no_access")
    if level not in WRITE_LEVELS:
        return 403, _error("read_only_access")
    deps.db.settle_review()
    tally = deps.db.cast_vote(entry_id, user_id, vote)
    # 只回票数，不回谁投的（operations §2.3）
    return 200, {"entry_id": entry_id, "worth_checking": tally["worth_checking"],
                 "looks_right": tally["looks_right"]}


def dispose_entry(body: dict, token: str, deps: Deps):
    """owner 的最终处置权：保留、打标签、移除。"""
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
    deps.db.dispose(entry_id, action)
    return 200, {"entry_id": entry_id, "disposition": action}
