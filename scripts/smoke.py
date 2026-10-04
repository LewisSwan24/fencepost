#!/usr/bin/env python3
"""
Stage 1 smoke test — the results go into docs/qwen-integration.md.

    python scripts/smoke.py

Three things:
1. A minimal text call, confirming the endpoint, the key and the model name are right
2. Probe reasoning_effort: does compatible mode accept the parameter at all? If it does
   not, the value is silently ignored and the "thinking off" setting for the Screener in
   qwen-integration.md §1 never lands
3. Send a flat-colour PNG the script generates itself, to test image_url. The official
   documentation does not say whether qwen3.8-max accepts images in compatible mode, so
   the only way to know is to measure
"""

import base64
import os
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.env import load_env
from proxy.model import EFFORT, provider


def tiny_png(size: int = 64, rgb: tuple[int, int, int] = (118, 92, 66)) -> bytes:
    """A flat-colour PNG written byte by byte. No Pillow and no real footage: what is
    being tested is whether the endpoint accepts an image at all.
    """

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
    row = provider()
    key = os.getenv(row["key"])
    if not key:
        sys.exit(f"No {row['key']} (MODEL_PROVIDER={row['name']}). Put the key in .env at "
                 "the repository root, never in the code.")

    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("Missing dependency: pip install openai")

    base_url = os.getenv(row["base_url_env"], row["base_url"])
    chat_model = os.getenv("CHAT_MODEL", row["model"])
    vision_model = os.getenv("VISION_MODEL", chat_model)
    client = OpenAI(api_key=key, base_url=base_url)

    def clean(exc: Exception) -> str:
        """An error message can carry a fragment of the key; wipe it before printing."""
        return str(exc).replace(key, "***")

    print(f"endpoint: {base_url}")
    print(f"models: chat={chat_model}  vision={vision_model}\n")

    print("1. Text call (reasoning_effort=low)")
    try:
        resp = client.chat.completions.create(
            model=chat_model,
            messages=[{"role": "user", "content": "Reply with one word: pong"}],
            extra_body={"reasoning_effort": "low"},
        )
    except Exception as exc:
        print(f"   failed: {clean(exc)}")
        return 1
    print(f"   OK  {describe(resp)}")
    print(f"   reply: {resp.choices[0].message.content!r}")

    print("\n2. Is reasoning_effort validated?")
    try:
        client.chat.completions.create(
            model=chat_model,
            messages=[{"role": "user", "content": "ping"}],
            extra_body={"reasoning_effort": "not_a_real_value"},
        )
        print("   An invalid value still returns 200 — the parameter is silently ignored "
              "and the configured thinking level does nothing")
    except Exception as exc:
        print(f"   Invalid value refused — the parameter is real. Original: {clean(exc)[:200]}")

    # The values the proxy actually sends, per role. A provider that refuses one of them
    # fails that role on every call, which the Screener would hide by failing open.
    print("\n2b. The proxy's own reasoning_effort values")
    refused = 0
    for role, effort in EFFORT.items():
        try:
            client.chat.completions.create(
                model=chat_model,
                messages=[{"role": "user", "content": "Reply with one word: pong"}],
                extra_body={"reasoning_effort": effort},
            )
            print(f"   {role}: {effort!r} accepted")
        except Exception as exc:
            refused += 1
            print(f"   {role}: {effort!r} REFUSED — {clean(exc)[:200]}")
    if refused:
        print("   → change EFFORT in proxy/model.py for this provider before going further")
        return 1

    print("\n3. Image input (image_url + base64 PNG)")
    png = tiny_png()
    print(f"   generated image, {len(png)} bytes")
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
        print(f"   refused: {clean(exc)[:300]}")
        print(f"   → send vision calls to the qwen3-vl family; chat stays on {chat_model}")
        return 0
    print(f"   accepted  {describe(resp)}")
    print(f"   reply: {resp.choices[0].message.content!r}")
    print(f"   → vision and chat can share {chat_model}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
