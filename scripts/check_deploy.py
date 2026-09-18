#!/usr/bin/env python3
"""Are both deployments actually serving? Run this after every deploy.

    python scripts/check_deploy.py
    python scripts/check_deploy.py --web https://... --api https://...

This exists because of a specific hour on 2026-09-17. A `web/` entry was added to
.vercelignore to trim the Python function's bundle. Vercel reads that file for both projects
built out of this repository, and fencepost-web has web/ as its Root Directory — so the entry
did not trim the API bundle, it deleted the front end's source.

Nothing failed. Next.js found no app directory, emitted a single 404 page through the pages
router, and Vercel deployed it and reported Ready:

    Route (pages)          Size   First Load JS
    - o /404               180 B         108 kB

Every route on the site answered 404 while the dashboard said the deployment was healthy. The
person who changed the file had checked that the API bundle still held what the API needs, and
stopped there, because they were thinking about one of the two projects the file governs.

So this is deliberately not a deep test. It asks the one question a green deployment status
cannot answer - is what got deployed the thing we meant to deploy - and it asks it of BOTH
projects, because that is the half that gets forgotten.

It is also deliberately not verify_deployment.py. That script walks ten authenticated chains
and leaves a content-holding verify-* user in the production database every time it runs.
This one signs in as nobody, writes nothing, and can be run as often as you like.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

WEB = "https://fencepost-app.vercel.app"
API = "https://fencepost-api.vercel.app"

# Every POST route api/index.py dispatches. A missing entry in the POST_ROUTES table shows up
# here as a 404 and nowhere else - that table used to be a twenty-branch if-chain and is now a
# dict, which is exactly the kind of thing that loses a line quietly in a merge.
POST_ROUTES = [
    "/api/session", "/api/register", "/api/login",
    "/api/storyboards", "/api/storyboards/close", "/api/videos",
    "/api/entries", "/api/entries/edit", "/api/entries/delete", "/api/entries/remove",
    "/api/share-links", "/api/share-links/redeem", "/api/share-links/revoke",
    "/api/grants/revoke",
    "/api/forum/threads", "/api/forum/posts", "/api/forum/posts/delete",
    "/api/forum/posts/remove",
    "/api/review/vote", "/api/review/dispose", "/api/assistant",
    # The one route an unauthenticated probe can use to tell a current API from one deployed
    # before 2026-09-18. It was missing, so this script passed against a stale API after a
    # push - the exact state it exists to catch. tests/test_entrypoint.py now compares this
    # list with the dispatch table.
    "/api/sessions/revoke",
]
GET_ROUTES = [
    "/api/timeline", "/api/dashboard", "/api/record",
    "/api/forum", "/api/forum/thread", "/api/review", "/api/grants", "/api/share-links",
]

# Pages that must exist on the front end. Which pages they are matters less than the fact that
# a build with no source answers 404 to every one of them while still reporting Ready.
WEB_PAGES = ["/", "/credits", "/sign-in", "/you"]


def fetch(url: str, method: str = "GET", body: bytes = None, headers: dict = None):
    """(status, body text, headers). A 4xx is an answer, not an error."""
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode("utf-8", "replace"), dict(response.headers)
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode("utf-8", "replace"), dict(err.headers)
    except Exception as exc:                                  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}", {}


class Report:
    def __init__(self):
        self.failures = []

    def check(self, ok: bool, label: str, detail: str = "") -> bool:
        # The detail says what went wrong, so it only belongs on a failure. Printing it beside
        # an "ok" put the sentence "every page 404s" next to a passing check, which reads as
        # exactly the opposite of what happened.
        print(f"  {'ok  ' if ok else 'FAIL'}  {label}" + ("" if ok or not detail else f"  - {detail}"))
        if not ok:
            self.failures.append(f"{label}{'  - ' + detail if detail else ''}")
        return bool(ok)


def check_web(report: Report, web: str) -> None:
    print(f"\nfront end  {web}")
    served = 0
    for page in WEB_PAGES:
        status, _, _ = fetch(web + page)
        if report.check(status == 200, f"GET {page}", f"status {status}"):
            served += 1
    # The failure this script was written for. One page could be a genuine 404; none of them
    # being served is the front end not being deployed at all.
    report.check(served > 0, "the site has any pages at all",
                 "every page 404s - this is what a build with no source looks like")


def check_api(report: Report, api: str) -> None:
    print(f"\napi  {api}")
    status, body, _ = fetch(api + "/api/dashboard")
    report.check(status == 401, "an unauthenticated read is refused, not crashed",
                 f"status {status}")
    try:
        report.check(json.loads(body)["error"]["code"] == "unauthorized",
                     "the refusal is a redacted JSON error")
    except Exception:                                         # noqa: BLE001
        report.check(False, "the refusal is a redacted JSON error", body[:80])

    # Reachability, not behaviour. A route missing from the dispatch table answers 404; every
    # other status here means the request got as far as a handler.
    missing = []
    for route in POST_ROUTES:
        status, _, _ = fetch(api + route, method="POST", body=b"{}",
                             headers={"content-type": "application/json"})
        if status == 404 or status is None:
            missing.append(f"{route} -> {status}")
    report.check(not missing, f"all {len(POST_ROUTES)} POST routes reach a handler",
                 "; ".join(missing))

    missing = []
    for route in GET_ROUTES:
        status, _, _ = fetch(api + route)
        if status == 404 or status is None:
            missing.append(f"{route} -> {status}")
    report.check(not missing, f"all {len(GET_ROUTES)} GET routes reach a handler",
                 "; ".join(missing))

    # The entrypoint guard: a body that is valid JSON but not an object, and an id that is not
    # a string. Both used to reach a handler and end the request with no response written at
    # all, which the client sees as a closed connection rather than a status.
    status, _, _ = fetch(api + "/api/entries/delete", method="POST", body=b"[]",
                         headers={"content-type": "application/json"})
    report.check(status == 400, "a body that is not an object is a clean 400", f"status {status}")
    status, _, _ = fetch(api + "/api/entries/delete", method="POST",
                         body=b'{"entry_id": {}}',
                         headers={"content-type": "application/json"})
    report.check(status == 400, "an id that is not a string is a clean 400", f"status {status}")

    _, _, headers = fetch(api + "/api/dashboard",
                          headers={"Origin": "https://evil.example.com"})
    allowed = (headers.get("access-control-allow-origin")
               or headers.get("Access-Control-Allow-Origin") or "")
    report.check(bool(allowed) and allowed != "*",
                 "CORS does not hand a wildcard to a hostile origin", f"got {allowed!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--web", default=WEB)
    parser.add_argument("--api", default=API)
    args = parser.parse_args()

    report = Report()
    check_web(report, args.web.rstrip("/"))
    check_api(report, args.api.rstrip("/"))

    print()
    if report.failures:
        print(f"{len(report.failures)} check(s) failed:")
        for failure in report.failures:
            print(f"  - {failure}")
        return 1
    print("both deployments are serving what they should be.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
