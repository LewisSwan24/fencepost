#!/usr/bin/env python3
"""Issue the join code the deployed front end uses, and say what to do with it.

    python scripts/issue_join_code.py https://fencepost-api.vercel.app --list
    python scripts/issue_join_code.py https://fencepost-api.vercel.app --storyboard <id>

Why this exists at all. Every visitor to the deployment gets an identity of their own, and
a new identity can reach no storyboard whatever, so the front end redeems one code on first
load: NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN. That code was issued once, by hand, and how it was
done was written down nowhere. It expires on 2026-12-13, the server allows at most 90 days,
and the site opens to an empty dashboard the moment it lapses.

The level matters more than it looks. The first code granted contribute, which is one level
below reshare, and reshare is what the Share button asks for. So the share screen, the
permissioned QR code this product is actually about, was reachable by nobody on the
deployment, on the only storyboard a visitor could see. Nothing failed and nothing was
logged; a button was simply not drawn. Hence the default here is reshare.

What reshare does and does not hand over: a resharer can issue codes, list them, turn off
codes they made themselves, and see who has access. Closing the storyboard, revoking
somebody's access and disposing of a flagged entry are the owner's, checked against
storyboards.owner_id rather than against a level, so none of them comes with this.

**The token is never printed.** It is written to a file, and the command that loads it into
Vercel reads that file, so the plaintext does not pass through a terminal transcript, a
scrollback buffer or a chat log. It is a redeemable grant until somebody turns it off.

This signs in as the owner's handle with no password, which works only because
FENCEPOST_OPEN_SIGNUP is on. That is the documented cost of hybrid delivery rather than a
trick this script invented: anybody can exchange any handle for a token, which is exactly
why the live database holds demo data only.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def send(base, path, token=None, body=None):
    url = base.rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    headers = {"accept": "application/json"}
    if data:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=data, headers=headers,
                                     method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as err:
        raw = err.read()
        try:
            return err.code, json.loads(raw or b"null")
        except json.JSONDecodeError:
            return err.code, {"raw": raw[:200].decode("utf-8", "replace")}


def fail(message):
    print(message)
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="the API deployment, e.g. https://fencepost-api.vercel.app")
    parser.add_argument("--owner", default="mel_k", help="the handle that owns the demo storyboard")
    parser.add_argument("--storyboard", help="which storyboard the code lets people into")
    parser.add_argument("--level", default="reshare", choices=["view", "contribute", "reshare"],
                        help="reshare, or the Share button is drawn for nobody")
    parser.add_argument("--days", type=int, default=90, help="1 to 90; the server enforces it")
    parser.add_argument("--out", default="joincode.txt",
                        help="where the token is written; it is never printed")
    parser.add_argument("--secrets", default=None,
                        help="a file of handle<tab>password lines, when the owner has one")
    parser.add_argument("--list", action="store_true",
                        help="show that handle's storyboards and stop, writing nothing")
    args = parser.parse_args()

    # Two ways in, because the owner may or may not have a password. A demo identity that
    # never registered is handed a token by /api/session under open sign-up; one that has a
    # password is refused there on purpose, since otherwise the password would be
    # decorative, and has to come through /api/login instead.
    #
    # The password is read from a file rather than taken on the command line: an argument
    # ends up in shell history and in the process list, where a password issued for the
    # owner of the demo storyboard is exactly as useful to somebody else as it is to you.
    if args.secrets:
        try:
            rows = dict(line.split("\t", 1) for line in
                        Path(args.secrets).read_text(encoding="utf-8").splitlines()
                        if "\t" in line)
        except OSError as exc:
            fail(f"Could not read {args.secrets}: {exc}")
        if args.owner not in rows:
            fail(f"{args.secrets} has no line for {args.owner}. It wants the handle, a tab, "
                 "then the password.")
        status, session = send(args.url, "/api/login",
                               body={"handle": args.owner,
                                     "password": rows[args.owner].strip()})
        if status != 200 or not session.get("token"):
            fail(f"Signing in as {args.owner} failed: HTTP {status} {session}")
    else:
        status, session = send(args.url, "/api/session", body={"handle": args.owner})
        if status == 403 and (session.get("error") or {}).get("code") == "use_password":
            fail(f"{args.owner} has a password, so /api/session will not hand out a token "
                 "for it — which is the point of having one. Pass --secrets <file>, where "
                 "the file holds a line of: the handle, a tab, then the password.")
        if status != 200 or not session.get("token"):
            fail(f"Could not get a token for {args.owner}: HTTP {status} {session}. "
                 "If that is a 403 signup_closed, FENCEPOST_OPEN_SIGNUP is off in the "
                 "deployment and a code has to be issued from the interface instead.")
    token = session["token"]

    status, home = send(args.url, "/api/dashboard", token=token)
    if status != 200:
        fail(f"Signed in but could not read the dashboard: HTTP {status} {home}")
    boards = (home.get("active") or []) + (home.get("past") or [])

    if args.list or not args.storyboard:
        print(f"Storyboards {args.owner} can reach:")
        print("")
        for board in boards:
            print(f"  {board['id']}  {board.get('status', '?'):9}"
                  f"{(board.get('level') or '?'):11}{board.get('title') or '(no title)'}")
        if not boards:
            print("  (none, so either the wrong handle or a deployment with no data)")
        if args.list:
            return
        fail("\nNothing issued. Pass --storyboard <id> with one of the ids above.")

    chosen = next((b for b in boards if b["id"] == args.storyboard), None)
    if chosen is None:
        fail(f"{args.owner} cannot reach {args.storyboard}. Run with --list to see what they can.")
    if chosen.get("level") != "reshare":
        fail(f"{args.owner} holds {chosen.get('level')} on that storyboard, and issuing a code "
             "needs reshare. The server would answer cannot_share.")
    if chosen.get("status") != "active":
        print(f"Note: that storyboard is {chosen.get('status')}. A code still redeems and the "
              "storyboard still reads, but nobody can post to it.")

    status, link = send(args.url, "/api/share-links", token=token, body={
        "storyboard_id": args.storyboard, "level": args.level, "expires_in_days": args.days})
    if status != 200 or not link.get("token"):
        fail(f"Issuing failed: HTTP {status} {link}")

    with open(args.out, "w", encoding="utf-8", newline="") as handle:
        handle.write(link["token"])

    # Redeem it once, as somebody else, before saying it works. Issuing reports what was
    # asked for; this reports what a visitor would actually receive, which is the thing that
    # was wrong last time and that nothing anywhere noticed. It costs one use of the code
    # (there is no max_uses on it) and leaves one throwaway user and grant behind, which
    # scripts/teardown_demo.py clears with the rest.
    probe_handle = "joincheck-" + link["share_link_id"][:8]
    status, probe = send(args.url, "/api/session", body={"handle": probe_handle})
    if status != 200:
        fail(f"Issued and saved to {args.out}, but could not check it: HTTP {status} {probe}")
    status, got = send(args.url, "/api/share-links/redeem", token=probe["token"],
                       body={"token": link["token"]})
    if status != 200:
        fail(f"Issued and saved to {args.out}, but redeeming it answered HTTP {status} {got}. "
             "Do not put this code into Vercel; it would open the site to an empty dashboard.")
    if got.get("level") != args.level:
        fail(f"Issued {args.level} but redeeming granted {got.get('level')}. Stopping here: "
             "this is exactly how the share screen went missing.")
    if got.get("storyboard_id") != args.storyboard:
        fail(f"Redeeming let the holder into {got.get('storyboard_id')}, not {args.storyboard}.")

    print(f"Issued {args.level} on {chosen.get('title') or args.storyboard}, "
          f"expiring {link.get('expires_at')}.")
    print(f"Checked by redeeming it as {probe_handle}: granted {got.get('level')}"
          + (", so the Share button will be drawn." if got.get("level") == "reshare"
             else ", which is below reshare, so the Share button stays hidden."))
    print(f"The token is in {args.out} and is not printed here. Two commands follow; "
          "delete that file afterwards.")
    print("")
    # --cwd web on the env command, and not on the deploy. Both halves have been got wrong
    # once each, on 2026-09-15. Without --cwd web, `vercel env add` uses whatever project
    # the repository root is linked to, which is the API, and the variable lands somewhere
    # nothing reads it while the front end carries on with the old code. With --cwd web on
    # the deploy, the CLI uploads web/ as the root and the project's own Root Directory
    # setting then looks for web/web, which does not exist. The front end is deployed from
    # git, so a push is what rebuilds it.
    print("PowerShell:")
    print("  vercel env add NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN production --force --cwd web "
          f"--value ((Get-Content {args.out} -Raw).Trim())")
    print("")
    print("bash:")
    print("  vercel env add NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN production --force --cwd web "
          f'--value "$(cat {args.out})"')
    print("")
    print("Then rebuild the front end by pushing to git, which is what deploys it. "
          "`vercel --cwd web --prod` does not work: the project's Root Directory is already "
          "web, so uploading web/ as the root makes it look for web/web.")
    print("")
    print("The rebuild is not optional: NEXT_PUBLIC_ variables are compiled into the "
          "bundle, so the old code stays live until the front end is built again.")
    print("Visitors already carrying the previous code pick this one up by themselves on "
          "their next visit. lib/api.js remembers which code it redeemed, not merely that "
          "it redeemed one.")


if __name__ == "__main__":
    main()
