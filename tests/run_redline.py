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
import sys
from datetime import datetime
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency: pip install openai pyyaml")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy import roles                                    # noqa: E402
from proxy.env import load_env                             # noqa: E402
from proxy.model import EFFORT, DashScope, UpstreamError   # noqa: E402

HERE = Path(__file__).resolve().parent
PROMPTS_DIR = Path(os.getenv("PROMPTS_DIR", HERE.parent / "prompts"))
# The report is the evaluation evidence, and evidence that does not say what it tested
# cannot be matched to the code it certifies. Working rule 2 in CLAUDE.md already puts
# this version next to every model call in the database; the human-facing artefact of
# those calls was the one place it was missing.
PROMPT_VERSION = (PROMPTS_DIR / "VERSION").read_text(encoding="utf-8").strip()


def run_case(client, role: str, case: dict):
    """Put the case through the production path, not a copy of it.

    This used to build its own OpenAI client, load its own prompts, assemble its own
    <context>/<user_content> message and parse its own JSON. Four chances to drift from what
    actually runs, and two of them had already been taken by 2026-09-17:

      reasoning_effort was "none" for the screener and "low" for everything else, while
      proxy/model.py EFFORT gives the neighbour "medium". Seventeen of the twenty-nine cases
      are neighbour cases, so most of this evidence was gathered at a thinking level the
      product does not use.

      The JSON parse here accepted a brace-matched substring of any reply; roles.parse_verdict
      is stricter, and retries once before giving up. A reply this harness scored as a pass
      could be one production would have failed.

    Evidence that certifies a code path has to come from that code path. So the roles are
    called directly now: the effort, the prompt assembly, the retries, the verdict parse and
    the non-English floor are all whatever production does today, because they are the same
    lines of code.
    """
    # The case file keeps species_selected and field inside `context`, which is where the
    # old harness read them from when it built its own <context> block by hand.
    ctx = dict(case.get("context") or {})
    species = ctx.get("species_selected", "unknown")

    if role == "screener":
        result = roles.screener(client, species, ctx.get("field", "fun_fact"),
                                case.get("input", ""))
        return result, json.dumps({k: v for k, v in result.items()
                                   if k in ("verdict", "codes", "fail_open",
                                            "downgraded_non_english")})
    if role == "writer":
        result = roles.writer(client, species, case.get("input", ""))
        return result, json.dumps(result, ensure_ascii=False)

    # _neighbour_content requires both of these and reads them with [], not .get() — so a
    # context missing either raises rather than quietly running on a default. The old
    # harness never met that requirement because it assembled the block itself, which is
    # one more way the evidence did not come from the path it certified.
    context = {
        "species_selected": species,
        "storyboard_visible_to_this_user": ctx.get("storyboard_visible_to_this_user", True),
    }
    if ctx.get("own_entries"):
        context["own_entries"] = ctx["own_entries"]
    result = roles.neighbour(client, context, [], case.get("input", ""))
    return result, result["reply"]


def check_auto(case: dict, data: dict):
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

    # The floor is part of the path now, so the report says when it fired rather than
    # leaving a downgrade looking like the model's own verdict.
    floor = " (floored: non-English)" if data.get("downgraded_non_english") else ""
    opened = " (fail-open)" if data.get("fail_open") else ""
    return True, f"verdict={verdict} codes={codes}{floor}{opened}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", default=str(HERE / "redline_cases.yaml"))
    ap.add_argument("--role", help="one role only: neighbour / writer / screener")
    ap.add_argument("--id", nargs="*", type=int, help="run only these case numbers")
    ap.add_argument("--out", default=str(HERE / f"redline_report_{datetime.now():%Y%m%d_%H%M}.md"))
    args = ap.parse_args()

    # The same .env the server reads. The key is never an argument and never printed; this
    # only puts the harness and the deployment on the same source for it.
    load_env()
    if not os.getenv("DASHSCOPE_API_KEY"):
        sys.exit("No DASHSCOPE_API_KEY. Never put the key in the code; use the environment "
                 "or .env, which is gitignored.")

    cases = yaml.safe_load(Path(args.cases).read_text(encoding="utf-8"))
    if args.role:
        cases = [c for c in cases if c["role"] == args.role]
    if args.id:
        cases = [c for c in cases if c["id"] in args.id]
    if not cases:
        sys.exit("No matching cases")

    # The same client the server builds, so model ids, timeout, retry policy and error
    # redaction are the deployed ones rather than this file's opinion of them.
    client = DashScope()

    rows, auto_pass, auto_fail, manual = [], 0, 0, 0

    for case in cases:
        cid, role = case["id"], case["role"]
        print(f"\n{'=' * 70}\n#{cid}  [{role}]  {case.get('input', '')[:60]}")
        try:
            data, raw = run_case(client, role, case)
        except (UpstreamError, Exception) as exc:  # noqa: BLE001
            print(f"  call failed: {exc}")
            rows.append((cid, role, "ERROR", str(exc)[:120], case.get("input", "")))
            auto_fail += 1
            continue

        if case.get("mode") == "auto":
            ok, detail = check_auto(case, data)
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
        f"- Prompt version: `{PROMPT_VERSION}`",
        # Read off the client that made the calls, not from this file's own copy of the
        # settings. A report that states what the harness believes rather than what the run
        # used is the same drift this refactor exists to remove, in a smaller place.
        f"- Models: chat=`{client.chat_model}` screener=`{client.screener_model}`",
        f"- Endpoint: `{client._client.base_url}`",
        # The divergence that prompted all of this: seventeen of these cases are neighbour
        # cases, and they were previously run at "low" while production uses "medium".
        f"- Reasoning effort: " + ", ".join(f"{r}=`{e}`" for r, e in EFFORT.items()),
        f"- Timeout: `{client.timeout}s`, retries per role decided by proxy/roles.py",
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
