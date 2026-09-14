#!/usr/bin/env python3
"""Empty the database once the course demo is over.

The last line of operations.md §1: "End of the course demo — clear everything, including
the backend logs. This goes in the report." So this is not a convenience script; it is
something the report has to be able to point at.

    python scripts/teardown_demo.py            # count only, delete nothing
    python scripts/teardown_demo.py --yes      # actually delete

The address is chosen the way api/index.py chooses it: --db → FENCEPOST_DB →
TURSO_DATABASE_URL. That was added later: once the database moved to hosted Turso this
script still recognised local files only, and `Path(...).exists()` is always false for
`libsql://`, so it could not clear the database that actually held the data — while
"everything cleared at the end of the demo" is a promise written into the report, and this
script is what that promise rests on.

Against the hosted database it needs **Python 3.12**: `libsql` ships wheels only up to
cp312, and the machine default of 3.14 cannot install it.

    py -3.12 scripts/teardown_demo.py          # count only
    py -3.12 scripts/teardown_demo.py --yes    # actually delete

The backend logs are not here: those are Vercel's runtime logs, which this script cannot
delete and should not pretend to. The printed reminder says what to do about them.
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from proxy.db import Database
from proxy.env import load_env
from proxy.store import REMOTE_PREFIXES

TABLES = ("screening_results", "review_votes", "rate_limits", "chat_messages", "forum_posts",
          "forum_threads", "share_links", "access_grants", "entries", "videos", "storyboards",
          "users")


def counts(db: Database) -> dict:
    return {name: db.conn.execute(f"SELECT COUNT(*) AS c FROM {name}").fetchone()["c"]
            for name in TABLES}


def screening_flags(db: Database) -> dict:
    """Two write-only markers, counted once before the database is cleared.

    `fail_open`: the model timed out twice, the Screener let the item through as a fallback,
    and it published as normal. That is the agreed behaviour (CLAUDE.md decision table: a
    broken model should not stop somebody posting), but **nothing has ever read it back** —
    an upstream failure left a trace in the database that nowhere could see. The ethics
    section has to answer how much screening was actually skipped, and this is the only
    place that answer lives.

    `downgraded_non_english`: how many times non-English content was pushed down from reject
    to review by the floor (operations §4.3). Write-only in the same way. It is the evidence
    for whether minority languages are being refused systematically.

    **Counted, never quoted.** `original_text` holds the refused wording, including whatever
    personal information triggered the refusal; counting it is safe, printing it is not. A
    test pins that down.

    SUM over an empty table returns NULL rather than 0, and so do MIN and MAX — hence
    COALESCE on all of them. Otherwise a freshly cleared database prints `fail_open = None`,
    which reads like a broken report rather than like screening never once falling back.
    """
    row = db.conn.execute(
        "SELECT COUNT(*) AS total, "
        "COALESCE(SUM(fail_open), 0) AS fail_open, "
        "COALESCE(SUM(downgraded_non_english), 0) AS downgraded, "
        "MIN(CASE WHEN fail_open = 1 THEN created_at END) AS first_fail_open, "
        "MAX(CASE WHEN fail_open = 1 THEN created_at END) AS last_fail_open "
        "FROM screening_results").fetchone()
    return dict(row)


def report_flags(db: Database) -> None:
    flags = screening_flags(db)
    print(f"\n{flags['total']} screening records, of which:")
    print(f"  fail_open = 1               {flags['fail_open']}   "
          "let through as a fallback on a model timeout; the item published as normal")
    if flags["fail_open"]:
        print(f"    earliest {flags['first_fail_open']}")
        print(f"    latest   {flags['last_fail_open']}")
    print(f"  downgraded_non_english = 1  {flags['downgraded']}   "
          "non-English submission pushed down from reject to review by the floor")
    print("  (counted, never quoted: original_text holds the refused wording, including "
          "the personal information that triggered the refusal.)")


def clear(db: Database) -> dict:
    """Delete from the leaves up, following the foreign keys. Returns how many rows
    went from each table.
    """
    before = counts(db)
    for name in TABLES:
        db.conn.execute(f"DELETE FROM {name}")
    db.conn.commit()
    return before


def main() -> None:
    # The hosted address lives in .env.local. Without reading it first the lookup below
    # returns None, so the script quietly clears the empty local database and reports
    # success — the same trap as in api/index.py, with the same fix.
    load_env()

    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", action="store_true", help="actually delete. Without it, only counts.")
    parser.add_argument("--db", default=None,
                        help="database address. Without it, FENCEPOST_DB then TURSO_DATABASE_URL.")
    args = parser.parse_args()

    address = (args.db or os.getenv("FENCEPOST_DB") or os.getenv("TURSO_DATABASE_URL")
               or "fencepost.db")
    # Only a local file can meaningfully be said to exist. A hosted database is a URL, and
    # asking Path.exists() about one always answers that there is no such database — so the
    # script never touched the database that actually held the data.
    if not address.startswith(REMOTE_PREFIXES) and not Path(address).exists():
        sys.exit(f"No such database: {address}")
    db = Database(address)
    remote = address.startswith(REMOTE_PREFIXES)
    shown = address.split("?", 1)[0] if remote else address

    if not args.yes:
        print(f"{shown} currently holds:" if not remote else f"{shown} (hosted) currently holds:")
        for name, number in counts(db).items():
            print(f"  {name:22} {number}")

        # Check referential integrity once before handing over. Foreign keys are on in both
        # backends, so this should always be empty; anything here means something else has
        # gone wrong.
        #
        # (This comment used to say foreign keys cannot be enforced on hosted libSQL. That
        # was wrong: the thing that swallowed PRAGMA foreign_keys was the deprecated
        # libsql-client, not libSQL. On the official SDK they are on by default and really
        # do bite, measured 2026-09-13 — see the module comment in proxy/store.py.)
        bad = db.foreign_key_violations()
        if bad:
            print(f"\n{len(bad)} rows pointing at a parent that does not exist:")
            for row in bad[:10]:
                print(f"  {row['table']} row {row['rowid']} → no matching {row['parent']}")
            if len(bad) > 10:
                print(f"  … and {len(bad) - 10} more")
        else:
            print("\nReferential integrity: no row points at a missing parent.")

        report_flags(db)

        print("\nAdd --yes to actually delete.")
        # The hosted client runs an event-loop thread of its own; the process will not exit
        # without closing it.
        db.close()
        return

    # This line has to come before clear. Once the database is empty those two numbers are
    # gone for good, and the report quotes them — somebody running --yes straight off will
    # never have run the counting mode first.
    report_flags(db)

    removed = clear(db)
    print(f"Cleared {shown}:")
    for name, number in removed.items():
        print(f"  {name:22} -{number}")
    print("\nThe database is clean. Three things sit outside this script:")
    print("  1. Vercel runtime logs. Delete them per project in the console, or delete the")
    print("     project itself.")
    print("  2. The uploaded videos. videos holds only a storage_key; the files live in")
    print("     object storage and have to be cleared separately.")
    print("  3. FENCEPOST_OPEN_SIGNUP. It is still on, so anyone visiting the site can")
    print("     create a fresh batch of data. To really finish, remove it in Vercel — at")
    print("     that moment the hybrid front end goes blank too, because those two things")
    print("     are one and the same.")
    db.close()


if __name__ == "__main__":
    main()
