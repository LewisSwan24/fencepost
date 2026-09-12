#!/usr/bin/env python3
"""
红线测试跑批 —— 对应 docs/prompts.md §6

用法:
    export DASHSCOPE_API_KEY=sk-xxx
    pip install openai pyyaml
    python run_redline.py                    # 全量
    python run_redline.py --role screener    # 只跑某个角色
    python run_redline.py --id 15 16 17      # 只跑指定用例
    python run_redline.py --out report.md    # 指定报告路径

screener 用例自动断言 verdict/codes。
neighbour / writer 用例无法自动判定，脚本打印模型输出，由你逐条勾选。
报告写成 markdown，可直接作为课程的 evaluation 证据存档。
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    import yaml
    from openai import OpenAI
except ImportError:
    sys.exit("缺依赖: pip install openai pyyaml")

BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
)
CHAT_MODEL = os.getenv("CHAT_MODEL", "qwen3.8-max")
SCREENER_MODEL = os.getenv("SCREENER_MODEL", "qwen3.8-max")

HERE = Path(__file__).resolve().parent
PROMPTS_DIR = Path(os.getenv("PROMPTS_DIR", HERE.parent / "prompts"))


def load_prompt(role: str) -> str:
    """
    读取角色 prompt。约定: prompts/shared.txt + prompts/<role>.txt 拼接。
    还没拆成文件的话，先从 docs/prompts.md 里把三段 ``` 块复制出来。
    """
    shared = PROMPTS_DIR / "shared.txt"
    role_file = PROMPTS_DIR / f"{role}.txt"
    missing = [p for p in (shared, role_file) if not p.exists()]
    if missing:
        sys.exit(
            "缺 prompt 文件: "
            + ", ".join(str(p) for p in missing)
            + "\n把 docs/prompts.md 里的代码块存成这些文件后重跑。"
        )
    return shared.read_text(encoding="utf-8") + "\n\n" + role_file.read_text(encoding="utf-8")


def build_user_message(case: dict) -> str:
    ctx = case.get("context") or {}
    ctx_lines = "\n".join(f"{k}: {v}" for k, v in ctx.items())
    return (
        f"<context>\n{ctx_lines}\n</context>\n\n"
        f"<user_content>\n{case.get('input', '')}\n</user_content>"
    )


def call(client: OpenAI, role: str, case: dict) -> str:
    model = SCREENER_MODEL if role == "screener" else CHAT_MODEL
    effort = "none" if role == "screener" else "low"   # 与 qwen-integration §1 一致
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": load_prompt(role)},
            {"role": "user", "content": build_user_message(case)},
        ],
        extra_body={"reasoning_effort": effort},
    )
    return resp.choices[0].message.content or ""


def parse_json(text: str):
    """Screener 应当只输出 JSON；容忍被 ``` 包住的情况。"""
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return None


def check_auto(case: dict, raw: str):
    data = parse_json(raw)
    if data is None:
        return False, "输出不是合法 JSON（Screener 必须只输出 JSON）"

    verdict = data.get("verdict")
    codes = data.get("codes") or []

    allowed = case.get("expect_verdict_any")
    if allowed:
        if verdict not in allowed:
            return False, f"verdict={verdict}，期望属于 {allowed}"
    elif case.get("expect_verdict") and verdict != case["expect_verdict"]:
        return False, f"verdict={verdict}，期望 {case['expect_verdict']}"

    want_codes = case.get("expect_codes_any")
    if want_codes and not set(codes) & set(want_codes):
        return False, f"codes={codes}，期望至少命中一个 {want_codes}"

    return True, f"verdict={verdict} codes={codes}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default=str(HERE / "redline_cases.yaml"))
    ap.add_argument("--role", help="只跑某角色: neighbour / writer / screener")
    ap.add_argument("--id", nargs="*", type=int, help="只跑指定用例编号")
    ap.add_argument("--out", default=str(HERE / f"redline_report_{datetime.now():%Y%m%d_%H%M}.md"))
    args = ap.parse_args()

    if not os.getenv("DASHSCOPE_API_KEY"):
        sys.exit("没有 DASHSCOPE_API_KEY。别把 key 写进代码，用环境变量。")

    cases = yaml.safe_load(Path(args.cases).read_text(encoding="utf-8"))
    if args.role:
        cases = [c for c in cases if c["role"] == args.role]
    if args.id:
        cases = [c for c in cases if c["id"] in args.id]
    if not cases:
        sys.exit("没有匹配的用例")

    client = OpenAI(api_key=os.getenv("DASHSCOPE_API_KEY"), base_url=BASE_URL)

    rows, auto_pass, auto_fail, manual = [], 0, 0, 0

    for case in cases:
        cid, role = case["id"], case["role"]
        print(f"\n{'=' * 70}\n#{cid}  [{role}]  {case.get('input', '')[:60]}")
        try:
            raw = call(client, role, case)
        except Exception as exc:  # noqa: BLE001
            print(f"  调用失败: {exc}")
            rows.append((cid, role, "ERROR", str(exc)[:120], case.get("input", "")))
            auto_fail += 1
            continue

        if case.get("mode") == "auto":
            ok, detail = check_auto(case, raw)
            print(f"  {'PASS' if ok else 'FAIL'}  {detail}")
            rows.append((cid, role, "PASS" if ok else "FAIL", detail, case.get("input", "")))
            auto_pass += ok
            auto_fail += not ok
        else:
            print(f"  期望: {case.get('expect', '')}")
            print(f"  ---- 模型输出 ----\n{raw}\n  ------------------")
            rows.append((cid, role, "MANUAL", raw.replace("\n", " ")[:300], case.get("input", "")))
            manual += 1

    lines = [
        "# 红线测试报告",
        "",
        f"- 时间: {datetime.now():%Y-%m-%d %H:%M}",
        f"- 模型: chat=`{CHAT_MODEL}` screener=`{SCREENER_MODEL}`",
        f"- 端点: `{BASE_URL}`",
        f"- 自动: {auto_pass} 通过 / {auto_fail} 失败 ｜ 待人工判定: {manual}",
        "",
        "自动项断言 verdict 与 codes。人工项需逐条勾选——把结论直接写在表格最后一列。",
        "",
        "| # | 角色 | 结果 | 输入 | 输出 / 说明 | 人工判定 |",
        "|---|---|---|---|---|---|",
    ]
    for cid, role, status, detail, inp in rows:
        esc = lambda s: str(s).replace("|", "\\|")
        mark = "" if status != "MANUAL" else "☐ 通过　☐ 不通过"
        lines.append(f"| {cid} | {role} | {status} | {esc(inp)[:60]} | {esc(detail)} | {mark} |")

    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print(f"\n报告已写入: {args.out}")
    print(f"自动: {auto_pass} pass / {auto_fail} fail ｜ 待人工: {manual}")

    sys.exit(1 if auto_fail else 0)


if __name__ == "__main__":
    main()
