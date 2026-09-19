"""The promise that the demo database gets emptied.

operations.md section 1 ends with a line that goes into the report: at the end of the course
demo, clear everything. scripts/teardown_demo.py is what that promise rests on, and until now
nothing checked it. The dry run has been exercised often; `--yes` never has, because running it
for real destroys the demo.

Two ways it can fail quietly, and both are covered here.

The table list is written by hand. It matches the schema today, but nothing keeps it matching:
add a table to data-model.md section 1, regenerate, and teardown carries on reporting success
while leaving that table full. The report would still say everything was cleared.

And the delete path has never run against the real driver. Every guarantee in this project
measured only against a stand-in has held, except the one that did not: settle_review answered
500 on Turso for weeks while the suite stayed green. libSQL's `file:` address runs the real
client without a hosted database, which is the closest thing to the real answer available
offline.
"""

import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import teardown_demo                                                         # noqa: E402
import seed_demo                                                             # noqa: E402
from proxy.db import (Database, SqliteCeilings, SqliteHistory,               # noqa: E402
                      SqliteRateLimiter, SqliteScreeningLog, _schema_table_names, schema_sql)


def references():
    """Which tables each table points at, read out of the generated schema.

    Parsed rather than listed, so this check cannot drift the same way the thing it checks can.
    """
    blocks = re.findall(r"CREATE TABLE (\w+)\s*\((.*?)^\);", schema_sql(), re.S | re.M)
    return {name: {t for t in re.findall(r"REFERENCES\s+(\w+)", body) if t != name}
            for name, body in blocks}


class TheTableListMatchesTheSchema(unittest.TestCase):
    """A hand-written list of tables, checked against the generated one."""

    def test_every_table_in_the_schema_gets_cleared(self):
        missing = sorted(set(_schema_table_names()) - set(teardown_demo.TABLES))
        self.assertEqual([], missing,
                         "these tables are in the schema and teardown would leave them full, "
                         "while still reporting that everything was cleared")

    def test_nothing_is_cleared_that_does_not_exist(self):
        extra = sorted(set(teardown_demo.TABLES) - set(_schema_table_names()))
        self.assertEqual([], extra, "teardown names a table the schema does not have")

    def test_the_order_deletes_children_before_parents(self):
        """Foreign keys are enforced on both backends, so the order is load-bearing.

        Deleting a parent first raises, and on the hosted database that surfaces as a 500 in
        the middle of a teardown, with some tables cleared and some not.
        """
        edges = references()
        self.assertEqual(13, len(edges), "the schema did not parse, so this check is not "
                                         "looking at what it thinks it is looking at")
        position = {name: i for i, name in enumerate(teardown_demo.TABLES)}
        for table, parents in edges.items():
            for parent in parents:
                self.assertLess(position[table], position[parent],
                                f"{table} points at {parent} and has to be deleted first")


try:
    import libsql
except ImportError:                                    # pragma: no cover
    libsql = None


@unittest.skipIf(libsql is None, "libsql not installed (needs Python 3.12, the Vercel runtime)")
class ClearingReallyEmptiesItOnTheRealDriver(unittest.TestCase):
    """Fill every table, run the real clear(), and check nothing is left.

    The "every table has a row first" assertion matters as much as the one after it. Without
    it, a fixture that quietly stopped filling a table would let this pass while proving
    nothing at all about that table.
    """

    def setUp(self):
        self.path = Path(tempfile.gettempdir()) / f"fencepost_teardown_{id(self)}.db"
        self._clean()
        self.db = Database("file:" + str(self.path).replace("\\", "/"))
        self._fill()

    def tearDown(self):
        self.db.close()
        self._clean()

    def _clean(self):
        for suffix in ("", "-shm", "-wal"):
            Path(str(self.path) + suffix).unlink(missing_ok=True)

    def _fill(self):
        db = self.db
        owner = db.ensure_user("mel_k")
        guest = db.ensure_user("sam_t")
        board = db.add_storyboard(owner, "The one in the jacaranda")   # also grants the owner
        db.grant(board, guest, "contribute", owner)
        video = db.add_video(owner, "s3://clip.mp4")
        entry = db.add_entry(board, owner, "ringtail", story="on the fence", video_id=video)
        db.add_share_link(board, owner, "not-a-real-hash", "view", None, None)
        thread, _first_post = db.add_thread(board, owner, "Pruning", "the council sent a letter")
        db.add_post(thread, guest, "they left the big limbs last time")
        db.cast_vote(entry, guest, "worth_checking")
        SqliteHistory(db).append(owner, board, "user", "which one is this?")
        SqliteRateLimiter(db).check_and_count(owner, "chat")
        SqliteCeilings(db).claim("model", 1000, 86400)
        SqliteScreeningLog(db).record({
            "subject_type": "entry", "subject_id": entry, "author_id": owner,
            "field": "story", "verdict": "ok", "codes": [], "prompt_version": "v0.11",
        })

    def test_every_table_is_filled_and_then_emptied(self):
        before = teardown_demo.counts(self.db)
        empty = sorted(name for name, n in before.items() if n == 0)
        self.assertEqual([], empty, "the fixture left these tables empty, so clearing them "
                                    "would prove nothing")

        reported = teardown_demo.clear(self.db)
        self.assertEqual(before, reported, "clear() reports the counts it deleted")

        after = teardown_demo.counts(self.db)
        left = {name: n for name, n in after.items() if n}
        self.assertEqual({}, left, "these tables still hold rows after the teardown")

    def test_clearing_an_already_empty_database_is_harmless(self):
        """Somebody will run it twice. It should answer zero, not fail."""
        teardown_demo.clear(self.db)
        again = teardown_demo.clear(self.db)
        self.assertEqual({name: 0 for name in teardown_demo.TABLES}, again)


class SeedingIsTheInverseOfClearing(unittest.TestCase):
    """teardown could empty the database and nothing could fill it again.

    That asymmetry is why the live site showed whatever development had left behind rather
    than a dataset somebody designed: an entry whose story was the word "nothing", a thread
    called "First thread on the hosted database". The designed one sat in
    web/lib/fixtures.js the whole time, shown only by the offline mode, so the offline demo
    and the live one told two different stories.

    These run on the real libSQL driver for the same reason the clearing tests do:
    settle_review answered 500 on Turso for weeks while a suite full of stand-ins stayed
    green.
    """

    def setUp(self):
        self.path = Path(tempfile.gettempdir()) / f"fencepost_seed_{id(self)}.db"
        self._clean()
        self.db = Database("file:" + str(self.path).replace(chr(92), "/"))
        self.data = seed_demo.load_fixture_data()

    def tearDown(self):
        self.db.close()
        self._clean()

    def _clean(self):
        for suffix in ("", "-shm", "-wal"):
            Path(str(self.path) + suffix).unlink(missing_ok=True)

    def count(self, table):
        return self.db.conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()["c"]

    def user(self, handle):
        return self.db.conn.execute("SELECT id FROM users WHERE handle = ?",
                                    (handle,)).fetchone()["id"]

    def test_the_dataset_comes_out_of_the_front_end_fixtures(self):
        """Read through that module's exported functions rather than copied into Python.

        A second copy would drift, which is the mistake this project already made once with
        the Screener's refusal sentence: two definitions, one of them never read.
        """
        titles = [b["title"] for b in self.data["boards"]]
        self.assertIn("The one in the jacaranda", titles)
        self.assertIn("Roof thumper", titles)
        self.assertTrue(any(b["status"] == "archived" for b in self.data["boards"]),
                        "nothing archived, so the dashboard's Past section stays empty")

    def test_it_builds_a_storyboard_somebody_can_actually_read(self):
        made = seed_demo.seed(self.db, self.data)
        self.assertEqual(len(self.data["boards"]), self.count("storyboards"))
        self.assertEqual(sum(len(b["entries"]) for b in self.data["boards"]),
                         self.count("entries"))
        self.assertTrue(self.count("forum_posts") > 0)
        self.assertEqual([], self.db.foreign_key_violations())
        self.assertTrue(made["join_token"])

    def test_everybody_in_the_dataset_can_reach_what_they_wrote_in(self):
        """A discussion between people who cannot open the storyboard reads as a fake."""
        seed_demo.seed(self.db, self.data)
        rows = self.db.conn.execute(
            "SELECT DISTINCT u.handle AS handle, e.storyboard_id AS board FROM entries e "
            "JOIN users u ON u.id = e.author_id").fetchall()
        self.assertTrue(rows)
        for row in rows:
            level = self.db.grant_level(row["board"], self.user(row["handle"]))
            self.assertIsNotNone(level, f"@{row['handle']} wrote somewhere they cannot open")

    def test_the_demo_identities_cannot_be_signed_into_without_their_password(self):
        """Every seeded handle is printed beside what it wrote, and an owner token closes
        the storyboard and revokes everybody's access. A passwordless cast would hand that
        to anybody who read a name off the screen.
        """
        seed_demo.seed(self.db, self.data)
        for row in self.db.conn.execute("SELECT handle, password_hash FROM users").fetchall():
            self.assertTrue(row["password_hash"], f"@{row['handle']} has no password")

    def test_seed_then_clear_leaves_nothing(self):
        """The round trip, which is the point of having both."""
        seed_demo.seed(self.db, self.data)
        self.assertTrue(self.count("entries") > 0)
        teardown_demo.clear(self.db)
        for table in teardown_demo.TABLES:
            self.assertEqual(0, self.count(table), f"{table} survived the clear")


if __name__ == "__main__":
    unittest.main()
