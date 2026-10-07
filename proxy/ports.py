"""The three outside things the proxy depends on. Stage 3 is in memory, stage 4 is SQLite.

History and context are ports rather than request-body fields because prompts.md §2.6.1
says the front end must not decide what gets assembled: the server looks it up itself by
(user, storyboard). Leaving them as parameters would hand that boundary to the client.
"""

import os
import time
from collections import deque

# operations.md §3. All three can be overridden by environment variable; defaults match the doc.
DEFAULT_LIMITS = {
    "chat": (int(os.getenv("LIMIT_CHAT_PER_DAY", "200")), 86400),
    "vision": (int(os.getenv("LIMIT_VISION_PER_HOUR", "10")), 3600),
    "submission": (int(os.getenv("LIMIT_SUBMISSION_PER_HOUR", "20")), 3600),
    # operations.md §3: the one ceiling here that is meant to block rather than degrade.
    "login": (int(os.getenv("LIMIT_LOGIN_PER_15MIN", "10")), 900),
}

# operations.md §3, the two ceilings that belong to no user. Open sign-up hands anyone a
# fresh identity per handle, so a per-user limit bounds nothing about total spend: these do.
# `model` counts every call to the model whoever asked, retries included. `session` counts
# tokens minted by /api/session per client address, and is generous on purpose — a lecture
# theatre of markers can sit behind one campus NAT.
CEILINGS = {
    "model": (int(os.getenv("LIMIT_MODEL_CALLS_PER_DAY", "1000")), 86400),
    "session": (int(os.getenv("LIMIT_SESSIONS_PER_HOUR", "120")), 3600),
    # Password work per client address. scrypt is memory-hard by design (~16 MiB and ~60 ms
    # a call), and two unauthenticated paths run it with no per-user counter to bill against:
    # register (which also writes a permanent row each time) and a login for a handle that
    # does not exist. A flood of either is unauthenticated CPU, memory and — for register —
    # unbounded rows. Capped per address like sessions, and generous for the same reason: a
    # lecture theatre of markers can sit behind one campus NAT.
    "password": (int(os.getenv("LIMIT_PASSWORD_PER_15MIN", "30")), 900),
    # Short-code redemptions (#54), counted per attempt whether or not it hits. `code` is
    # everyone together and is the one that bounds guessing, because open sign-up mints a
    # fresh user per handle: with about ten live codes among ~1.5 billion, 200 an hour is
    # 4,800 guesses a day, about 1 in 30,000 of finding one. `code_user` keeps a single
    # caller from spending that shared allowance on everybody else's behalf.
    "code": (int(os.getenv("LIMIT_CODE_ATTEMPTS_PER_HOUR", "200")), 3600),
    "code_user": (int(os.getenv("LIMIT_CODE_ATTEMPTS_PER_USER_HOUR", "20")), 3600),
}


class RateLimited(Exception):
    def __init__(self, scope: str):
        super().__init__(scope)
        self.scope = scope


class PermissionDenied(Exception):
    """No valid grant. data-model.md §2 asks for a refusal, not an empty context."""


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


class MemoryCeilings:
    """The in-memory twin of db.SqliteCeilings, for tests. Per instance, so no ceiling at all
    on serverless — the same caveat as MemoryRateLimiter."""

    def __init__(self, now=time.time):
        self._now = now
        self._hits: dict[str, deque] = {}

    def claim(self, bucket: str, cap: int, window: int) -> bool:
        """Take one slot in `bucket`. False, and nothing taken, when the cap is reached."""
        hits = self._hits.setdefault(bucket, deque())
        cutoff = self._now() - window
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= cap:
            return False
        hits.append(self._now())
        return True


class MemoryHistory:
    """Partitioned by (user, storyboard), last 6 messages, never summarised (prompts.md §2.4)."""

    TURNS = 6

    def __init__(self):
        self._log: dict[tuple[str, str], list[dict]] = {}

    def recent(self, user_id: str, storyboard_id: str) -> list[dict]:
        return list(self._log.get((user_id, storyboard_id), [])[-self.TURNS:])

    def append(self, user_id: str, storyboard_id: str, role: str, content: str,
               prompt_version: str = None, model: str = None) -> None:
        # prompt_version and model are what working rule 2 in CLAUDE.md requires be written
        # to the database; the in-memory version only accepts the signature.
        self._log.setdefault((user_id, storyboard_id), []).append({"role": role, "content": content})

    def drop_partition(self, user_id: str, storyboard_id: str) -> None:
        """Revoking access disables that partition at once, without waiting for a TTL
        (prompts.md §2.6.3, item 2).
        """
        self._log.pop((user_id, storyboard_id), None)


class MemoryScreeningLog:
    """Where screening results land. In memory it only collects; tests assert against it."""

    def __init__(self):
        self.records: list[dict] = []

    def record(self, row: dict) -> None:
        self.records.append(row)


class MemoryContext:
    """Tier 1: only this user's own content. Stage 4 swaps in data-model.md §2 build_context()."""

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
