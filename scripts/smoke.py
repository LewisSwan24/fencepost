#!/usr/bin/env python3
"""
阶段 1 冒烟 —— 结果写进 docs/qwen-integration.md。

    python scripts/smoke.py

三件事:
1. 最小文本调用，确认端点、key、模型名都对
2. 探测 reasoning_effort: 兼容模式认不认这个参数。不认的话它会被静默忽略，
   qwen-integration.md §1 里 Screener 那档「关闭思考」就落不了地
3. 发一张脚本自己生成的纯色 PNG 测 image_url。官方文档没写死 qwen3.8-max
   在兼容模式下收不收图，只能实测
"""

import base64
import os
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.env import load_env

DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"


def tiny_png(size: int = 64, rgb: tuple[int, int, int] = (118, 92, 66)) -> bytes:
    """纯色 PNG，手写字节。不引 Pillow，也不用真实素材——测的是接口收不收图。"""

    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    scanlines = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(scanlines))
        + chunk(b"IEND", b"")
    )


def describe(resp) -> str:
    bits = [f"model={resp.model}"]
    usage = getattr(resp, "usage", None)
    if usage:
        bits.append(f"tokens in/out={usage.prompt_tokens}/{usage.completion_tokens}")
        details = getattr(usage, "completion_tokens_details", None)
        reasoning = getattr(details, "reasoning_tokens", None) if details else None
        if reasoning is not None:
            bits.append(f"reasoning_tokens={reasoning}")
    return "  ".join(bits)


def main() -> int:
    load_env()
    key = os.getenv("DASHSCOPE_API_KEY")
    if not key:
        sys.exit("没有 DASHSCOPE_API_KEY。把 key 填进仓库根目录的 .env，不要写进代码。")

    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("缺依赖: pip install openai")

    base_url = os.getenv("DASHSCOPE_BASE_URL", DEFAULT_BASE_URL)
    chat_model = os.getenv("CHAT_MODEL", "qwen3.8-max")
    vision_model = os.getenv("VISION_MODEL", chat_model)
    client = OpenAI(api_key=key, base_url=base_url)

    def clean(exc: Exception) -> str:
        """报错原文可能带上 key 片段，打印前先抹掉。"""
        return str(exc).replace(key, "***")

    print(f"端点: {base_url}")
    print(f"模型: chat={chat_model}  vision={vision_model}\n")

    print("1. 文本调用 (reasoning_effort=low)")
    try:
        resp = client.chat.completions.create(
            model=chat_model,
            messages=[{"role": "user", "content": "Reply with one word: pong"}],
            extra_body={"reasoning_effort": "low"},
        )
    except Exception as exc:
        print(f"   失败: {clean(exc)}")
        return 1
    print(f"   OK  {describe(resp)}")
    print(f"   回复: {resp.choices[0].message.content!r}")

    print("\n2. reasoning_effort 是否被校验")
    try:
        client.chat.completions.create(
            model=chat_model,
            messages=[{"role": "user", "content": "ping"}],
            extra_body={"reasoning_effort": "not_a_real_value"},
        )
        print("   非法值也返回 200 —— 参数被静默忽略，配置里的思考档位不生效")
    except Exception as exc:
        print(f"   非法值被拒 —— 参数有效。原文: {clean(exc)[:200]}")

    print("\n3. 图像输入 (image_url + base64 PNG)")
    png = tiny_png()
    print(f"   合成图 {len(png)} 字节")
    try:
        resp = client.chat.completions.create(
            model=vision_model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Reply with one word: the dominant colour."},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/png;base64," + base64.b64encode(png).decode()
                            },
                        },
                    ],
                }
            ],
        )
    except Exception as exc:
        print(f"   拒收: {clean(exc)[:300]}")
        print(f"   → 视觉调用切到 qwen3-vl 系列，聊天仍用 {chat_model}")
        return 0
    print(f"   收下了  {describe(resp)}")
    print(f"   回复: {resp.choices[0].message.content!r}")
    print(f"   → 视觉与聊天可以共用 {chat_model}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
