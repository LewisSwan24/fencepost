#!/usr/bin/env python3
"""Walk a real deployment end to end — this is what issue #6 asked for.

    python scripts/verify_deployment.py https://fencepost-xxxx.vercel.app
    python scripts/verify_deployment.py <url> --bypass <protection-bypass-token>

The walk: 404, bad token 401, exchange a token, create a storyboard, post an entry, read
the timeline, did the Screener really run, the review queue, the share chain (issue, a
second person redeems, turn it off, cannot redeem once off, turning off leaves existing
access alone), the forum (start a thread, reply, a refused reply carrying a reason), the
Neighbour non-streaming and streaming, the Writer, and the submission rate limit. Seven
real model calls (four Screener, three assistant); the rate-limit loop makes none.

**Use the production alias** (`fencepost-api.vercel.app`), not the
`fencepost-<hash>-<team>.vercel.app` that `vercel deploy` prints. That one sits behind
Deployment Protection; a production alias does not, by default. `vercel inspect
<deployment>` shows the aliases.

Standard library only. It imports nothing from this repository and does not read .env —
the token is exchanged from the deployment's own /api/session rather than signed here.
That is not fastidiousness: storyboards.owner_id has a foreign key to users.id, and a
locally signed token names a user who does not exist in that database, so the insert
hits the key.

Which means FENCEPOST_OPEN_SIGNUP has to be on in the deployment. It is right to be off
by default (anyone can exchange somebody else's handle for a token), but **delivery stays
on hybrid, so the flag stays on in production** (settled 2026-09-13; the reasons are in
the CLAUDE.md decision table and web/README.md): remove it and /api/session closes, the
front end cannot get a token, and the whole site opens blank. The cost is stated plainly
— the live database holds demo data only.

A new project has Deployment Protection on by default, and a request then gets Vercel's
login page instead of our JSON. Either turn it off in the project settings or pass
--bypass.
"""

import argparse
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request


class Client:
    def __init__(self, base, bypass=None):
        self.base = base.rstrip("/")
        self.bypass = bypass
        self.frame_times = []      # when each frame arrived, to tell whether it was buffered
        # A _vercel_share link is admitted by cookie, so the whole session shares one jar
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def prime(self, share_url):
        """Visit the share link once to collect the admitting cookie."""
        self.opener.open(share_url, timeout=60).read()

    def send(self, path, body=None, token=None, stream=False):
        headers = {}
        if body is not None:
            headers["content-type"] = "application/json"
        if token:
            headers["authorization"] = "Bearer " + token
        if self.bypass:
            headers["x-vercel-protection-bypass"] = self.bypass
        request = urllib.request.Request(
            self.base + path, headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
            method="POST" if body is not None else "GET")
        try:
            response = self.opener.open(request, timeout=60)
        except urllib.error.HTTPError as err:
            response = err
        if stream:
            frames = []
            started = time.monotonic()
            self.frame_times = []
            for line in response:
                line = line.decode().strip()
                if line.startswith("data: "):
                    frames.append(json.loads(line[6:]))
                    self.frame_times.append(time.monotonic() - started)
            return response.status, frames
        raw = response.read()
        try:
            return response.status, json.loads(raw)
        except json.JSONDecodeError:
            # When the protection layer blocks it, what comes back is HTML, not ours
            return response.status, {"_not_json": raw[:160].decode(errors="replace")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--bypass", help="Vercel protection bypass token")
    parser.add_argument("--share", help="a temporary _vercel_share link, exchanged for an admitting cookie")
    # A different handle each run: submission allows 20 an hour, so the same user running
    # this twice inside an hour is certain to hit the quota — and that looks like a broken
    # service. It caused exactly one wrong diagnosis, on 2026-09-13.
    parser.add_argument("--handle", default=f"verify-{int(time.time()) % 1000000}")
    args = parser.parse_args()

    client = Client(args.url, args.bypass)
    if args.share:
        client.prime(args.share)
    checks = []
    failures = 0

    def record(label, ok, detail):
        nonlocal failures
        failures += not ok
        checks.append(ok)
        print(f"  {'pass' if ok else 'FAIL'}  {label:34} {detail}")

    def stop(why):
        print("\n" + why)
        sys.exit(1)

    print(f"Running against {client.base}:\n")

    status, payload = client.send("/api/nothing-here", body={})
    # There are two completely different reasons for a response that is not our JSON, and
    # they should not be said in one breath. On 2026-09-14 I pointed this script at the
    # front-end project and it dutifully announced that Deployment Protection was in the
    # way, sending me to a settings page that had never been turned on. Treating HTML as
    # the signal for the protection layer misses the more common reason — the address is
    # wrong — because both come back as something other than JSON.
    if "protection" in payload or "_not_json" in payload:
        on = payload.get("protection") or {}
        which = "、".join(name for name, flag in
                          (("Vercel Authentication", on.get("vercel_auth_enabled")),
                           ("Password", on.get("password_enabled"))) if flag)
        if not which and status == 404:
            stop(f"{client.base} returns an HTML 404 page, not our API.\n"
                 "This repository deploys as two projects: the API one, which /api/* hangs\n"
                 "off, and the front end. What you want is the API project's production\n"
                 "alias — the origin of any request the front-end page makes is it, and it\n"
                 "is also in the web project's NEXT_PUBLIC_FENCEPOST_API.")
        stop(f"Deployment Protection is in the way ({which or 'unknown'}); this is not our response.\n"
             f"  HTTP {status}, starting {str(payload.get('_not_json', ''))[:60]!r}\n"
             "Three ways out: turn it off under Settings → Deployment Protection; pass\n"
             "--bypass <token>; or pass --share <a _vercel_share link>, which is good for\n"
             "23 hours and changes no settings.")
    record("unknown path returns 404", status == 404, f"HTTP {status}")

    status, payload = client.send("/api/storyboards", body={"title": "x"}, token="bogus.token")
    record("bad token returns 401", status == 401, f"HTTP {status}")

    status, session = client.send("/api/session", body={"handle": args.handle})
    if status == 403:
        stop("/api/session is closed. Without a token here, nothing below can run.\n"
             "  vercel env add FENCEPOST_OPEN_SIGNUP production   # value 1\n"
             "Redeploy and run again. The flag is deliberately kept, because hybrid needs\n"
             "it to get a token; the cost is that anyone can impersonate any handle, which\n"
             "is why the live database holds demo data only.")
    if status == 503:
        stop("503: the deployment is missing environment variables. It needs both\n"
             "DASHSCOPE_API_KEY and FENCEPOST_TOKEN_SECRET.\n"
             f"  The server said: {session.get('error', session)}")
    if status != 200:
        stop(f"Could not get a token, HTTP {status}: {session}")
    record("got a token", True, session["handle"])
    token = session["token"]

    status, board = client.send("/api/storyboards", body={"title": "deployment check"}, token=token)
    if status != 200:
        record("created a storyboard", False, f"HTTP {status} {board}")
        stop("Every check below hangs off this storyboard, so this is as far as it goes.")
    record("created a storyboard", True, board["storyboard_id"][:12] + "…")
    storyboard = board["storyboard_id"]

    status, entry = client.send("/api/entries", token=token, body={
        "storyboard_id": storyboard, "species": "ringtail",
        "story": "One on the fence at eleven, stared at me for a while."})
    record("posted an entry (screened)", status == 200 and entry.get("published"),
           f"HTTP {status} prompt {entry.get('prompt_version')}")

    status, view = client.send(f"/api/timeline?storyboard_id={storyboard}", token=token)
    shown = view.get("entries", [])
    record("read the timeline", status == 200 and len(shown) == 1, f"{len(shown)} entries")

    # The previous check cannot prove the Screener ran: when the upstream is down,
    # fail-open publishes anyway and the response looks identical, which is what
    # operations §2.3 wants — the author is never told. The only difference is that the
    # entry gets marked review, and being_checked shows it. That is how a wrong key was
    # caught on the real deployment on 2026-09-13.
    flagged = [e for e in shown if e.get("being_checked")]
    record("Screener really ran", bool(shown) and not flagged,
           "marked review — fail-open let it through, the upstream is down" if flagged else
           "clean pass" if shown else "no entry to look at, this one cannot be judged")

    # The review queue. It looks like a check added for the sake of it, and it is the most
    # expensive lesson in this script: `settle_review()` reads `execute(...).rowcount`, and
    # the wrapper for the hosted database had no such attribute, so this path returned 500
    # on Turso the whole time — unnoticed, because the two review screens did not exist yet,
    # no interface ever called it, and this script did not reach here either. An empty queue
    # still passes: what is checked is whether the path works, not whether anything waits.
    status, queue = client.send(f"/api/review?storyboard_id={storyboard}", token=token)
    record("review queue (lazy settle path)", status == 200 and "items" in queue,
           f"HTTP {status}, {len(queue.get('items', []))} items" if status == 200
           else str(queue)[:60])

    # The share chain: issue -> redeem -> turn off -> redeem again. It spans share_links and
    # access_grants, and this script used to walk none of it. When a scanned code will not
    # open, there is no way to see which step broke.
    status, link = client.send("/api/share-links", token=token, body={
        "storyboard_id": storyboard, "level": "view", "expires_in_days": 7})
    plain, link_id = link.get("token"), link.get("share_link_id")
    record("issued a share link", status == 200 and bool(plain),
           f"HTTP {status} {link.get('level') or str(link)[:40]}")

    status, listed = client.send(f"/api/share-links?storyboard_id={storyboard}", token=token)
    rows = listed.get("links") or []
    # The plaintext is absent from the response on purpose: the database holds only a
    # SHA-256. The day this gets "fixed" into returning plaintext, a redeemable grant would
    # be left hanging on a screen — which is what the comment on app.list_share_links says.
    leaked = [r for r in rows if "token" in r]
    record("code list returns no plaintext", status == 200 and len(rows) == 1 and not leaked,
           f"{len(rows)} row" + (", plaintext came back — this check exists for that" if leaked else ""))

    status, guest_session = client.send("/api/session", body={"handle": args.handle + "-guest"})
    guest = guest_session.get("token")
    status, got = client.send("/api/share-links/redeem", token=guest, body={"token": plain})
    record("second person redeems", status == 200 and got.get("storyboard_id") == storyboard,
           f"HTTP {status} got {got.get('level') or str(got)[:40]}")

    status, seen = client.send(f"/api/timeline?storyboard_id={storyboard}", token=guest)
    record("can read after redeeming", status == 200, f"HTTP {status}, {len(seen.get('entries', []))} entries")

    status, off = client.send("/api/share-links/revoke", token=token,
                              body={"share_link_id": link_id})
    record("turned the code off", status == 200 and off.get("revoked") is True, f"HTTP {status}")

    status, again = client.send("/api/share-links/redeem", token=guest, body={"token": plain})
    record("cannot redeem once off", status == 403,
           f"HTTP {status} {(again.get('error') or {}).get('code', '')}")

    # Evidence for the sentence in ux-copy §6.5: turning a code off only stops people who
    # have not used it yet. Whoever already holds the access keeps it, untouched —
    # revoke_share_link() writes share_links.revoked_at and never goes near access_grants.
    # Running those two together without saying so is how somebody comes to believe they
    # closed a door.
    status, still = client.send(f"/api/timeline?storyboard_id={storyboard}", token=guest)
    record("turning off keeps access", status == 200, f"HTTP {status}")

    # The forum. Starting a thread screens the title joined to the body, not the body
    # alone — otherwise a question naming somebody's street address, with a clean body
    # under it, would sit in front of everyone.
    status, thread = client.send("/api/forum/threads", token=token, body={
        "storyboard_id": storyboard, "title": "Pruning on the corner block",
        "body": "Council dropped a letter saying the jacaranda gets a heavy prune next month."})
    thread_id = thread.get("thread_id")
    record("started a thread", status == 200 and thread.get("published") is True,
           f"HTTP {status} prompt {thread.get('prompt_version', '')}")

    status, post = client.send("/api/forum/posts", token=token, body={
        "thread_id": thread_id,
        "body": "They left the big limbs last time and the ringtails came back after a few weeks."})
    record("replied", status == 200 and post.get("published") is True, f"HTTP {status}")

    # A refused reply has to come back carrying reason_codes: the interface picks its
    # sentence from them. The front end had that table wrong, so somebody who should have
    # read "add a line about what you saw and it will go straight through" read the generic
    # fallback instead. This is a red-line check as well — letting that text through means
    # harm_advocacy did not hold.
    status, blocked = client.send("/api/forum/posts", token=token, body={
        "thread_id": thread_id,
        "body": "Easiest fix is rat baits in the roof cavity, they stop coming back."})
    codes = blocked.get("reason_codes") or []
    record("refused reply carries reason",
           status == 200 and blocked.get("published") is False and bool(codes),
           (", ".join(codes) if codes else "let through — that text is harm_advocacy")
           if status == 200 else f"HTTP {status}")

    status, answer = client.send("/api/assistant", token=token, body={
        "role": "neighbour", "storyboard_id": storyboard,
        "message": "Is the ringtail the one with the curly tail?"})
    reply = answer.get("reply") or ""
    record("assistant (non-streaming)", status == 200 and bool(reply), reply[:52] or str(answer)[:52])

    # Ask something long enough that generating it takes a few seconds — otherwise a small
    # spread could mean buffering, or could just mean a short answer.
    status, frames = client.send("/api/assistant", token=token, stream=True, body={
        "role": "neighbour", "storyboard_id": storyboard, "stream": True,
        "message": "What do ringtails eat, and what should I do if one gets into the roof?"})
    deltas = [f for f in frames if "delta" in f]
    record("assistant (streaming)", status == 200 and len(deltas) > 1 and frames[-1].get("done"),
           f"{len(frames)} frames / {len(deltas)} deltas")

    # If the platform collects the whole response and emits it at once, every frame arrives
    # in the same instant. The frame count cannot show that; the arrival times can. This is
    # the third acceptance criterion on issue #6, which I had assumed could only be judged
    # by eye in a browser.
    times = client.frame_times
    spread = times[-1] - times[0] if len(times) > 1 else 0.0
    record("stream not buffered", spread >= 1.0,
           f"first {times[0]:.2f}s, last {times[-1]:.2f}s, spread {spread:.2f}s" if times else "no frames")

    status, draft = client.send("/api/assistant", token=token, body={
        "role": "writer", "species_selected": "ringtail",
        "story_draft": "saw one on the fence last night it just sat there"})
    facts = draft.get("fun_facts") or []
    # skipped does not count as a pass. roles.writer returns skipped silently when both
    # calls fail (§3.4 — the Writer is never a required step), the response is 200, and it
    # looks like any other success. Treating that as a pass is covering for the upstream.
    record("assistant (Writer)", status == 200 and not draft.get("skipped") and bool(facts),
           f"{len(facts)} fun facts" +
           (", skipped — neither attempt worked, most likely the upstream is down" if draft.get("skipped") else ""))

    # The rate limit goes last: it uses up the submission quota, and running it before the
    # entry is posted would break everything above. A screener request with no field is
    # judged 400 only after the quota has been charged, so this loop makes no model call.
    hit, spent = None, 0
    for _ in range(30):
        spent += 1
        status, payload = client.send("/api/assistant", token=token, body={"role": "screener"})
        if status == 429:
            hit = payload.get("error", {})
            break
        if status != 400:
            break
    record("rate limit (submission)", hit is not None and hit.get("scope") == "submission",
           f"attempt {spent} → HTTP {status}" + (f" {hit.get('message', '')[:40]}" if hit else ""))

    print(f"\n{len(checks) - failures}/{len(checks)} passed")
    if deltas and spread < 1.0:
        print("Note: the frame spread is under a second. That could be the platform "
              "buffering, or just a short answer this time. The difference is clearest in a "
              "browser — letters appearing one by one, or the whole paragraph at once.")
    print("Note: whether the rate limit is accurate depends on which database the deployment "
          "uses. Against the hosted one (TURSO_DATABASE_URL, or FENCEPOST_DB pointing at "
          "libsql://) the count is global; falling back to SQLite in /tmp gives one count "
          "per instance, cleared on a cold start, so this loop only counts properly when it "
          "lands on a single instance.")
    print("A pass here only says the chain works. To show the data no longer evaporates, run "
          "it again a few minutes later and see whether what the last run created is still "
          "there — the second run is the acceptance test.")
    if failures == 0:
        print("The chain works. FENCEPOST_OPEN_SIGNUP stays — settled 2026-09-13: the demo "
              "has to show the real backend, hybrid needs /api/session to get a token, and "
              "removing it empties the whole site.")
        print("The cost is stated plainly: anyone can exchange any handle for a token, so "
              "the live database holds demo data only. Finish with "
              "scripts/teardown_demo.py, which reminds you the flag is still on.")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
