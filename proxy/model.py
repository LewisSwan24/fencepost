"""Thin wrapper over an OpenAI-compatible chat endpoint: timeouts, retries, error redaction.

Two providers speak the same protocol, so the switch is a table, not a second client.
MODEL_PROVIDER picks the row (default dashscope); each row names its own key variable,
base-URL variable and default model, and CHAT_MODEL / SCREENER_MODEL still override.
"""

import os
import sys

from .env import load_env
from .ports import CEILINGS

DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

# Added 2026-10-04 (#50): the owner may stop using Bailian. OpenAI's gpt-6-luna is the
# low-cost row. Switching rows changes the model the red lines were measured on, so re-run
# tests/run_redline.py and tests/run_nonenglish.py before production follows.
PROVIDERS = {
    "dashscope": {"key": "DASHSCOPE_API_KEY", "base_url_env": "DASHSCOPE_BASE_URL",
                  "base_url": DEFAULT_BASE_URL, "model": "qwen3.8-max"},
    "openai": {"key": "OPENAI_API_KEY", "base_url_env": "OPENAI_BASE_URL",
               "base_url": "https://api.openai.com/v1", "model": "gpt-6-luna"},
}


def provider() -> dict:
    """The selected row, with its name. An unknown name is a configuration error, raised as
    UpstreamError so it behaves like a missing key rather than silently picking a default."""
    name = (os.getenv("MODEL_PROVIDER") or "dashscope").strip().lower()
    if name not in PROVIDERS:
        raise UpstreamError("unknown_provider")
    return {"name": name, **PROVIDERS[name]}

# Thinking levels from qwen-integration.md §1. "none" was confirmed a valid value by
# measurement on 2026-09-12, see §5.
EFFORT = {"neighbour": "medium", "writer": "low", "screener": "none"}


class UpstreamError(Exception):
    """Any upstream failure lands here. The detail goes to the server log, never the client."""


_SECRET_ENV = ("DASHSCOPE_API_KEY", "OPENAI_API_KEY", "FENCEPOST_TOKEN_SECRET","TURSO_AUTH_TOKEN",
               "LIBSQL_AUTH_TOKEN", "TURSO_DATABASE_URL")


def redact(text: str) -> str:
    """Mask every known secret env value before text reaches a log.

    This is the one sanitiser on exception text on its way to stderr. It used to strip only
    the DashScope key, so a libSQL/Turso connection or query error — whose message can carry
    the database URL and its auth token — or anything that embedded the token-signing secret
    went to the runtime log verbatim. Redacting one secret while others flow through the same
    sink was the gap. Longest value first, so a secret that happens to contain another is
    still fully masked.
    """
    values = [v for v in (os.getenv(name) for name in _SECRET_ENV) if v]
    for value in sorted(values, key=len, reverse=True):
        text = text.replace(value, "***")
    return text


def log_usage(role: str, usage) -> None:
    """One line per model call, so the prefix-cache hit rate is a number in the runtime
    log instead of a guess (baseline measured 2026-09-18, qwen-integration.md §7).
    cached_tokens is the part of the prompt the gateway served from cache."""
    if usage is None:
        return
    d = usage if isinstance(usage, dict) else usage.model_dump()
    prompt = d.get("prompt_tokens") or 0
    cached = (d.get("prompt_tokens_details") or {}).get("cached_tokens") or 0
    pct = f"{round(100 * cached / prompt)}%" if prompt else "-"
    print(f"[proxy] {role} usage: prompt={prompt} cached={cached} ({pct}) "
          f"completion={d.get('completion_tokens') or 0}", file=sys.stderr)


class DashScope:
    def __init__(self, chat_model=None, screener_model=None, base_url=None, timeout=None):
        load_env()
        from openai import OpenAI

        row = provider()
        key = os.getenv(row["key"])
        if not key:
            raise UpstreamError("no_api_key")
        self.provider = row["name"]
        self.chat_model = chat_model or os.getenv("CHAT_MODEL", row["model"])
        # Settled 2026-09-13: the Screener and the chat share one model, held down to a
        # usable latency by reasoning_effort=none. To change models edit here or set
        # SCREENER_MODEL, and re-run the red-line suite afterwards.
        self.screener_model = screener_model or os.getenv("SCREENER_MODEL", self.chat_model)
        self.timeout = timeout or float(os.getenv("MODEL_TIMEOUT", "20"))
        # max_retries=0: the caller decides the retry count per role. The SDK must not
        # quietly retry on its own.
        self._client = OpenAI(
            api_key=key,
            base_url=base_url or os.getenv(row["base_url_env"], row["base_url"]),
            max_retries=0,
        )

    def call(self, role: str, system: str, content, history=()) -> str:
        model = self.screener_model if role == "screener" else self.chat_model
        messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": content}]
        try:
            resp = self._client.chat.completions.create(
                model=model,
                messages=messages,
                timeout=self.timeout,
                extra_body={"reasoning_effort": EFFORT[role]},
            )
        except Exception as exc:
            print(f"[proxy] upstream {role}: {redact(str(exc))[:300]}", file=sys.stderr)
            raise UpstreamError(role) from None
        log_usage(role, getattr(resp, "usage", None))
        return resp.choices[0].message.content or ""

    def stream(self, role: str, system: str, content, history=()):
        """Yield text deltas. Upstream problems raise UpstreamError; the caller ends it."""
        messages = [{"role": "system", "content": system}, *history,
                    {"role": "user", "content": content}]
        usage = None
        try:
            chunks = self._client.chat.completions.create(
                model=self.chat_model,
                messages=messages,
                timeout=self.timeout,
                stream=True,
                # The final usage chunk arrives with empty choices; without this option
                # the streaming path would never report its cache hit rate. Verified
                # against the token-plan gateway 2026-09-18.
                stream_options={"include_usage": True},
                extra_body={"reasoning_effort": EFFORT[role]},
            )
            for chunk in chunks:
                if getattr(chunk, "usage", None) is not None:
                    usage = chunk.usage
                if not chunk.choices:
                    continue
                piece = chunk.choices[0].delta.content
                if piece:
                    yield piece
        except Exception as exc:
            print(f"[proxy] upstream stream {role}: {redact(str(exc))[:300]}", file=sys.stderr)
            raise UpstreamError(role) from None
        log_usage(role, usage)


class CappedClient:
    """Any client, behind the global ceiling on model calls (operations.md §3).

    Open sign-up makes a fresh handle a fresh per-user quota, so those limits bound nothing
    about what the model costs in total. This counts every call before it goes out — each
    retry by the Screener and the Writer too, because each one is billed.

    Reaching the ceiling raises UpstreamError, deliberately indistinguishable from an outage:
    the Screener fails open, the Writer skips, the Neighbour answers upstream_unavailable.
    Nobody asking did anything wrong, so nothing may tell them they did.
    """

    def __init__(self, client, ceilings, cap: int = None, window: int = None):
        default_cap, default_window = CEILINGS["model"]
        self._client = client
        self._ceilings = ceilings
        self.cap = default_cap if cap is None else cap
        self.window = default_window if window is None else window

    def __getattr__(self, name):
        # chat_model and screener_model are read off the client when a reply is stored.
        # Private names are refused so a half-built instance cannot recurse into itself.
        if name.startswith("_"):
            raise AttributeError(name)
        return getattr(self._client, name)

    def _claim(self, role: str) -> None:
        if not self._ceilings.claim("model", self.cap, self.window):
            print(f"[proxy] model ceiling reached ({self.cap} per {self.window}s)",
                  file=sys.stderr)
            raise UpstreamError(role)

    def call(self, role: str, system: str, content, history=()) -> str:
        self._claim(role)
        return self._client.call(role, system, content, history=history)

    def stream(self, role: str, system: str, content, history=()):
        # Not a generator function on purpose. The slot is claimed here, when the stream is
        # asked for, so a refusal arrives before the response has started and can still be
        # a plain 503; a generator would defer it to the first iteration, after the SSE
        # headers are already out.
        self._claim(role)
        return self._client.stream(role, system, content, history=history)
