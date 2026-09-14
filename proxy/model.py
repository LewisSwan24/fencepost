"""DashScope 兼容模式的薄封装。超时、重试次数、报错脱敏都收在这里。"""

import os
import sys

from .env import load_env

DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"

# qwen-integration.md §1 的思考档位。"none" 是 2026-09-12 实测确认的合法值，见 §5。
EFFORT = {"neighbour": "medium", "writer": "low", "screener": "none"}


class UpstreamError(Exception):
    """上游的任何问题都归到这里。原文只进服务端日志，不回客户端。"""


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
        # 2026-09-13 定：Screener 与聊天同一个模型，靠 reasoning_effort=none 压延迟。
        # 要换型号改这一处或设 SCREENER_MODEL，换完必须重跑红线。
        self.screener_model = screener_model or os.getenv("SCREENER_MODEL", self.chat_model)
        self.timeout = timeout or float(os.getenv("MODEL_TIMEOUT", "20"))
        # max_retries=0：重试次数按角色由调用方决定，SDK 不要自己悄悄重试。
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
        """逐块吐出文本增量。上游出问题一律抛 UpstreamError，收场方式交给调用方。"""
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
