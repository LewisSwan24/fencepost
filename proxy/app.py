"""单个端点，按 role 分发。四条硬规则在这里收口：
限流、fail-open、Writer 校验、报错不外泄。
"""

import sys
from dataclasses import dataclass, field

from . import auth, roles
from .model import UpstreamError, redact
from .ports import MemoryContext, MemoryHistory, MemoryRateLimiter, PermissionDenied, RateLimited

# 每个角色算在哪条上限。operations.md §3 只列了聊天、视觉、提交三项，没提 Writer，
# 这里先并进聊天，文档要补一行（见阶段 3 报告）。
SCOPE = {"neighbour": "chat", "writer": "chat", "screener": "submission"}

FIELDS = {"fun_fact", "story", "forum_post"}

# 给客户端的文案一律固定，ux-copy.md 里有的就用原文。
# 上游报错、prompt 内容、key 一个字都不往外带。
COPY = {
    "unauthorized": "Sign in again to keep using the assistant.",
    "no_access": "You do not have access to this storyboard.",
    "bad_request": "The assistant could not read that request.",
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
    records: list = field(default_factory=list)   # 阶段 4 换成 screening_results 落库


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
        return _screener(body, deps)
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


def _screener(body: dict, deps: Deps):
    submission = body.get("submission")
    if submission is None or body.get("field") not in FIELDS:
        return 400, _error("bad_request")
    internal = roles.screener(deps.client, body.get("species_selected", "unknown"),
                              body["field"], submission)
    deps.records.append(internal)
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
