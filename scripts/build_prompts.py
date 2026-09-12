#!/usr/bin/env python3
"""
从 docs/prompts.md 抽出可运行的 prompt 文件。

docs/prompts.md 是唯一来源，prompts/*.txt 是生成物 —— 不要手改生成物。
改完文档跑一次：

    python scripts/build_prompts.py

输出:
    prompts/shared.txt      SHARED RULES
    prompts/neighbour.txt   ROLE: NEIGHBOUR + CONTEXT BOUNDARY + VISION RULES
    prompts/writer.txt      ROLE: WRITER
    prompts/screener.txt    ROLE: SCREENER + few-shot
    prompts/VERSION         文档版本号，随每次模型调用一起记录
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 仓库里在 docs/ 下；散装目录里在同级。两种都认。
SRC = next((c for c in (ROOT / "docs" / "prompts.md", ROOT / "prompts.md") if c.exists()),
           ROOT / "docs" / "prompts.md")
OUT = ROOT / "prompts"

# 生成物 → 按顺序拼接的区块起始标记
LAYOUT = {
    "shared": ["=== SHARED RULES ==="],
    "neighbour": ["=== ROLE: NEIGHBOUR ===", "=== CONTEXT BOUNDARY ===", "=== VISION RULES ==="],
    "writer": ["=== ROLE: WRITER ==="],
    "screener": ["=== ROLE: SCREENER ==="],
}

FEWSHOT_ANCHOR = 'Input: "Brushtail possums are marsupials'


def extract_block(text: str, start_marker: str) -> str:
    """取出 start_marker 到下一个 === END ... === 之间的内容（含首尾标记）。"""
    i = text.find(start_marker)
    if i == -1:
        sys.exit(f"prompts.md 里找不到区块: {start_marker}")
    end = re.search(r"^=== END [A-Z: ]+===$", text[i:], re.MULTILINE)
    if not end:
        sys.exit(f"区块没有结束标记: {start_marker}")
    return text[i : i + end.end()].strip()


def extract_fewshot(text: str) -> str:
    i = text.find(FEWSHOT_ANCHOR)
    if i == -1:
        sys.exit("找不到 Screener 的 few-shot 区块")
    fence = text.find("```", i)
    if fence == -1:
        sys.exit("few-shot 区块没有闭合的 ```")
    return text[i:fence].strip()


def extract_version(text: str) -> str:
    m = re.search(r"^> 版本：(v[\d.]+)", text, re.MULTILINE)
    return m.group(1) if m else "unknown"


def main() -> None:
    if not SRC.exists():
        sys.exit(f"找不到 {SRC}")
    text = SRC.read_text(encoding="utf-8")

    OUT.mkdir(exist_ok=True)
    version = extract_version(text)

    for name, markers in LAYOUT.items():
        parts = [extract_block(text, m) for m in markers]
        if name == "screener":
            parts.append("EXAMPLES\n\n" + extract_fewshot(text))
        body = "\n\n".join(parts)
        # 只查生成物：prompts.md §0 的占位符说明表本身就写着这些名字，扫全文必然误报
        leftover = re.findall(r"\[(?:PLATFORM_NAME|ASSISTANT_NAME|RESCUE_CONTACT)\]", body)
        if leftover:
            print(f"  警告: {name}.txt 里还有 {len(leftover)} 处未替换的占位符")
        header = f"# GENERATED from prompts.md {version} — do not edit by hand\n\n"
        path = OUT / f"{name}.txt"
        path.write_text(header + body + "\n", encoding="utf-8", newline="\n")
        print(f"  {path.relative_to(ROOT)}  ({len(body.splitlines())} 行)")

    (OUT / "VERSION").write_text(version + "\n", encoding="utf-8")
    print(f"  prompts/VERSION  ({version})")
    print("\n提醒: 每次模型调用要把这个版本号一起写进 screening_results / chat_messages。")


if __name__ == "__main__":
    main()
