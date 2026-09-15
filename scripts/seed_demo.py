#!/usr/bin/env python3
"""Put the demo dataset into a database, so that teardown has an inverse.

    python scripts/seed_demo.py                 # plan only, writes nothing
    python scripts/seed_demo.py --yes           # build it

teardown_demo.py could empty the database and nothing could fill it again, so the content
the live site showed was whatever two weeks of development had left behind: an entry whose
story was the word "nothing", a thread called "First thread on the hosted database". None of
that was designed. The designed dataset existed the whole time in web/lib/fixtures.js, shown
only by the offline mode, which meant the offline demo and the live one told two different
stories.

The content is not written here. It is read out of fixtures.js by running node against that
module's own exported functions, so there is one source and it cannot drift — the same
mistake as keeping a second copy of the Screener's refusal sentence, which this project
already made once. Node is needed to run this; it is already needed to build the front end.

Against the hosted database it needs **Python 3.12**, like teardown_demo.py: libsql ships
wheels only up to cp312.

    py -3.12 scripts/seed_demo.py --yes

What it builds: the cast of neighbours with passwords, both storyboards (one active, one
archived, which is what gives the dashboard's Past section anything to show), their entries
with the fixture's own timestamps so the ordering reads as a month of a street using it,
the discussion threads, the grants, and a join code for the front end.

Seeded entries carry no screening_results row. That only means they never appear in a
review queue; to demonstrate that path, flag one afterwards or post through the interface.

**Nothing here is a real person's real sighting.** The handles are invented, the writing is
invented, and a report that shows this data should say so — /credits already says it of the
photographs. The one factual error in it is deliberate: the fun fact about ringtails living
forty years is wrong (it is five or six), and it exists to demonstrate the Screener's
fact_conflict path.
"""

import argparse
import json
import os
import secrets
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from proxy import auth
from proxy.db import Database, new_id, now
from proxy.env import load_env
from proxy.store import REMOTE_PREFIXES

WEB = ROOT / "web"

# Reads the dataset through the module's public functions rather than parsing the file, so
# a change to how fixtures.js is laid out cannot quietly produce half a demo.
EXPORT = """
globalThis.window = { localStorage: { getItem: () => null, setItem: () => {},
                                      removeItem: () => {} } };
const f = await import('./lib/fixtures.js');
const home = f.dashboard();
const out = { boards: [], forum: {} };
for (const b of [...home.active, ...home.past]) {
  out.boards.push({ id: b.id, title: b.title, status: b.status,
                    closed_note: b.closed_note ?? null,
                    entries: f.timeline(b.id).entries });
  out.forum[b.id] = (f.forumThreads(b.id).threads || []).map(t => ({
    title: t.title, handle: t.handle, posts: f.readThread(t.id).posts }));
}
console.log(JSON.stringify(out));
"""


def load_fixture_data() -> dict:
    """The demo dataset, straight out of the front end's fixtures module."""
    if not (WEB / "lib" / "fixtures.js").exists():
        sys.exit(f"Cannot find {WEB / 'lib' / 'fixtures.js'}.")
    # Through a temporary file rather than `node -e`. On Windows a multi-line script passed
    # as an argument is taken apart by the shell before node ever sees it, and what comes
    # back is empty output and a JSONDecodeError that says nothing about why.
    script = WEB / f"_fixture_export_{os.getpid()}.mjs"
    script.write_text(EXPORT, encoding="utf-8", newline="\n")
    try:
        done = subprocess.run(["node", str(script)], cwd=WEB, capture_output=True, text=True)
    except FileNotFoundError:
        sys.exit("node is not on PATH, and the demo data lives in a JavaScript module.")
    finally:
        script.unlink(missing_ok=True)
    if done.returncode != 0 or not done.stdout.strip():
        sys.exit(f"node could not read the fixtures:\n{(done.stderr or done.stdout)[:600]}")
    return json.loads(done.stdout)


def cast_of(data: dict) -> list[str]:
    """Everybody who writes anything in the dataset, in a stable order."""
    people = set()
    for board in data["boards"]:
        people.update(entry["handle"] for entry in board["entries"])
        for thread in data["forum"].get(board["id"], []):
            people.add(thread["handle"])
            people.update(post["handle"] for post in thread["posts"])
    return sorted(people)


def seed(db: Database, data: dict, owner_handle: str = "mel_k") -> dict:
    """Build the dataset in `db`. Returns what was made, including the join code.

    Written to take a Database so it can be run against an in-memory one in a test, rather
    than being provable only by pointing it at something real.
    """
    made = {"people": {}, "boards": {}, "entries": 0, "threads": 0, "posts": 0}

    for handle in cast_of(data):
        password = "-".join(secrets.token_urlsafe(6) for _ in range(3))
        db.add_user(handle, auth.hash_password(password))
        made["people"][handle] = password

    def who(handle):
        return db.conn.execute("SELECT id FROM users WHERE handle = ?",
                               (handle,)).fetchone()["id"]

    owner = who(owner_handle)
    for board in data["boards"]:
        stamps = [e["created_at"] for e in board["entries"]] or [now()]
        board_id = new_id()
        db.conn.execute(
            "INSERT INTO storyboards (id, owner_id, title, status, last_entry_at, "
            "closed_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (board_id, owner, board["title"], board["status"], max(stamps),
             board.get("closed_note"), min(stamps)))
        made["boards"][board["id"]] = board_id

        for entry in board["entries"]:
            db.conn.execute(
                "INSERT INTO entries (id, storyboard_id, author_id, species, fun_fact, "
                "story, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (new_id(), board_id, who(entry["handle"]), entry["species"],
                 entry.get("fun_fact"), entry.get("story"), entry["created_at"]))
            made["entries"] += 1

        # Everybody in the dataset can reach both storyboards, or the discussion reads as a
        # conversation between people who are not there. The owner reshares; the rest
        # contribute on an active storyboard and view on one that is already closed, which
        # is the level an archived storyboard would leave them on anyway.
        for handle in cast_of(data):
            level = "reshare" if handle == owner_handle else (
                "view" if board["status"] != "active" else "contribute")
            db.conn.execute(
                "INSERT INTO access_grants (id, storyboard_id, user_id, level, granted_by, "
                "granted_at) VALUES (?, ?, ?, ?, ?, ?)",
                (new_id(), board_id, who(handle), level, owner, now()))

        for thread in data["forum"].get(board["id"], []):
            thread_id = new_id()
            db.conn.execute(
                "INSERT INTO forum_threads (id, storyboard_id, author_id, title, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (thread_id, board_id, who(thread["handle"]), thread["title"],
                 thread["posts"][0]["created_at"]))
            made["threads"] += 1
            for post in thread["posts"]:
                db.conn.execute(
                    "INSERT INTO forum_posts (id, thread_id, author_id, body, created_at) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (new_id(), thread_id, who(post["handle"]), post["body"],
                     post["created_at"]))
                made["posts"] += 1

    # The front end redeems one code on a visitor's first load, and teardown takes the
    # share_links table with everything else, so a seeded database without one opens to an
    # empty dashboard for everybody. reshare, because the Share button asks for it and the
    # permissioned QR code is the thing this product is about.
    active = next((b for b in data["boards"] if b["status"] == "active"), data["boards"][0])
    token = auth.new_share_token()
    expires = (datetime.now(timezone.utc) + timedelta(days=90)).isoformat(timespec="seconds")
    db.conn.execute(
        "INSERT INTO share_links (id, storyboard_id, token_hash, created_by, level, "
        "expires_at, max_uses, used_count) VALUES (?, ?, ?, ?, 'reshare', ?, NULL, 0)",
        (new_id(), made["boards"][active["id"]], auth.hash_share_token(token), owner, expires))
    made["join_token"] = token
    made["join_board"] = made["boards"][active["id"]]

    db.conn.commit()
    return made


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="actually write. Without it, a plan.")
    parser.add_argument("--db", default=None, help="overrides FENCEPOST_DB / TURSO_DATABASE_URL")
    parser.add_argument("--owner", default="mel_k", help="which handle owns the storyboards")
    parser.add_argument("--secrets-out", default="demo-secrets.txt",
                        help="where the passwords and the join code are written")
    parser.add_argument("--force", action="store_true",
                        help="seed even though the database already holds storyboards")
    args = parser.parse_args()

    load_env()
    address = args.db or os.getenv("FENCEPOST_DB") or os.getenv("TURSO_DATABASE_URL") or ":memory:"
    hosted = any(address.startswith(prefix) for prefix in REMOTE_PREFIXES)
    data = load_fixture_data()

    print(f"{address} {'(hosted)' if hosted else '(local)'}")
    print("would build:" if not args.yes else "building:")
    for board in data["boards"]:
        print(f"  {board['status']:<9} {board['title']!r}, {len(board['entries'])} entries, "
              f"{len(data['forum'].get(board['id'], []))} threads")
    print(f"  people: {', '.join(cast_of(data))}")
    print("  plus a 90-day reshare join code for the active storyboard")

    db = Database(address)
    standing = db.conn.execute("SELECT COUNT(*) AS c FROM storyboards").fetchone()["c"]
    if standing and not args.force:
        db.close()
        sys.exit(f"\nThis database already holds {standing} storyboards. Seeding would add a "
                 "second copy beside them. Run scripts/teardown_demo.py --yes first, or pass "
                 "--force if a duplicate is really what you want.")
    if not args.yes:
        print("\nAdd --yes to write.")
        db.close()
        return

    made = seed(db, data, owner_handle=args.owner)
    lines = [f"{handle}\t{password}" for handle, password in sorted(made["people"].items())]
    lines.append(f"JOIN_CODE\t{made['join_token']}")
    Path(args.secrets_out).write_text("handle\tsecret\n" + "\n".join(lines) + "\n",
                                      encoding="utf-8", newline="")

    print(f"\n  {len(made['people'])} people, {len(made['boards'])} storyboards, "
          f"{made['entries']} entries, {made['threads']} threads, {made['posts']} posts")
    bad = db.foreign_key_violations()
    print(f"  referential integrity: {'clean' if not bad else str(len(bad)) + ' VIOLATIONS'}")
    print(f"\nPasswords and the join code are in {args.secrets_out}, and are not printed "
          "here. Keep them somewhere, then delete that file.")
    print("\nThe front end needs the join code before anybody can see anything:")
    print("  vercel env add NEXT_PUBLIC_FENCEPOST_JOIN_TOKEN production --force --cwd web "
          f"--value <the JOIN_CODE line in {args.secrets_out}>")
    print("  vercel --cwd web --prod")
    print("\nNEXT_PUBLIC_ values are compiled into the bundle, so the redeploy is not "
          "optional. Everyone already carrying the old code picks this one up by itself.")
    print("\nNone of this is a real person's sighting. A report that shows it should say so.")
    db.close()


if __name__ == "__main__":
    main()
