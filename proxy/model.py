"""Thin wrapper over DashScope compatible mode: timeouts, retries, error redaction."""

import os
import sys

from .env import load_env

DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

# Thinking levels from qwen-integration.md §1. "none" was confirmed a valid value by
# measurement on 2026-09-12, see §5.
EFFORT = {"neighbour": "medium", "writer": "low", "screener": "none"}


class UpstreamError(Exception):
    """Any upstream failure lands here. The detail goes to the server log, never the client."""


def redact(text: str) -> str:
    key = os.getenv("DASHSCOPE_API_KEY")
    return text.replace(key, "***") if key else text


class DashScope:
    def __init__(self, chat_model=None, screener_model=None, base_url=None, timeout=None):
        load_env()
        from openai import OpenAI

        key = os.getenv("DASHSCOPE_API_KEY")
        if not key:
            raise UpstreamError("no_api_key")
        self.chat_model = chat_model or os.getenv("CHAT_MODEL", "qwen3.8-max")
        # Settled 2026-09-13: the Screener and the chat share one model, held down to a
        # usable latency by reasoning_effort=none. To change models edit here or set
        # SCREENER_MODEL, and re-run the red-line suite afterwards.
        self.screener_model = screener_model or os.getenv("SCREENER_MODEL", self.chat_model)
        self.timeout = timeout or float(os.getenv("MODEL_TIMEOUT", "20"))
        # max_retries=0: the caller decides the retry count per role. The SDK must not
        # quietly retry on its own.
        self._client = OpenAI(
            api_key=key,
            base_url=base_url or os.getenv("DASHSCOPE_BASE_URL", DEFAULT_BASE_URL),
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
        return resp.choices[0].message.content or ""

    def stream(self, role: str, system: str, content, history=()):
        """Yield text deltas. Upstream problems raise UpstreamError; the caller ends it."""
        messages = [{"role": "system", "content": system}, *history,
                    {"role": "user", "content": content}]
        try:
            chunks = self._client.chat.completions.create(
                model=self.chat_model,
                messages=messages,
                timeout=self.timeout,
                stream=True,
                extra_body={"reasoning_effort": EFFORT[role]},
            )
            for chunk in chunks:
                if not chunk.choices:
                    continue
                piece = chunk.choices[0].delta.content
                if piece:
                    yield piece
        except Exception as exc:
            print(f"[proxy] upstream stream {role}: {redact(str(exc))[:300]}", file=sys.stderr)
            raise UpstreamError(role) from None
