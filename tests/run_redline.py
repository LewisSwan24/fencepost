#!/usr/bin/env python3
"""
Red-line test batch — docs/prompts.md §6

Usage:
    export DASHSCOPE_API_KEY=sk-xxx          # or MODEL_PROVIDER=openai + OPENAI_API_KEY
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
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency: pip install openai pyyaml")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy import roles                                    # noqa: E402
from proxy.env import load_env                             # noqa: E402
from proxy.model import EFFORT, DashScope, UpstreamError, provider   # noqa: E402

HERE = Path(__file__).resolve().parent
PROMPTS_DIR = Path(os.getenv("PROMPTS_DIR", HERE.parent / "prompts"))
# The report is the evaluation evidence, and evidence that does not say what it tested
# cannot be matched to the code it certifies. Working rule 2 in CLAUDE.md already puts
# this version next to every model call in the database; the human-facing artefact of
# those calls was the one place it was missing.
PROMPT_VERSION = (PROMPTS_DIR / "VERSION").read_text(encoding="utf-8").strip()


@dataclass
class Row:
    """One case's result, as the report needs it rather than as the terminal printed it."""
    id: int
    role: str
    status: str                       # PASS | FAIL | MANUAL | ERROR
    detail: str                       # the short version, for the table
    input: str
    raw: str = ""                     # the whole reply, for the section after the table
    note: str = ""                    # set when a role answered for itself; see fallback_note
    expect: str = ""                  # what the case says a person should be looking for


class Recording:
    """The client, plus a record of what each call to it actually did.

    Both roles that can fall back swallow the reason on the way: roles.writer catches
    UpstreamError and returns its skip payload, roles.screener does the same and returns
    fail_open. That is right for the product — a broken model must not stop somebody
    posting — and wrong for evidence, because from the outside the fallback looks exactly
    like a model reply and the report printed it as one (#35).

    Wrapping the client rather than changing the roles keeps the path under test the
    deployed path, which is the whole point of the refactor this file already went through.
    """

    def __init__(self, inner):
        self.inner = inner
        self.attempts = []            # one (role, error or "") per call, since `start`

    def start(self):
        self.attempts = []

    def call(self, role: str, system: str, content, history=()):
        try:
            reply = self.inner.call(role, system, content, history=history)
        except Exception as exc:      # noqa: BLE001 — recorded, then raised on unchanged
            self.attempts.append((role, str(exc)))
            raise
        self.attempts.append((role, ""))
        return reply

    def __getattr__(self, name):
        # chat_model, screener_model, timeout, stream, _client.base_url — the header reads
        # them off the client that made the calls, so they have to come through.
        return getattr(self.inner, name)


def fallback_note(role: str, data: dict, attempts: list) -> str:
    """Why this row holds a role's own answer rather than the model's, or "" if it does not.

    The distinction the attempt record buys: "the model never answered" and "the model
    answered and what came back was unusable" are the same payload downstream, and they are
    not the same finding. The first says nothing about the prompt and calls for a rerun; the
    second is about the prompt and belongs in the evidence.
    """
    if role == "writer" and data.get("skipped"):
        what = "The Writer skipped, so the payload is proxy/roles.py's own, not the model's"
    elif role == "screener" and data.get("fail_open"):
        what = ("The Screener failed open, so `review` here is the fallback prompts.md §5 "
                "requires, not a judgement of this text")
    else:
        return ""

    failed = [error for _, error in attempts if error]
    if failed and len(failed) == len(attempts):
        why = f"every attempt failed upstream (`{failed[0]}`)"
    elif failed:
        why = (f"{len(failed)} of {len(attempts)} attempts failed upstream (`{failed[0]}`), "
               "and the rest came back unusable")
    elif attempts:
        why = (f"the model answered {len(attempts)} times and none of it passed the role's "
               "own validation — this one is about the prompt, not the network")
    else:
        why = "no call was made at all, which should not be possible; check the harness"
    return f"{what}: {why}."


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

    # _context_block requires both of these and reads them with [], not .get() — so a
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


TABLE_LIMIT = 300        # characters of a reply the table keeps; the rest is below it


def render(rows: list, header: list) -> str:
    """The report: a table that can be read at a glance, then everything it had to cut.

    The table used to be the whole report, holding 300 characters of each manual row while
    the rest went to the terminal and nowhere else. Eight of the nineteen manual rows in
    redline_report_20260918_2306.md could not be judged from the archive afterwards and had
    to be run again — the evidence had been gathered and then thrown away. A report is what
    is left when the terminal is closed.
    """
    esc = lambda s: str(s).replace("|", "\\|").replace("\n", " ")
    lines = list(header) + [
        "",
        "Automatic rows assert verdict and codes. Manual rows need ticking one by one — "
        "write the conclusion straight into the last column, reading the full output below.",
        "",
        "| # | role | result | input | output / note | human judgement |",
        "|---|---|---|---|---|---|",
    ]
    for row in rows:
        mark = "[ ] pass   [ ] fail" if row.status == "MANUAL" else ""
        status = f"{row.status} (fallback)" if row.note else row.status
        # A fallback's payload is not a reply, so the table carries the sentence saying so
        # rather than the bytes that read like one.
        detail = row.note or esc(row.detail)[:TABLE_LIMIT]
        lines.append(f"| {row.id} | {row.role} | {status} | {esc(row.input)[:60]} | "
                     f"{detail} | {mark} |")

    kept = [row for row in rows if row.status != "PASS"]
    if not kept:
        return "\n".join(lines) + "\n"
    lines += [
        "",
        "## Full outputs",
        "",
        f"The table keeps {TABLE_LIMIT} characters; these are the whole replies, which is "
        "what a judgement has to be made on. Automatic rows that passed are not repeated — "
        "their assertion is the evidence.",
    ]
    for row in kept:
        lines += ["", f"### #{row.id} {row.role}" + (" — fell back" if row.note else ""), ""]
        if row.expect:
            lines += [f"Expected: {row.expect}", ""]
        if row.note:
            lines += [row.note, ""]
        body = row.raw or row.detail
        lines += [f"```{_fence(body)}", body, "```"]
    return "\n".join(lines) + "\n"


def _fence(body: str) -> str:
    """json for a payload, text for a reply. The screener and writer rows are JSON and read
    as a wall without it; a neighbour reply is prose and highlighting it as anything is a lie
    about what it is."""
    try:
        json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return "text"
    return "json" if body.strip()[:1] in "{[" else "text"


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
    key_env = provider()["key"]
    if not os.getenv(key_env):
        sys.exit(f"No {key_env}. Never put the key in the code; use the environment "
                 "or .env, which is gitignored.")

    cases = yaml.safe_load(Path(args.cases).read_text(encoding="utf-8"))
    if args.role:
        cases = [c for c in cases if c["role"] == args.role]
    if args.id:
        cases = [c for c in cases if c["id"] in args.id]
    if not cases:
        sys.exit("No matching cases")

    # The same client the server builds, so model ids, timeout, retry policy and error
    # redaction are the deployed ones rather than this file's opinion of them. Recording
    # adds nothing to the path; it only remembers what went over it.
    client = Recording(DashScope())

    rows, auto_pass, auto_fail, manual, fell_back = [], 0, 0, 0, 0

    for case in cases:
        cid, role = case["id"], case["role"]
        expect = str(case.get("expect", ""))
        print(f"\n{'=' * 70}\n#{cid}  [{role}]  {case.get('input', '')[:60]}")
        client.start()
        try:
            data, raw = run_case(client, role, case)
        except (UpstreamError, Exception) as exc:  # noqa: BLE001
            print(f"  call failed: {exc}")
            rows.append(Row(cid, role, "ERROR", str(exc)[:120], case.get("input", ""),
                            raw=str(exc), expect=expect))
            auto_fail += 1
            continue

        note = fallback_note(role, data, client.attempts)
        if note:
            print(f"  {note}")
            fell_back += 1

        if case.get("mode") == "auto":
            ok, detail = check_auto(case, data)
            print(f"  {'PASS' if ok else 'FAIL'}  {detail}")
            rows.append(Row(cid, role, "PASS" if ok else "FAIL", detail,
                            case.get("input", ""), raw=raw, note=note, expect=expect))
            auto_pass += ok
            auto_fail += not ok
        else:
            print(f"  expected: {expect}")
            print(f"  ---- model output ----\n{raw}\n  ----------------------")
            rows.append(Row(cid, role, "MANUAL", raw.replace("\n", " "),
                            case.get("input", ""), raw=raw, note=note, expect=expect))
            manual += 1

    header = [
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
        f"- Reasoning effort: " + ", ".join(f"{r}=`{e}`" for r, e in getattr(client, "effort", EFFORT).items()),
        f"- Timeout: `{client.timeout}s`, retries per role decided by proxy/roles.py",
        f"- Automatic: {auto_pass} pass / {auto_fail} fail | awaiting a person: {manual}",
    ]
    if fell_back:
        # Stated up top rather than left to whoever reads the rows. A run with fallbacks in
        # it did not test what it set out to test, and the archive should say so on its face.
        header.append(
            f"- **Fell back: {fell_back} row(s)** carry a role's own answer rather than the "
            "model's. Those rows say nothing about the prompt; rerun them.")

    Path(args.out).write_text(render(rows, header), encoding="utf-8")
    print(f"\nReport written to: {args.out}")
    print(f"Automatic: {auto_pass} pass / {auto_fail} fail | awaiting a person: {manual}"
          + (f" | fell back: {fell_back}" if fell_back else ""))

    sys.exit(1 if auto_fail else 0)


if __name__ == "__main__":
    main()
