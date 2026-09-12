"""数据层测试。重点是 data-model.md §2 那三条不变量——它们是权限模型的全部内容。

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
from proxy.app import Deps, handle                                   # noqa: E402
from proxy.db import (Database, SqliteContext, SqliteHistory,        # noqa: E402
                      SqliteRateLimiter, SqliteScreeningLog)
from proxy.model import UpstreamError                                # noqa: E402
from proxy.ports import PermissionDenied, RateLimited                # noqa: E402

VERSION = (ROOT / "prompts" / "VERSION").read_text(encoding="utf-8").strip()

TABLES = {"users", "videos", "storyboards", "entries", "access_grants",
          "share_links", "chat_messages", "screening_results", "rate_limits",
          "review_votes"}

OK_JSON = '{"verdict":"ok","codes":[],"note":""}'
REVIEW_JSON = '{"verdict":"review","codes":["fact_conflict"],"note":"lifespan is off"}'
REJECT_JSON = '{"verdict":"reject","codes":["pii"],"note":"address named"}'


class FakeClient:
    chat_model = "fake-model"

    def __init__(self, reply="ok"):
        self.reply = reply
        self.calls = []

    def call(self, role, system, content, history=()):
        self.calls.append({"role": role, "content": content, "history": list(history)})
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
                         "docs/ 不进仓库，clone 下来通常没有")
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
    """author_id != requester_id 的内容永远不进 context。"""

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
    """软删的 entry 立即消失，不吃缓存。"""

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


class InvariantThree(Fixture):
    """撤销的 grant 立即失效，该分区的聊天记录同时停读。"""

    def test_revoked_grant_denies_context_immediately(self):
        self.context.build(self.guest, self.storyboard)          # 撤销前拿得到
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
    """筛查结果落库。三种 subject 都要装得下，见 data-model.md §6。"""

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

    def test_a_screened_entry_points_at_that_entry(self):
        entry = self.db.add_entry(self.storyboard, self.owner, "brushtail", story="mine")
        _, _, row = self.screen("Ringtails live about 40 years.", REVIEW_JSON,
                                subject_type="entry", subject_id=entry)
        self.assertEqual("entry", row["subject_type"])
        self.assertEqual(entry, row["subject_id"])

    def test_a_forum_post_fits_before_the_forum_table_exists(self):
        _, _, row = self.screen("possums carry rabies", REJECT_JSON, field="forum_post",
                                subject_type="forum_post", subject_id="post-1")
        self.assertEqual("forum_post", row["subject_type"])
        self.assertEqual("post-1", row["subject_id"])

    def test_a_subject_type_without_an_id_is_refused(self):
        deps = Deps(client=FakeClient(OK_JSON), screening=SqliteScreeningLog(self.db))
        status, _ = handle({"role": "screener", "field": "fun_fact", "submission": "x",
                            "subject_type": "entry"}, auth.issue(self.owner), deps)
        self.assertEqual(400, status)
        self.assertIsNone(self.db.conn.execute(
            "SELECT 1 FROM screening_results").fetchone())

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
    """user-flow §9：30 天没动静转只读，owner 可以主动完结。归档不等于删除。"""

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
    """data-model.md §4 那张触发表，逐行。"""

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
        self.assertEqual(["mine"], [e["story"] for e in self.db.timeline(self.storyboard)])
        self.assertEqual(0, self.remaining())
        self.assertEqual(0, self.db.conn.execute(
            "SELECT COUNT(*) AS c FROM chat_messages WHERE user_id = ?",
            (self.guest,)).fetchone()["c"])

    def test_deleting_an_account_leaves_an_anonymous_tombstone(self):
        self.db.delete_account(self.guest)
        handle = self.db.conn.execute("SELECT handle FROM users WHERE id = ?",
                                      (self.guest,)).fetchone()["handle"]
        self.assertTrue(handle.startswith("deleted-"))
        self.assertNotEqual("guest", handle)
        # owner 的故事版不受影响
        self.assertEqual("active", self.db.storyboard_status(self.storyboard))

    def test_deleting_an_account_turns_off_the_links_they_issued(self):
        link = self.db.add_share_link(self.storyboard, self.guest, "somehash", "view", None, None)
        self.db.delete_account(self.guest)
        self.assertIsNotNone(self.db.share_link(link)["revoked_at"])

    def test_the_teardown_script_empties_every_table(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import teardown_demo
        self.db.add_entry(self.storyboard, self.owner, "brushtail", story="anything")
        self.history.append(self.owner, self.storyboard, "user", "anything")
        removed = teardown_demo.clear(self.db)
        self.assertTrue(removed["entries"] >= 1)
        self.assertEqual({0}, set(teardown_demo.counts(self.db).values()))


class Limits(Fixture):
    """operations §3 的三条上限，落在表上而不是内存里。"""

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

    def test_scopes_are_counted_apart(self):
        limiter = self.limiter()
        limiter.check_and_count(self.owner, "vision")
        limiter.check_and_count(self.owner, "chat")      # vision 用满了也不该挡住 chat

    def test_people_are_counted_apart(self):
        limiter = self.limiter()
        limiter.check_and_count(self.owner, "vision")
        limiter.check_and_count(self.guest, "vision")    # 别人用满不该挡住我

    def test_old_uses_fall_out_of_the_window(self):
        limiter = self.limiter()
        stale = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(timespec="seconds")
        self.db.conn.execute(
            "INSERT INTO rate_limits (id, user_id, scope, used_at) VALUES (?, ?, 'vision', ?)",
            (uuid4().hex, self.owner, stale))
        self.db.conn.commit()
        limiter.check_and_count(self.owner, "vision")    # 两小时前那次不算数
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
            # 另一个实例，同一个库：serverless 上就是这个情形
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


if __name__ == "__main__":
    unittest.main()
