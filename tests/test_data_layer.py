"""Data-layer tests. The three invariants in data-model.md §2 are the whole permission model.

    python tests/test_data_layer.py
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ.setdefault("FENCEPOST_TOKEN_SECRET", "test-secret")

from proxy import auth                                               # noqa: E402
from proxy import db as db_module                                   # noqa: E402
from proxy.app import TIMELINE_PAGE, Deps, handle, _record_screening  # noqa: E402
from proxy import roles                                             # noqa: E402
from proxy.db import (Database, SqliteCeilings, SqliteContext,       # noqa: E402
                      SqliteHistory, SqliteRateLimiter, SqliteScreeningLog)
from proxy.model import UpstreamError                                # noqa: E402
from proxy.ports import MemoryCeilings, PermissionDenied, RateLimited  # noqa: E402

VERSION = (ROOT / "prompts" / "VERSION").read_text(encoding="utf-8").strip()

TABLES = {"users", "videos", "storyboards", "entries", "access_grants",
          "share_links", "chat_messages", "screening_results", "rate_limits",
          "ceilings", "forum_threads", "forum_posts", "review_votes"}

OK_JSON = '{"verdict":"ok","codes":[],"note":""}'
REVIEW_JSON = '{"verdict":"review","codes":["fact_conflict"],"note":"lifespan is off"}'
REJECT_JSON = '{"verdict":"reject","codes":["pii"],"note":"address named"}'


class FakeClient:
    chat_model = "fake-model"

    def __init__(self, reply="ok"):
        self.reply = reply
        self.calls = []

    def call(self, role, system, content, history=()):
        # system is recorded because that is where the context block rides — an
        # assertion that some text "never reaches the model" is only as wide as the
        # part of the request it looks at.
        self.calls.append({"role": role, "system": system, "content": content,
                           "history": list(history)})
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


class Fixture(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.context = SqliteContext(self.db)
        self.history = SqliteHistory(self.db)
        self.owner = self.db.add_user("owner")
        self.guest = self.db.add_user("guest")
        self.storyboard = self.db.add_storyboard(self.owner, "Fence at number 12")
        self.db.grant(self.storyboard, self.guest, "contribute", self.owner)


class Schema(Fixture):
    def test_tables_come_from_the_generated_schema(self):
        self.assertEqual(TABLES, self.db.tables())

    @unittest.skipUnless((ROOT / "docs" / "data-model.md").exists(),
                         "docs/ is not in the repository, so a clone usually lacks it")
    def test_schema_sql_has_not_drifted_from_the_doc(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import build_schema
        self.assertEqual(build_schema.render(),
                         (ROOT / "schema.sql").read_text(encoding="utf-8"))

    def test_species_constraint_is_live(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.add_entry(self.storyboard, self.owner, "dog")

    def test_foreign_keys_are_enforced(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.add_entry("no-such-storyboard", self.owner, "brushtail")

    def test_owner_can_reach_their_own_storyboard(self):
        context = self.context.build(self.owner, self.storyboard)
        self.assertTrue(context["storyboard_visible_to_this_user"])


class InvariantOne(Fixture):
    """Content whose author_id != requester_id never enters the context."""

    def test_other_peoples_entries_are_not_returned(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="mine, on the fence")
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="theirs, in the tree")
        context = self.context.build(self.owner, self.storyboard)
        stories = [entry["story"] for entry in context["own_entries"]]
        self.assertEqual(["mine, on the fence"], stories)

    def test_other_peoples_entries_never_reach_the_model(self):
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="SECRET FROM THE NEIGHBOUR")
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="mine, on the fence")
        client = FakeClient("sure")
        deps = Deps(client=client, history=self.history, context=self.context)
        status, _ = handle({"role": "neighbour", "storyboard_id": self.storyboard,
                            "message": "what have people written here?"},
                           auth.issue(self.owner), deps)
        self.assertEqual(200, status)
        sent = json.dumps(client.calls[0], ensure_ascii=False)
        self.assertIn("mine, on the fence", sent)
        self.assertNotIn("SECRET FROM THE NEIGHBOUR", sent)

    def test_species_falls_back_to_unknown_without_entries(self):
        self.assertEqual("unknown", self.context.build(self.owner, self.storyboard)["species_selected"])

    def test_species_follows_the_latest_own_entry(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail")
        self.db.add_entry(self.storyboard, self.owner, "ringtail")
        self.assertEqual("ringtail", self.context.build(self.owner, self.storyboard)["species_selected"])


class InvariantTwo(Fixture):
    """A soft-deleted entry disappears at once, with no cache in the way."""

    def test_soft_deleted_entry_disappears_on_the_next_call(self):
        entry = self.db.add_entry(self.storyboard, self.owner, "brushtail", story="about to go")
        self.assertEqual(1, len(self.context.build(self.owner, self.storyboard)["own_entries"]))
        self.db.soft_delete_entry(entry)
        self.assertEqual([], self.context.build(self.owner, self.storyboard)["own_entries"])

    def test_deleted_entry_does_not_set_the_species(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail")
        gone = self.db.add_entry(self.storyboard, self.owner, "ringtail")
        self.db.soft_delete_entry(gone)
        self.assertEqual("brushtail", self.context.build(self.owner, self.storyboard)["species_selected"])

    def test_a_deleted_entry_never_reaches_the_model_again(self):
        """Through the whole request, not just the context: the next call carries the
        previous call's history, so nothing stored may bring the deleted text back. The
        context block rides with the system prompt, rebuilt from the database every call,
        and history stores only the bare messages — that combination is what makes this
        hold on every deletion path at once, with no purge hook any of them could forget.
        """
        entry = self.db.add_entry(self.storyboard, self.owner, "brushtail", story="WILL BE DELETED")
        client = FakeClient("sure")
        deps = Deps(client=client, history=self.history, context=self.context)
        body = {"role": "neighbour", "storyboard_id": self.storyboard, "message": "tell me about it"}
        handle(body, auth.issue(self.owner), deps)
        self.assertIn("WILL BE DELETED", json.dumps(client.calls[0], ensure_ascii=False))
        self.db.soft_delete_entry(entry)
        handle(body, auth.issue(self.owner), deps)
        self.assertNotIn("WILL BE DELETED", json.dumps(client.calls[1], ensure_ascii=False))

    def test_an_edit_takes_effect_on_the_next_call(self):
        """prompts.md §2.6.3: deletion and editing take effect immediately — the old
        wording must not survive in the sent request either."""
        entry = self.db.add_entry(self.storyboard, self.owner, "brushtail", story="the old wording")
        client = FakeClient("sure")
        deps = Deps(client=client, history=self.history, context=self.context)
        body = {"role": "neighbour", "storyboard_id": self.storyboard, "message": "tell me about it"}
        handle(body, auth.issue(self.owner), deps)
        self.db.update_entry(entry, None, "the new wording")
        handle(body, auth.issue(self.owner), deps)
        sent = json.dumps(client.calls[1], ensure_ascii=False)
        self.assertIn("the new wording", sent)
        self.assertNotIn("the old wording", sent)


class InvariantThree(Fixture):
    """A revoked grant stops working at once, and that partition's chat stops being read."""

    def test_revoked_grant_denies_context_immediately(self):
        self.context.build(self.guest, self.storyboard)          # reachable before the revoke
        self.db.revoke(self.storyboard, self.guest)
        with self.assertRaises(PermissionDenied):
            self.context.build(self.guest, self.storyboard)

    def test_revoked_grant_stops_the_history_partition(self):
        self.history.append(self.guest, self.storyboard, "user", "earlier question")
        self.assertEqual(1, len(self.history.recent(self.guest, self.storyboard)))
        self.db.revoke(self.storyboard, self.guest)
        self.assertEqual([], self.history.recent(self.guest, self.storyboard))

    def test_revoked_user_gets_403_from_the_endpoint(self):
        self.db.revoke(self.storyboard, self.guest)
        deps = Deps(client=FakeClient(), history=self.history, context=self.context)
        status, payload = handle({"role": "neighbour", "storyboard_id": self.storyboard,
                                  "message": "what did I write?"}, auth.issue(self.guest), deps)
        self.assertEqual(403, status)
        self.assertEqual("no_access", payload["error"]["code"])

    def test_regrant_brings_the_partition_back(self):
        self.history.append(self.guest, self.storyboard, "user", "earlier question")
        self.db.revoke(self.storyboard, self.guest)
        self.db.grant(self.storyboard, self.guest, "view", self.owner)
        self.assertEqual(1, len(self.history.recent(self.guest, self.storyboard)))


class History(Fixture):
    def test_history_is_partitioned_by_storyboard(self):
        other = self.db.add_storyboard(self.owner)
        self.history.append(self.owner, other, "user", "line from the other storyboard")
        self.history.append(self.owner, self.storyboard, "user", "line from this one")
        recent = self.history.recent(self.owner, self.storyboard)
        self.assertEqual(["line from this one"], [m["content"] for m in recent])

    def test_history_keeps_the_last_six(self):
        for i in range(10):
            self.history.append(self.owner, self.storyboard, "user", f"line {i}")
        recent = self.history.recent(self.owner, self.storyboard)
        self.assertEqual(6, len(recent))
        self.assertEqual("line 9", recent[-1]["content"])

    def test_prompt_version_and_model_are_stored(self):
        deps = Deps(client=FakeClient("a reply"), history=self.history, context=self.context)
        handle({"role": "neighbour", "storyboard_id": self.storyboard, "message": "hello"},
               auth.issue(self.owner), deps)
        row = self.db.conn.execute(
            "SELECT role, prompt_version, model FROM chat_messages WHERE role = 'assistant'").fetchone()
        self.assertEqual(VERSION, row["prompt_version"])
        self.assertEqual("fake-model", row["model"])

    def test_archiving_drops_the_partition(self):
        self.history.append(self.owner, self.storyboard, "user", "will be archived")
        self.history.drop_partition(self.owner, self.storyboard)
        self.assertEqual([], self.history.recent(self.owner, self.storyboard))


class Screening(Fixture):
    """Screening results are stored. All three subject kinds have to fit; data-model.md §6."""

    def screen(self, submission, reply, **over):
        deps = Deps(client=FakeClient(reply), history=self.history, context=self.context,
                    screening=SqliteScreeningLog(self.db))
        body = {"role": "screener", "field": "fun_fact", "submission": submission}
        body.update(over)
        status, payload = handle(body, auth.issue(self.owner), deps)
        row = self.db.conn.execute(
            "SELECT * FROM screening_results ORDER BY rowid DESC LIMIT 1").fetchone()
        return status, payload, row

    def test_ok_keeps_no_original_text(self):
        _, payload, row = self.screen("Brushtails are nocturnal.", OK_JSON)
        self.assertTrue(payload["published"])
        self.assertEqual("ok", row["verdict"])
        self.assertIsNone(row["original_text"])
        self.assertEqual("submission", row["subject_type"])
        self.assertIsNone(row["subject_id"])

    def test_reject_keeps_the_original_text(self):
        _, payload, row = self.screen("He lives at 42 Example St.", REJECT_JSON)
        self.assertFalse(payload["published"])
        self.assertEqual("He lives at 42 Example St.", row["original_text"])
        self.assertEqual(["pii"], json.loads(row["codes"]))
        self.assertEqual("address named", row["note"])

    def test_review_keeps_the_original_text_too(self):
        _, _, row = self.screen("Ringtails live about 40 years.", REVIEW_JSON)
        self.assertEqual("review", row["verdict"])
        self.assertEqual("Ringtails live about 40 years.", row["original_text"])

    def record(self, text, reply, field="fun_fact", **kw):
        """Screen and store the way the server does it: submit_entry, create_post and the
        forum edit all call _record_screening directly, with a subject the server itself
        established. Going through /api/assistant instead is what let anybody file a verdict
        against somebody else's entry, so these tests no longer take that route either."""
        deps = Deps(client=FakeClient(reply), screening=SqliteScreeningLog(self.db))
        internal = roles.screener(deps.client, "brushtail", field, text)
        _record_screening(deps, internal, field, text, kw["subject_type"],
                          kw["subject_id"], author_id=self.owner)
        return self.db.conn.execute(
            "SELECT * FROM screening_results ORDER BY rowid DESC LIMIT 1").fetchone()

    def test_a_screened_entry_points_at_that_entry(self):
        entry = self.db.add_entry(self.storyboard, self.owner, "brushtail", story="mine")
        row = self.record("Ringtails live about 40 years.", REVIEW_JSON,
                          subject_type="entry", subject_id=entry)
        self.assertEqual("entry", row["subject_type"])
        self.assertEqual(entry, row["subject_id"])

    def test_a_forum_post_fits_before_the_forum_table_exists(self):
        row = self.record("possums carry rabies", REJECT_JSON, field="forum_post",
                          subject_type="forum_post", subject_id="post-1")
        self.assertEqual("forum_post", row["subject_type"])
        self.assertEqual("post-1", row["subject_id"])

    def test_a_caller_cannot_screen_anything_but_loose_text(self):
        """The hole an adversarial review found on 2026-09-16.

        _admit is token, role and quota — no grant, no authorship. So role=screener with
        subject_type="entry" let anybody stamp a review verdict on any entry id: the
        victim's entry appeared in the storyboard's review queue with reason codes the
        attacker chose, awaiting_review turned true, and the owner's remove button — which
        answers 409 for an unflagged entry — started working on it. The audit row named the
        attacker as the author of text they never wrote.
        """
        victim_entry = self.db.add_entry(self.storyboard, self.owner, "brushtail",
                                         story="written by somebody else")
        stranger = self.db.add_user("passing-stranger")
        deps = Deps(client=FakeClient(REJECT_JSON), screening=SqliteScreeningLog(self.db))
        for subject_type, subject_id in (("entry", victim_entry),
                                         ("forum_post", "post-1"),
                                         ("entry", None)):
            status, _ = handle({"role": "screener", "field": "fun_fact", "submission": "x",
                                "subject_type": subject_type, "subject_id": subject_id},
                               auth.issue(stranger), deps)
            self.assertEqual(400, status, f"{subject_type} was accepted from a caller")
        self.assertIsNone(self.db.conn.execute(
            "SELECT 1 FROM screening_results").fetchone())

    def test_loose_text_is_still_screened_and_points_at_nothing(self):
        # The legitimate use of the endpoint, unchanged: check text before posting it. It
        # records no subject, so it cannot reach anybody else's row.
        deps = Deps(client=FakeClient(OK_JSON), screening=SqliteScreeningLog(self.db))
        status, payload = handle({"role": "screener", "field": "fun_fact",
                                  "submission": "Brushtails are nocturnal."},
                                 auth.issue(self.owner), deps)
        self.assertEqual(200, status)
        self.assertTrue(payload["published"])
        row = self.db.conn.execute(
            "SELECT * FROM screening_results ORDER BY rowid DESC LIMIT 1").fetchone()
        self.assertEqual("submission", row["subject_type"])
        self.assertIsNone(row["subject_id"])

    def test_fail_open_is_recorded(self):
        _, payload, row = self.screen("anything", UpstreamError("boom"))
        self.assertTrue(payload["published"])
        self.assertEqual("review", row["verdict"])
        self.assertEqual(1, row["fail_open"])

    def test_the_language_floor_is_recorded(self):
        _, payload, row = self.screen("他住在四十二号，史密斯家的屋顶。", REJECT_JSON)
        self.assertTrue(payload["published"])
        self.assertEqual("review", row["verdict"])
        self.assertEqual(1, row["downgraded_non_english"])

    def test_the_check_constraint_catches_a_dangling_subject(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.conn.execute(
                "INSERT INTO screening_results (id, subject_type, subject_id, field, verdict, "
                "created_at) VALUES ('x', 'entry', NULL, 'fun_fact', 'ok', '2026-09-12T00:00:00+00:00')")


class Archiving(Fixture):
    """user-flow §9: 30 days quiet turns it read-only, and an owner can close it
    deliberately. Archived is not deleted.
    """

    def age(self, storyboard_id, days=40):
        old = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        self.db.conn.execute("UPDATE storyboards SET last_entry_at = ? WHERE id = ?",
                             (old, storyboard_id))
        self.db.conn.commit()

    def test_thirty_days_without_an_entry_turns_it_read_only(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="the last one")
        self.age(self.storyboard)
        self.assertEqual(1, self.db.settle_stale())
        self.assertEqual("readonly", self.db.storyboard_status(self.storyboard))

    def test_a_storyboard_with_recent_activity_is_left_alone(self):
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="yesterday")
        self.assertEqual(0, self.db.settle_stale())
        self.assertEqual("active", self.db.storyboard_status(self.storyboard))

    def test_settling_clears_that_storyboards_chat(self):
        self.history.append(self.owner, self.storyboard, "user", "will not survive archiving")
        self.age(self.storyboard)
        self.db.settle_stale()
        self.assertEqual([], self.history.recent(self.owner, self.storyboard))

    def test_the_owner_can_close_it_with_a_note(self):
        self.db.close_storyboard(self.storyboard, "that was the last of them")
        row = self.db.conn.execute("SELECT status, closed_note FROM storyboards WHERE id = ?",
                                   (self.storyboard,)).fetchone()
        self.assertEqual("archived", row["status"])
        self.assertEqual("that was the last of them", row["closed_note"])

    def test_closing_clears_the_chat_too(self):
        self.history.append(self.owner, self.storyboard, "user", "goes with it")
        self.db.close_storyboard(self.storyboard)
        self.assertEqual([], self.history.recent(self.owner, self.storyboard))

    def test_a_read_only_storyboard_still_resolves_for_a_grant_holder(self):
        self.age(self.storyboard)
        self.db.settle_stale()
        context = self.context.build(self.guest, self.storyboard)
        self.assertTrue(context["storyboard_visible_to_this_user"])


class Retention(Fixture):
    """The trigger table in data-model.md §4, row by row."""

    def screening_row(self, author, verdict, age_days):
        stamp = (datetime.now(timezone.utc) - timedelta(days=age_days)).isoformat(timespec="seconds")
        self.db.conn.execute(
            "INSERT INTO screening_results (id, subject_type, subject_id, author_id, field, "
            "verdict, codes, original_text, created_at) "
            "VALUES (?, 'submission', NULL, ?, 'fun_fact', ?, '[]', 'their words', ?)",
            (uuid4().hex, author, verdict, stamp))
        self.db.conn.commit()

    def remaining(self):
        return self.db.conn.execute("SELECT COUNT(*) AS c FROM screening_results").fetchone()["c"]

    def test_screening_results_go_thirty_days_after_disposal(self):
        self.screening_row(self.owner, "ok", 40)
        self.screening_row(self.owner, "reject", 40)
        self.screening_row(self.owner, "ok", 3)
        self.assertEqual(2, self.db.purge_screening())
        self.assertEqual(1, self.remaining())

    def test_items_still_under_review_are_left_in_the_queue(self):
        self.screening_row(self.owner, "review", 90)
        self.assertEqual(0, self.db.purge_screening())
        self.assertEqual(1, self.remaining())

    def test_deleting_an_account_removes_their_content_everywhere(self):
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="theirs, in my storyboard")
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="mine")
        self.history.append(self.guest, self.storyboard, "user", "their question")
        self.screening_row(self.guest, "reject", 1)
        self.db.delete_account(self.guest)
        self.assertEqual(["mine"],
                         [e["story"] for e in self.db.timeline(self.storyboard, TIMELINE_PAGE)])
        self.assertEqual(0, self.remaining())
        self.assertEqual(0, self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM chat_messages WHERE user_id = ?",
            (self.guest,)).fetchone()["c"])

    def test_deleting_an_account_clears_other_peoples_votes_on_its_entries(self):
        """The cascade used to stop halfway, holding the transaction open.

        review_votes.entry_id has a foreign key to entries(id), and both backends enforce it
        (store.py turns PRAGMA foreign_keys on). delete_account cleared the votes this person
        *cast* and then deleted their entries — so a vote somebody else had cast on one of
        those entries made the delete raise, after the screening rows, chat and everything
        earlier in the loop had already run and before the commit at the end. The connection
        was left holding a dirty transaction for whichever writer touched the instance next.
        """
        entry = self.db.add_entry(self.storyboard, self.guest, "ringtail", story="theirs")
        self.db.cast_vote(entry, self.owner, "worth_checking")
        removed = self.db.delete_account(self.guest)
        self.assertEqual(1, removed["votes_on_my_entries"])
        self.assertEqual(0, self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM review_votes").fetchone()["c"])
        self.assertEqual([], [e["story"] for e in self.db.timeline(self.storyboard, TIMELINE_PAGE)])

    def test_deleting_an_account_leaves_an_anonymous_tombstone(self):
        self.db.delete_account(self.guest)
        handle = self.db.conn.execute("SELECT handle FROM users WHERE id = ?",
                                      (self.guest,)).fetchone()["handle"]
        self.assertTrue(handle.startswith("deleted-"))
        self.assertNotEqual("guest", handle)
        # The owner's own storyboard is untouched
        self.assertEqual("active", self.db.storyboard_status(self.storyboard))

    def test_deleting_an_account_takes_their_forum_posts(self):
        thread, _ = self.db.add_thread(self.storyboard, self.guest, "their thread", "their words")
        self.db.add_post(thread, self.owner, "my reply stays")
        self.db.delete_account(self.guest)
        bodies = [p["body"] for p in self.db.posts(thread)]
        self.assertEqual(["my reply stays"], bodies)

    def test_deleting_an_account_turns_off_the_links_they_issued(self):
        link = self.db.add_share_link(self.storyboard, self.guest, "somehash", "view", None, None)
        self.db.delete_account(self.guest)
        self.assertIsNotNone(self.db.share_link(link)["revoked_at"])

    def flagged_row(self, fail_open=0, downgraded=0):
        self.db.conn.execute(
            "INSERT INTO screening_results (id, subject_type, subject_id, author_id, field, "
            "verdict, codes, original_text, fail_open, downgraded_non_english, created_at) "
            "VALUES (?, 'submission', NULL, ?, 'fun_fact', 'review', '[]', 'their words', "
            "?, ?, ?)",
            (uuid4().hex, self.owner, fail_open, downgraded,
             datetime.now(timezone.utc).isoformat(timespec="seconds")))
        self.db.conn.commit()

    def test_the_teardown_report_counts_fail_open_and_the_language_floor(self):
        """Both markers have only ever been written, never read. The ethics section
        asks how much screening was skipped, and this is the only place that can answer.
        """
        sys.path.insert(0, str(ROOT / "scripts"))
        import teardown_demo
        self.flagged_row(fail_open=1)
        self.flagged_row(fail_open=1)
        self.flagged_row(downgraded=1)
        flags = teardown_demo.screening_flags(self.db)
        self.assertEqual(2, flags["fail_open"])
        self.assertEqual(1, flags["downgraded"])
        self.assertEqual(3, flags["total"])

    def test_the_teardown_report_never_carries_the_refused_text(self):
        """Counting is safe; printing is not.

        `original_text` holds the refused wording, including the personal information that
        triggered the refusal. This pins down that the report carries none of it —
        otherwise a set of numbers assembled for an ethics review would copy out the very
        thing it exists to protect.
        """
        sys.path.insert(0, str(ROOT / "scripts"))
        import teardown_demo
        self.flagged_row(fail_open=1)
        blob = json.dumps(teardown_demo.screening_flags(self.db), ensure_ascii=False, default=str)
        self.assertNotIn("their words", blob)

    def test_the_teardown_report_reads_zero_from_an_empty_table(self):
        """SUM over an empty table returns NULL, not 0. Without COALESCE a freshly
        cleared database prints None, which reads like a broken report rather than like
        nothing having ever fallen back.
        """
        sys.path.insert(0, str(ROOT / "scripts"))
        import teardown_demo
        self.db.conn.execute("DELETE FROM screening_results")
        self.db.conn.commit()
        flags = teardown_demo.screening_flags(self.db)
        self.assertEqual(0, flags["total"])
        self.assertEqual(0, flags["fail_open"])
        self.assertEqual(0, flags["downgraded"])
        self.assertIsNone(flags["first_fail_open"])

    def test_the_teardown_script_empties_every_table(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import teardown_demo
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="anything")
        self.history.append(self.owner, self.storyboard, "user", "anything")
        removed = teardown_demo.clear(self.db)
        self.assertTrue(removed["entries"] >= 1)
        self.assertEqual({0}, set(teardown_demo.counts(self.db).values()))


class Limits(Fixture):
    """The three ceilings from operations §3, held in a table rather than in memory."""

    CAPS = {"chat": (2, 86400), "vision": (1, 3600), "submission": (2, 3600)}

    def limiter(self, db=None):
        return SqliteRateLimiter(db or self.db, self.CAPS)

    def test_each_window_is_enforced(self):
        limiter = self.limiter()
        for scope, (cap, _) in self.CAPS.items():
            with self.subTest(scope=scope):
                for _ in range(cap):
                    limiter.check_and_count(self.owner, scope)
                with self.assertRaises(RateLimited) as caught:
                    limiter.check_and_count(self.owner, scope)
                self.assertEqual(scope, caught.exception.scope)

    def test_a_refused_request_does_not_spend_quota(self):
        """The slot is claimed before it is counted, so a refusal has to give it back.

        Counting first and inserting afterwards let concurrent requests on one identity all
        read the same total and all insert, so the ceiling was whatever arrived between two
        round trips. Claiming first closes that, but only if the loser removes its own row —
        otherwise being refused would itself consume the quota it was refused for, and the
        window would never reopen.
        """
        limiter = self.limiter()
        cap, _ = self.CAPS["chat"]
        for _ in range(cap):
            limiter.check_and_count(self.owner, "chat")
        for _ in range(3):
            with self.assertRaises(RateLimited):
                limiter.check_and_count(self.owner, "chat")
        rows = self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM rate_limits WHERE user_id = ? AND scope = 'chat'",
            (self.owner,)).fetchone()["c"]
        self.assertEqual(cap, rows, "a refused request left its row behind")

    def test_the_cap_holds_when_the_count_is_read_stale(self):
        """The concurrency the old order got wrong, reproduced without threads.

        Several instances reading before any of them writes is what made the limit porous.
        Standing in for that: fill the window to the cap, then let a request arrive that
        would have passed under a count taken beforehand. It must still be refused, because
        the check now happens after the row exists rather than before.
        """
        limiter = self.limiter()
        cap, _ = self.CAPS["submission"]
        for _ in range(cap):
            limiter.check_and_count(self.owner, "submission")
        with self.assertRaises(RateLimited):
            limiter.check_and_count(self.owner, "submission")
        self.assertEqual(cap, self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM rate_limits WHERE user_id = ? AND scope = 'submission'",
            (self.owner,)).fetchone()["c"])

    def test_scopes_are_counted_apart(self):
        limiter = self.limiter()
        limiter.check_and_count(self.owner, "vision")
        limiter.check_and_count(self.owner, "chat")      # a used-up vision quota must not block chat

    def test_people_are_counted_apart(self):
        limiter = self.limiter()
        limiter.check_and_count(self.owner, "vision")
        limiter.check_and_count(self.guest, "vision")    # somebody else being out is not my problem

    def test_old_uses_fall_out_of_the_window(self):
        limiter = self.limiter()
        stale = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
        self.db.conn.execute(
            "INSERT INTO rate_limits (id, user_id, scope, used_at) VALUES (?, ?, 'vision', ?)",
            (uuid4().hex, self.owner, stale))
        self.db.conn.commit()
        limiter.check_and_count(self.owner, "vision")    # two hours ago does not count
        self.assertEqual(1, self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM rate_limits WHERE user_id = ?",
            (self.owner,)).fetchone()["c"])

    def test_the_count_survives_a_new_process(self):
        folder = Path(tempfile.mkdtemp())
        path = str(folder / "limits.db")
        try:
            first = Database(path)
            user = first.add_user("across-processes")
            for _ in range(2):
                self.limiter(first).check_and_count(user, "chat")
            # A different instance against the same database: the serverless case
            second = Database(path)
            with self.assertRaises(RateLimited):
                self.limiter(second).check_and_count(user, "chat")
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def test_deleting_an_account_takes_its_counters(self):
        self.limiter().check_and_count(self.guest, "chat")
        self.db.delete_account(self.guest)
        self.assertEqual(0, self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM rate_limits WHERE user_id = ?",
            (self.guest,)).fetchone()["c"])


class Ceilings(Fixture):
    """The two ceilings that belong to no user (operations §3), in their own table.

    Not rate_limits: its user_id is a NOT NULL foreign key, and neither the model ceiling nor
    the per-address session one has a user to point at.
    """

    def count(self, bucket):
        return self.db.conn.execute("SELECT COUNT(*) AS c FROM ceilings WHERE bucket = ?",
                                    (bucket,)).fetchone()["c"]

    def test_the_table_is_in_the_schema(self):
        self.assertIn("ceilings", self.db.tables())

    def test_the_cap_is_enforced_and_a_refusal_takes_nothing(self):
        ceilings = SqliteCeilings(self.db)
        for _ in range(3):
            self.assertTrue(ceilings.claim("model", 3, 86400))
        for _ in range(2):
            self.assertFalse(ceilings.claim("model", 3, 86400))
        self.assertEqual(3, self.count("model"), "a refused claim left its row behind")

    def test_slots_come_back_once_the_window_has_passed(self):
        ceilings = SqliteCeilings(self.db)
        stale = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
        for _ in range(2):
            self.db.conn.execute(
                "INSERT INTO ceilings (id, bucket, used_at) VALUES (?, 'session:x', ?)",
                (uuid4().hex, stale))
        self.db.conn.commit()
        self.assertTrue(ceilings.claim("session:x", 2, 3600))   # two hours ago does not count
        self.assertEqual(1, self.count("session:x"), "expired rows were not cleared")

    def test_buckets_are_counted_apart(self):
        ceilings = SqliteCeilings(self.db)
        self.assertTrue(ceilings.claim("session:a", 1, 3600))
        self.assertFalse(ceilings.claim("session:a", 1, 3600))
        self.assertTrue(ceilings.claim("session:b", 1, 3600))  # another network is not blocked
        self.assertTrue(ceilings.claim("model", 1, 3600))

    def test_the_count_is_shared_across_instances(self):
        folder = Path(tempfile.mkdtemp())
        try:
            first = Database(str(folder / "ceilings.db"))
            self.assertTrue(SqliteCeilings(first).claim("model", 1, 86400))
            second = Database(str(folder / "ceilings.db"))
            self.assertFalse(SqliteCeilings(second).claim("model", 1, 86400))
        finally:
            shutil.rmtree(folder, ignore_errors=True)

    def test_the_memory_twin_answers_the_same(self):
        clock = [1000.0]
        ceilings = MemoryCeilings(now=lambda: clock[0])
        self.assertTrue(ceilings.claim("model", 1, 60))
        self.assertFalse(ceilings.claim("model", 1, 60))
        self.assertTrue(ceilings.claim("session:a", 1, 60))
        clock[0] += 61
        self.assertTrue(ceilings.claim("model", 1, 60))


class SchemaRepairs(unittest.TestCase):
    """What happens to a database that was made before the document changed.

    _apply_schema returns early once all twelve tables exist, which is every deployed
    database. So a column added to data-model.md afterwards was never created, and the
    first code to use it failed on every call. Adding users.password_hash on 2026-09-15
    would have taken the live site down whole: INSERT INTO users is what every visitor's
    first request does, so the answer would have been 500 for everybody, not a degraded
    corner of the product.

    Its own empty database rather than the shared Fixture, which seeds users, a storyboard
    and grants: dropping the users table underneath those is a foreign key violation, and
    the thing being tested here is the shape of the schema rather than anything in it.
    """

    def setUp(self):
        self.db = Database()

    def columns(self, table):
        return {row["name"] for row in
                self.db.conn.execute(f"PRAGMA table_info({table})").fetchall()}

    def make_old_users_table(self):
        """A users table as it was before password_hash, with somebody already in it."""
        self.db.conn.execute("DROP TABLE users")
        self.db.conn.execute(
            "CREATE TABLE users (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, "
            "created_at TIMESTAMP NOT NULL)")
        self.db.conn.execute(
            "INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
            ("u_old", "mel_k", "2026-09-01T10:00:00+00:00"))
        self.db.conn.commit()

    def test_a_column_added_to_the_document_reaches_an_existing_database(self):
        self.make_old_users_table()
        self.assertNotIn("password_hash", self.columns("users"))
        self.db._apply_schema()
        self.assertIn("password_hash", self.columns("users"))

    def test_the_rows_already_there_survive_it(self):
        """ADD COLUMN keeps the rows; a rebuild done carelessly would not."""
        self.make_old_users_table()
        self.db._apply_schema()
        row = self.db.conn.execute("SELECT * FROM users WHERE id = 'u_old'").fetchone()
        self.assertEqual("mel_k", row["handle"])
        self.assertIsNone(row["password_hash"], "an existing person got a password somehow")

    def test_the_repair_is_what_lets_the_column_be_written(self):
        """The same failure from the other side: without the repair, the insert every
        visitor makes is the one that breaks.
        """
        self.make_old_users_table()
        self.db._apply_schema()
        self.assertTrue(self.db.add_user("ada_l", "scrypt$16384$8$1$c2FsdA==$aGFzaA=="))

    def test_running_it_again_changes_nothing(self):
        """It runs on every open, so it has to be quiet when there is nothing to do."""
        self.make_old_users_table()
        self.db._apply_schema()
        before = self.columns("users")
        self.db._apply_schema()
        self.assertEqual(before, self.columns("users"))

    def test_a_column_that_cannot_be_added_in_place_says_so(self):
        """NOT NULL without a default cannot be added to a populated table at all. Skipping
        it quietly would move the failure to the first insert, which is a worse place to
        find out about it.
        """
        self.make_old_users_table()
        real = db_module._schema_columns
        db_module._schema_columns = lambda table: (
            [("nickname", "nickname TEXT NOT NULL")] if table == "users" else real(table))
        try:
            with self.assertRaises(RuntimeError) as caught:
                self.db._apply_schema()
            self.assertIn("users.nickname", str(caught.exception))
            self.assertIn("by hand", str(caught.exception))
        finally:
            db_module._schema_columns = real

    def test_a_check_constraint_that_gained_a_value_is_rebuilt(self):
        """SQLite cannot alter a CHECK. rate_limits enumerates its scopes, so a database
        made before the login ceiling refuses that insert and answers 500 to every sign-in
        attempt, and a bucket that errors is not a bucket that limits.
        """
        self.db.conn.execute("DROP TABLE rate_limits")
        self.db.conn.execute(
            "CREATE TABLE rate_limits (id TEXT PRIMARY KEY, "
            "user_id TEXT NOT NULL REFERENCES users(id), "
            "scope TEXT NOT NULL CHECK (scope IN ('chat','vision','submission')), "
            "used_at TIMESTAMP NOT NULL)")
        self.db.conn.commit()

        self.db._apply_schema()

        self.db.conn.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                             ("u_1", "ada_l", "2026-09-15T10:00:00+00:00"))
        self.db.conn.execute(
            "INSERT INTO rate_limits (id, user_id, scope, used_at) VALUES (?, ?, ?, ?)",
            ("r_1", "u_1", "login", "2026-09-15T10:00:00+00:00"))
        self.db.conn.commit()
        kept = self.db.conn.execute("SELECT scope FROM rate_limits").fetchone()
        self.assertEqual("login", kept["scope"])

    def test_a_current_table_is_not_rebuilt_underneath_the_counters(self):
        """The trigger has to be narrow. A rebuild that fires on every open is a rate
        limiter that never counts to anything, and nothing would say so.
        """
        self.db.conn.execute("INSERT INTO users (id, handle, created_at) VALUES (?, ?, ?)",
                             ("u_1", "ada_l", "2026-09-15T10:00:00+00:00"))
        self.db.conn.execute(
            "INSERT INTO rate_limits (id, user_id, scope, used_at) VALUES (?, ?, ?, ?)",
            ("r_1", "u_1", "login", "2026-09-15T10:00:00+00:00"))
        self.db.conn.commit()

        self.db._apply_schema()

        left = self.db.conn.execute("SELECT COUNT(*) AS c FROM rate_limits").fetchone()["c"]
        self.assertEqual(1, left, "the counters were wiped by a repair with nothing to repair")


class StoredFrame(Fixture):
    """entries.still — what is kept, where it may be read, and when it goes.

    data-model.md 5 asked "does the visual frame land on disk; if it does, you need a frames
    table and a TTL task". entries.still answered that de facto in 99c969a and nothing was
    written down, so the two consequences the document anticipated were never weighed. These
    pin the answer that the code actually implements, since it is the answer the safety line
    in CLAUDE.md turns on: a masked, EXIF-stripped, card-sized copy that is the sighting's own
    picture and dies with the sighting is content, not a retained frame. Nothing here had a
    test before 2026-09-17.
    """

    FRAME = "/9j/4AAQSkZJRgABAQ"        # base64 JPEG, no data: prefix — the stored shape

    def test_the_masked_frame_reaches_the_timeline(self):
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="on the fence",
                          still=self.FRAME)
        self.assertEqual([self.FRAME],
                         [e["still"] for e in self.db.timeline(self.storyboard, TIMELINE_PAGE)])

    def test_the_frame_never_enters_the_assistant_context(self):
        """The one that matters most, and the reason this class exists.

        SqliteContext.build selects species, fun_fact and story — never still. A base64 image
        in the context would be a Tier 1 question nobody has answered and a large silent cost
        on every assistant call. Merging this query with timeline() would do it by accident,
        which is exactly what the docstring above timeline() warns against.
        """
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="on the fence",
                          still=self.FRAME)
        context = self.context.build(self.guest, self.storyboard)
        flattened = json.dumps(context)
        self.assertNotIn(self.FRAME, flattened)
        self.assertNotIn("still", flattened)
        # And the entry itself is still visible to its author, so this is not the context
        # being empty by accident.
        self.assertIn("on the fence", flattened)

    def test_soft_deleting_an_entry_takes_its_frame_off_the_timeline_at_once(self):
        """CLAUDE.md: a soft delete takes effect immediately, no cache and no TTL. That has
        to cover the picture as well as the words."""
        entry = self.db.add_entry(self.storyboard, self.guest, "ringtail", story="mine",
                                  still=self.FRAME)
        self.db.remove_entry(entry, self.owner)
        self.assertEqual([], self.db.timeline(self.storyboard, TIMELINE_PAGE))
        # Still in the row, and unreachable — which is what a soft delete is. The 30-day
        # purge is what removes the bytes; see operations 1.
        row = self.db.conn.execute("SELECT still, deleted_at FROM entries WHERE id = ?",
                                   (entry,)).fetchone()
        self.assertIsNotNone(row["deleted_at"])

    def test_deleting_an_account_takes_the_frame_with_the_entry(self):
        """No TTL task is needed for the stored copy because it has no life of its own: it is
        a column on the entry, so every path that removes an entry removes it."""
        self.db.add_entry(self.storyboard, self.guest, "ringtail", story="theirs",
                          still=self.FRAME)
        self.db.delete_account(self.guest)
        left = self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM entries WHERE still IS NOT NULL").fetchone()["c"]
        self.assertEqual(0, left)

    def test_an_entry_without_a_frame_is_an_ordinary_entry(self):
        """None is not a failure. The placeholder path has no clip behind it, and a browser
        that would not decode one arrives here the same way."""
        self.db.add_entry(self.storyboard, self.guest, "brushtail", story="no clip")
        self.assertEqual([None],
                         [e["still"] for e in self.db.timeline(self.storyboard, TIMELINE_PAGE)])


class Timestamps(Fixture):
    """Four queries compare stamps as strings, so the shape they are written in is a rule.

    settle_review, settle_stale, purge_screening and the rate limiter each build a cutoff and
    ask `column < ?`. Lexicographic ordering only matches chronological ordering while every
    stamp carries the same UTC offset, and that holds because db.now() is the only writer.
    Pinned here so a change to it has to be a decision rather than an accident.
    """

    def test_every_stamp_is_written_in_one_shape(self):
        stamp = db_module.now()
        self.assertTrue(stamp.endswith("+00:00"), stamp)
        self.assertNotIn(".", stamp, "sub-second precision would break the comparisons")
        self.assertEqual(len("2026-09-17T05:01:21+00:00"), len(stamp))

    def test_what_the_database_stores_has_that_shape_too(self):
        entry = self.db.add_entry(self.storyboard, self.guest, "ringtail", story="x")
        for table, column, key in (("entries", "created_at", entry),
                                   ("storyboards", "created_at", self.storyboard)):
            with self.subTest(table=table):
                got = self.db.conn.execute(
                    f"SELECT {column} AS stamp FROM {table} WHERE id = ?", (key,)).fetchone()
                self.assertTrue(str(got["stamp"]).endswith("+00:00"), got["stamp"])

    def test_string_order_is_time_order(self):
        early = db_module.now()
        later = (datetime.now(timezone.utc) + timedelta(days=400)).isoformat(timespec="seconds")
        self.assertLess(early, later, "a cutoff comparison would read these the wrong way round")


if __name__ == "__main__":
    unittest.main()
