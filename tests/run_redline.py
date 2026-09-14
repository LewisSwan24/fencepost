#!/usr/bin/env python3
"""
Red-line test batch — docs/prompts.md §6

Usage:
    export DASHSCOPE_API_KEY=sk-xxx
    pip install openai pyyaml
    python run_redline.py                    # everything
    python run_redline.py --role screener    # one role only
    python run_redline.py --id 15 16 17      # named cases only
    python run_redline.py --out report.md    # choose the report path

Screener cases assert verdict and codes automatically.
Neighbour and writer cases cannot be judged automatically: the script prints the model
output and you tick them off one by one.
The report is markdown, ready to archive as the evaluation evidence for the course.
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
    sys.exit("Missing dependency: pip install openai pyyaml")

BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
)
CHAT_MODEL = os.getenv("CHAT_MODEL", "qwen3.8-max")
SCREENER_MODEL = os.getenv("SCREENER_MODEL", "qwen3.8-max")

HERE = Path(__file__).resolve().parent
PROMPTS_DIR = Path(os.getenv("PROMPTS_DIR", HERE.parent / "prompts"))


def load_prompt(role: str) -> str:
    """
    Read a role prompt. The convention is prompts/shared.txt + prompts/<role>.txt, joined.
    If they have not been split into files yet, copy the three fenced blocks out of
    docs/prompts.md first.
    """
    shared = PROMPTS_DIR / "shared.txt"
    role_file = PROMPTS_DIR / f"{role}.txt"
    missing = [p for p in (shared, role_file) if not p.exists()]
    if missing:
        sys.exit(
            "Missing prompt file: "
            + ", ".join(str(p) for p in missing)
            + "\nSave the code blocks from docs/prompts.md as those files and run again."
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
    effort = "none" if role == "screener" else "low"   # matches qwen-integration §1
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
    """The Screener should emit JSON only; tolerate it being wrapped in a fence."""
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
        return False, "the output is not valid JSON (the Screener must emit JSON only)"

    verdict = data.get("verdict")
    codes = data.get("codes") or []

    allowed = case.get("expect_verdict_any")
    if allowed:
        if verdict not in allowed:
            return False, f"verdict={verdict}, expected one of {allowed}"
    elif case.get("expect_verdict") and verdict != case["expect_verdict"]:
        return False, f"verdict={verdict}, expected {case['expect_verdict']}"

    want_codes = case.get("expect_codes_any")
    if want_codes and not set(codes) & set(want_codes):
        return False, f"codes={codes}, expected at least one of {want_codes}"

    return True, f"verdict={verdict} codes={codes}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default=str(HERE / "redline_cases.yaml"))
    ap.add_argument("--role", help="one role only: neighbour / writer / screener")
    ap.add_argument("--id", nargs="*", type=int, help="run only these case numbers")
    ap.add_argument("--out", default=str(HERE / f"redline_report_{datetime.now():%Y%m%d_%H%M}.md"))
    args = ap.parse_args()

    if not os.getenv("DASHSCOPE_API_KEY"):
        sys.exit("No DASHSCOPE_API_KEY. Never put the key in the code; use the environment.")

    cases = yaml.safe_load(Path(args.cases).read_text(encoding="utf-8"))
    if args.role:
        cases = [c for c in cases if c["role"] == args.role]
    if args.id:
        cases = [c for c in cases if c["id"] in args.id]
    if not cases:
        sys.exit("No matching cases")

    client = OpenAI(api_key=os.getenv("DASHSCOPE_API_KEY"), base_url=BASE_URL)

    rows, auto_pass, auto_fail, manual = [], 0, 0, 0

    for case in cases:
        cid, role = case["id"], case["role"]
        print(f"\n{'=' * 70}\n#{cid}  [{role}]  {case.get('input', '')[:60]}")
        try:
            raw = call(client, role, case)
        except Exception as exc:  # noqa: BLE001
            print(f"  call failed: {exc}")
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
            print(f"  expected: {case.get('expect', '')}")
            print(f"  ---- model output ----\n{raw}\n  ----------------------")
            rows.append((cid, role, "MANUAL", raw.replace("\n", " ")[:300], case.get("input", "")))
            manual += 1

    lines = [
        "# Red-line test report",
        "",
        f"- Run: {datetime.now():%Y-%m-%d %H:%M}",
        f"- Models: chat=`{CHAT_MODEL}` screener=`{SCREENER_MODEL}`",
        f"- Endpoint: `{BASE_URL}`",
        f"- Automatic: {auto_pass} pass / {auto_fail} fail | awaiting a person: {manual}",
        "",
        "Automatic rows assert verdict and codes. Manual rows need ticking one by one — "
        "write the conclusion straight into the last column.",
        "",
        "| # | role | result | input | output / note | human judgement |",
        "|---|---|---|---|---|---|",
    ]
    for cid, role, status, detail, inp in rows:
        esc = lambda s: str(s).replace("|", "\\|")
        mark = "" if status != "MANUAL" else "[ ] pass   [ ] fail"
        lines.append(f"| {cid} | {role} | {status} | {esc(inp)[:60]} | {esc(detail)} | {mark} |")

    Path(args.out).write_text("\n".join(lines), encoding="utf-8")
    print(f"\nReport written to: {args.out}")
    print(f"Automatic: {auto_pass} pass / {auto_fail} fail | awaiting a person: {manual}")

    sys.exit(1 if auto_fail else 0)


if __name__ == "__main__":
    main()
