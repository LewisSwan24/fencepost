#!/usr/bin/env python3
"""Set up the booth screen: a QR link into the booth storyboard and the screen's own access.

    python scripts/issue_booth_screen.py https://fencepost-api.vercel.app --owner <handle> --list
    python scripts/issue_booth_screen.py https://fencepost-api.vercel.app --owner <handle> \\
        --storyboard <id>

The screen shows one storyboard to everybody walking past, so it is set up as two links on
that storyboard rather than anything new on the server:

    contribute  for the QR on the screen. A visitor who scans it joins the storyboard and can
                post; the screen tells them what they post appears there.
    view        for the screen itself. A fresh identity redeems it, so the screen is a member
                at the lowest level and reads through the same GET /api/timeline as anybody.

Both expire after --days (default 3: the show and a margin). The screen's token never reaches
a browser: it goes into web/.env.production.local, which next start reads on the server side
and which git ignores. **No token is printed.** The file is the only place they are written.

Every link is redeemed once before this says it works, by the screen for the view link and by
a throwaway identity for the contribute link, and the screen reads the timeline once. Those
two identities and their grants are demo rows that scripts/teardown_demo.py clears with the
rest. Signing in as the owner works without a password only under FENCEPOST_OPEN_SIGNUP, as
in issue_join_code.py; pass --secrets for an owner who has one.
"""

import argparse
import json
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = "https://fencepost-app.vercel.app"


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


def sign_in(api, handle, secrets_file):
    if secrets_file:
        try:
            rows = dict(line.split("\t", 1) for line in
                        Path(secrets_file).read_text(encoding="utf-8").splitlines()
                        if "\t" in line)
        except OSError as exc:
            fail(f"Could not read {secrets_file}: {exc}")
        if handle not in rows:
            fail(f"{secrets_file} has no line for {handle}. It wants the handle, a tab, "
                 "then the password.")
        status, session = send(api, "/api/login",
                               body={"handle": handle, "password": rows[handle].strip()})
    else:
        status, session = send(api, "/api/session", body={"handle": handle})
        if status == 403 and (session.get("error") or {}).get("code") == "use_password":
            fail(f"{handle} has a password. Pass --secrets <file>, a line of the handle, a "
                 "tab, then the password.")
    if status != 200 or not (session or {}).get("token"):
        fail(f"Could not sign in as {handle}: HTTP {status} {session}")
    return session["token"]


def issue(api, token, storyboard, level, days):
    status, link = send(api, "/api/share-links", token=token, body={
        "storyboard_id": storyboard, "level": level, "expires_in_days": days})
    if status != 200 or not link.get("token"):
        fail(f"Issuing the {level} link failed: HTTP {status} {link}")
    return link


def redeem_as_new(api, handle, link, storyboard, level):
    """A fresh identity redeems the link; stops unless it got exactly what was issued."""
    status, session = send(api, "/api/session", body={"handle": handle})
    if status != 200 or not (session or {}).get("token"):
        fail(f"Could not create {handle} to check the {level} link: HTTP {status} {session}")
    status, got = send(api, "/api/share-links/redeem", token=session["token"],
                       body={"token": link["token"]})
    if status != 200:
        fail(f"Redeeming the {level} link answered HTTP {status} {got}. Nothing written.")
    if got.get("level") != level or got.get("storyboard_id") != storyboard:
        fail(f"The {level} link granted {got.get('level')} on {got.get('storyboard_id')}. "
             "Nothing written.")
    return session["token"]


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("url", help="the API deployment, e.g. https://fencepost-api.vercel.app")
    parser.add_argument("--owner", required=True, help="a handle holding reshare on the booth storyboard")
    parser.add_argument("--storyboard", help="the booth storyboard's id")
    parser.add_argument("--web", default=WEB, help="the front end the QR opens")
    parser.add_argument("--days", type=int, default=3, help="1 to 90; both links expire then")
    parser.add_argument("--out", default=str(ROOT / "web" / ".env.production.local"),
                        help="where the settings go; never printed, refused if it exists")
    parser.add_argument("--secrets", default=None,
                        help="a file of handle<tab>password lines, when the owner has one")
    parser.add_argument("--list", action="store_true",
                        help="show the owner's storyboards and stop, writing nothing")
    args = parser.parse_args(argv)
    api, web = args.url.rstrip("/"), args.web.rstrip("/")
    out = Path(args.out)

    if not args.list and out.exists():
        fail(f"{out} already exists. Move it aside or pass --out; this never overwrites a "
             "file that may hold the only copy of a live token.")

    owner = sign_in(api, args.owner, args.secrets)
    status, home = send(api, "/api/dashboard", token=owner)
    if status != 200:
        fail(f"Signed in but could not read the dashboard: HTTP {status} {home}")
    boards = (home.get("active") or []) + (home.get("past") or [])

    if args.list or not args.storyboard:
        print(f"Storyboards {args.owner} can reach:")
        for board in boards:
            print(f"  {board['id']}  {board.get('status', '?'):9}"
                  f"{(board.get('level') or '?'):11}{board.get('title') or '(no title)'}")
        if not boards:
            print("  (none)")
        if args.list:
            return
        fail("\nNothing issued. Pass --storyboard <id> with one of the ids above.")

    chosen = next((b for b in boards if b["id"] == args.storyboard), None)
    if chosen is None:
        fail(f"{args.owner} cannot reach {args.storyboard}. Run with --list.")
    if chosen.get("level") != "reshare":
        fail(f"{args.owner} holds {chosen.get('level')} on that storyboard; issuing needs reshare.")
    if chosen.get("status") != "active":
        fail(f"That storyboard is {chosen.get('status')}, so nobody could post to it from the QR.")

    join = issue(api, owner, args.storyboard, "contribute", args.days)
    view = issue(api, owner, args.storyboard, "view", args.days)

    screen_handle = "booth-screen-" + secrets.token_hex(4)
    screen = redeem_as_new(api, screen_handle, view, args.storyboard, "view")
    redeem_as_new(api, "boothcheck-" + join["share_link_id"][:8], join, args.storyboard,
                  "contribute")

    query = urllib.parse.urlencode({"storyboard_id": args.storyboard})
    status, timeline = send(api, "/api/timeline?" + query, token=screen)
    if status != 200:
        fail(f"The screen could not read the timeline: HTTP {status} {timeline}. Nothing written.")

    out.write_text(
        f"# Booth screen settings, written by scripts/issue_booth_screen.py on {date.today()}.\n"
        "# Holds a live token. Keep it on the booth laptop, never commit it, delete it after\n"
        f"# the show. Both links expire {view.get('expires_at')}.\n"
        f"NEXT_PUBLIC_WN_BOOTH_JOIN_URL={web}/s/{join['token']}\n"
        f"FENCEPOST_API={api}\n"
        f"FENCEPOST_BOOTH_STORYBOARD={args.storyboard}\n"
        f"FENCEPOST_BOOTH_TOKEN={screen}\n",
        encoding="utf-8")

    print(f"Booth storyboard: {chosen.get('title') or args.storyboard}")
    print(f"Checked: {screen_handle} redeemed the view link and read "
          f"{len(timeline.get('entries') or [])} entries; a throwaway identity redeemed the "
          "contribute link.")
    print(f"Links expire {view.get('expires_at')}.")
    print(f"Settings are in {out}; no token is printed here. Then, in web/:")
    print("  npm run build")
    print("  npm start")
    print("and open http://localhost:3000/wildlife/index.html full screen.")
    print("The build copies the QR link into web/public/wildlife/shared/config.js. Do not "
          "commit that file; after the show run")
    print("  git checkout -- web/public/wildlife/shared/config.js")
    print(f"and delete {out}.")


if __name__ == "__main__":
    main()
