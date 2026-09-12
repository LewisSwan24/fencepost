"""代理依赖的三样外部东西。阶段 3 是内存实作，阶段 4 换成 SQLite。

历史与上下文之所以是端口而不是请求体字段：prompts.md §2.6.1 规定前端不得决定
拼什么，服务端必须自己按 (user, storyboard) 去取。留成参数就等于把边界交给客户端。
"""

import os
import time
from collections import deque

# operations.md §3。三个值都可用环境变量覆盖，默认与文档一致。
DEFAULT_LIMITS = {
    "chat": (int(os.getenv("LIMIT_CHAT_PER_DAY", "50")), 86400),
    "vision": (int(os.getenv("LIMIT_VISION_PER_HOUR", "10")), 3600),
    "submission": (int(os.getenv("LIMIT_SUBMISSION_PER_HOUR", "20")), 3600),
}


class RateLimited(Exception):
    def __init__(self, scope: str):
        super().__init__(scope)
        self.scope = scope


class PermissionDenied(Exception):
    """没有有效 grant。data-model.md §2 要求直接拒绝，不是返回空上下文。"""


class MemoryRateLimiter:
    def __init__(self, limits: dict | None = None, now=time.time):
        self.limits = limits or DEFAULT_LIMITS
        self._now = now
        self._hits: dict[tuple[str, str], deque] = {}

    def check_and_count(self, user_id: str, scope: str) -> None:
        cap, window = self.limits[scope]
        hits = self._hits.setdefault((user_id, scope), deque())
        cutoff = self._now() - window
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= cap:
            raise RateLimited(scope)
        hits.append(self._now())


class MemoryHistory:
    """按 (user, storyboard) 分区，最近 6 条，不摘要（prompts.md §2.4）。"""

    TURNS = 6

    def __init__(self):
        self._log: dict[tuple[str, str], list[dict]] = {}

    def recent(self, user_id: str, storyboard_id: str) -> list[dict]:
        return list(self._log.get((user_id, storyboard_id), [])[-self.TURNS:])

    def append(self, user_id: str, storyboard_id: str, role: str, content: str,
               prompt_version: str = None, model: str = None) -> None:
        # prompt_version 与 model 是 CLAUDE.md 工作约定 2 要落库的字段，内存实作只接住签名
        self._log.setdefault((user_id, storyboard_id), []).append({"role": role, "content": content})

    def drop_partition(self, user_id: str, storyboard_id: str) -> None:
        """权限撤销时立刻停用该分区，不等 TTL（prompts.md §2.6.3 第 2 条）。"""
        self._log.pop((user_id, storyboard_id), None)


class MemoryContext:
    """Tier 1：只回当前用户自己的内容。阶段 4 换成 data-model.md §2 的 build_context()。"""

    def __init__(self):
        self.grants: set[tuple[str, str]] = set()
        self.entries: dict[tuple[str, str], list[dict]] = {}

    def build(self, user_id: str, storyboard_id: str) -> dict:
        if (user_id, storyboard_id) not in self.grants:
            raise PermissionDenied
        own = self.entries.get((user_id, storyboard_id), [])
        return {
            "species_selected": own[-1]["species"] if own else "unknown",
            "storyboard_visible_to_this_user": True,
            "own_entries": own,
        }
